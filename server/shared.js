import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { RedisStore } from 'rate-limit-redis';
import { AppError } from './validation.js';

// Redis coordinates delivery and throttling only. Supabase remains the source
// of truth for users, permissions, conversations, and saved messages.
export async function createSharedBackend(config, logger = console) {
  if (!config.redisUrl) {
    if (config.vercel) throw new Error('REDIS_URL is required on Vercel.');
    return null;
  }
  const client = createClient({
    url: config.redisUrl, RESP: 2, commandsQueueMaxLength: 1000,
    socket: { connectTimeout: 8000, reconnectStrategy: retries => Math.min(250 * 2 ** Math.min(retries, 4), 4000) }
  });
  let lastErrorAt = 0;
  client.on('error', () => {
    if (Date.now() - lastErrorAt > 30_000) {
      lastErrorAt = Date.now();
      // Never log the Redis URL or an error that might include credentials.
      logger.error('Redis connection unavailable. Check REDIS_URL and the Redis service.');
    }
  });
  let deadline;
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Redis connection timed out.')), 12_000); })
    ]);
  } catch {
    if (client.isOpen) client.destroy();
    throw new Error('Cannot connect to Redis. Check REDIS_URL (TLS connection string) and your Redis service.');
  } finally { clearTimeout(deadline); }

  const prefix = config.redisPrefix;
  const sendCommand = async (...args) => {
    if (!client.isReady) throw new AppError(503, 'Service temporarily unavailable. Please try again shortly.');
    try { return await client.sendCommand(args, { abortSignal: AbortSignal.timeout(3000) }); }
    catch (error) {
      // Let the store reload its Lua scripts after Redis restarts/evicts them.
      if (/^NOSCRIPT(?:\s|$)/.test(error.message)) throw error;
      throw new AppError(503, 'Service temporarily unavailable. Please try again shortly.');
    }
  };
  const rateStore = name => new RedisStore({ prefix: `${prefix}:rate:${name}:`, sendCommand });
  const socketStore = rateStore('socket');
  try { await socketStore.init({ windowMs: 60_000 }); }
  catch (error) { client.destroy(); throw error; }

  return {
    adapter: createAdapter(client, {
      streamName: `${prefix}:events`, channelPrefix: `${prefix}:pubsub`,
      sessionKeyPrefix: `${prefix}:sessions:`, maxLen: 10_000,
      blockTimeInMs: 5000, onlyPlaintext: true
    }),
    rateStore,
    ready: () => client.isReady,
    async getJson(key) {
      const value=await sendCommand('GET',`${prefix}:cache:${key}`);
      if(!value)return null;
      try{return JSON.parse(value);}catch{return null;}
    },
    async setJson(key,value,seconds) {await sendCommand('SET',`${prefix}:cache:${key}`,JSON.stringify(value),'EX',String(seconds));},
    async acquire(key,token,milliseconds) {return await sendCommand('SET',`${prefix}:lock:${key}`,token,'PX',String(milliseconds),'NX')==='OK';},
    async release(key,token) {
      await sendCommand('EVAL',"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",'1',`${prefix}:lock:${key}`,token);
    },
    async socketLimit(userId) {
      const { totalHits } = await socketStore.increment(userId);
      if (totalHits > 100) throw new AppError(429, 'Please slow down and try again.');
    },
    close() { if (client.isOpen) client.destroy(); }
  };
}

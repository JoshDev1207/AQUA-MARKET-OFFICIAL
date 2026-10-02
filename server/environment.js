import { createHash } from 'node:crypto';

const configured = value => Boolean(value && !value.includes('YOUR_'));

// Kept separate from provider clients so deployment configuration can be tested
// without opening a connection or loading private credentials.
export function readConfig(env = process.env) {
  const vercel = env.AQUA_HOST === 'vercel' || env.VERCEL === '1';
  const production = vercel || env.NODE_ENV === 'production';
  const defaultUrl = vercel && env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000';
  const appUrl = (env.APP_URL?.trim() || defaultUrl).replace(/\/+$/, '');
  let origin;
  try { origin = new URL(appUrl); } catch {
    throw new Error('APP_URL must be the complete website URL. See VERCEL.md.');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== appUrl) {
    throw new Error('APP_URL must contain only the website origin, without a path or query.');
  }
  if (production && (origin.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new Error('Production APP_URL must be your live HTTPS website URL, not localhost. See VERCEL.md.');
  }
  const redisUrl = env.REDIS_URL?.trim() || '';
  if (redisUrl) {
    let url;
    try { url = new URL(redisUrl); } catch { throw new Error('REDIS_URL must be a Redis connection string.'); }
    if (!['redis:', 'rediss:'].includes(url.protocol)) {
      throw new Error('REDIS_URL must start with redis:// or rediss://. Do not use a Redis REST URL/token.');
    }
    if (vercel && url.protocol !== 'rediss:') throw new Error('Use a TLS rediss:// connection for Redis on Vercel.');
  }
  if (vercel && !configured(redisUrl)) throw new Error('Vercel needs REDIS_URL for shared chat and rate limits. See VERCEL.md.');
  const port = Number(env.PORT || 3000);
  const trustProxy = vercel ? 1 : Number(env.TRUST_PROXY || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  if (!Number.isInteger(trustProxy) || trustProxy < 0) throw new Error('TRUST_PROXY must be a nonnegative proxy hop count.');
  const config = {
    port, appUrl, production, vercel, trustProxy, redisUrl,
    redisPrefix: env.REDIS_PREFIX?.trim() || 'aquamarket:' + createHash('sha256').update(appUrl).digest('hex').slice(0, 16),
    // Leave room for multipart form headers below Vercel's 4.5 MB limit.
    maxUploadBytes: 4_000_000,
    supabaseUrl: env.SUPABASE_URL || '', publicKey: env.SUPABASE_PUBLISHABLE_KEY || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '', cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    cloudKey: env.CLOUDINARY_API_KEY || '', cloudSecret: env.CLOUDINARY_API_SECRET || '',
    groqKey: env.GROQ_API_KEY || '', groqModel: env.GROQ_MODEL || 'openai/gpt-oss-20b'
  };
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(config.redisPrefix)) throw new Error('REDIS_PREFIX must contain 1–100 letters, numbers, colons, dashes or underscores.');
  config.dbReady = [config.supabaseUrl, config.publicKey, config.serviceKey].every(configured);
  config.uploadReady = [config.cloudName, config.cloudKey, config.cloudSecret].every(configured);
  config.aiReady = configured(config.groqKey);
  return config;
}

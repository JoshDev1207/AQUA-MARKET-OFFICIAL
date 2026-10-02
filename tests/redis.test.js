import {test} from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {createSharedBackend} from '../server/shared.js';
import {createAquaServer} from '../server/app.js';

const once=(socket,event)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out: '+event)),7000);socket.once(event,value=>{clearTimeout(timer);resolve(value);});});
test('two server instances share chat delivery, read receipts, HTTP fallback, rate limits and AI cache', {skip:!process.env.TEST_REDIS_URL,timeout:30_000}, async()=>{
 const ids=[crypto.randomUUID(),crypto.randomUUID()],cid=crypto.randomUUID(),servers=[],sockets=[],backends=[];
 const messages=new Map(),conversation={id:cid,user_a:ids[0],user_b:ids[1]};
 // Test Auth/database adapter; Redis and Socket.IO transports are real.
 const db={
  auth:{getUser:async token=>({data:{user:ids.includes(token)?{id:token}:null}})},
  from(table){let wanted,update;
   return {select(){return this;},eq(key,value){if(key==='id')wanted=value;return this;},update(value){update=value;return this;},maybeSingle(){return this;},
    then(resolve,reject){const row=table==='profiles'?{id:wanted,active:true,role:'user'}:conversation;if(update)Object.assign(row,update);return Promise.resolve({data:row}).then(resolve,reject);}};
  },
  rpc(name,payload){assert.equal(name,'send_message');return{single:async()=>{if(!messages.has(payload.nonce))messages.set(payload.nonce,{id:crypto.randomUUID(),conversation_id:payload.convo,sender_id:payload.actor,body:payload.message_body,media_id:null,created_at:new Date().toISOString()});return{data:messages.get(payload.nonce)};}};}
 };
 const config={dbReady:true,uploadReady:false,appUrl:'http://localhost:3000',supabaseUrl:'https://test.supabase.co',publicKey:'public',redisUrl:process.env.TEST_REDIS_URL,redisPrefix:'aqua-test:'+crypto.randomUUID()};
 try{
  for(let i=0;i<2;i++){
   const shared=await createSharedBackend(config);backends.push(shared);
   const server=createAquaServer({config,db,authClient:()=>({}),cloudinary:{},shared});servers.push(server);
   await new Promise(r=>server.http.listen(0,'127.0.0.1',r));server.url='http://127.0.0.1:'+server.http.address().port;
   const socket=client(server.url,{transports:['websocket'],auth:{token:ids[i]},autoConnect:false,reconnection:false});sockets.push(socket);
   const connected=once(socket,'connect');socket.connect();await connected;
  }
  const payload={conversation_id:cid,client_id:crypto.randomUUID(),body:'Across instances',media_id:null};
  const delivery=once(sockets[1],'chat:message');const ack=await sockets[0].timeout(7000).emitWithAck('chat:send',payload);
  assert.equal(ack.ok,true);assert.equal((await delivery).id,ack.message.id);assert.equal(messages.size,1);
  const typing=once(sockets[0],'chat:typing');sockets[1].emit('chat:typing',{conversation_id:cid});assert.equal((await typing).user_id,ids[1]);
  const receipt=once(sockets[0],'chat:read');const read=await fetch(servers[1].url+'/api/conversations/'+cid+'/read',{method:'PATCH',headers:{Authorization:'Bearer '+ids[1]}});assert.equal(read.status,200);assert.equal((await receipt).user_id,ids[1]);
  // A retry through a different HTTP instance must refer to the same saved message.
  const fallback=once(sockets[0],'chat:message');const response=await fetch(servers[1].url+'/api/messages',{method:'POST',headers:{Authorization:'Bearer '+ids[0],'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(response.status,201);assert.equal((await fallback).id,ack.message.id);assert.equal(messages.size,1);
  // Reconnect the second user's socket to the other instance and rejoin its room.
  sockets[1].disconnect();const reconnected=client(servers[0].url,{transports:['websocket'],auth:{token:ids[1]},autoConnect:false,reconnection:false});sockets.push(reconnected);const ready=once(reconnected,'connect');reconnected.connect();await ready;
  const replay=once(reconnected,'chat:message');servers[1].io.to('user:'+ids[1]).emit('chat:message',ack.message);assert.equal((await replay).id,ack.message.id);
  for(let i=0;i<8;i++)assert.equal((await fetch(servers[i%2].url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  assert.equal((await fetch(servers[0].url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,429);
  const limitedId=crypto.randomUUID();await Promise.all(Array.from({length:100},(_,i)=>backends[i%2].socketLimit(limitedId)));
  await assert.rejects(backends[1].socketLimit(limitedId),error=>error.status===429);
  await backends[0].setJson('ai:example',{summary:'shared cached response'},60);assert.deepEqual(await backends[1].getJson('ai:example'),{summary:'shared cached response'});
  assert.equal(await backends[0].acquire('ai:lock','owner',5000),true);assert.equal(await backends[1].acquire('ai:lock','other',5000),false);await backends[1].release('ai:lock','other');assert.equal(await backends[1].acquire('ai:lock','other',5000),false);await backends[0].release('ai:lock','owner');
  backends[1].close();assert.equal((await fetch(servers[1].url+'/healthz')).status,503);assert.equal((await fetch(servers[1].url+'/api/config')).status,503);
 }finally{
  for(const socket of sockets)socket.disconnect();
  for(const server of servers)await new Promise(r=>server.io.close(r));
  for(const backend of backends)backend.close();
 }
});

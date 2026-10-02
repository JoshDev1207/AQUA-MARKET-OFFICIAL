import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {io as client} from 'socket.io-client';
import {createAquaServer} from '../server/app.js';
const ids=['00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013'];
const once=(socket,event)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out waiting for '+event)),5000);socket.once(event,data=>{clearTimeout(timer);resolve(data);});});
test('real Socket.IO transport persists a message, delivers it to the participant, rejects an outsider and supports retries',async()=>{
 const pg=new PGlite();const sockets=[];let server;
 try{
  await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb)');
  await pg.exec((await readFile(new URL('../supabase/migrations/001_aquamarket.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  for(let i=0;i<ids.length;i++)await pg.query('insert into auth.users values($1,$2,$3)',[ids[i],'user'+i+'@test.invalid',JSON.stringify({username:'socket_user_'+i,full_name:'Socket test '+i})]);
  const c=(await pg.query('insert into public.conversations(user_a,user_b) values($1,$2) returning id',[ids[0],ids[1]])).rows[0];
  // Test adapter only: the app's transport and business SQL are real; Auth is represented by test tokens.
  const result=async f=>{try{return {data:await f(),error:null};}catch(e){return {data:null,error:{code:e.code||'P0001',message:e.message}};}};
  const db={
   auth:{getUser:async token=>({data:{user:ids.includes(token)?{id:token}:null},error:ids.includes(token)?null:{message:'Invalid token'}})},
   from(table){assert.ok(['profiles','conversations','messages'].includes(table));const filters=[];let single=false;
    const builder={select(){return this;},eq(k,v){assert.ok(/^[a-z_]+$/.test(k));filters.push([k,v]);return this;},maybeSingle(){single=true;return this;},single(){single=true;return this;},then(resolve,reject){return result(async()=>{const rows=(await pg.query(`select * from public.${table}`+(filters.length?' where '+filters.map(([k],i)=>`${k}=$${i+1}`).join(' and '):''),filters.map(([,v])=>v))).rows;return single?rows[0]||null:rows;}).then(resolve,reject);}};return builder;
   },
   rpc(name,d){assert.equal(name,'send_message');const operation=()=>result(async()=>(await pg.query('select * from public.send_message($1,$2,$3,$4,$5)',[d.actor,d.convo,d.nonce,d.message_body,d.image])).rows[0]);return {single:operation,then:(a,b)=>operation().then(a,b)};}
  };
  server=createAquaServer({config:{dbReady:true,uploadReady:false,appUrl:'http://localhost:3000',supabaseUrl:'https://test.supabase.co',publicKey:'test'},db,authClient:()=>({}),cloudinary:{}});
  await new Promise(r=>server.http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.http.address().port;
  for(const id of ids){const s=client(url,{auth:{token:id},transports:['websocket'],autoConnect:false,reconnection:false});sockets.push(s);const ready=once(s,'connect');s.connect();await ready;}
  const invalid=client(url,{auth:{token:'forged'},transports:['websocket'],autoConnect:false,reconnection:false});sockets.push(invalid);const denied=once(invalid,'connect_error');invalid.connect();assert.match((await denied).message,/expired/);
  const payload={conversation_id:c.id,client_id:crypto.randomUUID(),body:'Hello from the first real socket.',media_id:null};
  const delivery=once(sockets[1],'chat:message');const ack=await sockets[0].timeout(5000).emitWithAck('chat:send',payload);assert.equal(ack.ok,true);assert.equal((await delivery).id,ack.message.id);
  const again=await sockets[0].timeout(5000).emitWithAck('chat:send',payload);assert.equal(again.message.id,ack.message.id);assert.equal((await pg.query('select count(*)::int n from public.messages')).rows[0].n,1);
  const outsider=await sockets[2].timeout(5000).emitWithAck('chat:send',{...payload,client_id:crypto.randomUUID()});assert.equal(outsider.ok,false);assert.match(outsider.error,/Conversation is unavailable/);
  const res=await fetch(url+'/api/messages',{method:'POST',headers:{Authorization:'Bearer '+ids[0],'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(res.status,201);assert.equal((await res.json()).id,ack.message.id);
 }finally{for(const s of sockets)s.disconnect();server?.io.close();if(server)await new Promise(r=>server.http.close(r));await pg.close();}
});

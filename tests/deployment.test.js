import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,stat} from 'node:fs/promises';
import {readConfig} from '../server/environment.js';
import {createAquaServer} from '../server/app.js';

test('Vercel configuration rejects localhost, absent Redis, and REST URLs; uses trusted production origin',()=>{
 const base={AQUA_HOST:'vercel',APP_URL:'https://aquamarket.example',REDIS_URL:'rediss://default:fake@redis.example:6379'};
 assert.throws(()=>readConfig({...base,APP_URL:'http://localhost:3000'}),/live HTTPS/);
 assert.throws(()=>readConfig({...base,REDIS_URL:''}),/REDIS_URL/);
 assert.throws(()=>readConfig({...base,REDIS_URL:'https://redis.example'}),/REST/);
 assert.throws(()=>readConfig({...base,REDIS_URL:'redis://redis.example'}),/TLS/);
 assert.throws(()=>readConfig({...base,APP_URL:base.APP_URL+'/path'}),/origin/);
 const config=readConfig({...base,NODE_ENV:'development',TRUST_PROXY:'0'});
 assert.equal(config.production,true);assert.equal(config.trustProxy,1);
 assert.equal(config.maxUploadBytes,4_000_000);
 assert.equal(readConfig({...base,APP_URL:'',VERCEL_PROJECT_PRODUCTION_URL:'aquamarket.vercel.app'}).appUrl,'https://aquamarket.vercel.app');
 assert.notEqual(config.redisPrefix,readConfig({...base,APP_URL:'https://preview.example'}).redisPrefix);
});

test('all served static files fit Vercel response limits, including the aquarium video',async()=>{
 const root=new URL('../public/',import.meta.url);
 for(const entry of await readdir(root,{recursive:true,withFileTypes:true})){
  if(!entry.isFile())continue;
  const info=await stat(entry.parentPath+'/'+entry.name);
  assert.ok(info.size<4_000_000,entry.name+' is too large for a container response');
 }
});

test('deployment serves uncached entry pages, denies polling, and rejects oversized uploads before Cloudinary',async()=>{
 const uid=crypto.randomUUID();let cloudCalled=false;
 const db={auth:{getUser:async()=>({data:{user:{id:uid}}})},from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:uid,active:true,role:'admin'}})};}};
 const config={...readConfig({}),dbReady:true,uploadReady:true,supabaseUrl:'https://test.supabase.co',publicKey:'public'};
 const server=createAquaServer({config,db,authClient:()=>({}),cloudinary:{uploader:{upload_stream(){cloudCalled=true;}}}});
 await new Promise(r=>server.http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.http.address().port;
 try{
  const page=await fetch(url+'/verify-email.html');assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-cache');
  assert.match(page.headers.get('content-security-policy'),/ws:\/\/localhost:3000/);
  assert.equal((await fetch(url+'/assets/js/bundle.js')).headers.get('cache-control'),'no-cache');
  assert.equal((await fetch(url+'/socket.io/?EIO=4&transport=polling')).status,400);
  assert.equal((await fetch(url+'/.env.vercel.example')).status,404);
  const body=new FormData();body.append('image',new Blob([new Uint8Array(4_000_001)],{type:'image/jpeg'}),'large.jpg');
  const response=await fetch(url+'/api/uploads/listing',{method:'POST',headers:{Authorization:'Bearer test'},body});
  assert.equal(response.status,413);assert.match((await response.json()).error,/4 MB/);assert.equal(cloudCalled,false);
 }finally{await new Promise(r=>server.io.close(r));}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAquaServer} from '../server/app.js';
import {createInsightService,metricLabels} from '../server/insights.js';

const uid='00000000-0000-4000-8000-000000000099';
const snapshot=()=>({period_days:30,generated_at:new Date().toISOString(),window_start:'2026-09-01T00:00:00Z',window_end:'2026-10-01T00:00:00Z',currency:'PHP',metrics:Object.fromEntries(Object.keys(metricLabels).map(key=>[key,0])),daily:[],categories:[]});
const output={summary:'Review seller applications.',recommendations:[{title:'Seller applications',observation:'Applications are pending.',action:'Review the pending applications.',priority:'medium',evidence_keys:['pending_sellers']}],limitations:['No demand forecast is available.']};
const config={appUrl:'http://localhost:3000',dbReady:true,uploadReady:false,supabaseUrl:'https://test.supabase.co',publicKey:'public',aiReady:true,groqKey:'private-groq-secret',groqModel:'openai/gpt-oss-20b'};
async function start({role='admin',active=true,auth={},rpc}={}){
 const calls=[];
 const db={auth:{getUser:async token=>({data:{user:token==='valid'?{id:uid}:null}})},from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:uid,active,role}})};},rpc:async(...args)=>{calls.push(args);return rpc?.(...args)||{data:snapshot()};}};
 const server=createAquaServer({config,db,authClient:()=>({auth}),cloudinary:{}});
 await new Promise(r=>server.http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.http.address().port;
 return {calls,server,url,close:()=>new Promise(r=>server.io.close(r)),post:(path,body)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer valid'},body:JSON.stringify(body)})};
}

test('email verification delegates to Supabase and only returns a session after token and account validation',async()=>{
 const calls=[];const session={access_token:'valid',refresh_token:'refresh'};
 const s=await start({auth:{verifyOtp:async value=>{calls.push(value);return value.token==='123456'?{data:{session}}:{error:{message:'expired'}};}}});
 try{
  assert.equal((await s.post('/api/auth/verify-email',{email:'member@example.com',token:'not-a-code'})).status,400);assert.equal(calls.length,0);
  assert.equal((await s.post('/api/auth/verify-email',{email:'member@example.com',token:'000000'})).status,400);
  const res=await s.post('/api/auth/verify-email',{email:'Member@example.com',token:'123456'});assert.equal(res.status,200);assert.deepEqual((await res.json()).session,session);
  assert.deepEqual(calls.at(-1),{email:'member@example.com',token:'123456',type:'email'});
 }finally{await s.close();}
 const suspended=await start({active:false,auth:{verifyOtp:async()=>({data:{session}})}});
 try{assert.equal((await suspended.post('/api/auth/verify-email',{email:'member@example.com',token:'123456'})).status,403);}finally{await suspended.close();}
});

test('resend uses signup email, provides a generic response and enforces cooldown',async()=>{
 const calls=[];const s=await start({auth:{resend:async value=>{calls.push(value);return{};}}});
 try{
  assert.equal((await s.post('/api/auth/resend-code',{email:'member@example.com'})).status,200);
  assert.equal(calls[0].type,'signup');assert.equal(calls[0].options.emailRedirectTo,'http://localhost:3000/auth-callback.html');
  assert.equal((await s.post('/api/auth/resend-code',{email:'MEMBER@example.com'})).status,429);assert.equal(calls.length,1);
 }finally{await s.close();}
});

test('analytics and AI endpoints require admin; missing migration is actionable; public config has no Groq key',async()=>{
 const ordinary=await start({role:'user'});
 try{
  assert.equal((await fetch(ordinary.url+'/api/admin/analytics',{headers:{Authorization:'Bearer valid'}})).status,403);
  assert.equal((await ordinary.post('/api/admin/insights',{days:30})).status,403);assert.equal(ordinary.calls.length,0);
  const publicConfig=await(await fetch(ordinary.url+'/api/config')).text();assert.ok(!publicConfig.includes('private-groq-secret'));assert.ok(!publicConfig.includes('groqKey'));
 }finally{await ordinary.close();}
 const admin=await start({rpc:()=>({error:{code:'PGRST202'}})});
 try{const res=await fetch(admin.url+'/api/admin/analytics',{headers:{Authorization:'Bearer valid'}});assert.equal(res.status,503);assert.match((await res.json()).error,/002_admin_analytics/);}finally{await admin.close();}
});

test('Groq receives only aggregate fields and validated recommendations are cached',async()=>{
 const requests=[];const service=createInsightService({config,fetchImpl:async(url,options)=>{requests.push({url,options});return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});}});
 const data=snapshot();data.metrics.pending_sellers=2;data.email='must-not-leak@example.com';data.messages=['private message'];data.metrics.customer_email='must-not-leak@example.com';
 const first=await service.generate(data),second=await service.generate(data);
 assert.equal(requests.length,1);assert.equal(first.source,'groq');assert.equal(second.cached,true);
 assert.ok(!requests[0].options.body.includes('must-not-leak'));assert.ok(!requests[0].options.body.includes('private message'));
 assert.equal(requests[0].url,'https://api.groq.com/openai/v1/chat/completions');
 assert.equal(JSON.parse(requests[0].options.body).response_format.json_schema.strict,true);
 assert.equal(first.snapshot.metrics.pending_sellers,2);
});

test('empty marketplace makes no AI request; invalid and limited AI replies produce recoverable errors',async()=>{
 let calls=0;const empty=createInsightService({config,fetchImpl:async()=>{calls++;throw Error('Must not call');}});
 assert.equal((await empty.generate(snapshot())).source,'insufficient-data');assert.equal(calls,0);
 const data=snapshot();data.metrics.orders_placed=1;
 const limited=createInsightService({config,fetchImpl:async()=>new Response('',{status:429})});
 await assert.rejects(limited.generate(data),e=>e.status===429);
 const invalid=createInsightService({config,fetchImpl:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"summary":"fake revenue"}'}}]})});
 await assert.rejects(invalid.generate(data),e=>e.status===502);
 const truncated=createInsightService({config,fetchImpl:async()=>Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(output)}}]})});
 await assert.rejects(truncated.generate(data),e=>e.status===502);
});

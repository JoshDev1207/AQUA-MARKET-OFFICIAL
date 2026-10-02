import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createAquaServer} from '../server/app.js';
import {schemas,requireMember,sameOrigin} from '../server/validation.js';
const servers=[];
async function server(ready=false){const config={appUrl:'http://localhost:3000',dbReady:ready,uploadReady:false,production:false,supabaseUrl:'https://test.supabase.co',publicKey:'public-test-key'};const s=createAquaServer({config,db:{auth:{getUser:async()=>({data:{user:null},error:{message:'Invalid token'}})}},authClient:()=>({}),cloudinary:{}});servers.push(s);await new Promise(r=>s.http.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.http.address().port;}
after(async()=>{for(const s of servers){s.io.close();await new Promise(r=>s.http.close(r));}});
test('configuration exposes no secret and setup mode never produces demo records',async()=>{const url=await server();const config=await(await fetch(url+'/api/config')).json();assert.equal(config.configured,false);assert.equal(config.publicKey,'');assert.equal('serviceKey'in config,false);assert.equal((await fetch(url+'/api/listings')).status,503);});
test('private files are not served, browser entry pages load, and CSP is enabled',async()=>{const url=await server();for(const p of ['/.env','/server/config.js','/supabase/migrations/001_aquamarket.sql','/package.json'])assert.equal((await fetch(url+p)).status,404);const r=await fetch(url+'/login.html');assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));assert.ok((await r.text()).includes('/assets/js/bundle.js'));});
test('protected REST routes reject absent and forged tokens; origin guard rejects cross-origin mutations',async()=>{const url=await server(true);for(const route of ['/api/me','/api/cart','/api/orders','/api/conversations','/api/admin/summary']){assert.equal((await fetch(url+route)).status,401);assert.equal((await fetch(url+route,{headers:{Authorization:'Bearer forged'}})).status,401);}assert.equal((await fetch(url+'/api/checkout',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'})).status,403);});
test('validation rejects mass assignment, bad money/quantity and nonparticipant chat access',()=>{
 assert.throws(()=>schemas.profile.parse({username:'name',full_name:'Name',phone:'',address:'',location:'',bio:'',avatar_id:null,role:'admin'}));
 assert.throws(()=>schemas.cart.parse({listing_id:crypto.randomUUID(),quantity:-1}));
 assert.throws(()=>schemas.message.parse({conversation_id:crypto.randomUUID(),client_id:crypto.randomUUID(),body:''}));
 assert.throws(()=>requireMember({user_a:'a',user_b:'b'},'c'));
 assert.equal(sameOrigin('https://evil.test','https://good.test'),false);
});
test('upload endpoint rejects disguised non-image content before calling Cloudinary',async()=>{
 const uid=crypto.randomUUID();let cloudCalled=false;
 const db={auth:{getUser:async()=>({data:{user:{id:uid}}})},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:uid,active:true,role:'admin'},error:null})};}};
 const config={dbReady:true,uploadReady:true,appUrl:'http://localhost:3000',supabaseUrl:'https://test.supabase.co',publicKey:'test'};
 const s=createAquaServer({config,db,authClient:()=>({}),cloudinary:{uploader:{upload_stream(){cloudCalled=true;throw Error('Should never be called');}}}});servers.push(s);await new Promise(r=>s.http.listen(0,'127.0.0.1',r));
 const body=new FormData();body.append('image',new Blob(['<svg onload="alert(1)"></svg>'],{type:'image/jpeg'}),'image.jpg');
 const res=await fetch('http://127.0.0.1:'+s.http.address().port+'/api/uploads/listing',{method:'POST',headers:{Authorization:'Bearer test'},body});assert.equal(res.status,400);assert.match((await res.json()).error,/valid JPG/);assert.equal(cloudCalled,false);
});

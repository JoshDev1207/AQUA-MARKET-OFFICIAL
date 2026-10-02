import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;const u={buyer:'00000000-0000-4000-8000-000000000001',seller:'00000000-0000-4000-8000-000000000002',other:'00000000-0000-4000-8000-000000000003',admin:'00000000-0000-4000-8000-000000000004'};
const q=(sql,args=[])=>db.query(sql,args);
const one=async(sql,args=[])=> (await q(sql,args)).rows[0];
async function listing(owner,{kind='sale',stock=2,price=100}={}){
 const m=await one("insert into public.media(owner_id,purpose,public_id,url,format,bytes) values($1,'listing',gen_random_uuid()::text,'https://res.cloudinary.com/test/image.jpg','jpg',100) returning id",[owner]);
 const payload={kind,title:'Test item',description:'A test-only listing description',category:'Fish',species:'',location:'Test city',price,stock,trade_preference:kind==='trade'?'Plants':'',status:'active'};
 return (await one('select public.save_listing($1,$2,$3,null) as id',[owner,JSON.stringify(payload),[m.id]])).id;
}
const info={recipient:'Test Buyer',phone:'09123456789',address:'Test address',payment_method:'Cash on meet-up',arrangement:'Meet-up'};
const checkout=async(l,buyer=u.buyer,key=crypto.randomUUID(),quantity=1,price=100)=>{
 await q('select public.set_cart($1,$2,$3)',[buyer,l,quantity]);
 return (await one('select public.checkout($1,$2,$3,$4) result',[buyer,key,JSON.stringify(info),JSON.stringify([{id:l,price,quantity}])])).result;
};
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);`);
 const migration=(await readFile(new URL('../supabase/migrations/001_aquamarket.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
 await db.exec(migration);
 for(const [name,id]of Object.entries(u))await q('insert into auth.users values($1,$2,$3)',[id,name+'@test.invalid',JSON.stringify({username:name+'_test',full_name:name,role:'admin'})]);
 await q("update public.profiles set seller_status='approved' where id in($1,$2)",[u.seller,u.other]);await q("update public.profiles set role='admin' where id=$1",[u.admin]);
});
after(async()=>{await db?.close();});
test('auth trigger ignores user-supplied admin metadata and creates empty new accounts',async()=>{assert.equal((await one('select role from public.profiles where id=$1',[u.buyer])).role,'user');assert.equal((await one('select count(*)::int n from public.listings')).n,0);});
test('anon and authenticated cannot read private tables or call business RPCs',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(q('select * from public.messages'),/permission denied/);
  await assert.rejects(q('select public.login_email($1)',['buyer_test']),/permission denied/);
  await assert.rejects(q('select public.change_order($1,$2,$3,$4)',[u.buyer,crypto.randomUUID(),'paid','test']),/permission denied/);
  await db.exec('reset role');
 }
 const tables=await q("select tablename,rowsecurity from pg_tables where schemaname='public'");assert.ok(tables.rows.every(t=>t.rowsecurity));
});
test('checkout validates current prices, atomically decrements stock, and deduplicates retries',async()=>{
 const l=await listing(u.seller),key=crypto.randomUUID();
 await q('select public.set_cart($1,$2,1)',[u.buyer,l]);
 await assert.rejects(q('select public.checkout($1,$2,$3,$4)',[u.buyer,key,JSON.stringify(info),JSON.stringify([{id:l,price:1,quantity:1}])]),/price changed/);
 assert.equal((await one('select stock from public.listings where id=$1',[l])).stock,2);
 const orderIds=await checkout(l,u.buyer,key);
 assert.equal(orderIds.length,1);assert.equal((await one('select stock from public.listings where id=$1',[l])).stock,1);
 const retry=(await one('select public.checkout($1,$2,$3,$4) result',[u.buyer,key,JSON.stringify(info),'[]'])).result;
 assert.deepEqual(retry,orderIds);assert.equal((await one('select stock from public.listings where id=$1',[l])).stock,1);
 assert.equal((await one('select payment_status from public.orders where id=$1',[orderIds[0]])).payment_status,'unpaid');
});
test('stock race: only one buyer can purchase the final item',async()=>{
 const l=await listing(u.seller,{stock:1});
 for(const buyer of [u.buyer,u.other])await q('select public.set_cart($1,$2,1)',[buyer,l]);
 const results=await Promise.allSettled([u.buyer,u.other].map(buyer=>q('select public.checkout($1,$2,$3,$4)',[buyer,crypto.randomUUID(),JSON.stringify(info),JSON.stringify([{id:l,price:100,quantity:1}])])));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await one('select stock from public.listings where id=$1',[l])).stock,0);
 await q('delete from public.cart_items');
});
test('multi-seller checkout creates a separate order per seller in one transaction',async()=>{
 const a=await listing(u.seller),b=await listing(u.other);for(const l of[a,b])await q('select public.set_cart($1,$2,1)',[u.buyer,l]);
 const {result}=await one('select public.checkout($1,$2,$3,$4) result',[u.buyer,crypto.randomUUID(),JSON.stringify(info),JSON.stringify([a,b].map(id=>({id,quantity:1,price:100})))]);
 assert.equal(result.length,2);for(const id of result)assert.equal(Number((await one('select total from public.orders where id=$1',[id])).total),100);
});
test('buyers cannot mark payment paid; cancellation restores stock only once',async()=>{
 const l=await listing(u.seller),[oid]=await checkout(l);
 await assert.rejects(q('select public.change_order($1,$2,$3,$4)',[u.buyer,oid,'paid','cash received']),/Only the seller/);
 await assert.rejects(q('select public.change_order($1,$2,$3,$4)',[u.other,oid,'cancelled','']),/Order not found/);
 await q('select public.change_order($1,$2,$3,$4)',[u.buyer,oid,'cancelled','']);
 await assert.rejects(q('select public.change_order($1,$2,$3,$4)',[u.buyer,oid,'cancelled','']),/Only pending/);
 assert.equal((await one('select stock from public.listings where id=$1',[l])).stock,2);
});
test('paid orders require recorded refund before cancellation',async()=>{
 const l=await listing(u.seller),[oid]=await checkout(l);
 await q('select public.change_order($1,$2,$3,$4)',[u.seller,oid,'paid','cash receipt 1']);
 await assert.rejects(q('select public.change_order($1,$2,$3,$4)',[u.buyer,oid,'cancelled','']),/refund first/);
 await q('select public.change_order($1,$2,$3,$4)',[u.seller,oid,'refunded','cash refund 1']);
 await q('select public.change_order($1,$2,$3,$4)',[u.buyer,oid,'cancelled','']);
 assert.equal((await one('select stock from public.listings where id=$1',[l])).stock,2);
});
test('unapproved sellers, foreign images and foreign edits are rejected',async()=>{
 await assert.rejects(listing(u.buyer),/Seller approval/);
 const l=await listing(u.seller);const m=await one('select media_id id from public.listing_images where listing_id=$1',[l]);
 const payload={kind:'sale',title:'Stolen listing',description:'Should not be allowed',category:'Fish',species:'',location:'Test',price:10,stock:1,trade_preference:'',status:'active'};
 await assert.rejects(q('select public.save_listing($1,$2,$3,$4)',[u.other,JSON.stringify(payload),[m.id],l]),/Invalid listing image/);
});
test('trade acceptance reserves both listings; both parties must confirm handover',async()=>{
 const wanted=await listing(u.seller,{kind:'trade'}),offered=await listing(u.other,{kind:'trade'});
 const {id}=await one("select public.propose_trade($1,$2,$3,'Interested') id",[u.other,wanted,offered]);
 await assert.rejects(q("select public.change_trade($1,$2,'accepted')",[u.other,id]),/cannot make/);
 await q("select public.change_trade($1,$2,'accepted')",[u.seller,id]);
 assert.equal((await one('select availability from public.listings where id=$1',[wanted])).availability,'reserved');
 await q("select public.change_trade($1,$2,'completed')",[u.other,id]);
 assert.equal((await one('select status from public.trade_requests where id=$1',[id])).status,'accepted');
 await assert.rejects(q("select public.change_trade($1,$2,'cancelled')",[u.seller,id]),/handover was confirmed/);
 await q("select public.change_trade($1,$2,'completed')",[u.seller,id]);
 assert.equal((await one('select status from public.trade_requests where id=$1',[id])).status,'completed');
 assert.equal((await one('select availability from public.listings where id=$1',[offered])).availability,'traded');
});
test('conversation membership and message ownership are enforced; retries are idempotent',async()=>{
 const c=await one('insert into public.conversations(user_a,user_b) values($1,$2) returning id',[u.buyer,u.seller]);const nonce=crypto.randomUUID();
 await assert.rejects(q("select * from public.send_message($1,$2,$3,'hello',null)",[u.other,c.id,nonce]),/Conversation is unavailable/);
 const first=await one("select * from public.send_message($1,$2,$3,'hello',null)",[u.buyer,c.id,nonce]);const second=await one("select * from public.send_message($1,$2,$3,'hello',null)",[u.buyer,c.id,nonce]);assert.equal(first.id,second.id);
 await assert.rejects(q("select * from public.send_message($1,$2,$3,'changed',null)",[u.buyer,c.id,nonce]),/retry does not match/);
 await assert.rejects(q("select * from public.send_message($1,$2,$3,'',null)",[u.buyer,c.id,crypto.randomUUID()]),/check constraint/);
 await q('update public.profiles set active=false where id=$1',[u.seller]);
 await assert.rejects(q("select * from public.send_message($1,$2,$3,'hello',null)",[u.buyer,c.id,crypto.randomUUID()]),/Conversation is unavailable/);
 await q('update public.profiles set active=true where id=$1',[u.seller]);
});
test('aggregate admin statistics require admin access and return database totals',async()=>{
 await assert.rejects(q('select public.marketplace_stats($1)',[u.buyer]),/not permitted/);
 const {stats}=await one('select public.marketplace_stats($1) stats',[u.admin]);
 assert.equal(stats.profiles,4);assert.equal(stats.orders,(await one('select count(*)::int n from public.orders')).n);
});

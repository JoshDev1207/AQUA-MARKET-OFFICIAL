import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {snapshotSchema} from '../server/insights.js';

test('analytics SQL is an idempotent upgrade, admin-only, excludes unpaid/cancelled value, and compares periods',async()=>{
 const pg=new PGlite();
 const admin='00000000-0000-4000-8000-000000000091',buyer='00000000-0000-4000-8000-000000000092';
 try{
  await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb)');
  await pg.exec((await readFile(new URL('../supabase/migrations/001_aquamarket.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  const migration=await readFile(new URL('../supabase/migrations/002_admin_analytics.sql',import.meta.url),'utf8');await pg.exec(migration);await pg.exec(migration);
  for(const [id,name]of [[admin,'analytics_admin'],[buyer,'analytics_buyer']])await pg.query('insert into auth.users values($1,$2,$3)',[id,name+'@test.invalid',JSON.stringify({username:name,full_name:name})]);
  await pg.query("update public.profiles set role='admin' where id=$1",[admin]);
  const get=async()=>(await pg.query('select public.admin_analytics($1,30) data',[admin])).rows[0].data;
  const initial=snapshotSchema.parse(await get());assert.equal(initial.metrics.orders_placed,0);assert.equal(initial.metrics.completed_paid_value,0);assert.equal(initial.categories.length,6);
  await assert.rejects(pg.query('select public.admin_analytics($1,30)',[buyer]),/not permitted/);
  await assert.rejects(pg.query('select public.admin_analytics($1,2)',[admin]),/7, 30 or 90/);
  await pg.exec('set role authenticated');await assert.rejects(pg.query('select public.admin_analytics($1,30)',[admin]),/permission denied/);await pg.exec('reset role');
  const listing=(await pg.query("insert into public.listings(seller_id,kind,title,description,category,price,stock) values($1,'sale','Test fish','Only an isolated test item','Fish',100,2) returning id",[admin])).rows[0].id;
  for(const [status,payment,total,age]of [['completed','paid',200,1],['pending','paid',400,2],['cancelled','refunded',500,3],['completed','paid',50,40]]){
   const order=(await pg.query("insert into public.orders(buyer_id,seller_id,total,status,payment_status,payment_method,recipient,phone,address,arrangement,created_at) values($1,$2,$3,$4,$5,'Cash on meet-up','Private name','Private phone','Private address','Meet-up',now()-make_interval(days=>$6)) returning id",[buyer,admin,total,status,payment,age])).rows[0].id;
   await pg.query("insert into public.order_items(order_id,listing_id,title,price,quantity) values($1,$2,'Private listing title',$3,2)",[order,listing,total/2]);
  }
  const data=snapshotSchema.parse(await get());assert.equal(data.metrics.orders_placed,3);assert.equal(data.metrics.orders_completed_paid,1);assert.equal(data.metrics.completed_paid_value,200);assert.equal(data.metrics.previous_completed_paid_value,50);assert.equal(data.metrics.previous_orders_placed,1);assert.equal(data.metrics.low_stock_listings,1);
  assert.equal(data.categories.find(c=>c.category==='Fish').sold_units,2);assert.equal(data.daily.reduce((n,d)=>n+d.value,0),200);
  assert.ok(!JSON.stringify(data).includes('Private'));
 }finally{await pg.close();}
});

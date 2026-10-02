import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID,createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { z } from 'zod';
import { schemas,uuid,AppError,requireMember,sameOrigin } from './validation.js';
import { createInsightService,snapshotSchema,periods } from './insights.js';

const publicProfile='id,username,full_name,store_name,seller_type,seller_status,location,bio,avatar_id,created_at';
const listSelect='*,images:listing_images(position,media:media(id,url)),seller:profiles!listings_seller_id_fkey('+publicProfile+',active,role)';
const orderSelect='*,items:order_items(*),buyer:profiles!orders_buyer_id_fkey(id,username,full_name),seller:profiles!orders_seller_id_fkey(id,username,full_name,store_name)';
export function createAquaServer({config,db,authClient,cloudinary,shared=null,aiFetch=fetch}) {
 if(config.vercel&&!shared)throw new Error('Vercel requires the shared Redis backend.');
 const app=express();const http=createServer(app);
 const maxUploadBytes=config.maxUploadBytes||4_000_000;
 const io=new Server(http,{transports:['websocket'],serveClient:false,adapter:shared?.adapter,maxHttpBufferSize:32*1024,allowRequest:(req,cb)=>cb(null,sameOrigin(req.headers.origin,config.appUrl)),cors:{origin:new URL(config.appUrl).origin,methods:['GET','POST']}});
 app.disable('x-powered-by');if(config.trustProxy)app.set('trust proxy',config.trustProxy);
 const sbOrigin=config.dbReady?new URL(config.supabaseUrl).origin:'https://example.supabase.co';
 const wsOrigin=new URL(config.appUrl).origin.replace(/^http/,'ws');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'",'data:','blob:','https://res.cloudinary.com','https://api.cloudinary.com'],mediaSrc:["'self'"],connectSrc:["'self'",sbOrigin,wsOrigin],objectSrc:["'none'"],baseUri:["'self'"],formAction:["'self'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.production?[]:null}},crossOriginEmbedderPolicy:false,hsts:config.production?undefined:false}));
 app.use(express.json({limit:'100kb'}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!sameOrigin(req.headers.origin,config.appUrl))return next(new AppError(403,'Origin is not allowed.'));next();});
 const limiter=(name,limit,windowMs,keyGenerator)=>rateLimit({windowMs,limit,store:shared?.rateStore(name),...(keyGenerator?{keyGenerator}:{}),passOnStoreError:false,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many requests. Please try again later.'}});
 app.use('/api',limiter('api',600,60000));
 app.get('/healthz',(req,res)=>{const ready=!shared||shared.ready();res.set('Cache-Control','no-store').status(ready?200:503).json({status:ready?'ok':'unavailable',databaseConfigured:config.dbReady,uploadsConfigured:config.uploadReady,sharedBackend:shared?'redis':'single-instance',sharedBackendReady:ready});});
 app.get('/api/config',(req,res)=>res.json({configured:config.dbReady,uploads:config.uploadReady,maxUploadBytes,supabaseUrl:config.dbReady?config.supabaseUrl:'',publicKey:config.dbReady?config.publicKey:''}));
 app.use('/api',(req,res,next)=>config.dbReady?next():next(new AppError(503,'AquaMarket is not connected yet. Follow SETUP.md to configure Supabase.')));
 const run=async query=>{const {data,error}=await query;if(error){if(error.code==='23505')throw new AppError(409,'This record already exists. Choose another username or check your previous submission.');if(error.code==='P0001')throw new AppError(409,error.message);if(error.code==='42501')throw new AppError(403,'You cannot perform this action.');if(error.code==='PGRST116')throw new AppError(404,'Record not found.');console.error('Database error:',error.code||'unknown');throw new AppError(503,'The database request failed. Check the server configuration and database migration.');}return data;};
 const rpc=async(name,args)=>run(db.rpc(name,args));
 async function identity(token){
  if(!token||typeof token!=='string')throw new AppError(401,'Please sign in to continue.');
  const {data,error}=await db.auth.getUser(token);
  if(error||!data?.user)throw new AppError(401,'Your session expired. Please sign in again.');
  const profile=await run(db.from('profiles').select('*').eq('id',data.user.id).maybeSingle());
  if(!profile?.active)throw new AppError(403,'Your account is unavailable. Contact marketplace support.');
  return {user:data.user,profile,token};
 }
 const auth=async(req,res,next)=>{try{Object.assign(req,await identity(req.headers.authorization?.replace(/^Bearer /,'')));next();}catch(e){next(e);}};
 const admin=(req,res,next)=>req.profile.role==='admin'?next():next(new AppError(403,'Administrator access is required.'));
 const id=req=>uuid.parse(req.params.id);
 const ownMedia=async(mid,actor,purpose)=>{if(!mid)return null;const m=await run(db.from('media').select('*').eq('id',mid).eq('owner_id',actor).eq('purpose',purpose).maybeSingle());if(!m)throw new AppError(400,'Invalid image. Upload your own image for this purpose.');return m;};
 const mediaUrl=m=>m?.purpose==='chat'?cloudinary.utils.private_download_url(m.public_id,m.format,{resource_type:'image',type:'authenticated',expires_at:Math.floor(Date.now()/1000)+300,attachment:false}):m?.url||null;
 const publicListing=l=>({...l,images:(l.images||[]).sort((a,b)=>a.position-b.position).map(i=>i.media).filter(Boolean),seller:l.seller?Object.fromEntries(Object.entries(l.seller).filter(([k])=>!['role','active'].includes(k))):null});
 const visible=l=>l?.status==='active'&&l.seller?.active&&(l.seller.seller_status==='approved'||l.seller.role==='admin');
 const notify=async(uid,body,href)=>{await rpc('notify_aqua',{uid,msg:body,link:href});io.to(`user:${uid}`).emit('notification');};

 app.post('/api/auth/register',limiter('register',8,15*60000),async(req,res)=>{
  const d=schemas.register.parse(req.body);
  const existing=await run(db.from('profiles').select('id').eq('username',d.username).maybeSingle());
  if(existing)throw new AppError(409,'That username is already taken.');
  const {data,error}=await authClient().auth.signUp({email:d.email,password:d.password,options:{emailRedirectTo:config.appUrl+'/auth-callback.html',data:{username:d.username,full_name:d.full_name}}});
  if(error)throw new AppError(400,error.code==='over_email_send_rate_limit'?'Too many confirmation emails. Try again later.':'Registration failed. Check your details or try password recovery.');
  res.status(201).json({session:data.session,message:data.session?'Account created.':'Enter the six-digit code from your email to verify your account.'});
 });
 // Supabase owns code generation, expiry, one-time use and verification.
 // Keep email addresses out of Redis rate-limit keys.
 const emailRateKey=req=>createHash('sha256').update(String(req.body.email||'').trim().toLowerCase()).digest('hex');
 const validateBody=schema=>(req,res,next)=>{try{req.body=schema.parse(req.body);next();}catch(error){next(error);}};
 app.post('/api/auth/verify-email',limiter('verify-ip',20,10*60000),validateBody(schemas.verifyEmail),limiter('verify-email',10,10*60000,emailRateKey),async(req,res)=>{
  const {data,error}=await authClient().auth.verifyOtp({...req.body,type:'email'});
  if(error||!data?.session)throw new AppError(400,'This code is invalid or expired. Check your email or request a new code.');
  await identity(data.session.access_token);
  res.json({session:data.session});
 });
 app.post('/api/auth/resend-code',limiter('resend-ip',10,15*60000),validateBody(schemas.resendEmail),limiter('resend-email',1,60000,emailRateKey),async(req,res)=>{
  const {error}=await authClient().auth.resend({type:'signup',email:req.body.email,options:{emailRedirectTo:config.appUrl+'/auth-callback.html'}});
  if(error&&(error.status===429||error.code==='over_email_send_rate_limit'))throw new AppError(429,'Please wait before requesting another code.');
  if(error&&(error.status>=500||error.code==='email_address_not_authorized'))throw new AppError(503,'Email could not be sent. Please try again later or contact support.');
  res.json({message:'If this address has an unverified account, a new code will arrive shortly.'});
 });
 app.post('/api/auth/login',limiter('login',15,15*60000),async(req,res)=>{
  const d=schemas.login.parse(req.body);
  const email=d.identifier.includes('@')?d.identifier.toLowerCase():await rpc('login_email',{uname:d.identifier.toLowerCase()});
  // Still perform password auth for unknown usernames; never return an email lookup.
  const {data,error}=await authClient().auth.signInWithPassword({email:email||'unknown-user@invalid.example',password:d.password});
  if(error||!data.session)throw new AppError(401,'Unable to sign in. Check your username/email and password, and confirm your email.');
  await identity(data.session.access_token);
  res.json({session:data.session});
 });
 app.get('/api/me',auth,async(req,res)=>res.json({profile:req.profile,email:req.user.email}));
 app.patch('/api/me',auth,async(req,res)=>{
  const d=schemas.profile.parse(req.body);await ownMedia(d.avatar_id,req.profile.id,'avatar');
  res.json(await run(db.from('profiles').update(d).eq('id',req.profile.id).select('*').single()));
 });
 app.post('/api/seller-application',auth,async(req,res)=>{
  const d=schemas.seller.parse(req.body);
  if(req.profile.seller_status==='approved')throw new AppError(409,'Your seller account is already approved.');
  await run(db.from('profiles').update({...d,seller_status:'pending',seller_note:''}).eq('id',req.profile.id));res.json({ok:true});
 });
 app.get('/api/sellers',async(req,res)=>{
  const sellers=await run(db.from('profiles').select(publicProfile).eq('active',true).eq('seller_status','approved').order('created_at',{ascending:false}).limit(100));res.json(sellers);
 });
 app.get('/api/sellers/:id',async(req,res)=>{
  const seller=await run(db.from('profiles').select(publicProfile+',active,role').eq('id',id(req)).maybeSingle());
  if(!seller?.active||(seller.seller_status!=='approved'&&seller.role!=='admin'))throw new AppError(404,'Seller not found.');
  delete seller.active;delete seller.role;res.json(seller);
 });
 app.get('/api/listings',async(req,res)=>{
  const page=Math.max(1,Math.min(10000,Number(req.query.page)||1));
  let q=db.from('listings').select(listSelect.replace('profiles!listings_seller_id_fkey(', 'profiles!listings_seller_id_fkey!inner('),{count:'exact'}).eq('status','active').eq('seller.active',true).or('seller_status.eq.approved,role.eq.admin',{referencedTable:'seller'});
  if(['sale','trade'].includes(req.query.kind))q=q.eq('kind',req.query.kind);
  if(typeof req.query.category==='string'&&req.query.category)q=q.eq('category',req.query.category.slice(0,50));
  if(req.query.seller)q=q.eq('seller_id',uuid.parse(req.query.seller));
  if(typeof req.query.q==='string'&&req.query.q.trim())q=q.ilike('title','%'+req.query.q.trim().slice(0,120).replace(/[%_\\]/g,'')+'%');
  if(req.query.min!==undefined&&Number.isFinite(Number(req.query.min)))q=q.gte('price',Number(req.query.min));
  if(req.query.max!==undefined&&Number.isFinite(Number(req.query.max)))q=q.lte('price',Number(req.query.max));
  if(req.query.kind==='trade')q=q.eq('availability','available');
  const sort=req.query.sort;
  q=q.order(sort==='price-asc'||sort==='price-desc'?'price':'created_at',{ascending:sort==='price-asc'}).order('id').range((page-1)*24,page*24-1);
  const {data,error,count}=await q;if(error){await run(Promise.resolve({error}));}
  res.json({items:data.map(publicListing),total:count,page,pageSize:24});
 });
 app.get('/api/listings/:id',async(req,res)=>{
  const l=await run(db.from('listings').select(listSelect).eq('id',id(req)).maybeSingle());if(!visible(l))throw new AppError(404,'This listing is unavailable.');res.json(publicListing(l));
 });
 app.get('/api/my-listings',auth,async(req,res)=>res.json((await run(db.from('listings').select(listSelect).eq('seller_id',req.profile.id).order('created_at',{ascending:false}))).map(publicListing)));
 const saveListing=async(req,res)=>{const d=schemas.listing.parse(req.body);const {image_ids,...payload}=d;const lid=await rpc('save_listing',{actor:req.profile.id,payload,images:image_ids,listing:req.params.id?id(req):null});res.json({id:lid});};
 app.post('/api/listings',auth,saveListing);app.put('/api/listings/:id',auth,saveListing);
 app.get('/api/favorites',auth,async(req,res)=>{
  const rows=await run(db.from('favorites').select('listing_id,listing:listings('+listSelect+')').eq('user_id',req.profile.id));res.json(rows.map(r=>r.listing).filter(visible).map(publicListing));
 });
 app.put('/api/favorites/:id',auth,async(req,res)=>{
  const listing=await run(db.from('listings').select(listSelect).eq('id',id(req)).maybeSingle());if(!visible(listing))throw new AppError(404,'Listing not found.');
  await run(db.from('favorites').upsert({user_id:req.profile.id,listing_id:id(req)},{onConflict:'user_id,listing_id'}));res.json({ok:true});
 });
 app.delete('/api/favorites/:id',auth,async(req,res)=>{await run(db.from('favorites').delete().eq('user_id',req.profile.id).eq('listing_id',id(req)));res.json({ok:true});});
 app.get('/api/cart',auth,async(req,res)=>{
  const rows=await run(db.from('cart_items').select('quantity,listing:listings('+listSelect+')').eq('user_id',req.profile.id));res.json(rows.map(r=>({quantity:r.quantity,listing:publicListing(r.listing),available:visible(r.listing)&&r.listing.stock>=r.quantity})));
 });
 app.put('/api/cart',auth,async(req,res)=>{const d=schemas.cart.parse(req.body);await rpc('set_cart',{actor:req.profile.id,listing:d.listing_id,qty:d.quantity});res.json({ok:true});});
 app.post('/api/checkout',auth,limiter('checkout',20,60000),async(req,res)=>{const d=schemas.checkout.parse(req.body);res.status(201).json({order_ids:await rpc('checkout',{actor:req.profile.id,...d})});});
 app.get('/api/orders',auth,async(req,res)=>{res.json(await run(db.from('orders').select(orderSelect).or(`buyer_id.eq.${req.profile.id},seller_id.eq.${req.profile.id}`).order('created_at',{ascending:false})));});
 app.get('/api/orders/:id',auth,async(req,res)=>{
  let q=db.from('orders').select(orderSelect).eq('id',id(req));if(req.profile.role!=='admin')q=q.or(`buyer_id.eq.${req.profile.id},seller_id.eq.${req.profile.id}`);
  const o=await run(q.maybeSingle());if(!o)throw new AppError(404,'Order not found.');res.json(o);
 });
 app.patch('/api/orders/:id',auth,async(req,res)=>{const d=schemas.order.parse(req.body);await rpc('change_order',{actor:req.profile.id,oid:id(req),...d});res.json({ok:true});});
 app.get('/api/trades',auth,async(req,res)=>res.json(await run(db.from('trade_requests').select('*,listing:listings!trade_requests_listing_id_fkey(id,title),offer:listings!trade_requests_offer_id_fkey(id,title)').or(`requester_id.eq.${req.profile.id},recipient_id.eq.${req.profile.id}`).order('created_at',{ascending:false}))));
 app.post('/api/trades',auth,async(req,res)=>{const d=schemas.trade.parse(req.body);res.status(201).json({id:await rpc('propose_trade',{actor:req.profile.id,...d})});});
 app.patch('/api/trades/:id',auth,async(req,res)=>{const d=schemas.tradeChange.parse(req.body);await rpc('change_trade',{actor:req.profile.id,rid:id(req),...d});res.json({ok:true});});
 app.get('/api/reviews',async(req,res)=>{
  const lid=uuid.parse(req.query.listing);const l=await run(db.from('listings').select(listSelect).eq('id',lid).maybeSingle());if(!visible(l))throw new AppError(404,'Listing not found.');
  res.json(await run(db.from('reviews').select('id,rating,body,created_at,author:profiles!reviews_author_id_fkey(username,full_name),media:media(url)').eq('listing_id',lid).eq('status','visible').order('created_at',{ascending:false}).limit(100)));
 });
 app.post('/api/reviews',auth,async(req,res)=>{
  const d=schemas.review.parse(req.body);
  const o=await run(db.from('orders').select('id,items:order_items(listing_id)').eq('id',d.order_id).eq('buyer_id',req.profile.id).eq('status','completed').maybeSingle());
  if(!o?.items.some(i=>i.listing_id===d.listing_id))throw new AppError(403,'Reviews require a completed purchase of this item.');
  await ownMedia(d.media_id,req.profile.id,'review');await run(db.from('reviews').insert({...d,author_id:req.profile.id}));res.status(201).json({ok:true});
 });
 app.get('/api/reports',auth,async(req,res)=>res.json(await run(db.from('reports').select('*').eq('author_id',req.profile.id).order('created_at',{ascending:false}))));
 app.post('/api/reports',auth,limiter('reports',10,60000),async(req,res)=>{
  const d=schemas.report.parse(req.body);
  if(d.target_type!=='support'){
   if(!d.target_id)throw new AppError(400,'Choose the record to report.');
   let q=db.from({listing:'listings',seller:'profiles',order:'orders'}[d.target_type]).select('id').eq('id',d.target_id);
   if(d.target_type==='order')q=q.or(`buyer_id.eq.${req.profile.id},seller_id.eq.${req.profile.id}`);
   if(!await run(q.maybeSingle()))throw new AppError(404,'Record not found.');
  }
  await run(db.from('reports').insert({...d,author_id:req.profile.id}));res.status(201).json({ok:true});
 });
 app.get('/api/announcements',async(req,res)=>res.json(await run(db.from('announcements').select('id,title,body,created_at,media:media(url)').eq('published',true).order('created_at',{ascending:false}).limit(20))));
 app.get('/api/notifications',auth,async(req,res)=>res.json(await run(db.from('notifications').select('*').eq('user_id',req.profile.id).order('created_at',{ascending:false}).limit(100))));
 app.patch('/api/notifications',auth,async(req,res)=>{await run(db.from('notifications').update({read:true}).eq('user_id',req.profile.id).eq('read',false));res.json({ok:true});});
 app.get('/api/media/:id',auth,async(req,res)=>{const m=await run(db.from('media').select('*').eq('id',id(req)).eq('owner_id',req.profile.id).maybeSingle());if(!m)throw new AppError(404,'Image not found.');res.json({id:m.id,url:mediaUrl(m)});});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxUploadBytes+1,files:1,fields:1,parts:2}});
 app.post('/api/uploads/:purpose',auth,limiter('uploads',30,10*60000),upload.single('image'),async(req,res)=>{
  if(!config.uploadReady)throw new AppError(503,'Image uploads are not configured. Follow SETUP.md.');
  const purpose=z.enum(['listing','avatar','review','chat','announcement']).parse(req.params.purpose);
  if(purpose==='announcement'&&req.profile.role!=='admin')throw new AppError(403,'Administrator access is required.');
  if(purpose==='listing'&&req.profile.seller_status!=='approved'&&req.profile.role!=='admin')throw new AppError(403,'Seller approval is required.');
  if(!req.file)throw new AppError(400,'Choose an image.');
  if(req.file.size>maxUploadBytes)throw new AppError(413,'Choose an image up to 4 MB.');
  const detected=await fileTypeFromBuffer(req.file.buffer);
  if(!['image/jpeg','image/png','image/webp'].includes(detected?.mime))throw new AppError(400,'Choose a valid JPG, PNG, or WebP image.');
  const publicId=`aquamarket/${req.profile.id}/${randomUUID()}`;
  const result=await new Promise((resolve,reject)=>{
   const stream=cloudinary.uploader.upload_stream({public_id:publicId,resource_type:'image',type:purpose==='chat'?'authenticated':'upload',overwrite:false,allowed_formats:['jpg','jpeg','png','webp'],transformation:[{width:2000,height:2000,crop:'limit'},{quality:'auto'},{flags:'strip_profile'}]},(err,data)=>err?reject(new AppError(502,'Image upload failed. Check the Cloudinary configuration and try again.')):resolve(data));
   stream.end(req.file.buffer);
  });
  try{
   const m=await run(db.from('media').insert({owner_id:req.profile.id,purpose,public_id:result.public_id,url:result.secure_url,format:result.format,bytes:result.bytes}).select('*').single());res.status(201).json({id:m.id,url:mediaUrl(m)});
  }catch(e){await cloudinary.uploader.destroy(publicId,{type:purpose==='chat'?'authenticated':'upload'}).catch(()=>{});throw e;}
 });

 const conversation=async(cid,uid)=>requireMember(await run(db.from('conversations').select('*').eq('id',cid).maybeSingle()),uid);
 const messageOut=async m=>{let attachment=null;if(m.media_id){const media=await run(db.from('media').select('*').eq('id',m.media_id).single());attachment=mediaUrl(media);}return {...m,attachment};};
 app.get('/api/conversations',auth,async(req,res)=>{
  const rows=await run(db.from('conversations').select('*,a:profiles!conversations_user_a_fkey(id,username,full_name,active),b:profiles!conversations_user_b_fkey(id,username,full_name,active)').or(`user_a.eq.${req.profile.id},user_b.eq.${req.profile.id}`).order('last_message_at',{ascending:false}));
  res.json(rows.map(c=>({id:c.id,peer:c.user_a===req.profile.id?c.b:c.a,last_message_at:c.last_message_at,read_at:c.user_a===req.profile.id?c.a_read_at:c.b_read_at,peer_read_at:c.user_a===req.profile.id?c.b_read_at:c.a_read_at})));
 });
 app.post('/api/conversations',auth,async(req,res)=>{
  const peer=uuid.parse(req.body.peer_id);if(peer===req.profile.id)throw new AppError(400,'Choose another user to message.');
  if(!await run(db.from('profiles').select('id').eq('id',peer).eq('active',true).maybeSingle()))throw new AppError(404,'User not found.');
  const [user_a,user_b]=[req.profile.id,peer].sort();
  await run(db.from('conversations').upsert({user_a,user_b},{onConflict:'user_a,user_b',ignoreDuplicates:true}));
  res.json(await run(db.from('conversations').select('id').eq('user_a',user_a).eq('user_b',user_b).single()));
 });
 app.get('/api/conversations/:id/messages',auth,async(req,res)=>{
  const cid=id(req);await conversation(cid,req.profile.id);
  let q=db.from('messages').select('*').eq('conversation_id',cid);
  if(req.query.before){const before=await run(db.from('messages').select('id,created_at').eq('conversation_id',cid).eq('id',uuid.parse(req.query.before)).maybeSingle());if(!before)throw new AppError(404,'Message not found.');q=q.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);}
  const msgs=await run(q.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50));res.json({items:await Promise.all(msgs.reverse().map(messageOut)),hasMore:msgs.length===50});
 });
 app.patch('/api/conversations/:id/read',auth,async(req,res)=>{
  const c=await conversation(id(req),req.profile.id);const now=new Date().toISOString();
  await run(db.from('conversations').update({[c.user_a===req.profile.id?'a_read_at':'b_read_at']:now}).eq('id',c.id));
  io.to(`user:${c.user_a}`).to(`user:${c.user_b}`).emit('chat:read',{conversation_id:c.id,user_id:req.profile.id,at:now});res.json({ok:true});
 });
 async function sendMessage(uid,payload){
  const d=schemas.message.parse(payload);const m=await run(db.rpc('send_message',{actor:uid,convo:d.conversation_id,nonce:d.client_id,message_body:d.body,image:d.media_id}).single());
  const c=await conversation(d.conversation_id,uid);const out=await messageOut(m);
  io.to(`user:${c.user_a}`).to(`user:${c.user_b}`).emit('chat:message',out);return out;
 }
 app.post('/api/messages',auth,limiter('messages',60,60000),async(req,res)=>res.status(201).json(await sendMessage(req.profile.id,req.body)));
 const socketRates=new Map();
 const socketLimit=shared?uid=>shared.socketLimit(uid):async uid=>{const now=Date.now();let r=socketRates.get(uid);if(!r||r.until<now){r={count:0,until:now+60000};socketRates.set(uid,r);}if(++r.count>100)throw new AppError(429,'Please slow down and try again.');};
 const cleanup=setInterval(()=>{for(const [k,v]of socketRates)if(v.until<Date.now())socketRates.delete(k);},60000);cleanup.unref();
 io.use(async(socket,next)=>{try{if(!config.dbReady)throw new AppError(503,'Backend is not configured.');socket.data.identity=await identity(socket.handshake.auth?.token);next();}catch(e){next(new Error(e.status?e.message:'Unable to connect.'));}});
 io.on('connection',socket=>{
  const uid=socket.data.identity.profile.id;socket.join(`user:${uid}`);
  // Require a fresh handshake at least hourly, even if idle. Active events revalidate the token.
  const expiry=setTimeout(()=>socket.disconnect(true),60*60000);expiry.unref();
  socket.on('chat:send',async(payload,ack)=>{if(typeof ack!=='function')return;try{await socketLimit(uid);await identity(socket.handshake.auth.token);ack({ok:true,message:await sendMessage(uid,payload)});}catch(e){ack({ok:false,error:e instanceof z.ZodError?'Invalid message.':e.status?e.message:'Could not send your message.'});}});
  socket.on('chat:typing',async payload=>{try{await socketLimit(uid);await identity(socket.handshake.auth.token);const c=await conversation(uuid.parse(payload?.conversation_id),uid);socket.to(`user:${c.user_a===uid?c.user_b:c.user_a}`).emit('chat:typing',{conversation_id:c.id,user_id:uid});}catch{}});
  socket.on('disconnect',()=>clearTimeout(expiry));
 });
 http.on('close',()=>clearInterval(cleanup));

 app.use('/api/admin',auth,admin);
 const insights=createInsightService({config,shared,fetchImpl:aiFetch});
 const analytics=async(actor,days)=>{
  const {data,error}=await db.rpc('admin_analytics',{actor,period_days:days});
  if(error&&['PGRST202','42883'].includes(error.code))throw new AppError(503,'Analytics needs database migration 002_admin_analytics.sql. See VERCEL.md.');
  return snapshotSchema.parse(await run(Promise.resolve({data,error})));
 };
 app.get('/api/admin/analytics',async(req,res)=>res.json({snapshot:await analytics(req.profile.id,periods.parse(Number(req.query.days||30))),ai:{configured:Boolean(config.aiReady),model:config.groqModel||'openai/gpt-oss-20b'}}));
 app.post('/api/admin/insights',limiter('ai',3,60000,()=> 'all-admins'),async(req,res)=>{
  const {days}=z.object({days:periods}).strict().parse(req.body);
  res.json(await insights.generate(await analytics(req.profile.id,days)));
 });
 app.get('/api/admin/summary',async(req,res)=>{
  res.json(await rpc('marketplace_stats',{actor:req.profile.id}));
 });
 const adminTables={users:['profiles','*'],sellers:['profiles','*'],listings:['listings',listSelect],transactions:['orders',orderSelect],complaints:['reports','*,author:profiles!reports_author_id_fkey(username)'],reviews:['reviews','*,author:profiles!reviews_author_id_fkey(username),listing:listings(title)'],announcements:['announcements','*,media:media(url)'],audit:['audit_log','*']};
 app.get('/api/admin/records/:type',async(req,res)=>{
  const spec=adminTables[req.params.type];if(!spec)throw new AppError(404,'Unknown collection.');
  const page=Math.max(1,Number(req.query.page)||1);let q=db.from(spec[0]).select(spec[1],{count:'exact'}).order('created_at',{ascending:false}).range((page-1)*50,page*50-1);
  if(req.params.type==='sellers')q=q.neq('seller_status','none');
  const {data,error,count}=await q;if(error)await run(Promise.resolve({error}));res.json({items:req.params.type==='listings'?data.map(publicListing):data,total:count,page,pageSize:50});
 });
 app.patch('/api/admin/users/:id',async(req,res)=>{
  const d=z.object({active:z.boolean()}).strict().parse(req.body);const target=await run(db.from('profiles').select('role').eq('id',id(req)).single());
  if(target.role==='admin')throw new AppError(403,'Administrator accounts must be managed by the project owner.');
  await run(db.from('profiles').update(d).eq('id',id(req)));await run(db.from('audit_log').insert({actor_id:req.profile.id,action:d.active?'user.activate':'user.suspend',entity_id:id(req)}));
  if(!d.active)io.in(`user:${id(req)}`).disconnectSockets(true);res.json({ok:true});
 });
 app.patch('/api/admin/sellers/:id',async(req,res)=>{
  const d=z.object({seller_status:z.enum(['approved','rejected']),seller_note:z.string().trim().max(1000)}).strict().parse(req.body);
  await run(db.from('profiles').update(d).eq('id',id(req)).neq('seller_status','none'));
  await notify(id(req),'Seller application: '+d.seller_status,'/seller-register.html');await run(db.from('audit_log').insert({actor_id:req.profile.id,action:'seller.'+d.seller_status,entity_id:id(req)}));res.json({ok:true});
 });
 app.patch('/api/admin/listings/:id',async(req,res)=>{
  const d=z.object({status:z.enum(['removed','active'])}).strict().parse(req.body);await run(db.from('listings').update(d).eq('id',id(req)));
  await run(db.from('audit_log').insert({actor_id:req.profile.id,action:'listing.'+d.status,entity_id:id(req)}));res.json({ok:true});
 });
 app.patch('/api/admin/complaints/:id',async(req,res)=>{
  const d=z.object({status:z.enum(['open','reviewing','resolved','dismissed']),response:z.string().trim().max(3000)}).strict().parse(req.body);
  const r=await run(db.from('reports').update(d).eq('id',id(req)).select('author_id').single());await notify(r.author_id,'Your support report has an update.','/support.html');res.json({ok:true});
 });
 app.patch('/api/admin/reviews/:id',async(req,res)=>{const d=z.object({status:z.enum(['visible','hidden'])}).strict().parse(req.body);await run(db.from('reviews').update(d).eq('id',id(req)));res.json({ok:true});});
 const saveAnnouncement=async(req,res)=>{const d=schemas.announcement.parse(req.body);const existing=req.params.id?await run(db.from('announcements').select('media_id').eq('id',id(req)).single()):null;if(d.media_id!==existing?.media_id)await ownMedia(d.media_id,req.profile.id,'announcement');const q=req.params.id?db.from('announcements').update(d).eq('id',id(req)):db.from('announcements').insert({...d,author_id:req.profile.id});res.json(await run(q.select('*').single()));};
 app.post('/api/admin/announcements',saveAnnouncement);app.put('/api/admin/announcements/:id',saveAnnouncement);
 app.delete('/api/admin/announcements/:id',async(req,res)=>{await run(db.from('announcements').delete().eq('id',id(req)));res.json({ok:true});});
 app.get('/api/admin/export',async(req,res)=>{
  let q=db.from('orders').select('id,created_at,buyer_id,seller_id,total,status,payment_status,payment_method');
  if(req.query.from)q=q.gte('created_at',z.iso.date().parse(req.query.from)+'T00:00:00Z');
  if(req.query.to)q=q.lt('created_at',new Date(Date.parse(z.iso.date().parse(req.query.to))+86400000).toISOString());
  // Explicitly paginate beyond Supabase's default 1000-row cap.
  let rows=[];for(let page=0;page<100;page++){const batch=await run(q.order('id').range(page*1000,page*1000+999));rows.push(...batch);if(batch.length<1000)break;if(page===99)throw new AppError(400,'Choose a narrower date range for export.');}
  const cols=['id','created_at','buyer_id','seller_id','total','status','payment_status','payment_method'];
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const csv='\uFEFF'+[cols.join(','),...rows.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\r\n');
  if(config.vercel&&Buffer.byteLength(csv,'utf8')>4_000_000)throw new AppError(400,'Choose a narrower date range to keep this report under 4 MB.');
  res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="aquamarket-orders.csv"'}).send(csv);
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found.'}));
 app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)),{dotfiles:'deny',index:'index.html',maxAge:config.production?'1h':0,setHeaders:(res,path)=>{if(path.endsWith('.html')||path.endsWith('/assets/js/bundle.js'))res.setHeader('Cache-Control','no-cache');}}));
 app.use((req,res)=>res.status(404).type('html').send('<h1>Page not found</h1><a href="/">Return to AquaMarket</a>'));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  if(err instanceof z.ZodError)return res.status(400).json({error:err.issues.map(i=>(i.path.join('.')?i.path.join('.')+': ':'')+i.message).slice(0,3).join(' ')});
  if(err instanceof multer.MulterError)return res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:'Upload one JPG, PNG, or WebP image up to 4 MB.'});
  if(err.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON.'});
  if(!err.status)console.error('Unhandled request error:',err.name);
  res.status(err.status||500).json({error:err.status?err.message:'Something went wrong. Please try again.'});
 });
 return {app,http,io};
}

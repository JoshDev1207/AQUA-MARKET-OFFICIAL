-- Run ONCE on a new Supabase project using the SQL editor (or supabase db push).
-- No seeded users, listings, transactions, messages, reviews, or announcements.
begin;
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  full_name text not null check (length(full_name) between 1 and 100),
  role text not null default 'user' check (role in ('user','admin')),
  active boolean not null default true,
  phone text not null default '', address text not null default '',
  location text not null default '', bio text not null default '',
  store_name text not null default '', seller_type text not null default 'Hobbyist',
  seller_status text not null default 'none' check (seller_status in ('none','pending','approved','rejected')),
  seller_note text not null default '', avatar_id uuid,
  created_at timestamptz not null default now()
);
create table public.media (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
  purpose text not null check(purpose in ('listing','avatar','review','chat','announcement')),
  public_id text not null unique, url text not null, format text not null,
  bytes integer not null check(bytes > 0), created_at timestamptz not null default now()
);
alter table public.profiles add constraint profile_avatar foreign key(avatar_id) references public.media(id);
create table public.listings (
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('sale','trade')),
  title text not null check(length(title) between 3 and 120),
  description text not null check(length(description) between 10 and 5000),
  category text not null check(category in ('Fish','Plants','Aquariums','Equipment','Food','Other')),
  species text not null default '', location text not null default '',
  price numeric(12,2) not null default 0 check(price >= 0 and price <= 99999999),
  stock integer not null default 1 check(stock >= 0),
  trade_preference text not null default '',
  status text not null default 'active' check(status in ('active','draft','archived','removed')),
  availability text not null default 'available' check(availability in ('available','reserved','traded')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.listing_images (
  listing_id uuid not null references public.listings(id) on delete cascade,
  media_id uuid not null references public.media(id), position smallint not null check(position between 0 and 5),
  primary key(listing_id,media_id), unique(listing_id,position)
);
create table public.favorites (
 user_id uuid not null references public.profiles(id) on delete cascade,
 listing_id uuid not null references public.listings(id) on delete cascade,
 primary key(user_id,listing_id)
);
create table public.cart_items (
 user_id uuid not null references public.profiles(id) on delete cascade,
 listing_id uuid not null references public.listings(id), quantity integer not null check(quantity between 1 and 1000),
 primary key(user_id,listing_id)
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), buyer_id uuid not null references public.profiles(id),
 seller_id uuid not null references public.profiles(id), total numeric(14,2) not null check(total >= 0),
 status text not null default 'pending' check(status in ('pending','confirmed','shipped','completed','cancelled')),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','paid','refunded')),
 payment_method text not null check(payment_method in ('Cash on delivery','Cash on meet-up','GCash (manual)','Maya (manual)')),
 payment_reference text not null default '', recipient text not null, phone text not null,
 address text not null, arrangement text not null check(arrangement in ('Meet-up','Delivery')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(buyer_id <> seller_id)
);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 listing_id uuid not null references public.listings(id), title text not null,
 price numeric(12,2) not null check(price >= 0), quantity integer not null check(quantity > 0),
 image_url text, unique(order_id,listing_id)
);
create table public.checkout_requests (
 buyer_id uuid not null references public.profiles(id), request_id uuid not null, result jsonb not null,
 primary key(buyer_id,request_id)
);
create table public.trade_requests (
 id uuid primary key default gen_random_uuid(), requester_id uuid not null references public.profiles(id),
 recipient_id uuid not null references public.profiles(id),
 listing_id uuid not null references public.listings(id), offer_id uuid not null references public.listings(id),
 message text not null default '' check(length(message)<=1000),
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled','completed')),
 requester_confirmed boolean not null default false, recipient_confirmed boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(requester_id<>recipient_id),check(listing_id<>offer_id)
);
create unique index one_pending_trade on public.trade_requests(listing_id,offer_id) where status in ('pending','accepted');
create table public.conversations (
 id uuid primary key default gen_random_uuid(),
 user_a uuid not null references public.profiles(id), user_b uuid not null references public.profiles(id),
 a_read_at timestamptz not null default '1970-01-01', b_read_at timestamptz not null default '1970-01-01',
 last_message_at timestamptz not null default now(), created_at timestamptz not null default now(),
 check(user_a<user_b),unique(user_a,user_b)
);
create table public.messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id),
 sender_id uuid not null references public.profiles(id), client_id uuid not null,
 body text not null default '' check(length(body)<=5000), media_id uuid references public.media(id),
 created_at timestamptz not null default clock_timestamp(), unique(sender_id,client_id),
 check(length(trim(body))>0 or media_id is not null)
);
create table public.reviews (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id),
 listing_id uuid not null references public.listings(id), order_id uuid not null references public.orders(id),
 rating smallint not null check(rating between 1 and 5), body text not null check(length(body) between 3 and 2000),
 media_id uuid references public.media(id), status text not null default 'visible' check(status in ('visible','hidden')),
 created_at timestamptz not null default now(),unique(author_id,listing_id,order_id)
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id),
 target_type text not null check(target_type in ('listing','seller','order','support')),
 target_id uuid, reason text not null check(length(reason) between 3 and 120),
 details text not null check(length(details) between 5 and 3000),
 status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
 response text not null default '', created_at timestamptz not null default now()
);
create table public.announcements (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id),
 title text not null check(length(title) between 3 and 120), body text not null check(length(body) between 3 and 3000),
 media_id uuid references public.media(id), published boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 body text not null, href text not null, read boolean not null default false, created_at timestamptz not null default now()
);
create table public.audit_log (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id),
 action text not null, entity_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index listings_browse on public.listings(status,kind,created_at desc);
create index listings_seller on public.listings(seller_id);
create index order_buyer on public.orders(buyer_id,created_at desc);
create index order_seller on public.orders(seller_id,created_at desc);
create index chat_history on public.messages(conversation_id,created_at desc,id desc);
create index conversation_a on public.conversations(user_a,last_message_at desc);
create index conversation_b on public.conversations(user_b,last_message_at desc);
create index trade_requester on public.trade_requests(requester_id);
create index trade_recipient on public.trade_requests(recipient_id);
create index notification_user on public.notifications(user_id,created_at desc);
create index reviews_listing on public.reviews(listing_id);

-- Only the Node server can access tables. Its service key NEVER goes to the browser.
-- Even authenticated clients cannot bypass business rules with direct REST calls.
do $$ declare t text; begin
 foreach t in array array['profiles','media','listings','listing_images','favorites','cart_items','orders','order_items','checkout_requests','trade_requests','conversations','messages','reviews','reports','announcements','notifications','audit_log'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on all sequences in schema public to service_role;

create function public.on_aqua_user_created() returns trigger language plpgsql security definer set search_path='' as $$
declare uname text; fullname text;
begin
 uname:=lower(new.raw_user_meta_data->>'username');
 if uname is null or uname !~ '^[a-z0-9_]{3,30}$' then uname:='keeper_'||replace(new.id::text,'-',''); uname:=left(uname,30); end if;
 fullname:=left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),nullif(trim(new.raw_user_meta_data->>'name'),''),uname),100);
 insert into public.profiles(id,username,full_name) values(new.id,uname,fullname);
 return new;
end $$;
create trigger aqua_new_user after insert on auth.users for each row execute function public.on_aqua_user_created();

-- Functions accept an actor resolved by the server from a verified Supabase token.
-- They are not executable using an anon/publishable key or a user's JWT.
create function public.assert_actor(actor uuid, admin_only boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=actor and active and (not admin_only or role='admin')) then
 raise exception 'This account is not permitted to perform this action.' using errcode='42501'; end if;
end $$;
create function public.login_email(uname text) returns text language sql security definer set search_path='' as $$
 select u.email from auth.users u join public.profiles p on p.id=u.id where p.username=lower(uname) and p.active;
$$;
create function public.notify_aqua(uid uuid, msg text, link text) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,body,href) values(uid,msg,link);
$$;

create function public.save_listing(actor uuid, payload jsonb, images uuid[], listing uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.listings; lid uuid; img uuid; pos smallint:=0;
begin
 perform public.assert_actor(actor);
 if not exists(select 1 from public.profiles where id=actor and (seller_status='approved' or role='admin')) then raise exception 'Seller approval is required.'; end if;
 if array_length(images,1) is null or array_length(images,1)>6 then raise exception 'Add between 1 and 6 images.'; end if;
 foreach img in array images loop
  if not exists(select 1 from public.media where id=img and owner_id=actor and purpose='listing') then raise exception 'Invalid listing image.'; end if;
 end loop;
 if listing is not null then
  select * into l from public.listings where id=listing for update;
  if l.id is null or l.seller_id<>actor then raise exception 'Listing not found.'; end if;
  if l.status='removed' or l.availability<>'available' then raise exception 'This listing cannot be edited.'; end if;
  if payload->>'kind'<>l.kind then raise exception 'Listing type cannot be changed.'; end if;
  lid:=l.id;
  update public.listings set title=payload->>'title',description=payload->>'description',category=payload->>'category',species=payload->>'species',location=payload->>'location',price=(payload->>'price')::numeric,stock=(payload->>'stock')::integer,trade_preference=payload->>'trade_preference',status=payload->>'status',updated_at=now() where id=lid;
  delete from public.listing_images where listing_id=lid;
 else
  insert into public.listings(seller_id,kind,title,description,category,species,location,price,stock,trade_preference,status)
  values(actor,payload->>'kind',payload->>'title',payload->>'description',payload->>'category',payload->>'species',payload->>'location',(payload->>'price')::numeric,(payload->>'stock')::integer,payload->>'trade_preference',payload->>'status') returning id into lid;
 end if;
 foreach img in array images loop
  insert into public.listing_images(listing_id,media_id,position) values(lid,img,pos);pos:=pos+1;
 end loop;
 return lid;
end $$;
create function public.set_cart(actor uuid, listing uuid, qty integer) returns void language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
 perform public.assert_actor(actor);
 -- Serialize cart edits with checkout for this buyer.
 perform 1 from public.profiles where id=actor for no key update;
 if qty=0 then delete from public.cart_items where user_id=actor and listing_id=listing;return;end if;
 select * into l from public.listings where id=listing;
 if l.id is null or l.kind<>'sale' or l.status<>'active' or l.seller_id=actor or l.stock<qty or qty not between 1 and 1000 or not exists(select 1 from public.profiles where id=l.seller_id and active and (seller_status='approved' or role='admin')) then raise exception 'This quantity is unavailable.';end if;
 insert into public.cart_items(user_id,listing_id,quantity) values(actor,listing,qty) on conflict(user_id,listing_id) do update set quantity=excluded.quantity;
end $$;
create function public.checkout(actor uuid, request_key uuid, info jsonb, reviewed jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; actual jsonb; result jsonb:='[]'; c record; seller uuid; oid uuid; amount numeric;
begin
 perform public.assert_actor(actor);
 perform 1 from public.profiles where id=actor for no key update;
 select r.result into prior from public.checkout_requests r where r.buyer_id=actor and r.request_id=request_key;
 if found then return prior;end if;
 if length(trim(info->>'recipient'))<2 or length(trim(info->>'phone'))<7 or length(trim(info->>'address'))<5 then raise exception 'Complete your contact and handover details.';end if;
 perform l.id from public.listings l join public.cart_items ci on ci.listing_id=l.id where ci.user_id=actor order by l.id for update of l;
 select jsonb_agg(jsonb_build_object('id',l.id,'quantity',ci.quantity,'price',l.price) order by l.id) into actual from public.cart_items ci join public.listings l on l.id=ci.listing_id where ci.user_id=actor;
 if actual is null then raise exception 'Your cart is empty.';end if;
 if actual is distinct from (select jsonb_agg(x order by x->>'id') from jsonb_array_elements(reviewed) x) then raise exception 'Your cart or a price changed. Review checkout again.';end if;
 for c in select l.*,ci.quantity from public.cart_items ci join public.listings l on l.id=ci.listing_id where ci.user_id=actor loop
  if c.status<>'active' or c.kind<>'sale' or c.stock<c.quantity or c.seller_id=actor or not exists(select 1 from public.profiles where id=c.seller_id and active and (seller_status='approved' or role='admin')) then raise exception 'One or more items are no longer available. Update your cart.';end if;
 end loop;
 for seller in select distinct l.seller_id from public.listings l join public.cart_items ci on ci.listing_id=l.id where ci.user_id=actor loop
  select sum(l.price*ci.quantity) into amount from public.listings l join public.cart_items ci on ci.listing_id=l.id where ci.user_id=actor and l.seller_id=seller;
  insert into public.orders(buyer_id,seller_id,total,payment_method,recipient,phone,address,arrangement)
  values(actor,seller,amount,info->>'payment_method',info->>'recipient',info->>'phone',info->>'address',info->>'arrangement') returning id into oid;
  insert into public.order_items(order_id,listing_id,title,price,quantity,image_url)
  select oid,l.id,l.title,l.price,ci.quantity,(select m.url from public.listing_images li join public.media m on m.id=li.media_id where li.listing_id=l.id order by li.position limit 1) from public.listings l join public.cart_items ci on ci.listing_id=l.id where ci.user_id=actor and l.seller_id=seller;
  result:=result||jsonb_build_array(oid);
  perform public.notify_aqua(seller,'You received a new order.','/order-details.html?id='||oid);
 end loop;
 update public.listings l set stock=l.stock-ci.quantity,updated_at=now() from public.cart_items ci where ci.listing_id=l.id and ci.user_id=actor;
 delete from public.cart_items where user_id=actor;
 insert into public.checkout_requests values(actor,request_key,result);
 perform public.notify_aqua(actor,'Your order was placed. Arrange payment and handover with the seller.','/orders.html');
 return result;
end $$;
create function public.change_order(actor uuid, oid uuid, action text, reference text default '') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; admin boolean;
begin
 perform public.assert_actor(actor);
 select * into o from public.orders where id=oid for update;
 select role='admin' into admin from public.profiles where id=actor;
 if o.id is null or (actor<>o.buyer_id and actor<>o.seller_id and not admin) then raise exception 'Order not found.';end if;
 if action='paid' then
  if (actor<>o.seller_id and not admin) or o.payment_status<>'unpaid' or o.status='cancelled' or length(trim(reference))<3 then raise exception 'Only the seller can record received payment, with a reference.';end if;
  update public.orders set payment_status='paid',payment_reference=reference,updated_at=now() where id=oid;
 elsif action='refunded' then
  if (actor<>o.seller_id and not admin) or o.payment_status<>'paid' or o.status='completed' or length(trim(reference))<3 then raise exception 'Refund cannot be recorded for this order.';end if;
  update public.orders set payment_status='refunded',payment_reference=reference,updated_at=now() where id=oid;
 elsif action='cancelled' then
  if o.status not in ('pending','confirmed') or o.payment_status='paid' then raise exception 'Only pending or confirmed orders can be cancelled; record any refund first.';end if;
  perform l.id from public.listings l join public.order_items i on i.listing_id=l.id where i.order_id=oid order by l.id for update of l;
  update public.listings l set stock=l.stock+i.quantity,updated_at=now() from public.order_items i where i.listing_id=l.id and i.order_id=oid;
  update public.orders set status=action,updated_at=now() where id=oid;
 elsif action='confirmed' and o.status='pending' and (actor=o.seller_id or admin) and o.payment_status<>'refunded' then
  update public.orders set status=action,updated_at=now() where id=oid;
 elsif action='shipped' and o.status='confirmed' and (actor=o.seller_id or admin) and o.payment_status<>'refunded' then
  update public.orders set status=action,updated_at=now() where id=oid;
 elsif action='completed' and o.status in ('confirmed','shipped') and (actor=o.buyer_id or admin) and o.payment_status='paid' then
  update public.orders set status=action,updated_at=now() where id=oid;
 else raise exception 'This order cannot make that status change.';
 end if;
 insert into public.audit_log(actor_id,action,entity_id,details) values(actor,'order.'||action,oid,jsonb_build_object('reference',reference));
 perform public.notify_aqua(o.buyer_id,'Order updated: '||action,'/order-details.html?id='||oid);
 perform public.notify_aqua(o.seller_id,'Order updated: '||action,'/order-details.html?id='||oid);
end $$;
create function public.propose_trade(actor uuid, wanted uuid, offered uuid, note text) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.listings;b public.listings;rid uuid;
begin
 perform public.assert_actor(actor);
 perform id from public.listings where id in(wanted,offered) order by id for update;
 select * into a from public.listings where id=wanted;select * into b from public.listings where id=offered;
 if a.id is null or b.id is null or a.kind<>'trade' or b.kind<>'trade' or a.seller_id=actor or b.seller_id<>actor or a.status<>'active' or b.status<>'active' or a.availability<>'available' or b.availability<>'available' or exists(select 1 from public.profiles where id in(a.seller_id,b.seller_id) and (not active or (seller_status<>'approved' and role<>'admin'))) then raise exception 'Choose two available trade listings from different sellers.';end if;
 insert into public.trade_requests(requester_id,recipient_id,listing_id,offer_id,message) values(actor,a.seller_id,wanted,offered,note) returning id into rid;
 perform public.notify_aqua(a.seller_id,'You received a trade request.','/my-trades.html');return rid;
end $$;
create function public.change_trade(actor uuid, rid uuid, action text) returns void language plpgsql security definer set search_path='' as $$
declare r public.trade_requests;
begin
 perform public.assert_actor(actor);
 select * into r from public.trade_requests where id=rid for update;
 if r.id is null or actor not in(r.requester_id,r.recipient_id) then raise exception 'Trade not found.';end if;
 perform id from public.listings where id in(r.listing_id,r.offer_id) order by id for update;
 if action='accepted' and r.status='pending' and actor=r.recipient_id then
  if exists(select 1 from public.listings l join public.profiles p on p.id=l.seller_id where l.id in(r.listing_id,r.offer_id) and (l.status<>'active' or l.availability<>'available' or not p.active or (p.seller_status<>'approved' and p.role<>'admin'))) then raise exception 'One of these listings is already reserved or unavailable.';end if;
  update public.listings set availability='reserved',updated_at=now() where id in(r.listing_id,r.offer_id);
  update public.trade_requests set status='accepted',updated_at=now() where id=rid;
 elsif action='declined' and r.status='pending' and actor=r.recipient_id then
  update public.trade_requests set status='declined',updated_at=now() where id=rid;
 elsif action='cancelled' and (r.status='accepted' or (r.status='pending' and actor=r.requester_id)) then
  if r.requester_confirmed or r.recipient_confirmed then raise exception 'A handover was confirmed; contact support for a dispute.';end if;
  if r.status='accepted' then update public.listings set availability='available',updated_at=now() where id in(r.listing_id,r.offer_id);end if;
  update public.trade_requests set status='cancelled',updated_at=now() where id=rid;
 elsif action='completed' and r.status='accepted' then
  update public.trade_requests set requester_confirmed=requester_confirmed or actor=requester_id,recipient_confirmed=recipient_confirmed or actor=recipient_id,updated_at=now() where id=rid returning * into r;
  if r.requester_confirmed and r.recipient_confirmed then
   update public.listings set availability='traded',updated_at=now() where id in(r.listing_id,r.offer_id);
   update public.trade_requests set status='completed' where id=rid;
  end if;
 else raise exception 'This trade cannot make that status change.';
 end if;
 perform public.notify_aqua(r.requester_id,'Trade updated: '||action,'/my-trades.html');
 perform public.notify_aqua(r.recipient_id,'Trade updated: '||action,'/my-trades.html');
end $$;
create function public.send_message(actor uuid, convo uuid, nonce uuid, message_body text, image uuid default null) returns public.messages language plpgsql security definer set search_path='' as $$
declare c public.conversations;m public.messages;
begin
 perform public.assert_actor(actor);
 select * into c from public.conversations where id=convo;
 if c.id is null or actor not in(c.user_a,c.user_b) or exists(select 1 from public.profiles where id in(c.user_a,c.user_b) and not active) then raise exception 'Conversation is unavailable.';end if;
 if image is not null and not exists(select 1 from public.media where id=image and owner_id=actor and purpose='chat') then raise exception 'Invalid attachment.';end if;
 insert into public.messages(conversation_id,sender_id,client_id,body,media_id) values(convo,actor,nonce,trim(message_body),image) on conflict(sender_id,client_id) do nothing returning * into m;
 if m.id is null then
  select * into m from public.messages where sender_id=actor and client_id=nonce;
  if m.conversation_id<>convo or m.body<>trim(message_body) or m.media_id is distinct from image then raise exception 'Message retry does not match the original.';end if;
 end if;
 update public.conversations set last_message_at=greatest(last_message_at,m.created_at) where id=convo;
 return m;
end $$;

create function public.marketplace_stats(actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_actor(actor,true);
 return jsonb_build_object(
  'profiles',(select count(*) from public.profiles),
  'listings',(select count(*) from public.listings),
  'orders',(select count(*) from public.orders),
  'trade_requests',(select count(*) from public.trade_requests),
  'reports',(select count(*) from public.reports),
  'received',(select coalesce(sum(total),0) from public.orders where payment_status='paid')
 );
end $$;

-- Restrict every function created by this migration, including helper functions.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('marketplace_stats','on_aqua_user_created','assert_actor','login_email','notify_aqua','save_listing','set_cart','checkout','change_order','propose_trade','change_trade','send_message') loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;

-- Safe upgrade for existing AquaMarket databases: no rows are inserted/deleted.
-- Run after 001_aquamarket.sql. Re-running this upgrade is safe.
begin;
create index if not exists aqua_orders_created on public.orders(created_at);

create or replace function public.admin_analytics(actor uuid, period_days integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare finish timestamptz:=now(); start_at timestamptz; previous_start timestamptz; previous_end timestamptz; result jsonb;
begin
 perform public.assert_actor(actor,true);
 if period_days not in (7,30,90) or period_days is null then raise exception 'Choose 7, 30 or 90 days.'; end if;
 start_at:=finish-make_interval(days=>period_days);
 previous_start:=start_at-make_interval(days=>period_days);
 previous_end:=start_at;
 with visible as (
   select l.* from public.listings l join public.profiles p on p.id=l.seller_id
   where l.status='active' and p.active and (p.seller_status='approved' or p.role='admin')
 ), recent as (
   select * from public.orders where created_at>=start_at and created_at<finish
 ), previous as (
   select * from public.orders where created_at>=previous_start and created_at<previous_end
 ), category_names as (
   select unnest(array['Fish','Plants','Aquariums','Equipment','Food','Other']) as category
 ), category_sales as (
   select l.category,sum(i.quantity) as units,sum(i.quantity*i.price) as value
   from public.order_items i join recent o on o.id=i.order_id join public.listings l on l.id=i.listing_id
   where o.status='completed' and o.payment_status='paid' group by l.category
 ), daily_sales as (
   select (created_at at time zone 'UTC')::date as day,count(*) as orders,
     coalesce(sum(total) filter(where status='completed' and payment_status='paid'),0) as value
   from recent group by (created_at at time zone 'UTC')::date
 )
 select jsonb_build_object(
   'period_days',period_days,'generated_at',finish,'window_start',start_at,'window_end',finish,'currency','PHP',
   'metrics',jsonb_build_object(
     'total_users',(select count(*) from public.profiles),
     'new_users',(select count(*) from public.profiles where created_at>=start_at and created_at<finish),
     'active_sellers',(select count(*) from public.profiles where active and seller_status='approved'),
     'pending_sellers',(select count(*) from public.profiles where active and seller_status='pending'),
     'active_sale_listings',(select count(*) from visible where kind='sale'),
     'active_trade_listings',(select count(*) from visible where kind='trade'),
     'out_of_stock_listings',(select count(*) from visible where kind='sale' and stock=0),
     'low_stock_listings',(select count(*) from visible where kind='sale' and stock between 1 and 3),
     'orders_placed',(select count(*) from recent),
     'orders_completed_paid',(select count(*) from recent where status='completed' and payment_status='paid'),
     'completed_paid_value',(select coalesce(sum(total),0) from recent where status='completed' and payment_status='paid'),
     'orders_cancelled',(select count(*) from recent where status='cancelled'),
     'orders_pending',(select count(*) from recent where status='pending'),
     'previous_orders_placed',(select count(*) from previous),
     'previous_completed_paid_value',(select coalesce(sum(total),0) from previous where status='completed' and payment_status='paid'),
     'open_reports',(select count(*) from public.reports where status in ('open','reviewing')),
     'trades_completed',(select count(*) from public.trade_requests where status='completed' and created_at>=start_at and created_at<finish)
   ),
   'daily',(select jsonb_agg(jsonb_build_object('date',to_char(d.day,'YYYY-MM-DD'),'orders',coalesce(s.orders,0),'value',coalesce(s.value,0)) order by d.day)
     from generate_series((start_at at time zone 'UTC')::date,(finish at time zone 'UTC')::date,interval '1 day') d(day)
     left join daily_sales s on s.day=d.day::date),
   'categories',(select jsonb_agg(jsonb_build_object(
     'category',c.category,'active_listings',(select count(*) from visible v where v.category=c.category and v.kind='sale'),
     'available_units',(select coalesce(sum(stock),0) from visible v where v.category=c.category and v.kind='sale'),
     'sold_units',coalesce(s.units,0),'completed_paid_value',coalesce(s.value,0)) order by c.category)
     from category_names c left join category_sales s using(category))
 ) into result;
 return result;
end $$;
revoke all on function public.admin_analytics(uuid,integer) from public,anon,authenticated;
grant execute on function public.admin_analytics(uuid,integer) to service_role;
commit;

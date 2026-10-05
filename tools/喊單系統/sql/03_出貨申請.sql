-- 03：客人申請出貨（全家好賣+ 店到店，運費統一 $39）

create table public.ship_requests (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id) on delete cascade,
  item_ids bigint[] not null,
  shipping_fee integer not null default 39,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','done','cancelled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index on public.ship_requests (status);
create index on public.ship_requests (customer_id);

alter table public.ship_requests enable row level security;

create policy "客人看自己的申請、管理者看全部" on public.ship_requests for select
  using (public.my_role() = 'admin'
         or customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "管理者處理申請" on public.ship_requests for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- 客人按「我想要出貨」：把自己「已到貨、還沒出貨、還沒申請過」的商品打包成一筆申請
create or replace function public.request_shipping(p_note text default '') returns bigint
language plpgsql security definer set search_path = public as $$
declare
  cid bigint;
  ids bigint[];
  rid bigint;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select id into cid from public.customers where user_id = auth.uid();
  if cid is null then raise exception '目前沒有你的喊單'; end if;

  select array_agg(oi.id order by oi.id) into ids
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.customer_id = cid
    and oi.shipped_at is null
    and p.status = 'arrived'
    and not exists (
      select 1 from public.ship_requests r
      where r.customer_id = cid and r.status = 'pending' and oi.id = any(r.item_ids)
    );

  if ids is null then raise exception '目前沒有可以申請出貨的商品'; end if;

  insert into public.ship_requests (customer_id, item_ids, note)
    values (cid, ids, left(coalesce(trim(p_note), ''), 200))
    returning id into rid;
  return rid;
end $$;

-- 客人取消自己還沒處理的申請
create or replace function public.cancel_ship_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.ship_requests set status = 'cancelled', handled_at = now()
  where id = p_id and status = 'pending'
    and customer_id in (select id from public.customers where user_id = auth.uid());
end $$;

revoke execute on function public.request_shipping(text) from public, anon;
revoke execute on function public.cancel_ship_request(bigint) from public, anon;
grant execute on function public.request_shipping(text) to authenticated;
grant execute on function public.cancel_ship_request(bigint) to authenticated;

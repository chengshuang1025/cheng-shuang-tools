-- 02：客人認領喊單、自己 +1、手機帳號
-- 手機帳號用「手機號碼＋密碼」註冊，手機號碼存在 user_metadata.phone

-- 新帳號建立 profile：FB 帳號帶名字，手機帳號帶手機與自填名字
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'display_name'),
    coalesce(new.phone, new.raw_user_meta_data->>'phone')
  );
  return new;
end $$;

-- 這個帳號是不是用 FB 登入
create or replace function public.is_facebook_user() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.identities where user_id = auth.uid() and provider = 'facebook')
$$;

-- 找出「可能是我的」喊單：FB 帳號比對 FB 名字；手機帳號比對你在後台登記的手機
create or replace function public.preview_claim()
returns table (customer_id bigint, fb_name text, items text, total int)
language sql stable security definer set search_path = public as $$
  with me as (select display_name, phone from public.profiles where id = auth.uid())
  select c.id, c.fb_name,
         string_agg(p.name || '×' || oi.qty, '、' order by p.code),
         (coalesce(sum(p.price * oi.qty), 0) + c.extra_fee)::int
  from public.customers c
  join public.order_items oi on oi.customer_id = c.id
  join public.products p on p.id = oi.product_id
  cross join me
  where c.user_id is null
    and (
      (public.is_facebook_user() and lower(trim(c.fb_name)) = lower(trim(me.display_name)))
      or (me.phone is not null and c.phone = me.phone)
    )
  group by c.id, c.fb_name, c.extra_fee
$$;

-- 確認「這些是我的」：只能認領 preview_claim 找到的那幾筆，並合併成一個客人
create or replace function public.confirm_claim(ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  allowed bigint[];
  target bigint;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select array_agg(customer_id) into allowed
    from public.preview_claim() where customer_id = any(ids);
  if allowed is null then return 0; end if;

  select id into target from public.customers where user_id = auth.uid();
  if target is null then
    target := allowed[1];
    update public.customers set user_id = auth.uid(), confirmed = true where id = target;
  end if;

  update public.order_items set customer_id = target
    where customer_id = any(allowed) and customer_id <> target;
  update public.customers t set
      extra_fee = t.extra_fee + coalesce((select sum(extra_fee) from public.customers where id = any(allowed) and id <> target), 0),
      note = trim(both '；' from t.note || '；' || coalesce((select string_agg(nullif(note,''), '；') from public.customers where id = any(allowed) and id <> target), '')),
      phone = coalesce(t.phone, (select phone from public.customers where id = any(allowed) and phone is not null limit 1))
    where t.id = target;
  delete from public.customers where id = any(allowed) and id <> target;
  return array_length(allowed, 1);
end $$;

-- 客人自己 +1（只限收單中商品）
create or replace function public.plus_one(p_product bigint, p_qty int default 1) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  cid bigint;
  pname text;
  existing bigint;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then raise exception '數量請填 1 到 99'; end if;
  if not exists (select 1 from public.products where id = p_product and status = 'open') then
    raise exception '這個商品目前沒有在收單';
  end if;

  select id into cid from public.customers where user_id = auth.uid();
  if cid is null then
    select coalesce(display_name, '未命名客人') into pname from public.profiles where id = auth.uid();
    insert into public.customers (fb_name, user_id, phone, confirmed)
      values (pname, auth.uid(), (select phone from public.profiles where id = auth.uid()), true)
      returning id into cid;
  end if;

  select id into existing from public.order_items
    where customer_id = cid and product_id = p_product and shipped_at is null limit 1;
  if existing is not null then
    update public.order_items set qty = qty + p_qty where id = existing;
    return existing;
  end if;
  insert into public.order_items (customer_id, product_id, qty, source)
    values (cid, p_product, p_qty, 'self') returning id into existing;
  return existing;
end $$;

revoke execute on function public.preview_claim() from public, anon;
revoke execute on function public.confirm_claim(bigint[]) from public, anon;
revoke execute on function public.plus_one(bigint, int) from public, anon;
grant execute on function public.preview_claim() to authenticated;
grant execute on function public.confirm_claim(bigint[]) to authenticated;
grant execute on function public.plus_one(bigint, int) to authenticated;

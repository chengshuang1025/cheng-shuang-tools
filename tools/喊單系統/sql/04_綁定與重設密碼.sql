-- 04：管理者把手機帳號綁定到社團喊單、幫客人重設密碼

-- 綁定：把某個登入帳號（p_user）綁到某位社團客人（p_customer）
-- 如果這個帳號已經有自己的客人資料（例如先自己 +1 過），就把喊單合併過去
create or replace function public.admin_bind_customer(p_user uuid, p_customer bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  existing bigint;
begin
  if public.my_role() <> 'admin' then raise exception '只有團主可以綁定'; end if;
  if exists (select 1 from public.customers where id = p_customer and user_id is not null and user_id <> p_user) then
    raise exception '這位客人已經綁定其他帳號了';
  end if;

  select id into existing from public.customers where user_id = p_user;
  if existing is not null and existing <> p_customer then
    update public.order_items set customer_id = p_customer where customer_id = existing;
    update public.ship_requests set customer_id = p_customer where customer_id = existing;
    update public.customers t set
        extra_fee = t.extra_fee + coalesce((select extra_fee from public.customers where id = existing), 0),
        note = trim(both '；' from t.note || '；' || coalesce((select nullif(note, '') from public.customers where id = existing), ''))
      where t.id = p_customer;
    delete from public.customers where id = existing;
  end if;

  update public.customers set
      user_id = p_user,
      confirmed = true,
      phone = coalesce(phone, (select phone from public.profiles where id = p_user))
    where id = p_customer;
  return p_customer;
end $$;

-- 解除綁定（綁錯人時用）
create or replace function public.admin_unbind_customer(p_customer bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception '只有團主可以解除綁定'; end if;
  update public.customers set user_id = null, confirmed = false where id = p_customer;
end $$;

-- 重設密碼：只限手機帳號（FB 帳號沒有密碼）
create or replace function public.admin_set_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.my_role() <> 'admin' then raise exception '只有團主可以重設密碼'; end if;
  if p_password is null or length(p_password) < 6 then raise exception '密碼至少要 6 個字'; end if;
  if not exists (select 1 from auth.identities where user_id = p_user and provider = 'email') then
    raise exception '這個帳號是用 Facebook 登入，沒有密碼可以重設';
  end if;
  update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = p_user;
end $$;

-- 後台「帳號」分頁用：每個帳號的登入方式與綁定狀態
create or replace function public.admin_accounts()
returns table (id uuid, display_name text, phone text, role public.app_role, created_at timestamptz,
               provider text, customer_id bigint, customer_name text)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.display_name, p.phone, p.role, p.created_at,
         coalesce((select i.provider from auth.identities i where i.user_id = p.id order by i.created_at limit 1), 'email'),
         c.id, c.fb_name
  from public.profiles p
  left join public.customers c on c.user_id = p.id
  where public.my_role() = 'admin'
  order by p.created_at desc
$$;

revoke execute on function public.admin_bind_customer(uuid, bigint) from public, anon;
revoke execute on function public.admin_unbind_customer(bigint) from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
revoke execute on function public.admin_accounts() from public, anon;
grant execute on function public.admin_bind_customer(uuid, bigint) to authenticated;
grant execute on function public.admin_unbind_customer(bigint) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_accounts() to authenticated;

-- 團主幫客人改手機號碼（客人註冊時打錯號碼用）
-- 手機帳號的登入名稱是 <手機>@phone.haoshi-groupbuy.tw，所以要一起改登入名稱
create or replace function public.admin_set_phone(p_user uuid, p_phone text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_phone text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '^886', '0');
  v_email text;
begin
  if public.my_role() <> 'admin' then
    raise exception '只有團主可以改手機號碼';
  end if;
  if v_phone !~ '^09[0-9]{8}$' then
    raise exception '請輸入 09 開頭的 10 碼手機號碼';
  end if;
  if not exists (select 1 from auth.identities where user_id = p_user and provider = 'email') then
    raise exception '只有手機註冊的帳號可以改手機號碼';
  end if;
  v_email := v_phone || '@phone.haoshi-groupbuy.tw';
  if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user) then
    raise exception '這個手機號碼已經有人註冊了';
  end if;

  update auth.users
     set email = v_email,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('phone', v_phone),
         updated_at = now()
   where id = p_user;
  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_email),
         updated_at = now()
   where user_id = p_user and provider = 'email';
  update public.profiles set phone = v_phone where id = p_user;
  update public.customers set phone = v_phone where user_id = p_user;
  return v_phone;
end;
$$;

revoke all on function public.admin_set_phone(uuid, text) from public, anon;
grant execute on function public.admin_set_phone(uuid, text) to authenticated;

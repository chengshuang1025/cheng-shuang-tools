-- 好事丞雙 團購喊單系統：資料表與權限
-- 身分：admin（好事丞雙）、partner（夥伴）、customer（客人）

create type public.app_role as enum ('admin','partner','customer');
create type public.product_status as enum ('open','closed','arrived');

-- 每個登入帳號的資料
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  display_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- 團（例如 10 月團購）
create table public.rounds (
  id bigint generated always as identity primary key,
  title text not null,
  close_date date,
  created_at timestamptz not null default now()
);

-- 商品
create table public.products (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.rounds(id) on delete cascade,
  code text not null,
  name text not null,
  price integer,
  status public.product_status not null default 'open',
  ordered_qty integer not null default 0,
  note text not null default '',
  note_by text,
  note_at timestamptz,
  unique (round_id, code)
);

-- 客人（可以先由社團匯入建立，之後再綁定登入帳號）
create table public.customers (
  id bigint generated always as identity primary key,
  fb_name text not null,
  user_id uuid unique references auth.users(id) on delete set null,
  phone text,
  extra_fee integer not null default 0,
  note text not null default '',
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.customers (lower(fb_name));

-- 喊單明細
create table public.order_items (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  qty integer not null check (qty > 0),
  source text not null default 'import' check (source in ('import','self','manual')),
  shipped_at date,
  created_at timestamptz not null default now()
);
create index on public.order_items (customer_id);
create index on public.order_items (product_id);

-- 自動喚醒用的小表
create table public.heartbeat (id int primary key default 1, at timestamptz not null default now());
insert into public.heartbeat default values;

-- 取得目前登入者的身分
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'customer'::public.app_role)
$$;

-- 新帳號註冊時自動建立 profile（預設是客人）
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), new.phone);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 夥伴只能改訂貨數與備註，不能改價格、狀態等
create or replace function public.partner_product_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'partner' then
    if (new.code, new.name, new.price, new.status, new.round_id)
       is distinct from (old.code, old.name, old.price, old.status, old.round_id) then
      raise exception '夥伴帳號只能修改訂貨數量與備註';
    end if;
  end if;
  return new;
end $$;
create trigger partner_guard before update on public.products
  for each row execute function public.partner_product_guard();

-- 夥伴看的訂貨表：只有數量，沒有客人資料
create or replace view public.product_demand with (security_invoker = false) as
  select p.id, p.round_id, p.code, p.name, p.status, p.ordered_qty, p.note, p.note_by, p.note_at,
         coalesce(sum(oi.qty),0)::int as needed_qty
  from public.products p left join public.order_items oi on oi.product_id = p.id
  where public.my_role() in ('admin','partner')
  group by p.id;

-- ===== 權限（RLS）=====
alter table public.profiles enable row level security;
alter table public.rounds enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.order_items enable row level security;
alter table public.heartbeat enable row level security;

create policy "自己的資料或管理者" on public.profiles for select
  using (id = auth.uid() or public.my_role() = 'admin');
create policy "管理者改身分" on public.profiles for update
  using (public.my_role() = 'admin');

create policy "登入者可看團" on public.rounds for select to authenticated using (true);
create policy "管理者管理團" on public.rounds for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "登入者可看商品" on public.products for select to authenticated using (true);
create policy "管理者管理商品" on public.products for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "夥伴更新訂貨與備註" on public.products for update
  using (public.my_role() = 'partner') with check (public.my_role() = 'partner');

create policy "客人看自己、管理者看全部" on public.customers for select
  using (user_id = auth.uid() or public.my_role() = 'admin');
create policy "管理者管理客人" on public.customers for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "客人看自己的喊單、管理者看全部" on public.order_items for select
  using (public.my_role() = 'admin'
         or customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "管理者管理喊單" on public.order_items for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "客人自己 +1（只限收單中商品）" on public.order_items for insert
  with check (
    source = 'self' and shipped_at is null
    and customer_id in (select id from public.customers where user_id = auth.uid())
    and product_id in (select id from public.products where status = 'open')
  );

grant select on public.product_demand to authenticated;

-- 自動喚醒：讓外部排程每天讀一次
create policy "任何人可讀心跳" on public.heartbeat for select to anon, authenticated using (true);

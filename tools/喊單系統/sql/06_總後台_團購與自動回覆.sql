-- 好事丞雙 總後台：團購資料（網站＋自動回覆共用）、留言自動回覆
-- 在 Supabase SQL Editor 執行一次

-- ===== 團購（一團一筆，團購網站與自動回覆共用）=====
create table if not exists public.campaigns (
  id bigint generated always as identity primary key,
  title text not null,
  descr text not null default '',          -- 一句話介紹
  points text[] not null default '{}',     -- 賣點
  image text not null default '',
  url text not null default '',            -- 團購連結
  tag text not null default '',
  start_date date,
  end_date date,
  worksheet boolean not null default false,
  faq text not null default '',            -- 給自動回覆參考的補充資訊（價格、運費、出貨時間…）
  on_site boolean not null default true,   -- 顯示在團購網站
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== 自動回覆：整體設定（只有一筆）=====
create table if not exists public.reply_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,          -- 總開關
  ig_enabled boolean not null default true,
  fb_enabled boolean not null default true,
  ai_enabled boolean not null default true,        -- 用 Gemini 回答團購問題
  public_reply text not null default '已經私訊給妳囉，記得去收件匣看看 💌',
  follow_button text not null default '我追蹤好了，領取 🎁',
  follow_prompt text not null default '謝謝妳的留言 🥰
學習單是送給追蹤 @cheng.shuang1025 的朋友的小禮物～
追蹤之後，按下面的按鈕就能領取喔！',
  not_following text not null default '咦，好像還沒看到妳的追蹤耶 🥲
追蹤 @cheng.shuang1025 之後，再按一次按鈕就可以領取囉！',
  fb_like_prompt text not null default '謝謝妳的留言 🥰
這份是送給粉絲頁朋友的小禮物～
幫好事丞雙的粉絲頁按個讚，再按下面的按鈕就能領取喔！',
  ai_style text not null default '語氣溫暖、親切，像朋友聊天，用繁體中文，句子短，可以加一兩個表情符號。自稱「我」，品牌叫好事丞雙。',
  verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);
insert into public.reply_settings (id) values (1) on conflict do nothing;

-- ===== 自動回覆：關鍵字規則 =====
create table if not exists public.reply_rules (
  id bigint generated always as identity primary key,
  name text not null default '',                   -- 後台顯示用，例如「VEGANWELL 學習單」
  keywords text[] not null default '{}',           -- 留言含任一個就觸發，例如 {學習單,想要}
  campaign_id bigint references public.campaigns(id) on delete set null,
  message text not null default '',                -- 私訊內容
  link text not null default '',                   -- 下載連結（追蹤後才送出）
  require_follow boolean not null default true,    -- 要先追蹤才給
  platforms text[] not null default '{ig,fb}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ===== 自動回覆紀錄 =====
create table if not exists public.reply_log (
  id bigint generated always as identity primary key,
  platform text not null,                          -- ig / fb
  kind text not null default 'comment',            -- comment / message
  event_id text unique,                            -- 留言 id 或訊息 id（避免重複回覆）
  post_id text,
  user_id text,
  user_name text,
  text text,
  rule_id bigint references public.reply_rules(id) on delete set null,
  action text,                                     -- keyword / gate_ok / gate_wait / ai / skip
  reply text,
  status text not null default 'done',             -- done / skipped / needs_human / error
  error text,
  handled boolean not null default false,          -- 團主已處理（需要人工的留言）
  created_at timestamptz not null default now()
);
create index if not exists reply_log_created on public.reply_log (created_at desc);

-- ===== Meta 連線（粉絲頁權杖，只有伺服器程式讀得到）=====
create table if not exists public.meta_connection (
  id int primary key default 1 check (id = 1),
  page_id text,
  page_name text,
  page_token text,
  ig_user_id text,
  ig_username text,
  connected_at timestamptz
);

-- ===== 權限 =====
alter table public.campaigns enable row level security;
alter table public.reply_settings enable row level security;
alter table public.reply_rules enable row level security;
alter table public.reply_log enable row level security;
alter table public.meta_connection enable row level security;

drop policy if exists "管理者管理團購" on public.campaigns;
create policy "管理者管理團購" on public.campaigns for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "管理者管理回覆設定" on public.reply_settings;
create policy "管理者管理回覆設定" on public.reply_settings for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "管理者管理回覆規則" on public.reply_rules;
create policy "管理者管理回覆規則" on public.reply_rules for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "管理者看回覆紀錄" on public.reply_log;
create policy "管理者看回覆紀錄" on public.reply_log for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
-- meta_connection 不開任何 policy：只有伺服器（service role）讀寫

-- 團購網站用的公開清單（只露出網站需要的欄位，不含 faq）
create or replace view public.site_campaigns with (security_invoker = false) as
  select id, title, descr, points, image, url, tag, start_date, end_date, worksheet, sort
  from public.campaigns where on_site;
grant select on public.site_campaigns to anon, authenticated;

-- 後台看 Meta 連線狀態（不含權杖）
create or replace function public.meta_status() returns json
language sql stable security definer set search_path = public as $$
  select case when public.my_role() = 'admin' then
    (select json_build_object('page_name', page_name, 'ig_username', ig_username, 'connected_at', connected_at)
     from public.meta_connection where id = 1)
  end
$$;
grant execute on function public.meta_status() to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists campaigns_touch on public.campaigns;
create trigger campaigns_touch before update on public.campaigns for each row execute function public.touch_updated_at();

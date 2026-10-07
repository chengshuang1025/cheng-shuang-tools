-- 只回覆「這個時間之後發的貼文」：舊貼文交給 FB／IG 內建的自動回覆
alter table public.reply_settings add column if not exists active_since timestamptz default '2026-10-07 10:00:00+08';
update public.reply_settings set active_since = '2026-10-07 10:00:00+08' where id = 1 and active_since is null;
-- 個別規則可以設定「舊貼文也適用」（例如測試用、長期索取的學習單）
alter table public.reply_rules add column if not exists all_posts boolean not null default false;
-- 貼文發佈時間的快取（伺服器查過一次就記住，不用每則留言都問 Meta）
create table if not exists public.post_times (
  post_id text primary key,
  created_at timestamptz,
  checked_at timestamptz not null default now()
);
alter table public.post_times enable row level security;

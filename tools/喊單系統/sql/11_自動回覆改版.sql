-- 自動回覆改版：分「貼文留言／限動回覆／私訊」、可鎖定某一篇、公開回覆庫隨機挑、
-- 私訊「第一則就給連結」或「先按按鈕再給」、連結按鈕、邀請追蹤一句、排程、測試用重複觸發、封存
-- 不再檢查追蹤（require_follow、menu 留著但不用了）

alter table public.reply_rules
  add column if not exists source text not null default 'comment',      -- comment 貼文留言／story 限動回覆／dm 私訊
  add column if not exists post_id text,                                -- 鎖定哪一篇（空白＝全部）
  add column if not exists post_thumb text not null default '',
  add column if not exists post_caption text not null default '',
  add column if not exists any_text boolean not null default false,     -- 不用關鍵字，有留言就回
  add column if not exists fuzzy boolean not null default true,         -- 同音錯字也算
  add column if not exists public_replies text[] not null default '{}', -- 留言底下公開回一句（隨機挑）
  add column if not exists mode text not null default 'button',         -- direct 第一則就給／button 先按按鈕再給
  add column if not exists greeting text not null default '',           -- 先按按鈕：招呼語
  add column if not exists button_label text not null default '我想更了解這產品！',
  add column if not exists link_buttons jsonb not null default '[]'::jsonb,  -- [{title,url}] 最多 3 顆
  add column if not exists follow_invite boolean not null default true, -- 最後附一句邀請追蹤
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists allow_repeat boolean not null default false, -- 測試用：同一個人可以重複觸發
  add column if not exists archived boolean not null default false;

alter table public.reply_rules drop constraint if exists reply_rules_source_chk;
alter table public.reply_rules add constraint reply_rules_source_chk check (source in ('comment','story','dm'));
alter table public.reply_rules drop constraint if exists reply_rules_mode_chk;
alter table public.reply_rules add constraint reply_rules_mode_chk check (mode in ('direct','button'));

-- 舊規則：連結改成連結按鈕、維持「直接給」、公開回覆沿用原本那一句
update public.reply_rules set
  link_buttons = case when link <> '' and link_buttons = '[]'::jsonb
                      then jsonb_build_array(jsonb_build_object('title', '🔗 點我打開', 'url', link)) else link_buttons end,
  link = '',
  mode = 'direct',
  public_replies = case when public_replies = '{}' then array[(select public_reply from public.reply_settings where id = 1)] else public_replies end
where created_at < '2026-10-07 14:30:00+08';  -- 只動改版前就有的規則（重跑也不會改到新規則）

alter table public.reply_settings
  add column if not exists dm_ready boolean not null default false,     -- Meta 私訊權限已核准
  add column if not exists typing boolean not null default true,        -- 送出前顯示「輸入中…」
  add column if not exists delay_sec numeric not null default 1.3,
  add column if not exists thanks_enabled boolean not null default true,
  add column if not exists thanks_replies text[] not null default array['棉客氣💛','不會～有問題再敲我🥰','咩～不用客氣🤟🏻'],
  add column if not exists public_pool text[] not null default array[
    '傳給你囉！沒收到可能沒有開啟陌生訊息～來私我吧😍',
    '私你囉🌸記得查看陌生訊息，沒收到可以再敲敲我🥰',
    '火速傳給你✨沒收到再主動敲我一下🫶🏻',
    '傳囉🥰記得收陌生私訊！沒收到可以再敲我🩵',
    '已傳！幫我看一下小盒子📥沒收到可能是沒開陌生訊息，來私我吧😍'],
  add column if not exists default_greeting text not null default '嗨嗨～謝謝妳的留言 🥰
按下面的按鈕，我馬上傳給妳 👇',
  add column if not exists invite_ig text not null default '喜歡的話記得追蹤 @cheng.shuang1025 喔 🥰 之後還有更多好玩的分享！',
  add column if not exists invite_fb text not null default '喜歡的話記得幫好事丞雙的粉絲頁按個讚喔 🥰 之後還有更多好玩的分享！';

-- 規則卡片上的數字（最近 30 天）：觸發、已送、按了按鈕
create or replace function public.reply_rule_stats() returns table (rule_id bigint, triggered int, sent int, greeted int, clicks int, errors int)
language sql stable security definer set search_path = public as $$
  select l.rule_id,
    count(*) filter (where l.action in ('greet','sent'))::int,
    count(*) filter (where l.action in ('greet','sent') and l.status = 'done')::int,
    count(*) filter (where l.action = 'greet' and l.status = 'done')::int,
    count(distinct l.user_id) filter (where l.action = 'click' and l.status = 'done')::int,
    count(*) filter (where l.status = 'error')::int
  from public.reply_log l
  where public.my_role() = 'admin' and l.rule_id is not null and l.created_at > now() - interval '30 days'
  group by l.rule_id
$$;
grant execute on function public.reply_rule_stats() to authenticated;

create index if not exists reply_log_rule_user on public.reply_log (rule_id, user_id);

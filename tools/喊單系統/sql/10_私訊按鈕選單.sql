-- 私訊按鈕選單（像 ManyChat）：每條關鍵字規則可以有一層層的按鈕
-- menu 的格式：[{ id, title(按鈕文字), text(私訊內容), link, follow(要追蹤才給), children:[…] }]
alter table public.reply_rules add column if not exists menu jsonb not null default '[]'::jsonb;
-- 回覆紀錄多記「點到哪個按鈕」，按鈕不見時對方打字也能接著走
alter table public.reply_log add column if not exists step text;

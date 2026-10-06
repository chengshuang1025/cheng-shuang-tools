-- 連接 FB 粉絲頁／IG 時用的一次性狀態碼（防止別人假冒團主完成連接）
create table if not exists public.meta_oauth_state (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.meta_oauth_state enable row level security;
drop policy if exists "管理者建立狀態碼" on public.meta_oauth_state;
create policy "管理者建立狀態碼" on public.meta_oauth_state for insert
  with check (public.my_role() = 'admin' and created_by = auth.uid());
drop policy if exists "管理者看自己的狀態碼" on public.meta_oauth_state;
create policy "管理者看自己的狀態碼" on public.meta_oauth_state for select
  using (public.my_role() = 'admin' and created_by = auth.uid());

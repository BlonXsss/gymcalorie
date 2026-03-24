create table if not exists public.app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "anon read app_state" on public.app_state;
create policy "anon read app_state"
on public.app_state
for select
to anon
using (true);

drop policy if exists "anon write app_state" on public.app_state;
create policy "anon write app_state"
on public.app_state
for insert
to anon
with check (true);

drop policy if exists "anon update app_state" on public.app_state;
create policy "anon update app_state"
on public.app_state
for update
to anon
using (true)
with check (true);

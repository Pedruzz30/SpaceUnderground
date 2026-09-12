-- Space Underground — administrative activity log

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users (id) on delete set null,
  action text not null check (btrim(action) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id text,
  title text not null check (btrim(title) <> ''),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx
  on public.activity_log (created_at desc);

create index if not exists activity_log_entity_idx
  on public.activity_log (entity_type, entity_id);

alter table public.activity_log enable row level security;

drop policy if exists activity_log_admin_read on public.activity_log;
create policy activity_log_admin_read on public.activity_log
  for select
  using (public.is_admin());

drop policy if exists activity_log_admin_insert on public.activity_log;
create policy activity_log_admin_insert on public.activity_log
  for insert
  with check (public.is_admin());

grant select, insert on public.activity_log to authenticated;

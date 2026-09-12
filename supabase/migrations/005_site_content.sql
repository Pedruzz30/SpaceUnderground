-- Space Underground — editable public site content

create table if not exists public.site_content (
  key text primary key check (btrim(key) <> ''),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

drop trigger if exists site_content_touch_updated_at on public.site_content;
create trigger site_content_touch_updated_at
  before update on public.site_content
  for each row execute function public.touch_updated_at();

alter table public.site_content enable row level security;

drop policy if exists site_content_public_read on public.site_content;
create policy site_content_public_read on public.site_content
  for select
  using (true);

drop policy if exists site_content_admin_all on public.site_content;
create policy site_content_admin_all on public.site_content
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;

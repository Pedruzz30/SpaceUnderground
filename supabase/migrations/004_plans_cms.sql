-- Space Underground — commercial plans CMS

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (btrim(slug) <> ''),
  name text not null check (btrim(name) <> ''),
  monogram text,
  category text,
  range text,
  scope text,
  scope_short text,
  status text not null default 'AVAILABLE',
  description text,
  timeline text,
  year integer check (year between 1990 and 2100),
  accent text check (accent is null or accent ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$'),
  visible boolean not null default true,
  "position" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_visible_position_idx
  on public.plans (visible, "position");

drop trigger if exists plans_touch_updated_at on public.plans;
create trigger plans_touch_updated_at
  before update on public.plans
  for each row execute function public.touch_updated_at();

create table if not exists public.plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  "position" integer not null check ("position" >= 0),
  text text not null check (btrim(text) <> ''),
  created_at timestamptz not null default now()
);

create index if not exists plan_features_plan_idx
  on public.plan_features (plan_id, "position");

create unique index if not exists plan_features_plan_position_key
  on public.plan_features (plan_id, "position");

alter table public.plans enable row level security;
alter table public.plan_features enable row level security;

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans
  for select
  using (visible = true);

drop policy if exists plans_admin_all on public.plans;
create policy plans_admin_all on public.plans
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists plan_features_public_read on public.plan_features;
create policy plan_features_public_read on public.plan_features
  for select
  using (
    exists (
      select 1
      from public.plans p
      where p.id = plan_features.plan_id
        and p.visible = true
    )
  );

drop policy if exists plan_features_admin_all on public.plan_features;
create policy plan_features_admin_all on public.plan_features
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.plans, public.plan_features to anon, authenticated;
grant insert, update, delete on public.plans, public.plan_features to authenticated;

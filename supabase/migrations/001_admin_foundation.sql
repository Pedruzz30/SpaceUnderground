-- Space Underground — admin foundation
--
-- Creates the tables the admin panel needs (projects, project_gallery, admins),
-- their constraints and triggers, and the row level security policies that
-- actually enforce authorization. The frontend never decides who may write:
-- hiding a button is not security, these policies are.
--
-- Value casing matches the admin UI model exactly, so no translation layer is
-- needed: category/status are title case, editorial_status is upper case.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- admins
-- ---------------------------------------------------------------------------
-- Being authenticated is NOT enough to reach the admin. A user must also have
-- a row here. Rows are inserted manually (SQL editor / service role), never by
-- the frontend.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin', 'editor')),
  created_at timestamptz not null default now()
);

comment on table public.admins is
  'Users authorized to use the admin panel. Supabase Auth proves identity; this table grants access.';

-- Consulted by the policies below. SECURITY DEFINER so that checking admin
-- membership does not recurse into the RLS policies of public.admins itself.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
-- `id` is the internal identity (uuid). `case_number` is the editorial
-- identity shown as CASE 001 — they are deliberately separate.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  case_number integer not null unique check (case_number > 0),
  name text not null check (btrim(name) <> ''),
  slug text not null unique check (btrim(slug) <> ''),
  client text,
  category text not null default 'Website'
    check (category in ('Website', 'System', 'Automation', 'AI', 'Other')),
  description text,
  status text not null default 'In Development'
    check (status in ('Live', 'Prototype', 'MVP', 'Pilot', 'In Development', 'Research', 'Archived')),
  editorial_status text not null default 'DRAFT'
    check (editorial_status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  featured boolean not null default false,
  visible boolean not null default true,
  year integer check (year between 1990 and 2100),
  accent text check (accent ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$'),
  tech_stack text[] not null default '{}',
  poster_url text,
  project_url text,
  preview_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists projects_editorial_status_idx
  on public.projects (editorial_status, visible);

-- updated_at is owned by the database, not by the client.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- First publication stamps published_at. Later edits — including going back to
-- DRAFT and publishing again — never reset it, so the original publication date
-- survives. This mirrors the admin behaviour.
create or replace function public.stamp_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.editorial_status = 'PUBLISHED' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists projects_stamp_published_at on public.projects;
create trigger projects_stamp_published_at
  before insert or update on public.projects
  for each row execute function public.stamp_published_at();

-- ---------------------------------------------------------------------------
-- project_gallery
-- ---------------------------------------------------------------------------
-- Gallery images live in their own table instead of a JSON blob on projects.
-- Not wired to real uploads yet; Supabase Storage arrives in a later branch.

create table if not exists public.project_gallery (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  url text not null,
  alt text,
  caption text,
  "position" integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists project_gallery_project_idx
  on public.project_gallery (project_id, "position");

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.admins enable row level security;
alter table public.projects enable row level security;
alter table public.project_gallery enable row level security;

-- admins: a user may check their own membership; admins may see the roster.
-- No write policy exists on purpose — promotion happens via SQL/service role.
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins
  for select
  using (user_id = auth.uid() or public.is_admin());

-- projects: the public site may read published + visible rows, nothing else.
drop policy if exists projects_public_read on public.projects;
create policy projects_public_read on public.projects
  for select
  using (editorial_status = 'PUBLISHED' and visible = true);

-- projects: authorized admins get full control.
drop policy if exists projects_admin_all on public.projects;
create policy projects_admin_all on public.projects
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- gallery follows the visibility of its parent project.
drop policy if exists project_gallery_public_read on public.project_gallery;
create policy project_gallery_public_read on public.project_gallery
  for select
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_gallery.project_id
        and p.editorial_status = 'PUBLISHED'
        and p.visible = true
    )
  );

drop policy if exists project_gallery_admin_all on public.project_gallery;
create policy project_gallery_admin_all on public.project_gallery
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Explicit grants. RLS is what actually gates access; these just make the
-- intended surface obvious.
grant select on public.projects, public.project_gallery to anon, authenticated;
grant insert, update, delete on public.projects, public.project_gallery to authenticated;
grant select on public.admins to authenticated;

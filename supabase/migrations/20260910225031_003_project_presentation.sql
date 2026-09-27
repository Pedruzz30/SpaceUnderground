-- Space Underground — project presentation
--
-- Completes the public presentation model for projects and adds ordered
-- modules as first-class rows. This migration deliberately does not touch
-- media, plans, content or settings.

alter table public.projects
  add column if not exists presentation_system text,
  add column if not exists presentation_label text,
  add column if not exists presentation_address text,
  add column if not exists presentation_type text,
  add column if not exists origin text,
  add column if not exists coordinates text[] not null default '{}';

comment on column public.projects.presentation_system is
  'System label shown inside the project viewer, for example SISTEMA DE EXPERIENCIA / 03.';
comment on column public.projects.presentation_label is
  'Short viewer label shown inside the project viewer.';
comment on column public.projects.presentation_address is
  'Editorial address/title shown in the viewer browser bar.';
comment on column public.projects.presentation_type is
  'Public type label shown in the project viewer.';
comment on column public.projects.origin is
  'Editorial origin display, for example RJ / BR.';
comment on column public.projects.coordinates is
  'Display-only coordinate strings. Not geospatial data.';

create table if not exists public.project_modules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  "position" integer not null check ("position" >= 0),
  code text,
  title text not null check (btrim(title) <> ''),
  description text,
  created_at timestamptz not null default now()
);

-- One unique index covers both jobs: it orders modules within a project and
-- makes two modules at the same position impossible, which is what keeps
-- reordering safe. A second plain index on the same columns would only cost
-- writes.
create unique index if not exists project_modules_project_position_key
  on public.project_modules (project_id, "position");

alter table public.project_modules enable row level security;

drop policy if exists project_modules_public_read on public.project_modules;
create policy project_modules_public_read on public.project_modules
  for select
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_modules.project_id
        and p.editorial_status = 'PUBLISHED'
        and p.visible = true
    )
  );

drop policy if exists project_modules_admin_all on public.project_modules;
create policy project_modules_admin_all on public.project_modules
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.project_modules to anon, authenticated;
grant insert, update, delete on public.project_modules to authenticated;

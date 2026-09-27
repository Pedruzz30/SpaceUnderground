-- Makes live previews explicitly controlled by the Admin. Existing preview_url
-- values are preserved; the new flag decides whether the public iframe may load.

alter table public.projects
  add column if not exists live_preview_enabled boolean not null default false;

comment on column public.projects.live_preview_enabled is
  'When true, the public project viewer may load preview_url in an iframe after URL validation.';

update public.projects
set live_preview_enabled = true
where case_number in (1, 2);

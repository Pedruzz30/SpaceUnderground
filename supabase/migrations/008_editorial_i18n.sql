-- Space Underground — editorial i18n
--
-- Existing text remains the pt-BR primary source. Optional translations live in
-- JSONB objects keyed by locale, for example:
--
-- {
--   "en": {
--     "title": "Independent by design.",
--     "description": "..."
--   }
-- }
--
-- Technical fields, enum values, URLs, paths, UUIDs, positions and dates stay
-- outside this structure.

create or replace function public.valid_i18n_translations(value jsonb)
returns boolean
language sql
immutable
as $$
  select value is null
    or (
      jsonb_typeof(value) = 'object'
      and not exists (
        select 1
        from jsonb_each(value) as locales(locale, fields)
        where locale not in ('en')
          or jsonb_typeof(fields) <> 'object'
      )
    );
$$;

alter table public.projects
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (public.valid_i18n_translations(translations));

alter table public.project_modules
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (public.valid_i18n_translations(translations));

alter table public.project_gallery
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (public.valid_i18n_translations(translations));

alter table public.plans
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (public.valid_i18n_translations(translations));

alter table public.plan_features
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (public.valid_i18n_translations(translations));

alter table public.site_content
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (public.valid_i18n_translations(translations));

alter table public.site_settings
  add column if not exists translations jsonb not null default '{}'::jsonb
    check (public.valid_i18n_translations(translations));

comment on column public.projects.translations is
  'Optional localized editorial fields by locale. pt-BR stays in the base columns.';
comment on column public.project_modules.translations is
  'Optional localized module title/description fields by locale. pt-BR stays in the base columns.';
comment on column public.project_gallery.translations is
  'Optional localized alt/caption fields by locale. pt-BR stays in the base columns.';
comment on column public.plans.translations is
  'Optional localized plan editorial fields by locale. pt-BR stays in the base columns.';
comment on column public.plan_features.translations is
  'Optional localized feature text by locale. pt-BR stays in the base columns.';
comment on column public.site_content.translations is
  'Optional localized public content JSON by locale. pt-BR stays in content.';
comment on column public.site_settings.translations is
  'Optional localized SEO/settings fields by locale. pt-BR stays in the base columns.';

grant execute on function public.valid_i18n_translations(jsonb) to anon, authenticated;

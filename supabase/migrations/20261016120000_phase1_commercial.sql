-- Space Underground — Phase 1 commercial expansion
--
-- Widens the project category check to the six commercial categories defined
-- by Strategy 001 (Websites, Commerce, Business Systems, Booking, Automation,
-- AI Systems) and adds the per-record fields the public portfolio needs to
-- render a contextual CTA and a demo link.
--
-- Business Systems and AI Systems are presentation labels only — the stored
-- enum values stay 'System' and 'AI' so existing rows and queries keep
-- working. The expanded label mapping lives in the i18n layer.

begin;

alter table public.projects
  drop constraint if exists projects_category_check;

alter table public.projects
  add constraint projects_category_check
  check (category in ('Website', 'Commerce', 'System', 'Booking', 'Automation', 'AI', 'Other'));

alter table public.projects
  add column if not exists demo_url text,
  add column if not exists cta_label text,
  add column if not exists cta_label_en text;

comment on column public.projects.demo_url is
  'Optional direct demo link shown on the public card ("Ver demonstração"). Separate from project_url so a client site and a shippable demo can coexist.';
comment on column public.projects.cta_label is
  'PT-BR label for the project card primary CTA ("Quero um sistema assim"). Null falls back to the per-category default resolved in the frontend.';
comment on column public.projects.cta_label_en is
  'EN label for the project card primary CTA. Null falls back to the per-category default resolved in the frontend.';

-- Column-level grants are additive. Re-stating the full set that anon may
-- read keeps a single canonical list and matches the hardening pattern from
-- 2026-09-28, so future migrations know where to extend it.
grant select (
  id,
  case_number,
  name,
  slug,
  client,
  category,
  description,
  status,
  editorial_status,
  featured,
  visible,
  year,
  accent,
  tech_stack,
  poster_url,
  project_url,
  preview_url,
  created_at,
  updated_at,
  published_at,
  presentation_system,
  presentation_label,
  presentation_address,
  presentation_type,
  origin,
  coordinates,
  translations,
  live_preview_enabled,
  demo_url,
  cta_label,
  cta_label_en
) on public.projects to anon;

commit;

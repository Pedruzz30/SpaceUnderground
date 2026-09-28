-- Space Underground - clients post-review hardening
--
-- Follows 20260927225753_clients_foundation, which is applied in production
-- and therefore not edited. Two changes, both additive or narrowing:
--
--   1. projects.client_id leaves the public surface. The foundation added the
--      column to a table anon could read table-wide, so any direct REST call
--      (projects?select=client_id) exposed the owning client of every
--      published project. The public site never asked for it, but not asking
--      is not a barrier.
--   2. clients.last_contact_at records when someone actually spoke with the
--      client. It is set by a person in the Admin, never derived from edits.
--
-- Safe with current production data: no row is rewritten, nothing is dropped
-- except the one policy that is recreated in the same transaction, and the
-- client code sequence is not touched.

-- ---------------------------------------------------------------------------
-- prerequisite
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'client_id'
  ) then
    raise exception 'clients_post_review_hardening requires 20260927225753_clients_foundation (projects.client_id) to be applied first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. projects: public reads without client_id
-- ---------------------------------------------------------------------------
-- Column privileges are per role, and admins are `authenticated` too, so the
-- column cannot be hidden from non-admin users by a grant without hiding it
-- from admins. The split is therefore:
--
--   anon          column-level SELECT on every public column, not client_id;
--                 the public read policy now applies to anon only.
--   authenticated keeps table-level SELECT, but only projects_admin_all
--                 (is_admin()) matches: a signed-in non-admin (sign-up is
--                 open) sees no project row at all, so no client_id either.
--   admin         unchanged: full access through projects_admin_all.
--
-- The public site is anon and selects an explicit column list
-- (src/scripts/supabase-public.js PROJECT_COLUMNS), filtered by
-- editorial_status/visible and ordered by case_number. The policies on
-- project_gallery, project_modules and storage.objects look up id,
-- editorial_status and visible as anon. All of those are granted below.
--
-- A new public column must be added to this grant list: column privileges are
-- not inherited by columns created later. tests/schema-contract.test.mjs
-- fails when the public query selects a column anon cannot read.

drop policy if exists projects_public_read on public.projects;
create policy projects_public_read on public.projects
  for select
  to anon
  using (editorial_status = 'PUBLISHED' and visible = true);

-- Revoking the table privilege also drops any column privileges anon held, so
-- this pair is safe to run again.
revoke select on table public.projects from anon;
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
  live_preview_enabled
) on public.projects to anon;

comment on column public.projects.client_id is
  'Optional owning client (public.clients). Admin-only: anon has no SELECT on this column and non-admin users match no projects policy.';

-- ---------------------------------------------------------------------------
-- 2. clients.last_contact_at
-- ---------------------------------------------------------------------------
-- Null until someone records a contact. Deliberately not maintained by a
-- trigger: editing a record is not talking to the client.

alter table public.clients add column if not exists last_contact_at timestamptz;

comment on column public.clients.last_contact_at is
  'When the team last actually contacted the client, set by hand in the Admin. Null when never recorded.';

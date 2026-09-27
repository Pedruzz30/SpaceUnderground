# Supabase — Space Underground Admin

Database foundation for the admin panel and CMS. The public site now reads
published project, media, plan, content and settings data through the anon key
and RLS.

## Migration format

Migrations follow the Supabase CLI format `YYYYMMDDHHMMSS_<name>.sql`. The
14 digit timestamp is the version the CLI records in
`supabase_migrations.schema_migrations`; the rest of the name only describes
the migration. Versions are unique and sort chronologically, which
`admin/tests/migration-chain.test.mjs` enforces.

The project used to number migrations `001_` to `012_`. That broke twice: two
files shared `010`, and production recorded CLI timestamps while the repository
kept ordinals. Every file now carries a timestamp; the historical ones keep
their old ordinal inside the name (`20260909062014_001_admin_foundation.sql`)
so older notes and commits stay easy to follow.

### Known remote state (production `zvzfkfvxbuofgqrrogxh`)

| Version | Migration | State |
| --- | --- | --- |
| `20260909062014` .. `20260910225035` | `001` .. `007` (admin foundation to activity log) | Schema present in production, **not recorded** in the CLI history |
| `20260912202425` | `editorial_i18n` | APPLIED (recorded) |
| `20260913031225` | `project_live_preview` | APPLIED (recorded) |
| `20260913211045` | `automation_runs` | APPLIED (recorded) |
| `20260914025524` | `011_business_workflows` | APPLIED (recorded) |
| `20260927225426` | `normalize_plan_status` | **NOT APPLIED** |
| `20260927225753` | `clients_foundation` | **NOT APPLIED** |

The four recorded versions and names match
`select version, name from supabase_migrations.schema_migrations` exactly and
must never be renamed. `011_business_workflows` keeps its old ordinal in the
name because that is the name production recorded.

The versions of `001`..`007` are reconciliation identifiers, not deploy
times: each is the UTC time of the commit that first added the file.
`003`..`007` were added in the same commit (`3ee8c2f`, 2026-09-10 22:50:31
UTC), so they take consecutive seconds from `225031` to keep their order.
Before any `supabase db push`, the CLI history must be repaired to mark these
seven versions as applied; they are listed in `docs/release-checklist.md`.

### What each migration creates

`migrations/20260909062014_001_admin_foundation.sql`

| Table | Purpose |
| --- | --- |
| `admins` | Users authorized to use the admin. Authentication alone is not access. |
| `projects` | Portfolio cases. `id` is a uuid; `case_number` is the editorial identity (CASE 001). |
| `project_gallery` | Gallery images per project. Not wired to uploads yet. |

`migrations/20260910011630_002_project_media_storage.sql` creates the private
`project-media` bucket and storage policies.

`migrations/20260910225031_003_project_presentation.sql` adds the project
viewer presentation columns and the ordered `project_modules` table.

`migrations/20260910225032_004_plans_cms.sql` adds public commercial plans plus
ordered `plan_features`.

`migrations/20260910225033_005_site_content.sql` adds structured public
content by key.

`migrations/20260910225034_006_site_settings.sql` adds safe public runtime
settings. Build-time SEO generation still belongs to `site.config.js`; editing
settings in the admin does not pretend to rebuild sitemap/canonical output.

`migrations/20260910225035_007_activity_log.sql` adds the admin-only activity
log.

`migrations/20260912202425_editorial_i18n.sql` adds the optional
`translations` JSONB columns. pt-BR text stays in the existing columns as the
primary source.

`migrations/20260913031225_project_live_preview.sql` adds
`projects.live_preview_enabled`. The public viewer only frames `preview_url`
when this flag is true, so a URL alone never puts a project on the site. The
column defaults to false and the migration enables CASE 001 and 002.

`migrations/20260913211045_automation_runs.sql` adds `automation_runs`, the
workflow engine's run history. RLS is on with no policy: only the automation
service (service role) reads or writes it.

`migrations/20260914025524_011_business_workflows.sql` adds `clients`,
`commercial_proposals` and `commercial_project_handoffs`, all admin-only.
Both this and `automation_runs` were created in production from the automation
branch before they joined this repository's main line; their content is
unchanged and idempotent.

`migrations/20260927225426_normalize_plan_status.sql` is a data-only normalization of
`plans.status` to the canonical values (`AVAILABLE`, `ON_REQUEST`, ...). It is
applied only after the compatible code is deployed and smoke tested (see
`docs/release-checklist.md`). Not applied yet.

`migrations/20260927225753_clients_foundation.sql` (Clients V2) builds on the
`clients` table from `20260914025524_011_business_workflows` and refuses to run
without it. **Not applied to production yet.**

- `clients.notes` and `clients.archived_at` (set and cleared by a trigger when
  `status` enters or leaves `ARCHIVED`);
- `clients.code` is `not null` and defaults to `public.next_client_code()`,
  which draws `CLIENT-001`, `CLIENT-002`, ... from `clients_code_seq` and skips
  codes typed by hand. Numbers are never reused and never derived from
  `count(*)`. Existing rows without a code are backfilled in creation order;
- `next_client_code()` is revoked from `anon`, and `clients_code_seq` from every
  API role: Supabase's default privileges would otherwise let visitors burn
  numbers through `/rpc`. The function is `security definer`, so admins still
  get a code on insert;
- `projects.client_id`, an optional foreign key (`on delete set null`). Existing
  projects keep working without a client, and `projects.client` (the public
  label) is untouched. The public site does not select `client_id`.

Plus:

- `is_admin()` — `security definer` helper used by the policies.
- `touch_updated_at()` trigger — the database owns `updated_at`.
- `stamp_published_at()` trigger — stamps `published_at` on first publication and never resets it.

### Identity: `id` vs `case_number`

They are deliberately separate. `case_number` is editorial and shown to humans
as `CASE 001`; it must never be a primary key. The admin router still addresses
projects by the padded case number (`#/projects/001`), and the Supabase
repository resolves either a padded case number or a real uuid.

### Value casing

The check constraints use exactly the same strings as the admin UI model, so no
value translation is needed:

- `category`: `Website`, `System`, `Automation`, `AI`, `Other`
- `status`: `Live`, `Prototype`, `MVP`, `Pilot`, `In Development`, `Research`, `Archived`
- `editorial_status`: `DRAFT`, `PUBLISHED`, `ARCHIVED`

Only column names differ (`snake_case` in the database, `camelCase` in the UI),
and that conversion happens in one place:
`admin/src/services/mappers/project-mapper.js`.

## Row level security

RLS is enabled on all CMS tables.

| Policy | Effect |
| --- | --- |
| `projects_public_read` | anon + authenticated may `SELECT` rows where `editorial_status = 'PUBLISHED' AND visible = true`. |
| `projects_admin_all` | Users listed in `admins` may `SELECT/INSERT/UPDATE/DELETE`. |
| `project_gallery_public_read` | Readable only when the parent project is published and visible. |
| `project_gallery_admin_all` | Full control for admins. |
| `admins_read` | A user can see their own row; admins can see the roster. No write policy exists. |
| `project_modules_public_read` | Modules are readable only when the parent project is published and visible. |
| `plans_public_read` | Public visitors read visible plans only. |
| `plan_features_public_read` | Public visitors read features only for visible plans. |
| `site_content_public_read` | Public visitors may read structured site content. |
| `site_settings_public_read` | Public visitors may read safe runtime settings. |
| `activity_log_admin_read` | Only admins can read activity. No anonymous grant exists. |
| `automation_runs` | RLS enabled with no policy: invisible to `anon` and `authenticated`; only the service role reaches it. |
| `clients_admin_*`, `commercial_proposals_admin_*`, `commercial_project_handoffs_admin_*` | Admin-only select/insert/update/delete. `anon` has every grant revoked. |
| `projects.client_id` / clients lifecycle | Admin-only through the policies above. The Admin never hard-deletes a client: archiving is reversible. |

There is **no public write path**. Authorization lives here, not in the
frontend: hiding a button or a route is not security.

## Applying the migration

With the Supabase CLI, apply migrations in order:

```bash
supabase db push
```

Or paste each migration into the SQL editor in order. Never edit or rename an
applied migration; create a new timestamped migration instead.

### Verifying it before deploying

`admin/tests/*.test.mjs` apply the migrations to a real Postgres engine
(PGlite, Postgres compiled to WASM) and assert constraints, triggers and RLS.

```bash
cd admin && npm test
```

No Docker, no Supabase project and no credentials needed.

### Verifying against the live project

`admin/tests/e2e/supabase-flow.mjs` drives the admin against a real Supabase
project: login, CRUD, duplicate slug, publish/unpublish, archive, delete,
logout and route protection. It assumes nothing about existing data and deletes
every project it creates.

```bash
# admin/.env.local (gitignored): ADMIN_EMAIL=... ADMIN_PASSWORD=...
npm run dev
BASE_URL=http://127.0.0.1:5173 npm run test:e2e:supabase
```

## Creating the first admin

Promotion is intentionally manual — the frontend can never grant admin access.

1. Create the user: Supabase dashboard → **Authentication → Users → Add user**
   (email + password), or have them sign up.
2. Copy that user's UUID from the same screen.
3. In the SQL editor, insert the row:

   ```sql
   insert into public.admins (user_id, role)
   values ('00000000-0000-0000-0000-000000000000', 'owner');
   ```

4. Sign in through the admin. `auth.uid()` now matches a row in `admins`, so
   `is_admin()` returns true and the RLS policies open up.

A user who authenticates but is missing from `admins` reaches the
**ACCESS DENIED** screen and every query they attempt returns nothing.

## Controlled seeds

Seeds never run during build. They sign in as an admin through the anon key and
therefore use the same RLS path as the frontend.

```bash
npm run seed:supabase
npm run seed:projects:presentation -- --dry-run
npm run seed:projects:presentation -- --apply
npm run seed:plans -- --dry-run
npm run seed:plans -- --apply
```

Project presentation seed data lives outside the public bundle in
`scripts/data/project-presentation-seed.mjs`. `src/scripts/project-registry.js`
is no longer an editorial fallback.

## Consistency Notes

Project modules and plan features are reconciled from the browser through
PostgREST. Since the public client does not get a multi-statement transaction,
the repositories delete removed rows, temporarily park kept rows at high
positions, then write final order and insert new rows. That avoids unique
position collisions during reorder and keeps the data readable if a later step
fails.

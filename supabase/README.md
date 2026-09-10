# Supabase — Space Underground Admin

Database foundation for the admin panel and CMS. The public site now reads
published project, media, plan, content and settings data through the anon key
and RLS.

## What the migrations create

`migrations/001_admin_foundation.sql`

| Table | Purpose |
| --- | --- |
| `admins` | Users authorized to use the admin. Authentication alone is not access. |
| `projects` | Portfolio cases. `id` is a uuid; `case_number` is the editorial identity (CASE 001). |
| `project_gallery` | Gallery images per project. Not wired to uploads yet. |

`migrations/002_project_media_storage.sql` creates the private `project-media`
bucket and storage policies.

`migrations/003_project_presentation.sql` adds the project viewer presentation
columns and the ordered `project_modules` table.

`migrations/004_plans_cms.sql` adds public commercial plans plus ordered
`plan_features`.

`migrations/005_site_content.sql` adds structured public content by key.

`migrations/006_site_settings.sql` adds safe public runtime settings. Build-time
SEO generation still belongs to `site.config.js`; editing settings in the admin
does not pretend to rebuild sitemap/canonical output.

`migrations/007_activity_log.sql` adds the admin-only activity log.

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

There is **no public write path**. Authorization lives here, not in the
frontend: hiding a button or a route is not security.

## Applying the migration

With the Supabase CLI, apply migrations in order:

```bash
supabase db push
```

Or paste each migration into the SQL editor in order. Do not edit already
applied migrations `001` and `002`; create incremental migrations instead.

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

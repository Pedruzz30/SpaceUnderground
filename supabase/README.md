# Supabase — Space Underground Admin

Database foundation for the admin panel. The public site does **not** read from
Supabase yet: it still uses `project-registry.js`. Connecting the public site is
a separate branch.

## What the migration creates

`migrations/001_admin_foundation.sql`

| Table | Purpose |
| --- | --- |
| `admins` | Users authorized to use the admin. Authentication alone is not access. |
| `projects` | Portfolio cases. `id` is a uuid; `case_number` is the editorial identity (CASE 001). |
| `project_gallery` | Gallery images per project. Not wired to uploads yet. |

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

RLS is enabled on all three tables.

| Policy | Effect |
| --- | --- |
| `projects_public_read` | anon + authenticated may `SELECT` rows where `editorial_status = 'PUBLISHED' AND visible = true`. |
| `projects_admin_all` | Users listed in `admins` may `SELECT/INSERT/UPDATE/DELETE`. |
| `project_gallery_public_read` | Readable only when the parent project is published and visible. |
| `project_gallery_admin_all` | Full control for admins. |
| `admins_read` | A user can see their own row; admins can see the roster. No write policy exists. |

There is **no public write path**. Authorization lives here, not in the
frontend: hiding a button or a route is not security.

## Applying the migration

With the Supabase CLI:

```bash
supabase db push
```

Or paste `migrations/001_admin_foundation.sql` into the SQL editor in the
Supabase dashboard and run it. The script is idempotent (`if not exists`,
`drop policy if exists`), so re-running it is safe.

### Verifying it before deploying

`admin/tests/migration.test.mjs` applies this file to a real Postgres engine
(PGlite, Postgres compiled to WASM) and asserts the constraints, both triggers
and every RLS policy — including that an authenticated non-admin can read
nothing but published projects and cannot promote themselves.

```bash
cd admin && npm test
```

No Docker, no Supabase project and no credentials needed.

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

## Importing existing projects

The seed data in `admin/src/data/projects.js` is **not** migrated
automatically. When you are ready, insert them deliberately:

```sql
insert into public.projects (case_number, name, slug, client, category, description, status, editorial_status, featured, visible, year, accent, tech_stack, poster_url, project_url, preview_url)
values
  (1, 'INK Tattoo', 'ink-tattoo', 'INK Tattoo', 'Website',
   'Dark editorial website for a tattoo studio.', 'Live', 'PUBLISHED', true, true, 2026,
   '#c6ff00', array['HTML','CSS','JavaScript'], null,
   'https://pedruzz30.github.io/TattooSite/',
   'https://pedruzz30.github.io/TattooSite/?embed=spaceunderground');
```

## Not in this migration

- Supabase Storage buckets (poster/gallery uploads are still local previews).
- An activity-log table — the admin activity feed is still local to the browser.
- Anything the public site reads.

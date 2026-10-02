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
| `20260909062014` .. `20260910225035` | `001` .. `007` (admin foundation to activity log) | APPLIED (recorded by history repair) |
| `20260912202425` | `editorial_i18n` | APPLIED (recorded) |
| `20260913031225` | `project_live_preview` | APPLIED (recorded) |
| `20260913211045` | `automation_runs` | APPLIED (recorded) |
| `20260914025524` | `011_business_workflows` | APPLIED (recorded) |
| `20260927225426` | `normalize_plan_status` | APPLIED (recorded) |
| `20260927225753` | `clients_foundation` | APPLIED (recorded) |
| `20260928013040` | `clients_post_review_hardening` | APPLIED (recorded) |
| `20260928031922` | `financial_foundation` | APPLIED (recorded) |
| `20260928035023` | `commercial_opportunities` | APPLIED (recorded) |
| `20260928200000` | `security_rbac_approval_foundation` | **PENDING — not applied** |

Every recorded version and name matches
`select version, name from supabase_migrations.schema_migrations` exactly and
must never be renamed. `011_business_workflows` keeps its old ordinal in the
name because that is the name production recorded.

The versions of `001`..`007` are reconciliation identifiers, not deploy
times: each is the UTC time of the commit that first added the file.
`003`..`007` were added in the same commit (`3ee8c2f`, 2026-09-10 22:50:31
UTC), so they take consecutive seconds from `225031` to keep their order.
Their schema already existed in production, so the CLI history was repaired to
mark these seven versions as applied (their SQL was not re-run).

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
`docs/release-checklist.md`). Applied: production plans read `Max` =
`ON_REQUEST`, `Plus` = `AVAILABLE`, `Pro` = `AVAILABLE`.

`migrations/20260927225753_clients_foundation.sql` (Clients V2) builds on the
`clients` table from `20260914025524_011_business_workflows` and refuses to run
without it. Applied in production.

- `clients.notes` and `clients.archived_at` (set and cleared by a trigger when
  `status` enters or leaves `ARCHIVED`);
- `clients.code` is `not null` and defaults to `public.next_client_code()`,
  which draws `CLIENT-001`, `CLIENT-002`, ... from `clients_code_seq` and skips
  codes typed by hand. Numbers are never reused and never derived from
  `count(*)`. Existing rows without a code are backfilled in creation order;
- `next_client_code()` is revoked from `anon`, and `clients_code_seq` from every
  API role: Supabase's default privileges would otherwise let visitors burn
  numbers through `/rpc`. `authenticated` keeps `EXECUTE` because an admin's
  insert evaluates the column default, but the function itself only serves an
  admin (`is_admin()`), the service role, or SQL with no request JWT
  (migrations, SQL editor). Public sign-up is open, so any other signed-in
  user is refused with `42501` before `nextval()`, and a refused call never
  consumes a number;
- `projects.client_id`, an optional foreign key (`on delete set null`). Existing
  projects keep working without a client, and `projects.client` (the public
  label) is untouched. The public site does not select `client_id`. The Admin
  links with a conditional `UPDATE ... where client_id is null` and unlinks
  with `where client_id = <expected client>`, so a stale tab is refused instead
  of moving or clearing a link someone else made.

`migrations/20260928013040_clients_post_review_hardening.sql` follows the applied
clients foundation, which is not edited. It is applied to production and must
not be edited either.

- Takes `projects.client_id` off the public surface. The foundation added it to
  a table `anon` could read table-wide, so `projects?select=client_id` exposed
  the owner of every published project. Now `anon` has column-level `SELECT`
  on every public column except `client_id`, and `projects_public_read` applies
  to `anon` only, so a signed-in non-admin (sign-up is open) matches no project
  row at all. Admins keep full access through `projects_admin_all`. Column
  grants do not cover columns added later: a new public column must be added
  to the grant, which `tests/schema-contract.test.mjs` enforces.
- Adds `clients.last_contact_at timestamptz`, null until someone records a real
  contact in the Admin. No trigger maintains it: editing a record is not
  talking to the client. The Dashboard's quiet-relationship follow-up reads it.

`migrations/20260928031922_financial_foundation.sql` creates the Financial V2
ledger. Applied in production.

- `financial_transactions`: one row per amount the studio expects to receive or
  pay. `type` is `INCOME` or `EXPENSE` (there is no receivable type: "to
  receive" is pending income), `status` is `PENDING`, `PAID` or `CANCELLED`,
  and `amount numeric(12,2)` is always positive, the sign coming from `type`.
  Only `PAID` counts toward revenue and expenses.
- `due_date` is when the money is expected; `paid_at` is owned by the database
  (`stamp_financial_paid_at()`): stamped when an entry becomes `PAID` (today
  unless the Admin sends the real date), kept on later edits, cleared when it
  leaves `PAID`. A check constraint makes a paid row without a date impossible.
- Optional `client_id` and `project_id`, both `on delete set null`: removing a
  client or a project keeps the ledger entry.
- Optional `opportunity_id`: the Commercial deal a receivable was created from
  when the deal was won. A retried win reads it to find what an earlier
  attempt already stored, so it never writes a second set of receivables. Its
  foreign key (`on delete set null`) is added by the commercial migration,
  which creates the table it points at.
- Admin-only: `anon` has no grant, and the four policies require `is_admin()`.
  The public site never reads this table.

`migrations/20260928035023_commercial_opportunities.sql` creates the Commercial
V2 pipeline. Applied in production.

- `commercial_opportunities`: one row per deal, `stage` `NEW` -> `CONTACTED` ->
  `PROPOSAL` -> `NEGOTIATION` -> `WON` | `LOST`, with `priority`, `source`,
  `estimated_value numeric(12,2)` and a fractional `position` for the order
  inside a board column.
- A lead usually exists before a client or a service does, so `client_id` and
  `plan_id` are optional (`on delete set null`) and the contact lives on the
  row (`contact_name`, `company`, `email`, `phone`).
- The trigger `stamp_commercial_opportunity_stage()` owns `stage_changed_at`
  (moved only by a stage change), `closed_at` (set on `WON`/`LOST`, kept on
  edits, cleared on reopen) and clears `lost_reason` outside `LOST`. A lost
  deal must carry a reason.
- `commercial_proposals` is not touched: it still requires a client and a plan
  and stays the contract the automation service reads on
  `commercial.proposal.accepted`.
- Adds `financial_transactions_opportunity_id_fkey` (`on delete set null`):
  deleting a deal keeps its receivables and drops the link. It needs
  `financial_foundation` first, which the version order guarantees.
- Admin-only: `anon` has no grant, and the four policies require `is_admin()`.

Plus:

- `is_admin()` — `security definer` helper used by the policies.
- `touch_updated_at()` trigger — the database owns `updated_at`.
- `stamp_published_at()` trigger — stamps `published_at` on first publication and never resets it.

`migrations/20260928200000_security_rbac_approval_foundation.sql` (pending)
replaces the binary `is_admin()` model with identities, roles and
permissions, project access, the account lifecycle, MFA and step-up, drafts
with approvals, and an append-only security audit log. It is documented in
[`docs/security-architecture.md`](../docs/security-architecture.md), which
also lists how to apply and verify it.

| Table | Purpose |
| --- | --- |
| `team_members` | One row per person with Admin access: RU (`SU-00001`), status, access window, MFA state. |
| `roles`, `permissions`, `role_permissions`, `approval_routes` | The access catalog, seeded from `admin/src/security/catalog.js`. |
| `user_roles`, `project_members` | Active and revoked grants; never deleted. |
| `team_invitations` | Invitations sent through the `team-invite` Edge Function. |
| `change_requests` | Drafts and their review; approval applies them atomically. |
| `security_audit_log` | Append-only security events. |
| `security_settings` | Step-up window, expiries, invitation budget. |

It also adds `projects.version`, guards on publishing, archiving and the
settings columns, and forces the author of `activity_log` rows. And it
changes what earlier migrations left: client codes are assigned by a trigger
(`next_client_code()` stops being an RPC for any API role, and the column
loses its default); `is_admin()` has no caller left and no API role may
execute it; the older functions get a pinned `search_path`; and a session
cutoff (`team_members.sessions_valid_after`) refuses tokens issued before a
revocation, a suspension or an offboarding.

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

> The table below is the model **before**
> `security_rbac_approval_foundation`. That migration replaces every
> `is_admin()` policy with a permission check; the full matrix after it is in
> [`docs/security-architecture.md`](../docs/security-architecture.md#row-level-security).

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

**After `security_rbac_approval_foundation`** the steps below no longer apply:
`public.admins` refuses new rows. Existing admins become OWNER when the
migration runs; new people are invited from the Admin's Team module (through
the `team-invite` Edge Function), and the one-off break-glass account is
created with `public.bootstrap_member(email, role)` in the SQL editor. See
[`docs/security-architecture.md`](../docs/security-architecture.md#bootstrap-and-break-glass).

Before that migration:

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

## Edge Functions

`functions/team-invite/` sends invitations: it asks the database, with the
inviter's own JWT, whether the invitation is allowed (`prepare_invitation`),
then Supabase Auth sends the email with the service role, and
`complete_invitation` records the member. Its logic is `handler.js`, tested in
`admin/tests/team-invite-function.test.mjs`. Deploying it is manual:

```bash
supabase secrets set ADMIN_ALLOWED_ORIGINS=https://<admin host> ADMIN_INVITE_REDIRECT_URL=https://<admin host>/
supabase functions deploy team-invite
```

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

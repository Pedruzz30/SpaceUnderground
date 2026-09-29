# Release checklist

Green tests are not a release. This project has already shipped a change where
every local signal passed and production still broke: the public site selected
`projects.live_preview_enabled`, no migration had been applied to the real
database, and PostgREST answered `42703` — which fails the *entire* select and
takes the whole Selected Work section down, not just the demo.

So the rule is: **if a change depends on the database, storage, an env var or an
external service, the validation has to reach the real production contract.**
Unit tests, mock E2E and a clean build only prove the code is consistent with
itself.

## Before merging

Run everything from the repo root unless noted.

### 1. Code

- [ ] `npm test` (root) — includes `tests/schema-contract.test.mjs`, the gate
      that fails when the public query selects a column no migration creates.
- [ ] `npm run build` (root)
- [ ] `cd admin && npm test`
- [ ] `cd admin && npm run build`
- [ ] `git diff --check` — no whitespace errors, no conflict markers

### 2. Frontend behaviour

- [ ] `npm run test:e2e:public`
- [ ] `npm run test:e2e:viewer`
- [ ] `npm run test:e2e:i18n`
- [ ] `cd admin && npm run test:e2e` (needs `npm run dev:mock` running)
- [ ] `cd admin && npm run test:e2e:i18n` (needs `npm run dev:mock` running)
- [ ] `cd admin && npm run test:e2e:security` (needs `npm run dev:mock` running)
- [ ] `cd admin && npm run test:e2e:clients` against the real project, only
      after the clients foundation migration is applied there (needs `npm run dev` with
      Supabase env and `ADMIN_EMAIL` / `ADMIN_PASSWORD`). It creates and then
      deletes its own `E2E Client <timestamp>` rows.

### Security settings — BLOCKING before deploying the security branch

These live in the Supabase dashboard, not in the repository, so no test can
check them. Every box must be checked by a person, on the production project,
before the Admin of `feat/security-rbac-approvals` is deployed or its
migration applied. Details: `docs/security-architecture.md`, "Authentication".

- [ ] **Public sign-up OFF** (Authentication → Sign In / Providers → "Allow
      new users to sign up"): access is by invitation only.
- [ ] **TOTP / MFA enabled** (Authentication → Multi-Factor): privileged roles
      hold nothing without it, from their first sign-in.
- [ ] **Redirect URLs** include the Admin's URL (Authentication → URL
      Configuration): invitation and recovery links land on `#/welcome`.
- [ ] **Leaked password protection enabled** (Authentication → Attack
      Protection / Passwords). The Security Advisor reports it disabled today.
- [ ] **JWT and session configuration reviewed**: JWT expiry 3600 s or less,
      refresh token rotation on.
- [ ] **The database can read the MFA factors**: in the SQL editor,
      `select has_table_privilege('postgres', 'auth.mfa_factors', 'select');`
      is `true`. Every permission check reads them (a token's `aal2` alone
      is not MFA), so without it no check can answer.
- [ ] **`auth.mfa_factors` has `created_at` and `updated_at`**
      (`timestamp with time zone`, not null): the query is in
      `docs/security-architecture.md`, "Applying the migration", step 2.
- [ ] **Supabase Auth stamps a factor's verification**: with a throwaway
      test account, enrol TOTP, wait a minute, then verify the code;
      `select created_at, updated_at from auth.mfa_factors where user_id = '<test user>';`
      shows `updated_at` at the verification, not at the enrolment. The
      rule that keeps an old token from coming back after a factor
      rotation relies on it. Delete the test account afterwards.
- [ ] **Deploy order**: the new Admin is deployed **before** the migration is
      applied. After the migration, owners need MFA at their first sign-in and
      only the new Admin has the enrolment screen; before it, the new Admin
      runs on the legacy model.
- [ ] After applying: the Security Advisor shows no "function search_path
      mutable" warning for `public` and no anon-executable `is_admin()`.

### 3. The real database — the step that is actually skipped

Project ref: `zvzfkfvxbuofgqrrogxh`. Never point any of this at another project.

- [ ] For data normalization migrations after compatible code, follow this
      order:
      [ ] new code reads legacy values
      [ ] new code reads canonical values
      [ ] public site deployed
      [ ] smoke test passed
      [ ] only then migration applied
      [ ] canonical DB verified
- [ ] Every migration in `supabase/migrations/` is applied to the real project,
      in order. Migrations are named `YYYYMMDDHHMMSS_<name>.sql` (Supabase CLI
      format); the timestamp is the version. Check the newest version, not just
      the newest file you wrote.
- [ ] Read the CLI history before any `supabase db push` or
      `supabase migration repair`:

      select version, name from supabase_migrations.schema_migrations order by version;

      Known remote state:

      | Version | Name | State |
      | --- | --- | --- |
      | `20260909062014` .. `20260910225035` | `001` .. `007` | APPLIED (history repair) |
      | `20260912202425` | `editorial_i18n` | APPLIED |
      | `20260913031225` | `project_live_preview` | APPLIED |
      | `20260913211045` | `automation_runs` | APPLIED |
      | `20260914025524` | `011_business_workflows` | APPLIED |
      | `20260927225426` | `normalize_plan_status` | APPLIED |
      | `20260927225753` | `clients_foundation` | APPLIED |
      | `20260928013040` | `clients_post_review_hardening` | APPLIED |
      | `20260928031922` | `financial_foundation` | APPLIED |
      | `20260928035023` | `commercial_opportunities` | APPLIED |
      | `20260928200000` | `security_rbac_approval_foundation` | PENDING |

      Recorded versions must never be renamed or repaired. After the normalize,
      production plans read `Max` = `ON_REQUEST`, `Plus` = `AVAILABLE`,
      `Pro` = `AVAILABLE`.
- [x] History repair for the schema production had but the CLI never
      recorded (done; kept here for the record). These seven versions were
      marked `applied`, their SQL was not re-run, and nothing else was repaired:

      20260909062014  001_admin_foundation
      20260910011630  002_project_media_storage
      20260910225031  003_project_presentation
      20260910225032  004_plans_cms
      20260910225033  005_site_content
      20260910225034  006_site_settings
      20260910225035  007_activity_log

      They are reconciliation identifiers derived from the commit that first
      added each file (`003`..`007` share one commit and take consecutive
      seconds), not deploy times. Without the repair, `db push` would have tried
      to re-run the foundation migrations.
- [x] `20260927225753_clients_foundation.sql` is applied (it requires
      `20260914025524_011_business_workflows`, which creates `public.clients`).
- [x] `20260928013040_clients_post_review_hardening.sql` is applied (the
      Admin reads `clients.last_contact_at`, and `anon` no longer reads
      `projects.client_id`).
- [x] `20260928031922_financial_foundation.sql` is applied before deploying the
      Admin that reads `public.financial_transactions`. It needs the clients
      migrations first. The public site does not depend on it.
- [ ] Right after applying it, as `anon` with the publishable key,
      `financial_transactions?select=id&limit=1` is refused (`401`/`42501`).
- [x] `20260928035023_commercial_opportunities.sql` is applied before deploying
      the Admin that reads `public.commercial_opportunities`. It needs the clients
      migrations first and leaves `commercial_proposals` untouched. The public
      site does not depend on it.
- [ ] Right after applying it, as `anon` with the publishable key,
      `commercial_opportunities?select=id&limit=1` is refused (`401`/`42501`).
- [x] Applied the two in version order, financial first: the commercial
      migration adds the foreign key behind
      `financial_transactions.opportunity_id`. Confirmed it exists:

      select conname from pg_constraint
      where conname = 'financial_transactions_opportunity_id_fkey';

- [ ] Signed in as an admin, Settings → System reads every module as
      responding and lists no pending migration.
- [ ] Right after applying the clients hardening, as `anon` with the publishable key:
      the public project query above still returns `200`, and
      `projects?select=client_id&limit=1` is refused (`401`/`42501`). A new
      column the public site selects needs its own `grant select (...) on
      public.projects to anon`.
- [ ] The exact public query returns `200`, run against production with the
      publishable key:

      curl -s -H "apikey: $KEY" \
        "https://zvzfkfvxbuofgqrrogxh.supabase.co/rest/v1/projects?select=<PROJECT_COLUMNS>&limit=1"

      A `42703` here is a release blocker, not a warning. Column lists live in
      `src/scripts/supabase-public.js` (`PROJECT_COLUMNS`, `PLAN_COLUMNS`).
- [ ] Any new column has the value the feature expects on the existing rows —
      an additive `default` is not the same as a backfill.

- [ ] `20260928200000_security_rbac_approval_foundation.sql` — **pending**.
      Only after every box of "Security settings" above is checked and the
      new Admin is deployed. Follow `docs/security-architecture.md`
      ("Applying the migration" and "Verify after applying"): apply, deploy
      the `team-invite` Edge Function with its secrets, both owners enable MFA
      at their first sign-in (there is no grace period), create the
      break-glass account with `bootstrap_member`. Then, as `anon` with the
      publishable key, `team_members?select=ru&limit=1` and
      `security_audit_log?select=id&limit=1` are refused, and the public
      project query still returns `200`.

How to apply a migration: Supabase CLI `supabase db push`, or paste the file
into the SQL editor in order. Never edit or rename an already applied migration;
add a new timestamped one (`YYYYMMDDHHMMSS_<name>.sql`, UTC).

### 4. Env and deploy targets

- [ ] Every new `import.meta.env` / `process.env` key the code reads is set in
      the deploy target, not only in the local `.env`.
- [ ] Supabase key shape is respected: a modern `sb_publishable_...` key goes in
      the `apikey` header **only**. Sent as `Authorization: Bearer` it fails
      before RLS is evaluated. Only a legacy `eyJ...` JWT gets the bearer header.

## Blocking rule

If any box above cannot be checked — including "no access to apply the
migration" — the change is **not** merge ready. Say which box failed and why.
A feature that is correct in code and absent from the database is not shipped.

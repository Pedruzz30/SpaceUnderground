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
      in order. Check the highest number, not just the newest file you wrote.
- [ ] The exact public query returns `200`, run against production with the
      publishable key:

      curl -s -H "apikey: $KEY" \
        "https://zvzfkfvxbuofgqrrogxh.supabase.co/rest/v1/projects?select=<PROJECT_COLUMNS>&limit=1"

      A `42703` here is a release blocker, not a warning. Column lists live in
      `src/scripts/supabase-public.js` (`PROJECT_COLUMNS`, `PLAN_COLUMNS`).
- [ ] Any new column has the value the feature expects on the existing rows —
      an additive `default` is not the same as a backfill.

How to apply a migration: Supabase CLI `supabase db push`, or paste the file
into the SQL editor in order. Never edit an already applied migration; add an
incremental one.

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

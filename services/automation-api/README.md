# Automation API

The processing layer of the Space Underground Admin: operational analysis,
reports, an event/workflow engine with persistent run history and retry, and
scheduled jobs. Python 3.12, FastAPI, httpx against Supabase PostgREST.

It is an **additional capability**, never a hop in front of CRUD:

```text
CRUD                     Admin ──────────────────────────────▶ Supabase
processing / workflows   Admin ──▶ Automation API ──(service role)──▶ Supabase
```

The Admin works without it. With `VITE_AUTOMATION_API_URL` unset every
automation panel says *Não configurado* and nothing else changes.

## 1. Architecture

```text
app/
├── main.py                 app factory: CORS, request ids, error envelope, /health
├── core/
│   ├── config.py           settings; production refuses unsafe configuration
│   ├── security.py         who is calling (member token / service token) and
│   │                       what they may do (public.has_permission, as them)
│   ├── permissions.py      the RBAC key each capability needs
│   ├── errors.py           stable error codes (not_configured ≠ unavailable)
│   └── logging.py          structured logs with the request id
├── api/v1/
│   ├── health.py           /api/v1/health, /api/v1/ready
│   ├── auth.py             /api/v1/auth/me
│   ├── projects.py         /api/v1/projects/{id}/analyze
│   ├── reports.py          /api/v1/reports/overview
│   ├── automations.py      dispatch, run history, stats, retry
│   └── jobs.py             /api/v1/jobs, /api/v1/jobs/run
├── automations/
│   ├── engine.py           steps, timeouts, sanitised errors, idempotency
│   ├── registry.py         event -> workflow (and retired events)
│   ├── jobs.py             scheduled jobs (detect, record, signal)
│   └── handlers/           project_published, project_completed,
│                           commercial_opportunity_won
├── business/               commercial and project rules
├── services/
│   ├── supabase_service.py the only module that talks to Supabase
│   ├── run_store.py        public.automation_runs (degrades, never raises)
│   ├── project_analysis_service.py, reporting_service.py
│   └── url_check_service.py SSRF-safe URL check for live demos
└── schemas/, utils/
```

Workflows run **synchronously** inside the request, one bounded step at a
time (10 s default per step). There is no queue: every workflow finishes in
well under a request timeout, and the response already carries a `run_id`, so
moving to asynchronous execution later would not change what the Admin reads.

## 2. Authentication and authorization

Two kinds of caller:

| Caller | Credential | Used by |
| --- | --- | --- |
| member | `Authorization: Bearer <Supabase access token>` | the Admin |
| service | `X-API-Token: <API_TOKEN>` (server-side only) | the scheduler, CI, scripts |

For a member, the service asks Supabase Auth whose token it is, then asks the
**database** — `public.has_permission(key)`, called through PostgREST *with
the member's own token* — whether they hold the permission the endpoint
needs. That is the function row level security uses, so membership status,
access windows, revoked sessions, role grants and MFA are decided in one
place. `public.admins` is not consulted (it is history since the security
foundation). Workflows that write business data re-check their permissions
without the cache; other answers are cached 30 s.

There is no automation permission in the RBAC catalog; each capability maps
onto the permission of the same business effect (`app/core/permissions.py`):

| Capability | Permission(s) |
| --- | --- |
| run history, stats, registered automations, jobs list | `logs.read` |
| project analysis, overview report | `projects.read` |
| dispatch `project.published` | `projects.publish` |
| dispatch `project.completed` | `projects.edit` |
| dispatch `commercial.opportunity.won` | `commercial.edit` + `projects.create` (ledger link only with `finance.edit`) |
| retry a run | `logs.read` + the workflow's own permissions |
| run jobs by hand | `settings.edit` |
| read a finance step's result | `finance.read` (otherwise withheld, `redacted: true`) |

`admin/tests/automation-v2-migration.test.mjs` pins this against the real
catalog: every key exists, and each role holds what the tests assume.

Only local development may run with no credential at all
(`APP_ENV=development` and no `API_TOKEN`); a member token that *is* sent is
still verified. Production and staging always require one. Browsers can
never send `X-API-Token`: it is not an allowed CORS header.

## 3. Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | liveness, no I/O |
| GET | `/api/v1/health` | configuration and dependencies, never a value |
| GET | `/api/v1/ready` | 200 when configuration, run history and the v2 schema are fine; 503 with the failing checks otherwise |
| GET | `/api/v1/auth/me` | who the service sees and their automation permissions |
| POST | `/api/v1/projects/{id}/analyze` | analysis of the **stored** row (uuid or case number) |
| GET | `/api/v1/reports/overview` | catalogue counts |
| GET | `/api/v1/automations` | registered events, steps, permissions |
| POST | `/api/v1/automations/dispatch` | `{event, entity_type, entity_id, operation_id, payload, dry_run}` |
| GET | `/api/v1/automations/runs` | newest first, `?event=&status=&entity_id=&limit<=100` |
| GET | `/api/v1/automations/runs/stats` | counts over the last 100 runs, success rate from 5 runs, runs needing attention |
| GET | `/api/v1/automations/runs/{run_id}` | one run |
| POST | `/api/v1/automations/runs/{run_id}/retry` | `{operation_id}`; failed or abandoned runs only; creates a new run |
| GET | `/api/v1/jobs` | registered jobs |
| POST | `/api/v1/jobs/run` | `{jobs?, operation_id?, scheduled?}` |

Errors are always `{code, message}`. Codes: `bad_request`, `unauthorized`,
`forbidden`, `not_found`, `validation_error`, `upstream_error`,
`not_configured` (this service lacks its own configuration), `unavailable`
(a dependency is down now), `internal_error`. No stack trace, URL, key or
database message ever reaches a response.

No endpoint accepts SQL, a table name or a filter expression. Writes are
limited to `automation_runs` and one named database function.

## 4. Events

| Event | Dispatched by the Admin | What it does |
| --- | --- | --- |
| `project.published` | after `updateProject()` confirmed `editorial_status = PUBLISHED`, and after an approved publish request was applied | confirms the stored row is published, analyses it, checks the live demo (SSRF-safe), records the outcome. Never writes. |
| `project.completed` | after a save moved the **persisted** `status` into `Live` | closing checklist, publication, documentation, CMS readiness and a read-only ledger review (through the project and its opportunity). Never writes, never charges. |
| `commercial.opportunity.won` | after `winOpportunity()` saved the win, when the operator asked to open the project | opens the project draft (DRAFT, hidden), records the handoff, links the deal's client and receivables, logs the activity — one idempotent transaction. Never creates a client or a receivable. |

What "completed" means: projects have no COMPLETED state or completion date.
`status` is the delivery axis (`In Development` … `Live`), `editorial_status`
the publication axis. A project is complete when its stored status becomes
`Live`.

Who owns what when a deal is won:

```text
Admin (synchronous, win dialog)          Automation (afterwards)
  opportunity -> WON                       project draft, once
  client: create or reuse (optional)       handoff opportunity -> project
  receivables, amounts the operator        client and receivables linked to it
  confirms (optional)                      activity log entry
                                           what is still missing (ATTENTION)
```

`commercial.proposal.accepted` is **retired**: nothing has written
`commercial_proposals` since Commercial moved to `commercial_opportunities`.
Its earlier runs stay readable; it cannot be dispatched or retried.

### Idempotency

- Every deliberate action carries an `operation_id`; the run key is
  `event:entity:operation_id` (unique in the table). A double click or a
  network retry of the same request returns the first run (`deduplicated`).
  A concurrent identical dispatch that loses the insert race returns the
  winner's run instead of executing again.
- Retries are keyed `retry:<run_id>:<operation_id>`.
- `commercial.opportunity.won` is idempotent **in the database**:
  `automation_open_project_for_opportunity()` is serialised per opportunity
  (advisory lock) and the handoff is unique per opportunity, so any number of
  dispatches — with any operation ids — converge on one project.
- Scheduled jobs are keyed `job:<name>:<business date>`: one run per job per
  day however often the schedule fires.

### Run history

`public.automation_runs`, written and read only with the service role:
`id` (exposed as `run_id`), `event`, `status`, `source` (`admin`, `retry`,
`dry_run`, `scheduler`, `service`), `entity_type`, `entity_id`, `payload`,
`steps`, `result` (`summary`, `business_status`, `actions`, `entities`),
`error`, timings, `retry_of`, `idempotency_key`, `requested_by`,
`created_at`. A retry is a new row pointing back at the one it repeats; a row
is never overwritten after it finishes. A run still `RUNNING` after
`STALE_RUN_MINUTES` was abandoned by its process: it is reported as
interrupted and may be retried.

Storage failures degrade: the workflow still runs, the response says
`persisted: false`, and readiness reports the table unreachable.

## 5. Scheduled jobs

Copilot, not actor — they **detect, record and signal**, nothing else:

| Job | Reads | Signals |
| --- | --- | --- |
| `financial.overdue_check` | `financial_transactions` (INCOME, PENDING, due before today) | count, total, oldest |
| `commercial.follow_up_check` | open opportunities with `next_action_at` before today | the deals |
| `projects.health_check` | published projects whose stored record fails the analysis | the cases |

There is no "overdue project" job: projects have no deadline field. "Today"
is the business day in `APP_TIMEZONE`.

The scheduler is `.github/workflows/automation-jobs.yml` (daily 08:00
Brasília): the smallest infrastructure available — no new service, the token
lives in GitHub's encrypted secrets. A member with `settings.edit` can also run
them from Settings › Sistema.

## 6. Configuration

| Variable | Required in production | Notes |
| --- | --- | --- |
| `APP_ENV` | `production` | |
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes, **secret** | a publishable/anon key here is detected and refused |
| `ADMIN_ORIGIN` | yes | exact https origin(s) of the Admin; localhost, http and `*` are refused |
| `API_TOKEN` | for the scheduler | long random value, **secret** |
| `ADMIN_JWT_AUTH` | keep `true` | |
| `ADMIN_JWT_CACHE_SECONDS` | optional (30) | |
| `APP_TIMEZONE` | optional (`America/Sao_Paulo`) | |
| `STALE_RUN_MINUTES` | optional (15) | |
| `SUPABASE_TIMEOUT_SECONDS`, `LOG_LEVEL` | optional | |

The service role key belongs to this process only: never a `VITE_` value,
never in the Admin bundle, never in Git. Production refuses to start without
the structural values above (a Supabase outage does not stop it: `/ready`
reports that instead).

## 7. Local development

```bash
cd services/automation-api
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Windows; .venv/bin/pip elsewhere
cp .env.example .env                              # fill SUPABASE_SERVICE_ROLE_KEY
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

Admin side: `VITE_AUTOMATION_API_URL=http://127.0.0.1:8000` in
`admin/.env.local`, Supabase mode (the service reads the real database, so in
mock mode the Admin dispatches nothing and the analysis says it does not
apply).

## 8. Tests

```bash
cd services/automation-api
.venv/Scripts/python -m pytest -q
.venv/Scripts/ruff check .
```

No test touches a network or a database: Supabase is a fake injected through
FastAPI's dependency override, and the real HTTP client is exercised over a
mocked transport. The SQL side (migration, function, grants, RLS, the
permission contract) is tested in the Admin suite against PGlite:
`admin/tests/automation-v2-migration.test.mjs`.

`scripts/verify_run_storage.py` checks run storage against the **real**
project with the real key: it writes one probe row, reads it back, proves anon
cannot see it, and deletes only that probe row.

## 9. Deploy (Render)

Order matters: **migration, then service, then Admin.**

1. Apply `supabase/migrations/20261002233745_automation_v2.sql` to production
   (`supabase db push` or the SQL editor). It is additive; nothing is dropped
   or rewritten.
2. Render › New › Blueprint › this repository, *Blueprint path*
   `services/automation-api/render.yaml` (or create the web service by hand
   with the same values: Docker, root `services/automation-api`, branch
   `main`, health check `/health`, plan Starter).
3. Set the secret variables in Render: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_ORIGIN` (the Netlify Admin origin, e.g.
   `https://<admin-site>.netlify.app`), `API_TOKEN` (random, e.g.
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`).
4. Check `/health`, `/api/v1/health`, `/api/v1/ready` (must be 200).
5. Netlify (Admin): `VITE_AUTOMATION_API_URL=https://space-underground-automation.onrender.com`
   and redeploy. If the Render URL differs, change `connect-src` in
   `netlify.toml` to that exact origin first — the CSP blocks any other.
6. GitHub › Settings › Secrets and variables › Actions: variable
   `AUTOMATION_API_URL`, secret `AUTOMATION_API_TOKEN` (= `API_TOKEN`).

## 10. Smoke test (production)

```bash
URL=https://space-underground-automation.onrender.com
curl -s $URL/health                    # {"status":"ok",...}
curl -s $URL/api/v1/health             # supabase/authentication/automation_storage configured
curl -s -w '%{http_code}\n' $URL/api/v1/ready      # 200, every check configured
curl -s -w '%{http_code}\n' $URL/api/v1/automations/runs   # 401 without a credential
```

Then, signed in to the real Admin as a member with the permissions:

1. Settings › Sistema › Serviço de automação: Online, version, *Pronto*, your
   session and permissions.
2. Dashboard: the Automações panel shows recent runs and the last one.
3. Logs › Automações lists the runs (the earlier production runs included).
4. Open a stored project: the operational analysis renders.
5. Publish a project: a `project.published` run appears in Logs › Automações
   and in `automation_runs` (`requested_by` = you).
6. Retry a FAILED run: a new run with `retry_of` appears; the original is
   unchanged.
7. Win an opportunity with "Abrir o projeto pela automação": one draft
   project, one handoff; "Concluir fechamento" again does not create another.
8. Regressions: project/client/commercial/financial CRUD as before; a member
   without `logs.read` gets *Sem acesso*, not data; MFA and approvals behave
   as before (the service holds no access of its own).

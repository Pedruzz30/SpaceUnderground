# Automation API

Python processing layer for Space Underground. It is a separate service: it
does not replace Supabase, it does not serve the public site, and it does not
reimplement the Admin.

## 1. Purpose

The Admin and the public site are vanilla JavaScript talking to Supabase, and
that stays true. This service exists for the work that does not belong in a
browser: operational analysis, reporting, business handoffs, document
generation, integrations and, later, AI.

## 2. Architecture

```
Public site ----------+
                      |
Admin ------ Supabase |
  |                   |
  +--- Automation API-+
          |
          +-- Project analysis
          +-- Reporting
          +-- Automation engine
```

The rule that decides where a call goes:

| Operation | Path |
| --- | --- |
| Read a project | Admin -> Supabase |
| Save a project | Admin -> Supabase |
| Generate a report | Admin -> Python |
| Analyse a project | Admin -> Python |
| Run an automation | Admin -> Python |
| External integrations | Admin -> Python |

Plain CRUD never routes through Python. That would only add a hop.

Inside the service the layering is one-directional:

```text
api/v1/* -> services/* -> supabase_service -> Supabase (PostgREST)
```

`supabase_service.py` is the only module that performs HTTP against Supabase.
Analysis and reporting are pure functions over row dictionaries, which is why
their tests need no remote database.

### Why httpx and not the Supabase Python SDK

Most calls only read. The SDK would add a dependency and a client lifecycle in
exchange for a thin wrapper over the same REST calls. Phase 4 adds one bounded
business write path for proposal handoffs; it still goes through named service
methods and an allowlist, never arbitrary SQL or frontend-supplied table names.

## 3. Installation

Requires Python 3.12+.

```bash
cd services/automation-api
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
pip install -r requirements.txt
```

macOS / Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

## 4. Configuration

```bash
cp .env.example .env
```

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_ENV` | no | `development` (default), `staging`, `production` |
| `APP_HOST` / `APP_PORT` | no | defaults `127.0.0.1:8000` |
| `SUPABASE_URL` | for data endpoints | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | for data endpoints | secret, server-side only |
| `SUPABASE_TIMEOUT_SECONDS` | no | default `10` |
| `ADMIN_ORIGIN` | yes in production | CORS allowlist, comma-separated. Never `*`, and never localhost in production |
| `ADMIN_JWT_AUTH` | no | default `true`. Accept a Supabase access token as `Authorization: Bearer` |
| `ADMIN_JWT_CACHE_SECONDS` | no | default `60`. How long a verified identity is trusted |
| `API_TOKEN` | no | service-to-service secret, sent as `X-API-Token`. Never given to the Admin |
| `LOG_LEVEL` | no | default `INFO` |

Without `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` the service still starts
and `/health` still answers; every data endpoint returns `503 not_configured`
rather than an empty result.

### The service role key

It belongs to this process and nowhere else. It must never appear in the public
site, the Admin bundle, any `VITE_*` variable, or Git. `.env` is gitignored.

## 5. Running locally

```bash
uvicorn app.main:app --reload
```

- API: http://127.0.0.1:8000
- Swagger: http://127.0.0.1:8000/docs
- OpenAPI: http://127.0.0.1:8000/openapi.json

## 6. Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe. No auth |
| GET | `/api/v1/health` | Liveness plus dependency status. No auth |
| POST | `/api/v1/projects/{project_id}/analyze` | Operational analysis of one project |
| GET | `/api/v1/reports/overview` | Catalogue-wide operational metrics |
| GET | `/api/v1/automations` | Registered automations and handlers |
| POST | `/api/v1/automations/dispatch` | Dispatch an automation event |
| GET | `/api/v1/automations/runs` | Automation run history |
| GET | `/api/v1/automations/runs/stats` | Recent run statistics |
| GET | `/api/v1/automations/runs/{run_id}` | One run |
| POST | `/api/v1/automations/runs/{run_id}/retry` | Retry a failed run |

`{project_id}` accepts a uuid or a case number, the same identifiers the Admin
router uses.

## 7. Analysis And Reports

Analysis is deterministic and uses no AI. It is not a port of the Admin's
`projectHealth`: that function asks "is this form ready to publish?", while
this one asks "is the stored row coherent?".

Every report number is counted from rows actually read. A metric the current
schema cannot answer is left out rather than reported as zero.

## 8. Automations

```bash
curl -X POST http://127.0.0.1:8000/api/v1/automations/dispatch \
  -H "Content-Type: application/json" \
  -d '{"event": "project.published", "payload": {"project_id": "1"}}'
```

`project.published` re-reads the project from the database and analyses it, so
what is validated is what was actually persisted.

`commercial.proposal.accepted` is the first write-capable business workflow. It
requires migration `011_business_workflows.sql`, a real accepted proposal, a
real client, a real service plan and an explicit `project_category`. Missing
required data stops the run with `FAILED` and `business_status: ATTENTION`.
When `dry_run: true`, it records the planned project creation without writing.
When executed, it may create one hidden `DRAFT` project and one private handoff
link; a second run detects the existing project/link and does not duplicate it.

`project.completed` remains read-only. It reports the closing checklist,
financial readiness as `SKIPPED` while no ledger table exists, and CMS
readiness as `READY`, `ATTENTION` or `NOT_ELIGIBLE`.

There is no queue, broker or scheduler: only an event name, a registry and
handlers. Adding a queue later means changing dispatch, not every handler.

## 9. Run History

Execution history lives in `automation_runs`, created by
`supabase/migrations/010_automation_runs.sql`. The service works without it:
workflows still run, and every run reports `persisted: false` so the Admin can
say history is not being recorded rather than pretend it is.

To make history durable, two things are needed and neither can be faked:

1. Apply `010_automation_runs.sql` to the project.
2. Put the real service_role / secret key in `.env`.

The table has RLS enabled with no policy, so only `service_role`, which bypasses
RLS, can read or write it. A publishable key gets nothing by design:

```text
Admin -> FastAPI -> service_role -> automation_runs
```

Verify against the real project:

```bash
.venv/Scripts/python -m scripts.verify_run_storage
```

It writes one controlled row, reads it back, proves the unique index collapses a
duplicate dispatch, proves the anon key cannot see run history, and deletes the
row. It touches no project and never prints the key.

## 10. Business Workflow Schema

`supabase/migrations/011_business_workflows.sql` is the proposed additive Phase
4 schema. It is not required for the Phase 3 workflows, and this repository does
not apply it automatically. Review and apply it only when the real project is
ready for business workflow data.

The migration adds private `clients`, `commercial_proposals` and
`commercial_project_handoffs` tables. It does not grant anonymous access to
those tables, and it keeps proposal/client/plan relationships out of public
project rows. The automation service uses the service role key server-side to
read those entities and, only for an accepted proposal handoff, to create a
hidden project draft plus its private handoff link.

## 11. Tests

```bash
pytest
ruff check .
```

Python unit tests do not touch a network or a remote database: the Supabase
layer is replaced through FastAPI's dependency override. Admin migration tests
apply SQL files to PGlite, a local Postgres-compatible engine. Coverage includes
both health endpoints, the analysis rules, the report aggregation, business
workflow handoffs, dry-runs, duplicate prevention, a missing project, an
unconfigured service, CORS, and the token guard.

## 12. Security

- The service role key lives only here and is never returned by any endpoint.
- CORS is an explicit allowlist. `*` is never used.
- Production requires a credential on every non-health endpoint. Development
  requires one once `API_TOKEN` is set, and runs open before that -- demanding
  a credential before there is anywhere to keep one only teaches people to
  disable the check.
- All input is validated by Pydantic; identifiers are length-bounded before
  they can reach a query string.
- No endpoint accepts SQL. Callers choose a named operation, never a query.
- Errors are returned as `{ "code", "message" }`. Tracebacks and PostgREST
  strings go to the log, never to the client.

## 13. Authentication

There are two kinds of caller and they are not given the same credential.

**A person using the Admin.** The Admin is a browser bundle, so it has no
secret to offer: every `VITE_` value is readable by anyone who opens the
bundle. Shipping a shared token there would be the appearance of
authentication, not authentication. So the Admin sends the Supabase access
token of whoever is signed in:

```http
Authorization: Bearer <supabase access token>
```

The service asks Supabase who that token belongs to -- it never decodes the
token itself, because a signature this process does not verify is not evidence
-- and then requires the user to hold a row in `public.admins`. That is the
same table `public.is_admin()` consults, so the API and row level security
agree on who an administrator is by construction rather than by convention.

Authentication and authorisation are answered separately: an unknown token is
`401`, and a real user without an admin row is `403`. The Admin needs that
difference to say "your account lacks access" instead of bouncing a correctly
signed-in operator back to the login screen.

**Another machine.** CI, scripts, technical administration. These can keep a
secret, so they send `X-API-Token: <API_TOKEN>`. This credential must never
reach the Admin bundle.

A verified identity is cached for `ADMIN_JWT_CACHE_SECONDS` (default 60), keyed
by a digest of the token rather than the token itself. Without it a polling
Dashboard would cost two Supabase round trips per poll for an answer that
changes rarely; with it, revoking an admin takes effect within the window.

If Supabase cannot be reached, the caller gets `503`, never `403`. A blip must
not look like a permissions problem.

## 14. Admin Integration

`admin/src/services/automation-api.js` is the Admin's only door to this service.
It centralises health, analysis, reports, run history, retries and dispatch.

In `admin/.env`:

```env
VITE_AUTOMATION_API_URL=http://127.0.0.1:8000
```

There is deliberately no token variable. Leaving the URL empty is a supported
state: the Admin then reports the automation API as unavailable and behaves
exactly as it does today; the client fails locally with a `not_configured`
error and never issues a request. Python is an additional capability, not a
dependency.

## 15. Health And Readiness

| Endpoint | Auth | Answers |
| --- | --- | --- |
| `GET /health` | none | the process is alive. No I/O at all |
| `GET /api/v1/health` | none | which dependencies are configured, never how |
| `GET /api/v1/ready` | none | whether the service can actually work right now |

Health is unauthenticated on purpose: a probe that needs a secret stops working
the moment the secret rotates. None of the three ever returns a URL, a key, a
key fragment or a traceback.

`/api/v1/ready` answers `503` when configuration is broken or `automation_runs`
is unreachable, and `200` again once it is not -- by itself, with nobody
intervening. It is the deploy's gate, while `/health` is the process's.

### Startup

In production the service refuses to start when structural configuration is
missing or wrong: no `SUPABASE_URL`, no service role key, a public key in the
service role slot, an empty origin allowlist, or an allowlist that still
permits `localhost`. Those cannot become correct on their own, so booting would
only serve broken requests until someone noticed.

Reachability is deliberately *not* checked at startup. Refusing to boot because
Supabase is briefly down would turn a five-minute blip into an outage that
needs a human to end it. `/api/v1/ready` reports that instead.

Outside production the same problems are logged as warnings and the service
starts, because a half-configured local checkout still has to run.

### Request correlation

Every response carries `X-Request-ID`, and every log line emitted while
handling that request carries the same value. A caller may supply one; it is
accepted only in a safe shape (`[A-Za-z0-9._:-]`, up to 64 characters) and
replaced with a generated id otherwise. It is a log label and never a
credential.

## 16. Deploy

The service is deployed on its own, never inside the Vite build. The Dockerfile
targets any FastAPI-compatible host; it runs as a non-root user and honours
`PORT`.

```bash
docker build -t space-underground-automation .
docker run --rm -p 8000:8000 --env-file .env space-underground-automation
```

### Platform

**Render**, configured by `render.yaml` in this directory. The reason is
recorded because it was a real comparison and not a preference: Render is the
only candidate that deploys this repository from a GitHub branch with no vendor
CLI involved, which matters because nothing else in this project uses one.
Railway and Fly.io both host the container equally well but need their CLI for
the first deploy and for secrets. Netlify serves the Admin and GitHub Pages the
public site; neither can host a long-running ASGI process.

Deploys follow the branch: CI validates the change, then Render builds the same
Dockerfile a developer builds locally. There is no second pipeline, so there is
no second source of truth for what is running.

### Remote environment

Set these in the Render dashboard. `render.yaml` marks every one of them
`sync: false`, so none is ever committed:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production` (already in `render.yaml`) |
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret / service role key |
| `ADMIN_ORIGIN` | the deployed Admin origin, over HTTPS. No localhost |
| `API_TOKEN` | only if CI or a script needs server-to-server access |

And in the Admin's deployment (Netlify):

| Variable | Value |
| --- | --- |
| `VITE_AUTOMATION_API_URL` | the deployed service origin, over HTTPS |

The service refuses to start in production if `ADMIN_ORIGIN` is missing or
still allows localhost, so a deployment that forgot it fails loudly at boot
rather than quietly accepting requests from anywhere.

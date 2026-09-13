# Automation API

Python processing layer for Space Underground. It is a **separate service**: it
does not replace Supabase, it does not serve the public site, and it does not
reimplement the Admin.

## 1. Purpose

The Admin and the public site are vanilla JavaScript talking to Supabase, and
that stays true. This service exists for the work that does not belong in a
browser: operational analysis, reporting, document generation, integrations and
— later — AI.

## 2. Architecture

```
Public site ───────────────┐
                           │
Admin ────────── Supabase  │
  │                        │
  └──── Automation API ────┘
              │
              ├── Project analysis
              ├── Reporting
              └── Automation engine
```

The rule that decides where a call goes:

| Operation | Path |
| --- | --- |
| Read a project | Admin → Supabase |
| Save a project | Admin → Supabase |
| Generate a report | Admin → Python |
| Analyse a project | Admin → Python |
| Run an automation | Admin → Python |
| External integrations | Admin → Python |

Plain CRUD never routes through Python — that would only add a hop.

Inside the service the layering is one-directional:

```
api/v1/*  ->  services/*  ->  supabase_service  ->  Supabase (PostgREST)
```

`supabase_service.py` is the only module that performs HTTP against Supabase.
Analysis and reporting are pure functions over row dictionaries, which is why
their tests need no database.

### Why httpx and not the Supabase Python SDK

This service only reads. The SDK would add a dependency and a client lifecycle
in exchange for a thin wrapper over the same REST calls. If Realtime or signed
Storage URLs are ever needed, that is the moment to reconsider.

## 3. Installation

Requires Python 3.12+.

```bash
cd services/automation-api
```

## 4. Virtualenv

```bash
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

macOS / Linux:

```bash
source .venv/bin/activate
```

## 5. Dependencies

```bash
pip install -r requirements.txt
```

## 6. Configuration

```bash
cp .env.example .env
```

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_ENV` | no | `development` (default), `staging`, `production` |
| `APP_HOST` / `APP_PORT` | no | defaults `127.0.0.1:8000` |
| `SUPABASE_URL` | for data endpoints | project `zvzfkfvxbuofgqrrogxh` |
| `SUPABASE_SERVICE_ROLE_KEY` | for data endpoints | **secret**, see below |
| `SUPABASE_TIMEOUT_SECONDS` | no | default `10` |
| `ADMIN_ORIGIN` | no | CORS allowlist, comma-separated. Never `*` |
| `API_TOKEN` | no in dev, **yes in production** | shared secret, sent as `X-API-Token` |
| `LOG_LEVEL` | no | default `INFO` |

Without `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` the service still starts
and `/health` still answers; every data endpoint returns `503 not_configured`
rather than an empty result.

### The service role key

It belongs to this process and nowhere else. It must never appear in the public
site, the Admin bundle, any `VITE_*` variable, or Git. `.env` is gitignored.

## 7. Running locally

```bash
uvicorn app.main:app --reload
```

- API: http://127.0.0.1:8000
- Swagger: http://127.0.0.1:8000/docs
- OpenAPI: http://127.0.0.1:8000/openapi.json

## 8. Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe. No auth |
| GET | `/api/v1/health` | Liveness plus dependency status. No auth |
| POST | `/api/v1/projects/{project_id}/analyze` | Operational analysis of one project |
| GET | `/api/v1/reports/overview` | Catalogue-wide operational metrics |
| GET | `/api/v1/automations` | Registered automations and handlers |
| POST | `/api/v1/automations/dispatch` | Dispatch an automation event |

`{project_id}` accepts a uuid or a case number, the same identifiers the Admin
router uses.

### Analysis

Deterministic rules, no AI. It is **not** a port of the Admin's
`projectHealth`: that function asks "is this form ready to publish?", while this
one asks "is the stored row coherent?" — publication status versus visibility,
`live_preview_enabled` versus `preview_url`, a missing `published_at`, English
coverage, and how long since the row changed.

Each check is `ok`, `warn` or `fail`. The score starts at 100 and loses 12 per
failure and 4 per warning; the status is `healthy`, `attention` or `incomplete`,
matching the vocabulary the Admin already renders.

```bash
curl -X POST http://127.0.0.1:8000/api/v1/projects/1/analyze
```

### Reports

```bash
curl http://127.0.0.1:8000/api/v1/reports/overview
```

Every number is counted from rows actually read. A metric the current schema
cannot answer is left out rather than reported as zero.

### Automations

```bash
curl -X POST http://127.0.0.1:8000/api/v1/automations/dispatch \
  -H "Content-Type: application/json" \
  -d '{"event": "project.published", "payload": {"project_id": "1"}}'
```

`project.published` re-reads the project from the database and analyses it, so
what is validated is what was actually persisted. **No handler writes anything
in this phase.**

There is no queue, broker or scheduler — only the seam: an event name, a
registry and handlers. Adding a queue later means changing `dispatch()`, not
every handler.

## 9. Tests

```bash
pytest
ruff check .
```

Nothing in the suite touches a network or a database: the Supabase layer is
replaced through FastAPI's dependency override. Coverage includes both health
endpoints, the analysis rules, the report aggregation, a missing project, an
unconfigured service, CORS, and the token guard.

## 10. Security

- The service role key lives only here and is never returned by any endpoint.
- CORS is an explicit allowlist. `*` is never used.
- `API_TOKEN` is optional in development and **required in production** —
  without it there, every data endpoint fails closed with `503`.
- All input is validated by Pydantic; `{project_id}` is length- and
  pattern-bounded before it can reach a query string.
- No endpoint accepts SQL. Callers choose a named operation, never a query.
- Errors are returned as `{ "code", "message" }`. Tracebacks and PostgREST
  strings go to the log, never to the client.

## 11. Admin integration

`admin/src/services/automation-api.js` is the Admin's only door to this
service. It centralises `getAutomationHealth()`, `analyzeProject()`,
`getOperationsOverview()`, `getRegisteredAutomations()` and
`dispatchAutomation()`.

In `admin/.env`:

```
VITE_AUTOMATION_API_URL=http://127.0.0.1:8000
VITE_AUTOMATION_API_TOKEN=
```

**Leaving `VITE_AUTOMATION_API_URL` empty is a supported state.** The Admin then
reports the automation API as unavailable and behaves exactly as it does today;
the client fails locally with a `not_configured` error and never issues a
request. Python is an additional capability, not a dependency.

No Admin page calls the client yet — wiring it into the UI is a later step.

## 12. Deploy

The service is deployed on its own, never inside the Vite build. The
`Dockerfile` targets any FastAPI-compatible host (Render, Railway, Fly.io, a
VPS); it runs as a non-root user and honours `PORT`.

```bash
docker build -t space-underground-automation .
docker run --rm -p 8000:8000 --env-file .env space-underground-automation
```

In production, set `APP_ENV=production`, a real `API_TOKEN`, and an
`ADMIN_ORIGIN` restricted to the Admin's actual host.

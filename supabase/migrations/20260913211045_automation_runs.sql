-- Space Underground — automation run history
--
-- Execution history for the workflow engine. Deliberately separate from
-- activity_log, which records what a person did in the Admin. This table
-- records what the engine did on its own:
--
--   activity_log      "Pedro published CASE 006"
--   automation_runs   "project.published -> SUCCESS in 843 ms"
--
-- Mixing the two would make both useless: a human action is not a workflow,
-- and a workflow is not something a person can be asked to explain.
--
-- Steps live in a JSONB array rather than their own table. A run's steps are
-- only ever read together with the run, they are never queried across runs,
-- and a second table would buy nothing but joins. If steps ever need to be
-- aggregated on their own, that is the moment to split them out.

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),

  event text not null check (btrim(event) <> ''),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED')),

  -- Where the dispatch came from: "admin", "api", "retry".
  source text not null default 'api' check (btrim(source) <> ''),

  -- The subject of the run. Kept as text rather than a foreign key: a run is a
  -- historical record and must survive the project it describes being deleted.
  entity_type text,
  entity_id text,

  payload jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,

  -- Set by the engine, not by the database: the run is timed around the
  -- handlers, so a slow insert never inflates the reported duration.
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),

  -- A manual retry creates a new run and points back at the one it repeats.
  -- The original is never overwritten: failed history is the point.
  retry_of uuid references public.automation_runs (id) on delete set null,

  -- Collapses an accidental double dispatch (a click plus a network retry)
  -- without blocking a legitimate second run of the same event later: the key
  -- carries an operation id supplied by the caller, not just the entity.
  idempotency_key text,

  created_at timestamptz not null default now()
);

-- The Logs screen reads newest-first, and that is by far the common query.
create index if not exists automation_runs_created_idx
  on public.automation_runs (created_at desc);

-- Filtering by event or status, always with the same ordering.
create index if not exists automation_runs_event_idx
  on public.automation_runs (event, created_at desc);

create index if not exists automation_runs_status_idx
  on public.automation_runs (status, created_at desc);

-- "What has the engine done to this project?"
create index if not exists automation_runs_entity_idx
  on public.automation_runs (entity_type, entity_id, created_at desc);

-- Partial: most rows carry no key, and only the ones that do need uniqueness.
create unique index if not exists automation_runs_idempotency_key
  on public.automation_runs (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Enabled with no policy on purpose. `service_role` bypasses row level
-- security, so the automation service reads and writes normally, while anon and
-- authenticated get nothing: with RLS on and no policy, every row is invisible.
--
-- That is the intended architecture. Run history belongs to the automation
-- service, and the Admin reaches it through the API rather than querying this
-- table directly:
--
--   Admin -> FastAPI -> automation_runs
--
-- Adding a policy for `authenticated` later would be a deliberate decision to
-- change that, not a fix for a missing grant.

alter table public.automation_runs enable row level security;

comment on table public.automation_runs is
  'Workflow engine execution history. Written and read by the automation service via service_role; the Admin reads it through the automation API, never directly.';

comment on column public.automation_runs.steps is
  'Ordered JSONB array of {name, status, started_at, finished_at, duration_ms, result, error}.';

comment on column public.automation_runs.idempotency_key is
  'Collapses accidental duplicate dispatches. Unique when present, null otherwise.';

"""Automation endpoints: dispatch, history and retry.

Dispatch is synchronous. The workflows in this phase load a row, analyse it and
make at most one bounded HTTP check, so they finish inside a request, and an
in-process call is far easier to reason about than a queue nobody needs yet.
The response shape already carries a `run_id`, so moving to asynchronous
execution later does not change what the Admin reads.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from app.automations.engine import run_workflow
from app.automations.registry import get_workflow, known_events
from app.core.security import verify_api_token
from app.schemas.automation import (
    AutomationEvent,
    AutomationRun,
    AutomationRunList,
    AutomationStats,
    RegisteredAutomation,
)
from app.services.run_store import DEFAULT_LIMIT, MAX_LIMIT, RunStore, get_run_store
from app.services.supabase_service import (
    SupabaseNotConfigured,
    SupabaseService,
    get_supabase_service,
)

router = APIRouter(prefix="/automations", tags=["automations"], dependencies=[Depends(verify_api_token)])

RUN_ID_PATTERN = r"^[0-9a-fA-F-]{8,64}$"


def get_store(supabase: SupabaseService = Depends(get_supabase_service)) -> RunStore:
    return get_run_store(supabase)


def _default_entity_type(event: AutomationEvent) -> str | None:
    if event.entity_type:
        return event.entity_type
    if event.event.startswith("commercial."):
        return "commercial_proposal"
    if event.event.startswith("project."):
        return "project"
    return None


def _default_entity_id(event: AutomationEvent) -> str | None:
    value = event.entity_id or event.payload.get("project_id") or event.payload.get("proposal_id")
    return str(value) if value else None


def _to_run(raw: dict[str, Any]) -> AutomationRun:
    """Normalises a run from either the engine or a stored row.

    The two differ in one place -- the engine calls it `id`, the database
    column is `id`, and the API calls it `run_id` -- so the mapping lives here
    rather than in three call sites.
    """
    return AutomationRun(
        run_id=raw.get("run_id") or raw.get("id"),
        event=raw.get("event", ""),
        status=raw.get("status", "PENDING"),
        source=raw.get("source", "api"),
        entity_type=raw.get("entity_type"),
        entity_id=raw.get("entity_id"),
        steps=raw.get("steps") or [],
        result=raw.get("result") or {},
        error=raw.get("error"),
        started_at=raw.get("started_at"),
        finished_at=raw.get("finished_at"),
        duration_ms=raw.get("duration_ms"),
        retry_of=raw.get("retry_of"),
        created_at=raw.get("created_at"),
        persisted=raw.get("persisted", raw.get("id") is not None),
        deduplicated=bool(raw.get("deduplicated")),
    )


@router.get("", response_model=list[RegisteredAutomation], summary="Registered automations")
async def list_automations() -> list[RegisteredAutomation]:
    return [
        RegisteredAutomation(event=event, steps=[step.name for step in get_workflow(event).steps])
        for event in known_events()
    ]


@router.post("/dispatch", response_model=AutomationRun, summary="Dispatch an automation event")
async def dispatch_event(
    event: AutomationEvent,
    supabase: SupabaseService = Depends(get_supabase_service),
    store: RunStore = Depends(get_store),
) -> AutomationRun:
    workflow = get_workflow(event.event)

    # An unknown event is a caller mistake worth reporting: absorbing it would
    # make a typo look like a working no-op.
    if workflow is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown event: " + event.event,
        )

    try:
        run = await run_workflow(
            workflow,
            supabase=supabase,
            store=store,
            entity_type=_default_entity_type(event),
            entity_id=_default_entity_id(event),
            payload=event.payload,
            source="dry_run" if event.dry_run else "admin",
            idempotency_key=event.idempotency_key(),
            dry_run=event.dry_run,
        )
    except SupabaseNotConfigured as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error

    return _to_run(run)


@router.get("/runs", response_model=AutomationRunList, summary="Automation run history")
async def list_runs(
    event: str | None = Query(default=None, max_length=100),
    run_status: str | None = Query(default=None, alias="status", max_length=20),
    entity_id: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    store: RunStore = Depends(get_store),
) -> AutomationRunList:
    # Same rule as the other data endpoints: an unconfigured service reports
    # that, rather than answering with an empty result it never looked for.
    if not store.configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase is not configured.",
        )

    rows = await store.list(event=event, status=run_status, entity_id=entity_id, limit=limit)
    runs = [_to_run(row) for row in rows]

    return AutomationRunList(
        runs=runs,
        count=len(runs),
        limit=limit,
        storage_available=await store.available(),
    )


@router.get("/runs/stats", response_model=AutomationStats, summary="Automation run statistics")
async def run_stats(store: RunStore = Depends(get_store)) -> AutomationStats:
    # Declared before /runs/{run_id} so "stats" is not captured as an id.
    available = await store.available()
    stats = await store.stats()

    return AutomationStats(**stats, storage_available=available)


@router.get("/runs/{run_id}", response_model=AutomationRun, summary="One automation run")
async def get_run(
    run_id: str = Path(pattern=RUN_ID_PATTERN),
    store: RunStore = Depends(get_store),
) -> AutomationRun:
    row = await store.get(run_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found.")

    return _to_run(row)


@router.post("/runs/{run_id}/retry", response_model=AutomationRun, summary="Retry a failed run")
async def retry_run(
    run_id: str = Path(pattern=RUN_ID_PATTERN),
    supabase: SupabaseService = Depends(get_supabase_service),
    store: RunStore = Depends(get_store),
) -> AutomationRun:
    """Re-runs a failed execution as a new run.

    The original is never overwritten: a retry is a second attempt, and the
    first attempt is the evidence of what went wrong. The new run points back
    at it through `retry_of`.
    """
    original = await store.get(run_id)
    if not original:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found.")

    if original.get("status") != "FAILED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a failed run can be retried.",
        )

    workflow = get_workflow(original.get("event", ""))
    if workflow is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This run's event is no longer registered.",
        )

    run = await run_workflow(
        workflow,
        supabase=supabase,
        store=store,
        entity_type=original.get("entity_type"),
        entity_id=original.get("entity_id"),
        payload=original.get("payload") or {},
        source="retry",
        # Deliberately unkeyed: a retry is meant to run again.
        idempotency_key=None,
        retry_of=run_id,
    )

    return _to_run(run)

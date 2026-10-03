"""Automation endpoints: dispatch, history and retry.

Dispatch is synchronous: a workflow runs inside the request, one bounded step
at a time, and the response is the finished run. The response shape already
carries a `run_id`, so moving to asynchronous execution later does not change
what the Admin reads.

Who may do what is the database's answer, never this module's: every route
names the permission it needs (app/core/permissions.py) and each workflow
names the permissions of the business effect it has.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Body, Depends, Path, Query

from app.automations.engine import FAILED, Workflow, run_workflow
from app.automations.registry import RETIRED_EVENTS, get_run_workflow, get_workflow, known_events
from app.core.config import get_settings
from app.core.errors import bad_request, not_configured, not_found
from app.core.permissions import RUN_JOBS, VIEW_RUNS
from app.core.security import Access, current_access, require_permissions
from app.schemas.automation import (
    AttentionItem,
    AutomationEvent,
    AutomationRun,
    AutomationRunList,
    AutomationStats,
    RegisteredAutomation,
    RetryRequest,
)
from app.services.run_store import DEFAULT_LIMIT, MAX_LIMIT, RunStore, get_run_store, is_stale
from app.services.supabase_service import SupabaseNotConfigured, SupabaseService, get_supabase_service

router = APIRouter(prefix="/automations", tags=["automations"])

RUN_ID_PATTERN = r"^[0-9a-fA-F-]{8,64}$"


def get_store(supabase: SupabaseService = Depends(get_supabase_service)) -> RunStore:
    return get_run_store(supabase)


def source_for(access: Access, *, dry_run: bool = False) -> str:
    if dry_run:
        return "dry_run"
    if access.caller.is_member:
        return "admin"
    return "scheduler" if access.caller.is_scheduler else "api"


async def can_see(access: Access, permission: str | None) -> bool:
    return permission is None or await access.can(permission)


def run_permissions(workflow: Workflow) -> tuple[str, ...]:
    """What starting this workflow again requires: its own permissions, or,
    for a scheduled job (which has none of its own), the job permission."""
    return RUN_JOBS if workflow.entity_type == "job" else workflow.permissions


async def present_run(raw: dict[str, Any], access: Access, *, now: datetime | None = None) -> AutomationRun:
    """A run as this reader may see it.

    The engine calls it `id` and so does the table; the API calls it `run_id`.
    That mapping lives here and nowhere else. Results a reader may not see --
    a finance review for a member who cannot read the ledger -- are withheld,
    and the run says so.
    """
    settings = get_settings()
    workflow = get_run_workflow(str(raw.get("event") or ""))
    stale = is_stale(raw, minutes=settings.stale_run_minutes, now=now)
    redacted = False

    result = raw.get("result") if isinstance(raw.get("result"), dict) else {}
    steps = [dict(step) for step in (raw.get("steps") or []) if isinstance(step, dict)]

    if workflow is not None:
        if not await can_see(access, workflow.visible_with):
            result = {
                key: result[key]
                for key in ("steps_total", "steps_run", "steps_succeeded", "dry_run")
                if key in result
            }
            for step in steps:
                step["result"] = None
                step["redacted"] = True
            redacted = True
        else:
            hidden = {step.name for step in workflow.steps if not await can_see(access, step.visible_with)}
            for step in steps:
                if step.get("name") in hidden:
                    step["result"] = None
                    step["redacted"] = True
                    redacted = True

    status = raw.get("status", "PENDING")
    retryable = workflow is not None and raw.get("id") is not None and (status == FAILED or stale)

    return AutomationRun(
        run_id=raw.get("run_id") or raw.get("id"),
        event=raw.get("event", ""),
        status=status,
        source=raw.get("source", "api"),
        entity_type=raw.get("entity_type"),
        entity_id=raw.get("entity_id"),
        steps=steps,
        result=result,
        error=raw.get("error"),
        started_at=raw.get("started_at"),
        finished_at=raw.get("finished_at"),
        duration_ms=raw.get("duration_ms"),
        retry_of=raw.get("retry_of"),
        requested_by=raw.get("requested_by"),
        created_at=raw.get("created_at"),
        persisted=raw.get("persisted", raw.get("id") is not None),
        deduplicated=bool(raw.get("deduplicated")),
        stale=stale,
        retryable=retryable,
        redacted=redacted,
    )


def _describe(workflow: Workflow) -> RegisteredAutomation:
    return RegisteredAutomation(
        event=workflow.event,
        description=workflow.description,
        entity_type=workflow.entity_type,
        steps=[step.name for step in workflow.steps],
        permissions=list(workflow.permissions),
        writes=workflow.writes,
    )


def _unknown_event(event: str):
    if event in RETIRED_EVENTS:
        return bad_request(f"The event {event} was retired; use {RETIRED_EVENTS[event]}.")
    # An unknown event is a caller mistake worth reporting: absorbing it would
    # make a typo look like a working no-op.
    return bad_request("Unknown event: " + event)


@router.get("", response_model=list[RegisteredAutomation], summary="Registered automations")
async def list_automations(
    _: Access = Depends(require_permissions(*VIEW_RUNS)),
) -> list[RegisteredAutomation]:
    return [_describe(get_workflow(event)) for event in known_events()]


@router.post("/dispatch", response_model=AutomationRun, summary="Dispatch an automation event")
async def dispatch_event(
    event: AutomationEvent,
    access: Access = Depends(current_access),
    supabase: SupabaseService = Depends(get_supabase_service),
    store: RunStore = Depends(get_store),
) -> AutomationRun:
    workflow = get_workflow(event.event)
    if workflow is None:
        raise _unknown_event(event.event)

    # The permissions of the business effect, asked of the database as the
    # member. A workflow that writes asks without the cache.
    await access.require(*workflow.permissions, fresh=workflow.writes and not event.dry_run)

    if not supabase.configured:
        raise not_configured("Supabase is not configured on the automation service.")

    try:
        run = await run_workflow(
            workflow,
            supabase=supabase,
            store=store,
            entity_type=event.entity_type or workflow.entity_type,
            entity_id=event.subject_id(),
            payload=event.payload,
            source=source_for(access, dry_run=event.dry_run),
            idempotency_key=event.idempotency_key(),
            dry_run=event.dry_run,
            access=access,
        )
    except SupabaseNotConfigured as error:
        raise not_configured(str(error)) from error

    return await present_run(run, access)


@router.get("/runs", response_model=AutomationRunList, summary="Automation run history")
async def list_runs(
    event: str | None = Query(default=None, max_length=100, pattern=r"^[a-z][a-z0-9_.]*$"),
    run_status: str | None = Query(
        default=None, alias="status", pattern=r"^(PENDING|RUNNING|SUCCESS|FAILED|SKIPPED)$"
    ),
    entity_id: str | None = Query(default=None, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    access: Access = Depends(require_permissions(*VIEW_RUNS)),
    store: RunStore = Depends(get_store),
) -> AutomationRunList:
    # An unconfigured service says so rather than answering with an empty
    # result it never looked for.
    if not store.configured:
        raise not_configured("Supabase is not configured on the automation service.")

    rows = await store.list(event=event, status=run_status, entity_id=entity_id, limit=limit)
    now = datetime.now(UTC)
    runs = [await present_run(row, access, now=now) for row in rows]

    return AutomationRunList(
        runs=runs, count=len(runs), limit=limit, storage_available=await store.available()
    )


@router.get("/runs/stats", response_model=AutomationStats, summary="Automation run statistics")
async def run_stats(
    access: Access = Depends(require_permissions(*VIEW_RUNS)),
    store: RunStore = Depends(get_store),
) -> AutomationStats:
    # Declared before /runs/{run_id} so "stats" is not captured as an id.
    if not store.configured:
        raise not_configured("Supabase is not configured on the automation service.")

    available = await store.available()
    stats = await store.stats(stale_minutes=get_settings().stale_run_minutes)

    # A run whose findings this reader may not see is not named to them either.
    attention = []
    for item in stats.pop("attention", []):
        workflow = get_run_workflow(str(item.get("event") or ""))
        if workflow is None or await can_see(access, workflow.visible_with):
            attention.append(AttentionItem(**item))

    return AutomationStats(**stats, attention=attention, storage_available=available)


@router.get("/runs/{run_id}", response_model=AutomationRun, summary="One automation run")
async def get_run(
    run_id: str = Path(pattern=RUN_ID_PATTERN),
    access: Access = Depends(require_permissions(*VIEW_RUNS)),
    store: RunStore = Depends(get_store),
) -> AutomationRun:
    row = await store.get(run_id)
    if not row:
        raise not_found("Run not found.")
    return await present_run(row, access)


@router.post("/runs/{run_id}/retry", response_model=AutomationRun, summary="Retry a failed run")
async def retry_run(
    run_id: str = Path(pattern=RUN_ID_PATTERN),
    request: RetryRequest | None = Body(default=None),
    access: Access = Depends(require_permissions(*VIEW_RUNS)),
    supabase: SupabaseService = Depends(get_supabase_service),
    store: RunStore = Depends(get_store),
) -> AutomationRun:
    """Re-runs a failed (or abandoned) execution as a new run.

    The original is never touched: a retry is a second attempt, and the first
    attempt is the evidence of what went wrong. The new run points back at it
    through `retry_of`. The retry acts for whoever asks for it, with their
    permissions, and its operation id collapses a double click into one run.
    """
    original = await store.get(run_id)
    if not original:
        raise not_found("Run not found.")

    stale = is_stale(original, minutes=get_settings().stale_run_minutes)
    if original.get("status") != FAILED and not stale:
        raise bad_request("Only a failed or abandoned run can be retried.")

    event = str(original.get("event") or "")
    workflow = get_run_workflow(event)
    if workflow is None:
        raise bad_request(
            f"The event {event} was retired; its runs stay in the history but cannot run again."
            if event in RETIRED_EVENTS
            else "This run's event is no longer registered."
        )

    await access.require(*run_permissions(workflow), fresh=workflow.writes)

    operation_id = request.operation_id if request else None
    dry_run = original.get("source") == "dry_run" or bool((original.get("result") or {}).get("dry_run"))

    run = await run_workflow(
        workflow,
        supabase=supabase,
        store=store,
        entity_type=original.get("entity_type"),
        entity_id=original.get("entity_id"),
        payload=original.get("payload") or {},
        source="retry",
        idempotency_key=f"retry:{run_id}:{operation_id}" if operation_id else None,
        retry_of=run_id,
        dry_run=dry_run,
        access=access,
    )

    return await present_run(run, access)

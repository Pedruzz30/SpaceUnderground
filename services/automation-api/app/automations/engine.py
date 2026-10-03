"""The workflow engine.

A run is an event plus an ordered list of steps. The engine owns the lifecycle
-- timing, status, error sanitisation, persistence -- and the handlers own only
what their step actually does. That split is what keeps a handler from having
to remember to stamp a duration or catch its own exceptions.

The rules the whole design rests on:

  1. A step that raises does not crash the run. It is recorded as FAILED with a
     sanitised message, the steps before it keep their results, and the run
     finishes as FAILED. History is the point; losing it on failure would
     defeat the feature.

  2. Nothing here can fail the caller's real work. `project.published` runs
     after Supabase has already published, so the worst a broken workflow can
     do is record itself as broken.

  3. Every step is bounded. A handler that hangs would hold a worker open, so
     each one runs under a timeout, and a timeout is just another controlled
     FAILED result.

  4. One deliberate action, one run. A dispatch carrying an idempotency key
     that was already recorded -- finished or still running -- returns that
     run instead of executing again.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.core.logging import get_logger, log_event
from app.services.run_store import RunStore
from app.services.supabase_service import SupabaseService

if TYPE_CHECKING:
    from app.core.security import Access

logger = get_logger("automation")

# Per step. Generous enough for an HTTP check plus a Supabase read, short
# enough that a stuck run is noticed rather than waited on.
DEFAULT_STEP_TIMEOUT_SECONDS = 10.0

PENDING = "PENDING"
RUNNING = "RUNNING"
SUCCESS = "SUCCESS"
FAILED = "FAILED"
SKIPPED = "SKIPPED"

FINISHED = (SUCCESS, FAILED, SKIPPED)


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None


def _elapsed_ms(started: datetime, finished: datetime) -> int:
    """Whole milliseconds between two stamps, never negative.

    `datetime.now()` is wall clock, not monotonic: an NTP correction during a
    run can place `finished` before `started`. The database refuses a negative
    duration (`duration_ms >= 0`), so without this clamp a clock adjustment
    would fail the write and strand the run at RUNNING -- the one state that
    means "still going" and would never resolve.
    """
    return max(0, int((finished - started).total_seconds() * 1000))


class StepSkipped(Exception):
    """Raised by a step that had nothing to do. Not a failure."""


class StepFailed(Exception):
    """Raised by a step that failed in a way it already understands.

    The message is written by the handler and is safe to show; an unexpected
    exception is not, and is replaced with its type name instead.
    """


@dataclass
class StepContext:
    """What a step is given. Deliberately narrow."""

    event: str
    entity_type: str | None
    entity_id: str | None
    payload: dict[str, Any]
    supabase: SupabaseService
    dry_run: bool = False
    # Who the run acts for. None only when a test drives the engine directly;
    # handlers that write ask it before they do.
    access: Access | None = None
    run_id: str | None = None
    # Results of the steps that already ran, by name, so a later step can build
    # on an earlier one without the handler passing state around by hand.
    results: dict[str, Any] = field(default_factory=dict)

    @property
    def actor_id(self) -> str | None:
        return self.access.user_id if self.access else None

    async def can(self, permission: str, *, fresh: bool = False) -> bool:
        """Whether the caller holds `permission`. True when nobody is calling
        (the engine driven directly), which only tests do."""
        return True if self.access is None else await self.access.can(permission, fresh=fresh)


StepFunction = Callable[[StepContext], Awaitable[Any]]


@dataclass
class Step:
    name: str
    run: StepFunction
    timeout: float = DEFAULT_STEP_TIMEOUT_SECONDS
    # A permission needed to *see* this step's result when the run is read
    # back. A finance review is history like any other, but the Logs screen is
    # open to members who may not read the ledger.
    visible_with: str | None = None


@dataclass
class Workflow:
    event: str
    steps: list[Step]
    # Every one is required to dispatch or retry the workflow.
    permissions: tuple[str, ...] = ()
    # Business writes: permissions are re-checked without the cache first.
    writes: bool = False
    entity_type: str | None = None
    description: str = ""
    # A permission needed to see anything this workflow found (its summary,
    # actions and step results), for workflows whose whole output is
    # sensitive -- a scan of the ledger, say. Status and timing stay visible.
    visible_with: str | None = None


def _sanitise(error: Exception) -> str:
    """What is safe to put in front of a person.

    A handler's own StepFailed message is intentional and kept. Anything else
    could carry a connection string, a query or a key, so only the exception
    type survives.
    """
    if isinstance(error, StepFailed):
        return str(error)
    if isinstance(error, TimeoutError):
        return "Step timed out."
    return f"Unexpected error ({type(error).__name__})."


async def _execute_step(step: Step, context: StepContext, run_id: str | None) -> dict[str, Any]:
    started = _now()
    log_event(
        logger, logging.INFO, "automation.step.started", run_id=run_id, event=context.event, step=step.name
    )

    status = SUCCESS
    result: Any = None
    error: str | None = None

    try:
        result = await asyncio.wait_for(step.run(context), timeout=step.timeout)
    except StepSkipped as skipped:
        status = SKIPPED
        result = {"reason": str(skipped)} if str(skipped) else None
    except Exception as failure:  # noqa: BLE001 - every failure is recorded, never raised
        status = FAILED
        error = _sanitise(failure)

    finished = _now()
    duration_ms = _elapsed_ms(started, finished)

    log_event(
        logger,
        logging.INFO,
        "automation.step.completed",
        run_id=run_id,
        event=context.event,
        step=step.name,
        status=status,
        duration_ms=duration_ms,
    )

    return {
        "name": step.name,
        "status": status,
        "started_at": _iso(started),
        "finished_at": _iso(finished),
        "duration_ms": duration_ms,
        "result": result,
        "error": error,
    }


async def run_workflow(
    workflow: Workflow,
    *,
    supabase: SupabaseService,
    store: RunStore,
    entity_type: str | None = None,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
    source: str = "api",
    idempotency_key: str | None = None,
    retry_of: str | None = None,
    dry_run: bool = False,
    access: Access | None = None,
) -> dict[str, Any]:
    """Executes a workflow end to end and records it.

    Returns the run as the API reports it, whether or not it was persisted: a
    missing history table degrades the audit trail, not the workflow.
    """
    payload = payload or {}

    # An identical dispatch already recorded is returned as-is rather than run
    # again -- a double click plus a network retry must not produce two runs.
    # A deliberate second run later supplies a different operation id.
    if idempotency_key:
        existing = await store.find_by_idempotency_key(idempotency_key)
        if existing:
            log_event(
                logger,
                logging.INFO,
                "automation.run.deduplicated",
                run_id=existing.get("id"),
                event=workflow.event,
            )
            return {**existing, "deduplicated": True}

    started = _now()
    record = {
        "event": workflow.event,
        "status": RUNNING,
        "source": source,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "payload": payload,
        "started_at": _iso(started),
        "idempotency_key": idempotency_key,
        "retry_of": retry_of,
    }
    actor = access.user_id if access else None
    if actor:
        record["requested_by"] = actor

    created, inserted = await store.create(record)

    # The key was taken between the lookup above and the insert: a concurrent
    # identical dispatch won the race. Whatever state its run is in, it is
    # *the* run for this operation, and executing again would do the work twice.
    if created is not None and not inserted:
        log_event(
            logger,
            logging.INFO,
            "automation.run.deduplicated",
            run_id=created.get("id"),
            event=workflow.event,
        )
        return {**created, "deduplicated": True}

    run_id = created.get("id") if created else None
    persisted = created is not None

    log_event(
        logger,
        logging.INFO,
        "automation.run.started",
        run_id=run_id,
        event=workflow.event,
        entity_id=entity_id,
        persisted=persisted,
    )

    context = StepContext(
        event=workflow.event,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
        supabase=supabase,
        dry_run=dry_run,
        access=access,
        run_id=run_id,
    )

    steps: list[dict[str, Any]] = []
    status = SUCCESS

    for step in workflow.steps:
        step_record = await _execute_step(step, context, run_id)
        steps.append(step_record)

        if step_record["status"] == SUCCESS:
            context.results[step.name] = step_record["result"]
            continue

        if step_record["status"] == FAILED:
            # Stop at the first failure: later steps are written assuming the
            # earlier ones produced something, and running them anyway would
            # turn one real error into a cascade of misleading ones.
            status = FAILED
            break

    finished = _now()
    duration_ms = _elapsed_ms(started, finished)
    failed_step = next((item for item in steps if item["status"] == FAILED), None)

    result = {
        "steps_total": len(workflow.steps),
        "steps_run": len(steps),
        "steps_succeeded": sum(1 for item in steps if item["status"] == SUCCESS),
        "summary": context.results.get("summary"),
        "business_status": context.results.get("business_status"),
        "actions": context.results.get("actions") or [],
        "entities": context.results.get("entities") or {},
        "dry_run": dry_run,
    }

    run = {
        "id": run_id,
        "event": workflow.event,
        "status": status,
        "source": source,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "payload": payload,
        "steps": steps,
        "result": result,
        "error": failed_step["error"] if failed_step else None,
        "started_at": _iso(started),
        "finished_at": _iso(finished),
        "duration_ms": duration_ms,
        "retry_of": retry_of,
        "requested_by": actor,
        "created_at": created.get("created_at") if created else None,
        "persisted": persisted,
    }

    if run_id:
        updated = await store.update(
            run_id,
            {
                "status": status,
                "steps": steps,
                "result": result,
                "error": run["error"],
                "finished_at": _iso(finished),
                "duration_ms": duration_ms,
            },
        )
        # The run executed, but its final state never reached the table: the
        # history now says RUNNING forever. Reported, so the Admin can say so.
        if updated is None:
            run["persisted"] = False

    log_event(
        logger,
        logging.INFO,
        "automation.run.completed",
        run_id=run_id,
        event=workflow.event,
        entity_id=entity_id,
        status=status,
        duration_ms=duration_ms,
        persisted=run["persisted"],
    )

    return run

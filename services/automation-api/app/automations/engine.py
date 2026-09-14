"""The workflow engine.

A run is an event plus an ordered list of steps. The engine owns the lifecycle
-- timing, status, error sanitisation, persistence -- and the handlers own only
what their step actually does. That split is what keeps a handler from having
to remember to stamp a duration or catch its own exceptions.

Three rules the whole design rests on:

  1. A step that raises does not crash the run. It is recorded as FAILED with a
     sanitised message, the steps before it keep their results, and the run
     finishes as FAILED. History is the point; losing it on failure would
     defeat the feature.

  2. Nothing here can fail the caller's real work. `project.published` runs
     after Supabase has already published, so the worst a broken workflow can
     do is record itself as broken.

  3. Every step is bounded. A handler that hangs is a handler that would hold a
     worker open, so each one runs under a timeout and a timeout is just
     another controlled FAILED result.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger, log_event
from app.services.run_store import RunStore
from app.services.supabase_service import SupabaseService

logger = get_logger("automation")

# Per step. Generous enough for an HTTP check plus a Supabase read, short
# enough that a stuck run is noticed rather than waited on.
DEFAULT_STEP_TIMEOUT_SECONDS = 10.0

PENDING = "PENDING"
RUNNING = "RUNNING"
SUCCESS = "SUCCESS"
FAILED = "FAILED"
SKIPPED = "SKIPPED"


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None


def _elapsed_ms(started: datetime, finished: datetime) -> int:
    """Whole milliseconds between two stamps, never negative.

    `datetime.now()` is wall clock, not monotonic: an NTP correction during a
    run can place `finished` before `started`. The database refuses a negative
    duration (`duration_ms >= 0` in migration 010), so without this clamp a
    clock adjustment would fail the write and strand the run at RUNNING --
    the one state that means "still going" and would never resolve.
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
    # Results of the steps that already ran, by name, so a later step can build
    # on an earlier one without the handler passing state around by hand.
    results: dict[str, Any] = field(default_factory=dict)


StepFunction = Callable[[StepContext], Awaitable[Any]]


@dataclass
class Step:
    name: str
    run: StepFunction
    timeout: float = DEFAULT_STEP_TIMEOUT_SECONDS


@dataclass
class Workflow:
    event: str
    steps: list[Step]


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
        logger,
        logging.INFO,
        "automation.step.started",
        run_id=run_id,
        event=context.event,
        step=step.name,
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
) -> dict[str, Any]:
    """Executes a workflow end to end and records it.

    Returns the run as the API reports it, whether or not it was persisted: a
    missing history table degrades the audit trail, not the workflow.
    """
    payload = payload or {}

    # An identical dispatch that was already recorded is returned as-is rather
    # than run again -- a double click plus a network retry must not produce two
    # runs. A deliberate second run later supplies a different operation id.
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
    created = await store.create(
        {
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
    )

    # A run created by a concurrent identical dispatch comes back already
    # finished; nothing is gained by running it a second time.
    if created and created.get("status") in (SUCCESS, FAILED, SKIPPED):
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
    )

    steps: list[dict[str, Any]] = []
    status = SUCCESS

    for step in workflow.steps:
        record = await _execute_step(step, context, run_id)
        steps.append(record)

        if record["status"] == SUCCESS:
            context.results[step.name] = record["result"]
            continue

        if record["status"] == FAILED:
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
        "persisted": persisted,
    }

    if run_id:
        await store.update(
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

    log_event(
        logger,
        logging.INFO,
        "automation.run.completed",
        run_id=run_id,
        event=workflow.event,
        entity_id=entity_id,
        status=status,
        duration_ms=duration_ms,
        persisted=persisted,
    )

    return run

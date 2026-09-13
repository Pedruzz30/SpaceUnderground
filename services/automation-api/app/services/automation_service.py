"""The automation engine: events in, handlers out.

Deliberately small. There is no queue, no broker and no scheduler, because
there is nothing yet that needs to survive a restart or run concurrently.
What exists is the seam: an event name, a registry, and handlers that receive a
payload and return a result. Adding a queue later means changing `dispatch`,
not every handler.

Safety rule for this phase: no handler writes anything. Automations observe,
analyse and log. Anything that mutates project data is a deliberate decision
for a later phase, made once the execution log lives somewhere durable.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.logging import get_logger, log_event
from app.schemas.automation import AutomationResult, RegisteredAutomation
from app.services.project_analysis_service import analyze_project
from app.services.supabase_service import (
    ProjectNotFound,
    SupabaseError,
    SupabaseService,
)

logger = get_logger("automation")

# Events the system is expected to grow into. Listed so a typo in a dispatch
# call is visible, and so the roadmap is readable from the code.
KNOWN_EVENTS = (
    "project.created",
    "project.updated",
    "project.published",
    "project.completed",
    "client.created",
    "proposal.accepted",
)

Handler = Callable[[dict[str, Any], SupabaseService], Awaitable[AutomationResult]]

_REGISTRY: dict[str, list[Handler]] = {}


def register(event: str) -> Callable[[Handler], Handler]:
    """Registers a handler for an event."""

    def decorator(handler: Handler) -> Handler:
        _REGISTRY.setdefault(event, []).append(handler)
        return handler

    return decorator


def registered_automations() -> list[RegisteredAutomation]:
    return [
        RegisteredAutomation(event=event, handlers=[handler.__name__ for handler in handlers])
        for event, handlers in sorted(_REGISTRY.items())
    ]


async def dispatch(
    event: str,
    payload: dict[str, Any],
    supabase: SupabaseService,
) -> list[AutomationResult]:
    """Runs every handler registered for `event`.

    One failing handler does not stop the others: each result carries its own
    status, so a partial run is reported rather than hidden behind a 500.
    """
    handlers = _REGISTRY.get(event, [])

    if not handlers:
        log_event(logger, logging.INFO, "automation.dispatch.unhandled", event=event)
        return []

    results: list[AutomationResult] = []

    for handler in handlers:
        name = handler.__name__
        log_event(logger, logging.INFO, "automation.handler.start", event=event, handler=name)

        try:
            result = await handler(payload, supabase)
        except SupabaseError as error:
            # Expected failure mode: the database is unreachable or the row is
            # gone. Reported as a handler result, not as a server error.
            log_event(
                logger,
                logging.WARNING,
                "automation.handler.failed",
                event=event,
                handler=name,
                error=type(error).__name__,
            )
            result = AutomationResult(
                event=event,
                handler=name,
                status="failed",
                message=str(error),
            )
        except Exception as error:  # noqa: BLE001 - a handler must not take the process down
            log_event(
                logger,
                logging.ERROR,
                "automation.handler.crashed",
                event=event,
                handler=name,
                error=type(error).__name__,
            )
            result = AutomationResult(
                event=event,
                handler=name,
                status="failed",
                message="Handler raised an unexpected error.",
            )

        log_event(
            logger,
            logging.INFO,
            "automation.handler.done",
            event=event,
            handler=name,
            status=result.status,
        )
        results.append(result)

    return results


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


@register("project.published")
async def validate_published_project(
    payload: dict[str, Any],
    supabase: SupabaseService,
) -> AutomationResult:
    """Re-checks a project's integrity right after it goes live.

    Reads the row back from the database rather than trusting the payload, so
    what is validated is what was actually persisted. Reports and logs only --
    it never edits the project, even when the analysis fails.
    """
    event = "project.published"
    project_id = str(payload.get("project_id") or "").strip()

    if not project_id:
        return AutomationResult(
            event=event,
            handler="validate_published_project",
            status="skipped",
            message="payload has no project_id.",
        )

    try:
        row = await supabase.get_project(project_id)
    except ProjectNotFound:
        return AutomationResult(
            event=event,
            handler="validate_published_project",
            status="skipped",
            message="Project not found: " + project_id,
        )

    analysis = analyze_project(row)

    log_event(
        logger,
        logging.INFO,
        "automation.project.published",
        project_id=analysis.project_id or project_id,
        case_number=analysis.case_number,
        score=analysis.score,
        status=analysis.status.value,
    )

    return AutomationResult(
        event=event,
        handler="validate_published_project",
        status="ok",
        message="Analise executada: " + analysis.status.value + " (" + str(analysis.score) + "/100).",
        data={
            "project_id": analysis.project_id,
            "case_number": analysis.case_number,
            "score": analysis.score,
            "status": analysis.status.value,
            "failed_checks": [check.key for check in analysis.checks if check.status.value == "fail"],
            "warnings": analysis.warnings,
        },
    )

"""Workflow for `project.published`.

Runs after the Admin has already published through Supabase. It observes and
reports: it loads the row back, analyses it, checks the demo actually loads, and
summarises. It never edits the project, never changes visibility and never
publishes anything.

Reading the row back rather than trusting the dispatch payload is deliberate --
what gets validated is what was actually persisted, not what the browser
believed it sent.
"""

from __future__ import annotations

from typing import Any

from app.automations.engine import Step, StepFailed, StepSkipped, Workflow
from app.services.project_analysis_service import analyze_project
from app.services.supabase_service import ProjectNotFound, SupabaseError
from app.services.url_check_service import check_url

EVENT = "project.published"


async def load_project(context) -> dict[str, Any]:
    """Step 01 -- the project must exist and be readable."""
    identifier = str(context.entity_id or context.payload.get("project_id") or "").strip()
    if not identifier:
        raise StepFailed("No project identifier was supplied.")

    try:
        row = await context.supabase.get_project(identifier)
    except ProjectNotFound as error:
        raise StepFailed(f"Project not found: {identifier}") from error
    except SupabaseError as error:
        raise StepFailed("Could not read the project from Supabase.") from error

    context.results["project"] = row

    return {
        "project_id": row.get("id"),
        "case_number": row.get("case_number"),
        "name": row.get("name"),
        "editorial_status": row.get("editorial_status"),
    }


async def analyze(context) -> dict[str, Any]:
    """Step 02 -- the operational analysis over the stored row."""
    row = context.results.get("project")
    if not row:
        raise StepFailed("The project was not loaded.")

    analysis = analyze_project(row)
    context.results["analysis"] = analysis

    return {
        "score": analysis.score,
        "status": analysis.status.value,
        "failed_checks": [check.key for check in analysis.checks if check.status.value == "fail"],
        "warnings": analysis.warnings,
    }


async def check_live_preview(context) -> dict[str, Any]:
    """Step 03 -- does the demo actually load?

    Only when the flag is on. A project without a live demo is a valid state,
    so this is SKIPPED rather than failed. The check goes through the SSRF-safe
    path: `preview_url` is operator-supplied data, and fetching it from the
    server is exactly the request-forgery shape.
    """
    row = context.results.get("project") or {}

    if row.get("live_preview_enabled") is not True:
        raise StepSkipped("Live preview is not enabled for this project.")

    preview_url = str(row.get("preview_url") or "").strip()
    if not preview_url:
        raise StepFailed("Live preview is enabled but no preview URL is set.")

    result = await check_url(preview_url)
    if not result.ok:
        raise StepFailed(f"Preview URL is not reachable ({result.reason}).")

    return result.as_dict()


async def summarise(context) -> dict[str, Any]:
    """Step 04 -- one readable outcome for the Admin."""
    row = context.results.get("project") or {}
    analysis = context.results.get("analysis")
    preview = context.results.get("check_live_preview")

    summary = {
        "project_id": row.get("id"),
        "case_number": row.get("case_number"),
        "name": row.get("name"),
        "score": analysis.score if analysis else None,
        "analysis_status": analysis.status.value if analysis else None,
        "live_preview_checked": bool(preview),
    }

    # Recorded under "summary" as well, which is what the engine copies into
    # the run's result.
    context.results["summary"] = summary
    return summary


WORKFLOW = Workflow(
    event=EVENT,
    steps=[
        Step(name="load_project", run=load_project),
        Step(name="analyze_project", run=analyze),
        # The only step that leaves the network for an arbitrary host, so it
        # gets a tighter bound than the default.
        Step(name="check_live_preview", run=check_live_preview, timeout=8.0),
        Step(name="register_result", run=summarise),
    ],
)

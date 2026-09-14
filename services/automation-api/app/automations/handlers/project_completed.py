"""Workflow for `project.completed`.

Produces the closing checklist for a project: what is done, what is still
outstanding. It is strictly read-only in this phase.

What it explicitly does not do, because these were asked for later and doing
any of them early would make the workflow unsafe to run twice: no invoice, no
PDF, no financial movement, no email. A checklist is information; acting on it
is a decision a person still makes.
"""

from __future__ import annotations

from typing import Any

from app.automations.engine import Step, StepFailed, Workflow
from app.services.project_analysis_service import analyze_project
from app.services.supabase_service import ProjectNotFound, SupabaseError

EVENT = "project.completed"

# Checks that must pass before a project can honestly be called finished.
# Narrower than the full analysis: an empty gallery is untidy, a published
# project with no poster is unfinished.
CLOSING_CHECKS = (
    "identity",
    "client",
    "description",
    "poster",
    "modules",
    "publication_consistency",
    "live_preview",
)


async def load_project(context) -> dict[str, Any]:
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
    return {"project_id": row.get("id"), "case_number": row.get("case_number"), "name": row.get("name")}


async def analyze(context) -> dict[str, Any]:
    row = context.results.get("project")
    if not row:
        raise StepFailed("The project was not loaded.")

    analysis = analyze_project(row)
    context.results["analysis"] = analysis

    return {"score": analysis.score, "status": analysis.status.value}


async def build_checklist(context) -> dict[str, Any]:
    """The closing checklist, derived from the analysis already computed.

    Outstanding items do not fail the run: "this project is not finished yet"
    is a correct answer, not an error.
    """
    analysis = context.results.get("analysis")
    if not analysis:
        raise StepFailed("The analysis did not run.")

    relevant = [check for check in analysis.checks if check.key in CLOSING_CHECKS]
    outstanding = [
        {"key": check.key, "status": check.status.value, "message": check.message}
        for check in relevant
        if check.status.value != "ok"
    ]

    checklist = {
        "checked": len(relevant),
        "cleared": len(relevant) - len(outstanding),
        "outstanding": outstanding,
        "ready_to_close": not outstanding,
    }

    context.results["checklist"] = checklist
    return checklist


async def summarise(context) -> dict[str, Any]:
    row = context.results.get("project") or {}
    analysis = context.results.get("analysis")
    checklist = context.results.get("checklist") or {}

    summary = {
        "project_id": row.get("id"),
        "case_number": row.get("case_number"),
        "name": row.get("name"),
        "score": analysis.score if analysis else None,
        "ready_to_close": checklist.get("ready_to_close"),
        "outstanding": len(checklist.get("outstanding", [])),
    }

    context.results["summary"] = summary
    return summary


WORKFLOW = Workflow(
    event=EVENT,
    steps=[
        Step(name="load_project", run=load_project),
        Step(name="analyze_project", run=analyze),
        Step(name="build_checklist", run=build_checklist),
        Step(name="register_result", run=summarise),
    ],
)

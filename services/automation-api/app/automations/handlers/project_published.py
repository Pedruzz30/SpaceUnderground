"""Workflow for `project.published`.

Dispatched by the Admin only after Supabase confirmed the publication, so it
never stands between an operator and the site. It observes and reports: it
loads the row back, confirms it really is published, analyses it, checks the
demo actually loads, and summarises. It never edits the project, never changes
visibility and never publishes anything.
"""

from __future__ import annotations

from typing import Any

from app.automations.engine import Step, StepFailed, StepSkipped, Workflow
from app.business.projects import load_project
from app.core.permissions import PROJECTS_PUBLISH
from app.schemas.common import AnalysisStatus
from app.services.project_analysis_service import analyze_project
from app.services.url_check_service import check_url

EVENT = "project.published"


async def confirm_published(context) -> dict[str, Any]:
    """Step 01 -- the stored row must be the published one."""
    loaded = await load_project(context)
    if loaded.get("editorial_status") != "PUBLISHED":
        raise StepFailed(
            "O projeto não está publicado no banco (status editorial "
            f"{loaded.get('editorial_status') or 'vazio'}); nada a verificar."
        )
    return loaded


async def analyze(context) -> dict[str, Any]:
    """Step 02 -- the operational analysis over the stored row."""
    row = context.results.get("project")
    if not row:
        raise StepFailed("O projeto não foi carregado.")

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

    Only when the flag is on: a project without a live demo is a valid state,
    so this is SKIPPED rather than failed. The check goes through the
    SSRF-safe path: `preview_url` is operator-supplied data, and fetching it
    from the server is exactly the request-forgery shape.
    """
    row = context.results.get("project") or {}

    if row.get("live_preview_enabled") is not True:
        raise StepSkipped("A demonstração ao vivo não está habilitada neste projeto.")

    preview_url = str(row.get("preview_url") or "").strip()
    if not preview_url:
        raise StepFailed("A demonstração está habilitada, mas não há URL de preview.")

    result = await check_url(preview_url)
    if not result.ok:
        raise StepFailed(f"A URL de preview não respondeu ({result.reason}).")

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

    context.results["summary"] = summary
    # Published with failing checks is a real exception worth surfacing; a
    # warning is not.
    context.results["business_status"] = (
        "ATTENTION" if analysis and analysis.status is AnalysisStatus.INCOMPLETE else "SUCCESS"
    )
    context.results["entities"] = {"project_id": row.get("id")}
    return summary


WORKFLOW = Workflow(
    event=EVENT,
    entity_type="project",
    permissions=(PROJECTS_PUBLISH,),
    description="Verifica o projeto recém-publicado: registro, análise operacional e demonstração.",
    steps=[
        Step(name="load_project", run=confirm_published),
        Step(name="analyze_project", run=analyze),
        # The only step that leaves the network for an arbitrary host, so it
        # gets a tighter bound than the default.
        Step(name="check_live_preview", run=check_live_preview, timeout=8.0),
        Step(name="register_result", run=summarise),
    ],
)

"""Workflow for `project.completed`.

What "completed" means here: the project's persisted `status` became `Live`
(delivered and in production). The schema has no COMPLETED state and no
completion date, so the Admin dispatches this event only after a save that
moved the stored status into Live -- never from text on a screen.

The workflow produces the closing checklist: what is done, what is still
outstanding, what the ledger says. It is read-only. No invoice, no charge, no
financial movement, no email and no publication: readiness is information,
acting on it is still a human decision.
"""

from __future__ import annotations

from typing import Any

from app.automations.engine import Step, StepFailed, StepSkipped, Workflow
from app.business.projects import (
    COMPLETED_STATUS,
    cms_candidate,
    completion_business_status,
    finance_review,
    load_project,
)
from app.core.config import get_settings
from app.core.permissions import FINANCE_READ, PROJECTS_EDIT
from app.services.project_analysis_service import analyze_project
from app.services.supabase_service import SupabaseError
from app.utils.dates import business_today

EVENT = "project.completed"

# Checks that must pass before a project can honestly be called finished.
# Narrower than the full analysis: an empty gallery is untidy, a delivered
# project with no description is unfinished.
CLOSING_CHECKS = (
    "identity",
    "client",
    "description",
    "poster",
    "modules",
    "publication_consistency",
    "live_preview",
)


async def confirm_completion(context) -> dict[str, Any]:
    loaded = await load_project(context)
    if loaded.get("status") != COMPLETED_STATUS:
        raise StepFailed(
            f"O projeto não está concluído: o status salvo é {loaded.get('status') or 'vazio'}, "
            f"e a conclusão é o status {COMPLETED_STATUS}."
        )
    return loaded


async def analyze(context) -> dict[str, Any]:
    row = context.results.get("project")
    if not row:
        raise StepFailed("O projeto não foi carregado.")

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
        raise StepFailed("A análise não foi executada.")

    relevant = [check for check in analysis.checks if check.key in CLOSING_CHECKS]
    outstanding = [
        {"key": check.key, "status": check.status.value, "message": check.message}
        for check in relevant
        if check.status.value != "ok"
    ]

    row = context.results.get("project") or {}
    publication = {
        "editorial_status": row.get("editorial_status"),
        "published": row.get("editorial_status") == "PUBLISHED",
    }

    checklist = {
        "checked": len(relevant),
        "cleared": len(relevant) - len(outstanding),
        "outstanding": outstanding,
        "publication": publication,
        "ready_to_close": not outstanding,
    }

    context.results["checklist"] = checklist
    return checklist


async def review_financial(context) -> dict[str, Any]:
    """What the ledger says about this project. Never writes.

    Read through the project and through the opportunity it was opened from
    (its handoff), since a won deal's receivables are recorded before the
    project exists.
    """
    if not await context.can(FINANCE_READ):
        raise StepSkipped("Sem permissão para ler o financeiro (finance.read).")

    row = context.results.get("project") or {}
    project_id = str(row.get("id") or "")

    try:
        handoff = await context.supabase.get_handoff_for_project(project_id)
        entries = await context.supabase.list_transactions_for(
            project_id=project_id,
            opportunity_id=(handoff or {}).get("opportunity_id"),
        )
    except SupabaseError as error:
        raise StepFailed("Não foi possível ler o financeiro do projeto.") from error

    review = finance_review(entries, today=business_today(get_settings().app_timezone))
    context.results["finance_review"] = review
    return review


async def build_cms_candidate(context) -> dict[str, Any]:
    row = context.results.get("project") or {}
    analysis = context.results.get("analysis")
    if not analysis:
        raise StepFailed("A análise não foi executada.")

    readiness = cms_candidate(row, analysis)
    context.results["cms_candidate"] = readiness
    return readiness


async def summarise(context) -> dict[str, Any]:
    row = context.results.get("project") or {}
    analysis = context.results.get("analysis")
    checklist = context.results.get("checklist") or {}
    finance = context.results.get("finance_review") or {}
    cms = context.results.get("cms_candidate") or {}

    summary = {
        "project_id": row.get("id"),
        "case_number": row.get("case_number"),
        "name": row.get("name"),
        "score": analysis.score if analysis else None,
        "ready_to_close": checklist.get("ready_to_close"),
        "outstanding": len(checklist.get("outstanding", [])),
        # Status words only: amounts stay in the finance step, which the API
        # hides from members who cannot read the ledger.
        "finance_status": finance.get("status"),
        "cms_status": cms.get("status"),
    }

    business = completion_business_status(checklist)
    if finance.get("status") == "ATTENTION" or cms.get("status") == "ATTENTION":
        business = "ATTENTION"

    context.results["summary"] = summary
    context.results["business_status"] = business
    context.results["entities"] = {"project_id": row.get("id")}
    return summary


WORKFLOW = Workflow(
    event=EVENT,
    entity_type="project",
    permissions=(PROJECTS_EDIT,),
    description=(
        "Checklist de fechamento de um projeto que passou a Live: conteúdo, publicação, financeiro e CMS."
    ),
    steps=[
        Step(name="load_project", run=confirm_completion),
        Step(name="analyze_project", run=analyze),
        Step(name="build_checklist", run=build_checklist),
        Step(name="finance_review", run=review_financial, visible_with=FINANCE_READ),
        Step(name="cms_candidate", run=build_cms_candidate),
        Step(name="register_result", run=summarise),
    ],
)

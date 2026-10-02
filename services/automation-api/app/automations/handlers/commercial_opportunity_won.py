"""Workflow for `commercial.opportunity.won`.

Dispatched by the Admin after `winOpportunity` closed the deal (and, when the
operator asked, created the client and recorded the receivables). Opens the
project draft, records the handoff and links client and ledger to it -- in
one database transaction that is idempotent on the opportunity (see
app/business/commercial.py for who owns what).

Safe to run any number of times: a double click, a network retry, a manual
retry or "Finish closing" all converge on the same single project.
"""

from __future__ import annotations

from typing import Any

from app.automations.engine import Step, StepFailed, StepSkipped, Workflow
from app.business.commercial import (
    add_action,
    describe_rpc_error,
    flag_attention,
    load_won_opportunity,
    plan_project,
    project_slug,
    resolve_client,
)
from app.core.config import get_settings
from app.core.permissions import COMMERCIAL_EDIT, FINANCE_EDIT, FINANCE_READ, PROJECTS_CREATE
from app.services.supabase_service import SupabaseConflict, SupabaseError, SupabaseRejected
from app.utils.dates import business_today

EVENT = "commercial.opportunity.won"


async def validate_opportunity(context) -> dict[str, Any]:
    opportunity = await load_won_opportunity(context)
    return {
        "opportunity_id": opportunity.get("id"),
        "title": opportunity.get("title"),
        "stage": opportunity.get("stage"),
        "project_category": context.results.get("project_category"),
    }


async def check_client(context) -> dict[str, Any]:
    client = await resolve_client(context)
    if client is None:
        raise StepSkipped("Sem cliente vinculado; o projeto será aberto sem cliente.")
    return {"client_id": client.get("id"), "name": client.get("name"), "status": client.get("status")}


async def open_project(context) -> dict[str, Any]:
    if context.dry_run:
        return await plan_project(context)

    opportunity = context.results.get("opportunity") or {}
    # Linking ledger entries to the project is a ledger write: only for a
    # member who could make it in the Admin. Asked fresh, right before writing.
    link_finance = await context.can(FINANCE_EDIT, fresh=True)

    try:
        outcome = await context.supabase.open_project_for_opportunity(
            opportunity_id=str(opportunity.get("id")),
            category=context.results.get("project_category"),
            name=str(opportunity.get("title")).strip(),
            slug=project_slug(opportunity),
            link_finance=link_finance,
            actor_id=context.actor_id,
            run_id=context.run_id,
        )
    except SupabaseConflict as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed(
            "Outro projeto ocupou o número ou o slug ao mesmo tempo; tente novamente."
        ) from error
    except SupabaseRejected as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed(describe_rpc_error(error)) from error
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Não foi possível abrir o projeto no Supabase.") from error

    project_id = str(outcome.get("project_id") or "")
    context.results["project"] = {
        "id": project_id,
        "case_number": outcome.get("case_number"),
        "slug": outcome.get("slug"),
    }
    context.results["handoff"] = outcome

    add_action(
        context,
        action="project.create",
        status="executed" if outcome.get("project_created") else "skipped",
        target="projects",
        entity_id=project_id,
        reason=None if outcome.get("project_created") else "Esta oportunidade já tinha projeto.",
        fields={"case_number": outcome.get("case_number"), "slug": outcome.get("slug")},
    )
    if outcome.get("client_linked"):
        add_action(context, action="client.link", status="executed", target="projects", entity_id=project_id)
    if link_finance:
        linked = int(outcome.get("transactions_linked") or 0)
        add_action(
            context,
            action="finance.link",
            status="executed" if linked else "skipped",
            target="financial_transactions",
            entity_id=project_id,
            reason=None if linked else "Nenhum lançamento pendente de vínculo.",
            fields={"linked": linked},
        )
    else:
        add_action(
            context,
            action="finance.link",
            status="skipped",
            target="financial_transactions",
            reason="Sem permissão para editar o financeiro (finance.edit).",
        )

    return {
        "project_id": project_id,
        "case_number": outcome.get("case_number"),
        "project_created": bool(outcome.get("project_created")),
        "client_linked": bool(outcome.get("client_linked")),
        "transactions_linked": int(outcome.get("transactions_linked") or 0),
    }


async def review_financial(context) -> dict[str, Any]:
    """Whether the deal's receivables exist. Never creates one: the amounts
    are the operator's call, made in the win dialog."""
    if not await context.can(FINANCE_READ):
        raise StepSkipped("Sem permissão para ler o financeiro (finance.read).")

    opportunity = context.results.get("opportunity") or {}
    try:
        entries = await context.supabase.list_transactions_for(opportunity_id=str(opportunity.get("id")))
    except SupabaseError as error:
        raise StepFailed("Não foi possível ler o financeiro da oportunidade.") from error

    live = [
        entry for entry in entries if entry.get("status") != "CANCELLED" and entry.get("type") == "INCOME"
    ]
    today = business_today(get_settings().app_timezone).isoformat()
    overdue = [
        entry
        for entry in live
        if entry.get("status") == "PENDING" and str(entry.get("due_date") or "") < today
    ]

    if not live:
        flag_attention(context, "Nenhum recebível registrado para esta oportunidade.")

    review = {
        "status": "NONE" if not live else ("ATTENTION" if overdue else "READY"),
        "receivables": len(live),
        "overdue": len(overdue),
        "linked_to_project": sum(1 for entry in live if entry.get("project_id")),
    }
    context.results["finance_review"] = review
    return review


async def register_handoff(context) -> dict[str, Any]:
    opportunity = context.results.get("opportunity") or {}
    client = context.results.get("client") or {}
    project = context.results.get("project") or {}
    finance = context.results.get("finance_review") or {}
    warnings = context.results.get("warnings") or []

    summary = {
        "opportunity_id": opportunity.get("id"),
        "client_id": client.get("id"),
        "project_id": project.get("id"),
        "case_number": project.get("case_number"),
        "finance_status": finance.get("status"),
        "warnings": warnings,
        "dry_run": context.dry_run,
    }
    context.results["summary"] = summary
    context.results["entities"] = {
        "opportunity_id": opportunity.get("id"),
        "client_id": client.get("id"),
        "project_id": project.get("id"),
    }
    context.results["business_status"] = "ATTENTION" if warnings else "SUCCESS"
    return summary


WORKFLOW = Workflow(
    event=EVENT,
    entity_type="opportunity",
    # Opening a project is creating one; the handoff is a commercial write.
    permissions=(COMMERCIAL_EDIT, PROJECTS_CREATE),
    writes=True,
    description=(
        "Abre o projeto de uma oportunidade ganha, registra o handoff e vincula cliente e financeiro."
    ),
    steps=[
        Step(name="validate_opportunity", run=validate_opportunity),
        Step(name="resolve_client", run=check_client),
        Step(name="open_project", run=open_project),
        Step(name="review_financial", run=review_financial, visible_with=FINANCE_READ),
        Step(name="register_handoff", run=register_handoff),
    ],
)

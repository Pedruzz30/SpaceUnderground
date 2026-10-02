"""Workflow for `commercial.proposal.accepted`.

Turns an accepted commercial proposal into an operational project draft. This is
the first workflow in the codebase that performs a business write, so every
write is both planned and constrained: one project draft, created only from a
real proposal, client and service, and idempotent through `projects.proposal_id`.
"""

from __future__ import annotations

from typing import Any

from app.automations.engine import Step, StepFailed, StepSkipped, Workflow
from app.business.commercial import (
    finance_context_for_proposal,
    load_required_proposal,
    prepare_or_create_project,
    resolve_required_client,
    resolve_required_plan,
    summarise_handoff,
)

EVENT = "commercial.proposal.accepted"


def _proposal_id(context) -> str:
    identifier = str(context.entity_id or context.payload.get("proposal_id") or "").strip()
    if not identifier:
        raise StepFailed("No commercial proposal identifier was supplied.")
    return identifier


async def validate_proposal(context) -> dict[str, Any]:
    proposal = await load_required_proposal(context, _proposal_id(context))
    return {
        "proposal_id": proposal.get("id"),
        "proposal_number": proposal.get("proposal_number"),
        "status": proposal.get("status"),
        "project_category": proposal.get("project_category"),
    }


async def resolve_client(context) -> dict[str, Any]:
    proposal = context.results.get("proposal")
    if not proposal:
        raise StepFailed("The commercial proposal was not loaded.")

    client = await resolve_required_client(context, str(proposal.get("client_id") or ""))
    return {"client_id": client.get("id"), "name": client.get("name"), "status": client.get("status")}


async def resolve_service(context) -> dict[str, Any]:
    proposal = context.results.get("proposal")
    if not proposal:
        raise StepFailed("The commercial proposal was not loaded.")

    plan = await resolve_required_plan(context, str(proposal.get("plan_id") or ""))
    return {"plan_id": plan.get("id"), "name": plan.get("name"), "status": plan.get("status")}


async def prepare_project(context) -> dict[str, Any]:
    return await prepare_or_create_project(context)


async def prepare_financial_context(context) -> dict[str, Any]:
    finance = finance_context_for_proposal(context)
    raise StepSkipped(finance["reason"])


async def register_handoff(context) -> dict[str, Any]:
    return summarise_handoff(context)


WORKFLOW = Workflow(
    event=EVENT,
    steps=[
        Step(name="validate_proposal", run=validate_proposal),
        Step(name="resolve_client", run=resolve_client),
        Step(name="resolve_service", run=resolve_service),
        Step(name="prepare_project", run=prepare_project),
        Step(name="prepare_financial_context", run=prepare_financial_context),
        Step(name="register_handoff", run=register_handoff),
    ],
)

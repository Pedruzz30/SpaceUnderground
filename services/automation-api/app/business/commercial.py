"""Commercial handoff rules.

The functions here never guess missing business data. If a proposal does not
carry the fields required to open an operational project, the workflow reports
ATTENTION/FAILED and stops before writing anything.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.automations.engine import StepFailed
from app.services.project_analysis_service import VALID_CATEGORIES
from app.services.supabase_service import ProjectNotFound, SupabaseConflict, SupabaseError

ACCEPTED_STATUS = "ACCEPTED"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def fail_attention(context, message: str) -> None:
    context.results["business_status"] = "ATTENTION"
    raise StepFailed(message)


def add_action(
    context,
    *,
    action: str,
    status: str,
    target: str,
    entity_id: str | None = None,
    reason: str | None = None,
    fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record = {
        "action": action,
        "status": status,
        "target": target,
        "entity_id": entity_id,
        "dry_run": context.dry_run,
    }
    if reason:
        record["reason"] = reason
    if fields:
        record["fields"] = fields

    context.results.setdefault("actions", []).append(record)
    return record


def require_accepted_proposal(context, proposal: dict[str, Any]) -> dict[str, Any]:
    if proposal.get("status") != ACCEPTED_STATUS:
        fail_attention(context, "Commercial proposal is not ACCEPTED.")

    missing = [
        key
        for key in ("client_id", "plan_id", "title", "project_category")
        if not _text(proposal.get(key))
    ]
    if missing:
        fail_attention(context, "Accepted proposal is missing required field(s): " + ", ".join(missing) + ".")

    category = _text(proposal.get("project_category"))
    if category not in VALID_CATEGORIES:
        fail_attention(context, "Accepted proposal has an unsupported project category: " + category + ".")

    return proposal


def require_active_client(context, client: dict[str, Any]) -> dict[str, Any]:
    if _text(client.get("status")) == "ARCHIVED":
        fail_attention(context, "Accepted proposal references an archived client.")
    if not _text(client.get("name")):
        fail_attention(context, "Accepted proposal references a client without a name.")
    return client


def require_available_plan(context, plan: dict[str, Any]) -> dict[str, Any]:
    if not _text(plan.get("name")):
        fail_attention(context, "Accepted proposal references a service without a name.")
    if _text(plan.get("status")) == "ARCHIVED":
        fail_attention(context, "Accepted proposal references an archived service.")
    return plan


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "accepted-proposal"


def draft_project_payload(
    *,
    proposal: dict[str, Any],
    client: dict[str, Any],
    plan: dict[str, Any],
    case_number: int,
) -> dict[str, Any]:
    proposal_number = _text(proposal.get("proposal_number")) or str(proposal.get("id"))
    title = _text(proposal.get("title"))
    client_name = _text(client.get("company")) or _text(client.get("name"))

    return {
        "case_number": case_number,
        "name": title,
        "slug": slugify(f"{proposal_number}-{title}"),
        "client": client_name,
        "category": _text(proposal.get("project_category")),
        "status": "In Development",
        "editorial_status": "DRAFT",
        "featured": False,
        "visible": False,
        "description": None,
        "tech_stack": [],
        "_proposal_id": proposal.get("id"),
    }


async def load_required_proposal(context, proposal_id: str) -> dict[str, Any]:
    try:
        proposal = await context.supabase.get_commercial_proposal(proposal_id)
    except ProjectNotFound:
        fail_attention(context, "Commercial proposal not found: " + proposal_id)
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Could not read the commercial proposal from Supabase.") from error

    context.results["proposal"] = require_accepted_proposal(context, proposal)
    return proposal


async def resolve_required_client(context, client_id: str) -> dict[str, Any]:
    try:
        client = await context.supabase.get_client(client_id)
    except ProjectNotFound:
        fail_attention(context, "Client not found: " + client_id)
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Could not read the client from Supabase.") from error

    context.results["client"] = require_active_client(context, client)
    return client


async def resolve_required_plan(context, plan_id: str) -> dict[str, Any]:
    try:
        plan = await context.supabase.get_plan(plan_id)
    except ProjectNotFound:
        fail_attention(context, "Service plan not found: " + plan_id)
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Could not read the service plan from Supabase.") from error

    context.results["plan"] = require_available_plan(context, plan)
    return plan


async def prepare_or_create_project(context) -> dict[str, Any]:
    proposal = context.results.get("proposal") or {}
    client = context.results.get("client") or {}
    plan = context.results.get("plan") or {}
    proposal_id = _text(proposal.get("id"))

    try:
        existing = await context.supabase.get_project_by_proposal(proposal_id)
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Could not check for an existing project from this proposal.") from error

    if existing:
        action = add_action(
            context,
            action="project.create",
            status="skipped",
            target="projects",
            entity_id=str(existing.get("id")),
            reason="A project already exists for this proposal.",
            fields={"proposal_id": proposal_id},
        )
        context.results["project"] = existing
        context.results["business_status"] = "SUCCESS"
        return action

    draft_slug = slugify(
        f"{_text(proposal.get('proposal_number')) or proposal_id}-{_text(proposal.get('title'))}"
    )
    try:
        existing_by_slug = await context.supabase.get_project_by_slug(draft_slug)
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Could not check for an existing project slug from this proposal.") from error

    if existing_by_slug:
        action = add_action(
            context,
            action="project.create",
            status="skipped",
            target="projects",
            entity_id=str(existing_by_slug.get("id")),
            reason="A project already exists for this proposal slug.",
            fields={"slug": draft_slug},
        )
        context.results["project"] = existing_by_slug
        context.results["business_status"] = "SUCCESS"
        return action

    try:
        case_number = await context.supabase.next_project_case_number()
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Could not allocate the next project case number.") from error

    draft = draft_project_payload(proposal=proposal, client=client, plan=plan, case_number=case_number)
    context.results["planned_project"] = draft

    if context.dry_run:
        context.results["business_status"] = "SUCCESS"
        return add_action(
            context,
            action="project.create",
            status="planned",
            target="projects",
            fields={
                "case_number": draft["case_number"],
                "slug": draft["slug"],
                "category": draft["category"],
                "proposal_id": proposal_id,
            },
        )

    try:
        created = await context.supabase.create_project_from_proposal(draft)
    except SupabaseConflict as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Project creation conflicted with an existing unique project field.") from error
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Could not create the project draft in Supabase.") from error

    context.results["project"] = created
    context.results["business_status"] = "SUCCESS"
    return add_action(
        context,
        action="project.create",
        status="executed",
        target="projects",
        entity_id=str(created.get("id")),
        fields={
            "case_number": created.get("case_number") or draft["case_number"],
            "slug": created.get("slug") or draft["slug"],
            "category": created.get("category") or draft["category"],
            "proposal_id": proposal_id,
        },
    )


def finance_context_for_proposal(context) -> dict[str, Any]:
    proposal = context.results.get("proposal") or {}
    finance = {
        "status": "SKIPPED",
        "reason": "No real financial ledger table exists in this phase.",
        "amount": proposal.get("amount"),
        "currency": proposal.get("currency"),
        "payment_terms": proposal.get("payment_terms"),
    }
    context.results["finance_context"] = finance
    return finance


def summarise_handoff(context) -> dict[str, Any]:
    proposal = context.results.get("proposal") or {}
    client = context.results.get("client") or {}
    plan = context.results.get("plan") or {}
    project = context.results.get("project") or context.results.get("planned_project") or {}

    summary = {
        "proposal_id": proposal.get("id"),
        "proposal_number": proposal.get("proposal_number"),
        "client_id": client.get("id"),
        "client_name": client.get("name"),
        "plan_id": plan.get("id"),
        "plan_name": plan.get("name"),
        "project_id": project.get("id"),
        "case_number": project.get("case_number"),
        "dry_run": context.dry_run,
        "finance_status": (context.results.get("finance_context") or {}).get("status"),
    }
    context.results["summary"] = summary
    context.results["entities"] = {
        "proposal_id": proposal.get("id"),
        "client_id": client.get("id"),
        "plan_id": plan.get("id"),
        "project_id": project.get("id"),
    }
    return summary

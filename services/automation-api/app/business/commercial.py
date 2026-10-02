"""Commercial handoff rules, on the current pipeline (`commercial_opportunities`).

Who does what when a deal is won -- one owner per responsibility:

  Admin, synchronously, in the win dialog (commercial-service.winOpportunity)
    - moves the opportunity to WON
    - creates or reuses the client, when the operator asks
    - records the receivables, with the amounts the operator confirms

  This workflow, afterwards (`commercial.opportunity.won`)
    - opens the project draft for the deal, once
    - records the handoff (opportunity -> project)
    - links the client and the deal's receivables to that project
    - writes the activity log entry
    - reports what is still missing (no client, no receivable)

The workflow never creates a client or a receivable and never changes an
amount: those are the operator's decisions and the Admin already makes them,
with its own recovery for a retried win. Two systems doing the same job is
how a deal ends up with two clients.

Nothing here guesses business data. The project's category is chosen by the
operator in the win dialog; without it the workflow stops before writing.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.automations.engine import StepFailed
from app.services.project_analysis_service import VALID_CATEGORIES
from app.services.supabase_service import (
    RecordNotFound,
    SupabaseError,
    SupabaseRejected,
)

WON_STAGE = "WON"

# SQLSTATEs raised by public.automation_open_project_for_opportunity.
RPC_ERRORS = {
    "AU001": "A oportunidade não existe mais.",
    "AU002": "A oportunidade não está ganha (WON); reabra o fechamento no Comercial.",
    "AU003": "Os dados do projeto são inválidos (nome, slug ou categoria).",
    "42501": "A função de handoff só aceita o serviço de automação.",
}


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


def flag_attention(context, message: str) -> None:
    """Something is missing but nothing is broken: the run goes on."""
    context.results.setdefault("warnings", []).append(message)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized.lower()).strip("-")
    return slug[:60].strip("-") or "projeto"


def project_slug(opportunity: dict[str, Any]) -> str:
    """Readable and unique enough: the title plus the deal's own id prefix.

    The database still resolves a collision (it appends a suffix), so this is
    a good first guess rather than a uniqueness guarantee.
    """
    suffix = str(opportunity.get("id") or "")[:8]
    return f"{slugify(_text(opportunity.get('title')))}-{suffix}".strip("-")


def opportunity_id(context) -> str:
    identifier = str(context.entity_id or context.payload.get("opportunity_id") or "").strip()
    if not identifier:
        raise StepFailed("Nenhum identificador de oportunidade foi informado.")
    return identifier


async def load_won_opportunity(context) -> dict[str, Any]:
    identifier = opportunity_id(context)
    try:
        opportunity = await context.supabase.get_opportunity(identifier)
    except RecordNotFound:
        fail_attention(context, f"Oportunidade não encontrada: {identifier}.")
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Não foi possível ler a oportunidade no Supabase.") from error

    if opportunity.get("stage") != WON_STAGE:
        fail_attention(
            context,
            f"A oportunidade não está ganha (etapa {opportunity.get('stage') or 'vazia'}); "
            "o projeto só é aberto para um negócio fechado.",
        )
    if not _text(opportunity.get("title")):
        fail_attention(context, "A oportunidade não tem título para nomear o projeto.")

    category = _text(context.payload.get("project_category"))
    if not category:
        fail_attention(context, "Escolha a categoria do projeto no fechamento da oportunidade.")
    if category not in VALID_CATEGORIES:
        fail_attention(context, f"Categoria de projeto não suportada: {category}.")

    context.results["opportunity"] = opportunity
    context.results["project_category"] = category
    return opportunity


async def resolve_client(context) -> dict[str, Any] | None:
    """The client the Admin linked to the deal, if any. Never creates one."""
    opportunity = context.results.get("opportunity") or {}
    client_id = _text(opportunity.get("client_id"))
    if not client_id:
        flag_attention(
            context, "A oportunidade não tem cliente vinculado; conclua o fechamento no Comercial."
        )
        return None

    try:
        client = await context.supabase.get_client(client_id)
    except RecordNotFound:
        flag_attention(context, "O cliente vinculado à oportunidade não existe mais.")
        return None
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Não foi possível ler o cliente no Supabase.") from error

    if client.get("status") == "ARCHIVED":
        flag_attention(context, "O cliente vinculado está arquivado.")

    context.results["client"] = client
    return client


def describe_rpc_error(error: SupabaseRejected) -> str:
    return RPC_ERRORS.get(error.code, "O banco recusou a abertura do projeto.")


async def plan_project(context) -> dict[str, Any]:
    """Dry run: what would happen, with no write at all."""
    opportunity = context.results.get("opportunity") or {}
    identifier = str(opportunity.get("id") or "")

    try:
        handoff = await context.supabase.get_handoff_for_opportunity(identifier)
    except SupabaseError as error:
        context.results["business_status"] = "ATTENTION"
        raise StepFailed("Não foi possível verificar se o projeto já foi aberto.") from error

    if handoff:
        return add_action(
            context,
            action="project.create",
            status="skipped",
            target="projects",
            entity_id=str(handoff.get("project_id")),
            reason="Esta oportunidade já tem projeto.",
        )

    return add_action(
        context,
        action="project.create",
        status="planned",
        target="projects",
        fields={
            "name": _text(opportunity.get("title")),
            "slug": project_slug(opportunity),
            "category": context.results.get("project_category"),
            "editorial_status": "DRAFT",
            "visible": False,
        },
    )

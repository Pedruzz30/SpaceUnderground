"""Project rules shared by the project workflows and jobs."""

from __future__ import annotations

from datetime import date
from typing import Any

from app.automations.engine import StepFailed
from app.services.supabase_service import RecordNotFound, SupabaseError

# The status that means "delivered" in this schema. Projects have no
# COMPLETED state and no completion date: `status` is the delivery axis
# (In Development, Pilot, MVP, Prototype, Research -> Live) and
# `editorial_status` is the publication axis (DRAFT/PUBLISHED/ARCHIVED).
# A project is complete when its persisted status becomes Live.
COMPLETED_STATUS = "Live"

CMS_CHECKS = (
    "description",
    "poster",
    "modules",
    "presentation",
    "translations_en",
    "publication_consistency",
)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


async def load_project(context) -> dict[str, Any]:
    """Loads the project the run is about, from the database.

    Always the stored row, never the dispatch payload: what gets checked is
    what was persisted, not what the browser believed it sent.
    """
    identifier = str(context.entity_id or context.payload.get("project_id") or "").strip()
    if not identifier:
        raise StepFailed("Nenhum identificador de projeto foi informado.")

    try:
        row = await context.supabase.get_project(identifier)
    except RecordNotFound as error:
        raise StepFailed(f"Projeto não encontrado: {identifier}.") from error
    except SupabaseError as error:
        raise StepFailed("Não foi possível ler o projeto no Supabase.") from error

    context.results["project"] = row
    return {
        "project_id": row.get("id"),
        "case_number": row.get("case_number"),
        "name": row.get("name"),
        "status": row.get("status"),
        "editorial_status": row.get("editorial_status"),
    }


def completion_business_status(checklist: dict[str, Any]) -> str:
    return "SUCCESS" if checklist.get("ready_to_close") else "ATTENTION"


def cms_candidate(project: dict[str, Any], analysis: Any) -> dict[str, Any]:
    if _text(project.get("editorial_status")) == "ARCHIVED" or _text(project.get("status")) == "Archived":
        return {
            "status": "NOT_ELIGIBLE",
            "reason": "Projetos arquivados não são candidatos ao CMS.",
            "missing": [],
        }

    checks = [check for check in getattr(analysis, "checks", []) if check.key in CMS_CHECKS]
    missing = [
        {"key": check.key, "status": check.status.value, "message": check.message}
        for check in checks
        if check.status.value != "ok"
    ]

    return {
        "status": "READY" if not missing else "ATTENTION",
        "reason": (
            "O projeto tem o material necessário para o CMS."
            if not missing
            else "O projeto precisa de material antes de ir para o CMS."
        ),
        "missing": missing,
    }


def _amount(value: Any) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return 0.0


def finance_review(entries: list[dict[str, Any]], *, today: date) -> dict[str, Any]:
    """What the ledger says about a project, read-only.

    Overdue is computed the way the Admin computes it (financial-metrics.js):
    PENDING with a due date before today. CANCELLED entries count nowhere.
    """
    live = [entry for entry in entries if entry.get("status") != "CANCELLED"]
    income = [entry for entry in live if entry.get("type") == "INCOME"]
    pending = [entry for entry in income if entry.get("status") == "PENDING"]
    overdue = [entry for entry in pending if str(entry.get("due_date") or "") < today.isoformat()]
    paid = [entry for entry in income if entry.get("status") == "PAID"]

    if not income:
        status = "NONE"
        reason = "Nenhum recebível vinculado a este projeto."
    elif overdue:
        status = "ATTENTION"
        reason = "Há recebíveis vencidos vinculados a este projeto."
    elif pending:
        status = "PENDING"
        reason = "Há recebíveis em aberto, dentro do prazo."
    else:
        status = "READY"
        reason = "Todos os recebíveis vinculados estão pagos."

    return {
        "status": status,
        "reason": reason,
        "receivables": len(income),
        "paid": len(paid),
        "pending": len(pending),
        "pending_amount": round(sum(_amount(entry.get("amount")) for entry in pending), 2),
        "overdue": len(overdue),
        "overdue_amount": round(sum(_amount(entry.get("amount")) for entry in overdue), 2),
    }

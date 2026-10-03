"""Scheduled jobs: the first autonomous automations.

A job is a workflow with no triggering event: something on a schedule asks
"is anything wrong right now?" and the answer is recorded as a run, exactly
like an event-driven one -- same engine, same history, same retry.

This phase is a copilot, not an actor. Every job here only

    detects  -> reads the current data
    records  -> the run, with what it found
    signals  -> business_status ATTENTION when something needs a person

and never sends a message, charges anyone or changes a record. Acting on a
signal is still a human decision; doing it automatically is the next phase,
and it will be a deliberate change, not a side effect of these.

Only jobs over data that really exists are registered. Projects have no
deadline or next-action field, so there is no "overdue project" job: the
project job checks what the schema can answer (published cases whose stored
record is incoherent).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from app.automations.engine import Step, StepFailed, Workflow
from app.core.config import get_settings
from app.core.permissions import COMMERCIAL_READ, FINANCE_READ, PROJECTS_READ
from app.schemas.common import AnalysisStatus
from app.services.project_analysis_service import analyze_project
from app.services.supabase_service import SupabaseError
from app.utils.dates import business_today

# How many items a job names in its result. The count is always complete.
ITEM_LIMIT = 20


def _today() -> date:
    return business_today(get_settings().app_timezone)


def _days_between(earlier: str, today: date) -> int | None:
    try:
        return (today - date.fromisoformat(str(earlier)[:10])).days
    except ValueError:
        return None


def _amount(value: Any) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return 0.0


def _signal(context, *, count: int, kind: str, detail: dict[str, Any]) -> dict[str, Any]:
    summary = {"job": context.entity_id, "kind": kind, "signals": count, **detail}
    context.results["summary"] = summary
    context.results["business_status"] = "ATTENTION" if count else "SUCCESS"
    return summary


# -- financial.overdue_check ----------------------------------------------------


async def scan_overdue_receivables(context) -> dict[str, Any]:
    today = _today()
    try:
        rows = await context.supabase.list_overdue_receivables(today.isoformat())
    except SupabaseError as error:
        raise StepFailed("Não foi possível ler o financeiro.") from error

    items = [
        {
            "transaction_id": row.get("id"),
            "description": row.get("description"),
            "amount": _amount(row.get("amount")),
            "due_date": row.get("due_date"),
            "days_overdue": _days_between(row.get("due_date"), today),
            "client_id": row.get("client_id"),
            "project_id": row.get("project_id"),
        }
        for row in rows
    ]
    found = {
        "date": today.isoformat(),
        "count": len(items),
        "total": round(sum(item["amount"] for item in items), 2),
        "oldest_days": max((item["days_overdue"] or 0 for item in items), default=0),
        "items": items[:ITEM_LIMIT],
    }
    context.results["scan"] = found
    return found


async def signal_overdue_receivables(context) -> dict[str, Any]:
    found = context.results.get("scan") or {}
    return _signal(
        context, count=found.get("count", 0), kind="financial.overdue", detail={"date": found.get("date")}
    )


# -- commercial.follow_up_check -------------------------------------------------


async def scan_follow_ups(context) -> dict[str, Any]:
    today = _today()
    try:
        rows = await context.supabase.list_open_opportunities_due_before(today.isoformat())
    except SupabaseError as error:
        raise StepFailed("Não foi possível ler a pipeline comercial.") from error

    items = [
        {
            "opportunity_id": row.get("id"),
            "title": row.get("title"),
            "stage": row.get("stage"),
            "priority": row.get("priority"),
            "next_action": row.get("next_action"),
            "next_action_at": row.get("next_action_at"),
            "days_overdue": _days_between(row.get("next_action_at"), today),
        }
        for row in rows
    ]
    found = {"date": today.isoformat(), "count": len(items), "items": items[:ITEM_LIMIT]}
    context.results["scan"] = found
    return found


async def signal_follow_ups(context) -> dict[str, Any]:
    found = context.results.get("scan") or {}
    return _signal(
        context, count=found.get("count", 0), kind="commercial.follow_up", detail={"date": found.get("date")}
    )


# -- projects.health_check ------------------------------------------------------


async def scan_published_projects(context) -> dict[str, Any]:
    try:
        rows = await context.supabase.list_projects()
    except SupabaseError as error:
        raise StepFailed("Não foi possível ler os projetos.") from error

    published = [row for row in rows if row.get("editorial_status") == "PUBLISHED"]
    items = []
    for row in published:
        analysis = analyze_project(row)
        if analysis.status is AnalysisStatus.INCOMPLETE:
            items.append(
                {
                    "project_id": row.get("id"),
                    "case_number": row.get("case_number"),
                    "name": row.get("name"),
                    "score": analysis.score,
                    "failed_checks": [check.key for check in analysis.checks if check.status.value == "fail"],
                }
            )

    found = {"checked": len(published), "count": len(items), "items": items[:ITEM_LIMIT]}
    context.results["scan"] = found
    return found


async def signal_project_health(context) -> dict[str, Any]:
    found = context.results.get("scan") or {}
    return _signal(
        context,
        count=found.get("count", 0),
        kind="projects.incoherent",
        detail={"checked": found.get("checked")},
    )


def _job(name: str, *, description: str, visible_with: str, scan, signal) -> Workflow:
    return Workflow(
        event=f"job.{name}",
        entity_type="job",
        description=description,
        visible_with=visible_with,
        steps=[
            Step(name="scan", run=scan, timeout=30.0, visible_with=visible_with),
            Step(name="register_signal", run=signal, visible_with=visible_with),
        ],
    )


JOBS: dict[str, Workflow] = {
    "financial.overdue_check": _job(
        "financial.overdue_check",
        description="Recebíveis pendentes com vencimento anterior a hoje.",
        visible_with=FINANCE_READ,
        scan=scan_overdue_receivables,
        signal=signal_overdue_receivables,
    ),
    "commercial.follow_up_check": _job(
        "commercial.follow_up_check",
        description="Oportunidades abertas cuja próxima ação já venceu.",
        visible_with=COMMERCIAL_READ,
        scan=scan_follow_ups,
        signal=signal_follow_ups,
    ),
    "projects.health_check": _job(
        "projects.health_check",
        description="Projetos publicados cujo registro salvo tem falhas operacionais.",
        visible_with=PROJECTS_READ,
        scan=scan_published_projects,
        signal=signal_project_health,
    ),
}


def job_names() -> tuple[str, ...]:
    return tuple(sorted(JOBS))


def get_job(name: str) -> Workflow | None:
    return JOBS.get(name)

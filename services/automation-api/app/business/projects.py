"""Business readiness derived from project analysis."""

from __future__ import annotations

from typing import Any

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


def completion_business_status(checklist: dict[str, Any]) -> str:
    return "SUCCESS" if checklist.get("ready_to_close") else "ATTENTION"


def finance_readiness_for_project() -> dict[str, Any]:
    return {
        "status": "SKIPPED",
        "reason": "No real financial ledger table exists in this phase.",
    }


def cms_candidate(project: dict[str, Any], analysis: Any) -> dict[str, Any]:
    if _text(project.get("editorial_status")) == "ARCHIVED" or _text(project.get("status")) == "Archived":
        return {
            "status": "NOT_ELIGIBLE",
            "reason": "Archived projects are not CMS publication candidates.",
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
            "Project has the required CMS material."
            if not missing
            else "Project needs CMS material before publication."
        ),
        "missing": missing,
    }

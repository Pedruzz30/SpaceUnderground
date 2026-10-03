"""Operational reporting over the project catalogue.

Every number here is counted from rows that were actually read. Nothing is
estimated, and a metric that the current schema cannot answer is not reported
at all -- a zero that means "unknown" is worse than a missing field.

The aggregation is a pure function of the rows, so the rules are tested with
fixtures and never need a database.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.schemas.report import (
    ContentCounts,
    FreshnessCounts,
    OverviewReport,
    ProjectCounts,
    TranslationCounts,
)
from app.utils.dates import days_since, isoformat, utc_now

FRESH_WITHIN_DAYS = 30
STALE_AFTER_DAYS = 180


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _has_english(row: dict[str, Any]) -> bool:
    """Whether the row carries any English translation at all.

    Deliberately coarser than the per-field coverage in the analysis: this is a
    catalogue-level count, not a completeness score.
    """
    translations = row.get("translations")
    if not isinstance(translations, dict):
        return False

    english = translations.get("en")
    if not isinstance(english, dict):
        return False

    return any(_text(value) for value in english.values())


def build_overview(rows: list[dict[str, Any]], *, now: datetime | None = None) -> OverviewReport:
    """Aggregates the catalogue into the operations overview."""
    reference = now or utc_now()

    projects = ProjectCounts(
        total=len(rows),
        published=sum(1 for row in rows if row.get("editorial_status") == "PUBLISHED"),
        draft=sum(1 for row in rows if row.get("editorial_status") == "DRAFT"),
        archived=sum(1 for row in rows if row.get("editorial_status") == "ARCHIVED"),
        visible=sum(1 for row in rows if row.get("visible") is True),
        featured=sum(1 for row in rows if row.get("featured") is True),
    )

    content = ContentCounts(
        with_poster=sum(1 for row in rows if _text(row.get("poster_url"))),
        with_description=sum(1 for row in rows if _text(row.get("description"))),
        with_project_url=sum(1 for row in rows if _text(row.get("project_url"))),
        with_preview_url=sum(1 for row in rows if _text(row.get("preview_url"))),
        # The flag, not the URL: a preview_url with the flag off is not a demo.
        with_live_preview=sum(1 for row in rows if row.get("live_preview_enabled") is True),
    )

    with_english = sum(1 for row in rows if _has_english(row))
    translations = TranslationCounts(
        with_english=with_english,
        without_english=len(rows) - with_english,
    )

    ages = [days_since(row.get("updated_at"), now=reference) for row in rows]
    freshness = FreshnessCounts(
        updated_last_30_days=sum(1 for age in ages if age is not None and age <= FRESH_WITHIN_DAYS),
        stale_over_180_days=sum(1 for age in ages if age is not None and age > STALE_AFTER_DAYS),
    )

    return OverviewReport(
        generated_at=isoformat(reference),
        projects=projects,
        content=content,
        translations=translations,
        freshness=freshness,
    )

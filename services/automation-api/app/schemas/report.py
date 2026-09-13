"""Operational report shapes.

Every field is optional-by-omission rather than optional-by-null: a metric that
cannot be computed from the current schema is left out of the response instead
of being reported as zero. A zero that means "unknown" is worse than no number.
"""

from __future__ import annotations

from pydantic import BaseModel


class ProjectCounts(BaseModel):
    total: int
    published: int
    draft: int
    archived: int
    visible: int
    featured: int


class ContentCounts(BaseModel):
    with_poster: int
    with_description: int
    with_project_url: int
    with_preview_url: int
    with_live_preview: int


class TranslationCounts(BaseModel):
    with_english: int
    without_english: int


class FreshnessCounts(BaseModel):
    updated_last_30_days: int
    stale_over_180_days: int


class OverviewReport(BaseModel):
    generated_at: str
    projects: ProjectCounts
    content: ContentCounts
    translations: TranslationCounts
    freshness: FreshnessCounts

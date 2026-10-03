"""Operational reporting.

The workflow engine has its own suite in test_workflow_engine.py.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.services.reporting_service import build_overview
from tests.conftest import project_row

NOW = datetime(2026, 9, 13, tzinfo=UTC)


def catalogue():
    """Five projects with genuinely different states.

    A uniform fixture makes every count agree by accident; these are chosen so
    a wrong field would change at least one number.
    """
    return [
        project_row(),
        project_row(
            id="2",
            case_number=2,
            editorial_status="PUBLISHED",
            visible=True,
            featured=False,
            live_preview_enabled=True,
            updated_at="2026-09-10T00:00:00+00:00",
        ),
        project_row(
            id="3",
            case_number=3,
            editorial_status="DRAFT",
            visible=False,
            featured=False,
            poster_url=None,
            project_url=None,
            preview_url=None,
            live_preview_enabled=False,
            translations={},
            updated_at="2026-08-20T00:00:00+00:00",
        ),
        project_row(
            id="4",
            case_number=4,
            editorial_status="DRAFT",
            visible=False,
            featured=False,
            description=None,
            live_preview_enabled=False,
            preview_url=None,
            translations={"en": {}},
            updated_at="2024-01-01T00:00:00+00:00",
        ),
        project_row(
            id="5",
            case_number=5,
            editorial_status="ARCHIVED",
            visible=False,
            featured=False,
            live_preview_enabled=False,
            preview_url=None,
            updated_at="2026-09-12T00:00:00+00:00",
        ),
    ]


def test_overview_counts_editorial_states():
    report = build_overview(catalogue(), now=NOW)

    assert report.projects.total == 5
    assert report.projects.published == 2
    assert report.projects.draft == 2
    assert report.projects.archived == 1
    assert report.projects.visible == 2
    assert report.projects.featured == 1


def test_overview_counts_content():
    report = build_overview(catalogue(), now=NOW)

    assert report.content.with_poster == 4
    assert report.content.with_description == 4
    assert report.content.with_project_url == 4
    assert report.content.with_preview_url == 2
    assert report.content.with_live_preview == 2


def test_live_preview_counts_the_flag_and_not_the_url():
    """A URL with the flag off is not a demo, and must not be counted as one."""
    rows = [project_row(live_preview_enabled=False, preview_url="https://example.com/embed")]

    report = build_overview(rows, now=NOW)

    assert report.content.with_preview_url == 1
    assert report.content.with_live_preview == 0


def test_overview_counts_translations():
    report = build_overview(catalogue(), now=NOW)

    # Case 4 carries an empty `en` object, which is not a translation.
    assert report.translations.with_english == 3
    assert report.translations.without_english == 2


def test_overview_counts_freshness():
    report = build_overview(catalogue(), now=NOW)

    assert report.freshness.updated_last_30_days == 4
    assert report.freshness.stale_over_180_days == 1


def test_an_empty_catalogue_reports_zeroes_rather_than_failing():
    report = build_overview([], now=NOW)

    assert report.projects.total == 0
    assert report.translations.without_english == 0
    assert report.generated_at.endswith("Z")


def test_overview_endpoint_returns_real_counts(make_client):
    client, fake = make_client(catalogue())

    response = client.get("/api/v1/reports/overview")

    assert response.status_code == 200
    body = response.json()
    assert body["projects"]["total"] == 5
    assert body["content"]["with_live_preview"] == 2
    assert fake.calls == ["list_projects"]

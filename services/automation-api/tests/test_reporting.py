"""Operational reporting and the automation engine."""

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


# --- automation engine ----------------------------------------------------


def test_registered_automations_are_listed(make_client):
    client, _ = make_client([])

    response = client.get("/api/v1/automations")

    assert response.status_code == 200
    events = {item["event"]: item["handlers"] for item in response.json()}
    assert "validate_published_project" in events["project.published"]


def test_project_published_analyses_the_stored_row(make_client):
    client, fake = make_client([project_row()])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.published", "payload": {"project_id": "1"}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["handled"] is True

    result = body["results"][0]
    assert result["status"] == "ok"
    assert result["data"]["score"] == 100
    assert result["data"]["failed_checks"] == []
    # The handler reads the row back rather than trusting the payload.
    assert fake.calls == ["get_project:1"]


def test_project_published_reports_a_failing_project_without_editing_it(make_client):
    rows = [project_row(poster_url=None)]
    client, _ = make_client(rows)

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.published", "payload": {"project_id": "1"}},
    )

    result = response.json()["results"][0]
    assert result["status"] == "ok"
    assert "poster" in result["data"]["failed_checks"]
    # Nothing in this phase writes back: the row is untouched.
    assert rows[0]["poster_url"] is None


def test_a_missing_project_skips_instead_of_failing_the_request(make_client):
    client, _ = make_client([])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.published", "payload": {"project_id": "404"}},
    )

    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "skipped"


def test_a_payload_without_a_project_id_skips(make_client):
    client, _ = make_client([project_row()])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.published", "payload": {}},
    )

    assert response.json()["results"][0]["status"] == "skipped"


def test_a_known_event_with_no_handler_reports_unhandled(make_client):
    client, _ = make_client([])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "client.created", "payload": {}},
    )

    assert response.status_code == 200
    assert response.json() == {"event": "client.created", "handled": False, "results": []}


def test_an_unknown_event_is_rejected(make_client):
    """A typo must not look like a working no-op."""
    client, _ = make_client([])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.publishedd", "payload": {}},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"


def test_a_malformed_body_is_a_422(make_client):
    client, _ = make_client([])

    response = client.post("/api/v1/automations/dispatch", json={"payload": {}})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

"""Analysis rules and the /analyze endpoint."""

from __future__ import annotations

from app.services.project_analysis_service import analyze_project
from app.utils.dates import days_since, parse_timestamp
from tests.conftest import project_row


def check_for(analysis, key):
    return next(check for check in analysis.checks if check.key == key)


def test_a_complete_project_is_healthy():
    analysis = analyze_project(project_row())

    assert analysis.status.value == "healthy"
    assert analysis.score == 100
    assert analysis.warnings == []
    assert analysis.recommendations == []
    assert analysis.case_number == 1
    assert analysis.name == "Ink Lab"


def test_published_without_a_poster_is_incomplete():
    analysis = analyze_project(project_row(poster_url=None))

    assert check_for(analysis, "poster").status.value == "fail"
    assert analysis.status.value == "incomplete"
    assert analysis.score < 100
    assert "Faca upload do poster antes de publicar." in analysis.recommendations


def test_a_draft_without_a_poster_only_warns():
    """A draft is unfinished by definition; that is not a defect."""
    analysis = analyze_project(project_row(editorial_status="DRAFT", visible=False, poster_url=None))

    assert check_for(analysis, "poster").status.value == "warn"
    assert analysis.status.value == "attention"


def test_publication_and_visibility_must_agree():
    published_but_hidden = analyze_project(project_row(visible=False))
    assert check_for(published_but_hidden, "publication_consistency").status.value == "fail"

    visible_but_draft = analyze_project(project_row(editorial_status="DRAFT"))
    assert check_for(visible_but_draft, "publication_consistency").status.value == "fail"

    coherent_draft = analyze_project(project_row(editorial_status="DRAFT", visible=False))
    assert check_for(coherent_draft, "publication_consistency").status.value == "ok"


def test_demo_enabled_without_a_url_fails():
    analysis = analyze_project(project_row(preview_url=None))

    check = check_for(analysis, "live_preview")
    assert check.status.value == "fail"
    assert "sem URL" in check.message


def test_demo_enabled_with_an_unusable_url_fails():
    """A value that a browser cannot frame is worse than no value at all."""
    analysis = analyze_project(project_row(preview_url="javascript:alert(1)"))

    assert check_for(analysis, "live_preview").status.value == "fail"


def test_a_preview_url_with_the_flag_off_only_warns():
    analysis = analyze_project(project_row(live_preview_enabled=False))

    check = check_for(analysis, "live_preview")
    assert check.status.value == "warn"
    assert analysis.status.value == "attention"


def test_no_demo_at_all_is_a_valid_state():
    analysis = analyze_project(project_row(live_preview_enabled=False, preview_url=None))

    assert check_for(analysis, "live_preview").status.value == "ok"
    assert analysis.status.value == "healthy"


def test_project_url_never_stands_in_for_preview_url():
    """The demo must depend on preview_url alone, never on the external link."""
    analysis = analyze_project(
        project_row(preview_url=None, project_url="https://example.com/live")
    )

    assert check_for(analysis, "live_preview").status.value == "fail"


def test_an_invalid_project_url_fails_but_an_absent_one_does_not():
    invalid = analyze_project(project_row(project_url="not-a-url"))
    assert check_for(invalid, "project_url").status.value == "fail"

    absent = analyze_project(project_row(project_url=None))
    assert check_for(absent, "project_url").status.value == "ok"
    assert absent.status.value == "healthy"


def test_values_outside_the_schema_domain_fail():
    analysis = analyze_project(project_row(category="Banana", status="Whatever"))

    assert check_for(analysis, "category").status.value == "fail"
    assert check_for(analysis, "status").status.value == "fail"


def test_missing_english_translation_warns_with_the_real_percentage():
    """Coverage counts modules too, so clearing the project alone is partial.

    Five project fields plus this fixture module's title and description make
    seven translatable values; the module keeps its own translations here, so
    two of the seven survive.
    """
    analysis = analyze_project(project_row(translations={}))

    check = check_for(analysis, "translations_en")
    assert check.status.value == "warn"
    assert "29%" in check.message
    assert "2/7" in check.message


def test_a_project_with_nothing_translated_reports_zero():
    row = project_row(translations={})
    row["project_modules"][0]["translations"] = {}

    check = check_for(analyze_project(row), "translations_en")

    assert check.status.value == "warn"
    assert "0%" in check.message
    assert "0/7" in check.message


def test_a_module_field_that_is_empty_is_not_counted_as_translatable():
    """An empty source field has nothing to translate and must not lower the score."""
    row = project_row()
    row["project_modules"][0]["description"] = ""
    row["project_modules"][0]["translations"] = {"en": {"title": "Booking"}}

    check = check_for(analyze_project(row), "translations_en")

    assert check.status.value == "ok"


def test_a_stale_project_warns():
    analysis = analyze_project(project_row(updated_at="2020-01-01T00:00:00+00:00"))

    check = check_for(analysis, "freshness")
    assert check.status.value == "warn"
    assert "Sem atualizacao" in check.message


def test_an_unusable_updated_at_does_not_raise():
    analysis = analyze_project(project_row(updated_at="not a date"))

    assert check_for(analysis, "freshness").status.value == "warn"


def test_a_row_missing_every_optional_field_still_analyses():
    """Defensive: a partial row must produce a report, not an exception."""
    analysis = analyze_project({"id": "abc", "editorial_status": "DRAFT"})

    assert analysis.status.value == "incomplete"
    assert 0 <= analysis.score <= 100
    assert check_for(analysis, "identity").status.value == "fail"


def test_the_score_never_leaves_its_bounds():
    analysis = analyze_project({})

    assert 0 <= analysis.score <= 100


def test_dates_parse_the_z_suffix():
    assert parse_timestamp("2026-01-01T00:00:00Z") is not None
    assert parse_timestamp("garbage") is None
    assert days_since(None) is None


def test_a_future_timestamp_reads_as_zero_days():
    """Clock skew must not report a project as updated tomorrow."""
    assert days_since("2999-01-01T00:00:00Z") == 0


# --- endpoint -------------------------------------------------------------


def test_analyze_endpoint_returns_the_report(make_client):
    client, fake = make_client([project_row()])

    response = client.post("/api/v1/projects/1/analyze")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["score"] == 100
    assert body["project_id"] == "11111111-2222-3333-4444-555555555555"
    assert {"key", "status", "message"} <= set(body["checks"][0])
    assert fake.calls == ["get_project:1"]


def test_analyze_endpoint_accepts_a_uuid(make_client):
    client, _ = make_client([project_row()])

    response = client.post("/api/v1/projects/11111111-2222-3333-4444-555555555555/analyze")

    assert response.status_code == 200


def test_analyze_endpoint_reports_404_for_a_missing_project(make_client):
    client, _ = make_client([project_row()])

    response = client.post("/api/v1/projects/999/analyze")

    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "Project not found."}

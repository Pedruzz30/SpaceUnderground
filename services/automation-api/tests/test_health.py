"""Health, error handling, CORS and the behaviour with no configuration."""

from __future__ import annotations

import pytest

from app.core.config import get_settings


def test_root_health_reports_the_service(make_client):
    client, _ = make_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "space-underground-automation",
        "version": "0.1.0",
    }


def test_versioned_health_reports_dependencies(make_client):
    client, _ = make_client()

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["environment"] == "development"

    dependencies = {item["name"]: item for item in body["dependencies"]}
    # Nothing is configured in the test environment, and health says so without
    # revealing a URL or any part of a key.
    assert dependencies["supabase"]["configured"] is False
    assert "SUPABASE_URL" in dependencies["supabase"]["detail"]
    assert "://" not in dependencies["supabase"]["detail"]


def test_health_needs_no_token(make_client, monkeypatch):
    """A probe must keep working when the shared secret changes."""
    monkeypatch.setenv("API_TOKEN", "s3cret")
    get_settings.cache_clear()

    client, _ = make_client()

    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/health").status_code == 200


def test_data_endpoints_report_503_without_supabase(make_client):
    """No configuration must read as "not configured", never as an empty result."""
    client, _ = make_client(configured=False)

    report = client.get("/api/v1/reports/overview")
    assert report.status_code == 503
    assert report.json()["code"] == "not_configured"

    analysis = client.post("/api/v1/projects/1/analyze")
    assert analysis.status_code == 503
    assert analysis.json()["code"] == "not_configured"


def test_unknown_route_uses_the_error_envelope(make_client):
    client, _ = make_client()

    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "Not Found"}


def test_invalid_identifier_is_rejected_before_supabase(make_client):
    """The path pattern refuses anything that is not an id, so nothing reaches the query string."""
    client, fake = make_client([])

    response = client.post("/api/v1/projects/..%2Fetc/analyze")

    assert response.status_code in {404, 422}
    assert fake.calls == []


def test_token_is_required_when_configured(make_client, monkeypatch):
    monkeypatch.setenv("API_TOKEN", "s3cret")
    get_settings.cache_clear()

    client, _ = make_client([])

    assert client.get("/api/v1/reports/overview").status_code == 401

    with_token = client.get("/api/v1/reports/overview", headers={"X-API-Token": "s3cret"})
    assert with_token.status_code == 200

    wrong_token = client.get("/api/v1/reports/overview", headers={"X-API-Token": "nope"})
    assert wrong_token.status_code == 401


def test_production_without_a_token_fails_closed(make_client, monkeypatch):
    """Production must never serve data unauthenticated by accident."""
    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()

    client, _ = make_client([])

    response = client.get("/api/v1/reports/overview")

    assert response.status_code == 503
    assert response.json()["code"] == "not_configured"


@pytest.mark.parametrize(
    "origin,allowed",
    [
        ("http://localhost:5174", True),
        ("http://127.0.0.1:5174", True),
        # The Admin dev server binds 127.0.0.1:5173. Leaving it out of the
        # default made the browser drop every response while curl still saw
        # 200, which read as an outage rather than a CORS mistake.
        ("http://localhost:5173", True),
        ("http://127.0.0.1:5173", True),
        ("https://evil.example.com", False),
    ],
)
def test_cors_is_restricted_to_the_admin_origin(make_client, origin, allowed):
    client, _ = make_client()

    response = client.get("/health", headers={"Origin": origin})

    assert response.status_code == 200
    header = response.headers.get("access-control-allow-origin")
    assert (header == origin) is allowed
    # A wildcard would let any page on the internet read this service.
    assert header != "*"

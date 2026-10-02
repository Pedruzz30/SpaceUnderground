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


@pytest.mark.parametrize(
    "key,public",
    [
        ("sb_publishable_abc123", True),
        ("sb_secret_abc123", False),
        # Legacy keys are all "eyJ...": only the payload's role tells them apart.
        # {"role":"anon"} and {"role":"service_role"}, unsigned -- this is a
        # configuration check, not authentication.
        ("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig", True),
        ("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig", False),
        # Unrecognised shapes pass: refusing a key that turns out to be valid
        # would be a self-inflicted outage.
        ("something-else-entirely", False),
        ("eyJ-not-a-jwt", False),
        ("", False),
    ],
)
def test_a_public_key_in_the_service_role_slot_is_detected(monkeypatch, key, public):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", key)
    get_settings.cache_clear()

    assert get_settings().service_role_key_is_public is public


def test_a_public_key_makes_supabase_count_as_unconfigured(monkeypatch, make_client):
    """The symptom of a wrong key is otherwise baffling: reads work, writes do not."""
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_abc123")
    get_settings.cache_clear()

    settings = get_settings()
    assert settings.supabase_configured is False

    client, _ = make_client()
    body = client.get("/api/v1/health").json()
    supabase = next(item for item in body["dependencies"] if item["name"] == "supabase")

    assert supabase["configured"] is False
    assert "public key" in supabase["detail"]
    # The message names the variable, never the value.
    assert "sb_publishable_abc123" not in supabase["detail"]


def test_a_secret_key_counts_as_configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc123")
    get_settings.cache_clear()

    assert get_settings().supabase_configured is True


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


def test_production_without_credentials_fails_closed(make_client, monkeypatch):
    """Production must never serve data unauthenticated by accident."""
    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()

    client, _ = make_client([])

    response = client.get("/api/v1/reports/overview")

    # 401 rather than 503: the admin token path is available, the caller simply
    # presented nothing. Either way the request is refused.
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_production_with_no_mechanism_at_all_refuses(make_client, monkeypatch):
    """Turning every mechanism off must close the door, not open it."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ADMIN_JWT_AUTH", "false")
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

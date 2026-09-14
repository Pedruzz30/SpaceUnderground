"""What has to hold once this service is reachable from the internet.

Phase 4 proved the workflows. These are the properties that only start to
matter when the process is no longer on someone's laptop: who may call it, what
it refuses, what it says about itself, and what it must never say.
"""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.security import reset_identity_cache
from app.main import resolve_request_id
from app.services.supabase_service import SupabaseUnavailable

ADMIN_ID = "84c64f19-83fb-4613-a7ce-83c720c6798c"
OTHER_ID = "11111111-1111-4111-8111-111111111111"

PRODUCTION_ENV = {
    "APP_ENV": "production",
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_abc123",
    "ADMIN_ORIGIN": "https://admin.example.com",
}


@pytest.fixture
def production(monkeypatch):
    for key, value in PRODUCTION_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    reset_identity_cache()
    return monkeypatch


def identity_client(make_client, **kwargs):
    return make_client([], tokens={"good-token": ADMIN_ID, "other-token": OTHER_ID}, **kwargs)


# --- admin access token ------------------------------------------------------


def test_an_admin_access_token_is_accepted(production, make_client):
    client, fake = identity_client(make_client, admins={ADMIN_ID})

    response = client.get(
        "/api/v1/automations/runs",
        headers={"Authorization": "Bearer good-token"},
    )

    assert response.status_code == 200
    # The token was checked against Supabase rather than decoded here.
    assert "get_token_user" in fake.calls
    assert f"user_is_admin:{ADMIN_ID}" in fake.calls


def test_an_invalid_access_token_is_refused(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    response = client.get(
        "/api/v1/automations/runs",
        headers={"Authorization": "Bearer forged-token"},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_a_valid_user_who_is_not_an_admin_is_forbidden(production, make_client):
    """Authentication is not authorisation: signing in is not access."""
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    response = client.get(
        "/api/v1/automations/runs",
        headers={"Authorization": "Bearer other-token"},
    )

    # 403, not 401: the Admin can then say "your account lacks access" instead
    # of bouncing a correctly signed-in operator back to the login screen.
    assert response.status_code == 403
    assert response.json()["code"] == "error"


def test_no_credentials_at_all_is_refused_in_production(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    assert client.get("/api/v1/automations/runs").status_code == 401


def test_a_malformed_authorization_header_is_refused(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    for header in ("good-token", "Basic good-token", "Bearer", "Bearer "):
        response = client.get("/api/v1/automations/runs", headers={"Authorization": header})
        assert response.status_code == 401, header


def test_supabase_being_down_is_not_reported_as_forbidden(production, make_client):
    """A blip must not look like a permissions problem.

    Reporting 401/403 here would send an operator hunting for an access rule
    that was never wrong, so an unverifiable caller is a 503 instead.
    """
    client, _ = identity_client(
        make_client,
        admins={ADMIN_ID},
        identity_error=SupabaseUnavailable("Could not reach Supabase."),
    )

    response = client.get(
        "/api/v1/automations/runs",
        headers={"Authorization": "Bearer good-token"},
    )

    assert response.status_code == 503


def test_a_verified_identity_is_not_re_checked_on_every_call(production, make_client):
    """The Dashboard polls; verification must not cost two round trips a poll."""
    client, fake = identity_client(make_client, admins={ADMIN_ID})
    headers = {"Authorization": "Bearer good-token"}

    for _ in range(3):
        assert client.get("/api/v1/automations/runs", headers=headers).status_code == 200

    assert fake.calls.count("get_token_user") == 1


# --- service token -----------------------------------------------------------


def test_the_service_token_still_works_for_machines(production, make_client, monkeypatch):
    """CI and scripts keep a shared secret; only the browser may not."""
    monkeypatch.setenv("API_TOKEN", "s3rv1ce")
    get_settings.cache_clear()

    client, _ = identity_client(make_client, admins={ADMIN_ID})

    assert client.get("/api/v1/automations/runs", headers={"X-API-Token": "s3rv1ce"}).status_code == 200
    assert client.get("/api/v1/automations/runs", headers={"X-API-Token": "wrong"}).status_code == 401


def test_an_admin_token_still_works_when_a_service_token_exists(production, make_client, monkeypatch):
    monkeypatch.setenv("API_TOKEN", "s3rv1ce")
    get_settings.cache_clear()

    client, _ = identity_client(make_client, admins={ADMIN_ID})

    response = client.get(
        "/api/v1/automations/runs",
        headers={"Authorization": "Bearer good-token"},
    )
    assert response.status_code == 200


# --- health and readiness ----------------------------------------------------


def test_health_never_describes_a_credential(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    body = client.get("/api/v1/health").json()
    serialised = str(body)

    assert body["environment"] == "production"
    for secret in ("sb_secret_abc123", "example.supabase.co", "good-token"):
        assert secret not in serialised


def test_health_stays_open_so_a_probe_never_needs_a_secret(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/health").status_code == 200


def test_readiness_is_ready_when_configuration_and_storage_are_fine(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    response = client.get("/api/v1/ready")

    assert response.status_code == 200
    assert response.json()["ready"] is True


def test_readiness_refuses_when_history_is_unreachable(production, make_client):
    """Not ready, but still alive: the liveness probe must not go down with it."""
    client, _ = make_client([], storage=False, tokens={}, admins=set())

    response = client.get("/api/v1/ready")

    assert response.status_code == 503
    assert response.json()["ready"] is False
    assert client.get("/health").status_code == 200


def test_readiness_names_a_configuration_problem_without_values(make_client, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_abc123")
    get_settings.cache_clear()

    client, _ = make_client([])
    body = client.get("/api/v1/ready").json()

    assert body["ready"] is False
    detail = " ".join(check["detail"] or "" for check in body["checks"])
    assert "SUPABASE_SERVICE_ROLE_KEY" in detail
    assert "sb_publishable_abc123" not in detail


# --- startup -----------------------------------------------------------------


def test_production_refuses_to_start_without_structural_configuration(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    get_settings.cache_clear()

    # Entering the client runs the lifespan, which is where startup validation
    # lives; the app object itself is built without touching configuration.
    with pytest.raises(RuntimeError, match="Refusing to start"), TestClient(create_app()):
        pass


def test_production_refuses_a_localhost_origin(monkeypatch):
    """The development default must never survive into production unnoticed."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc123")
    get_settings.cache_clear()

    problems = " ".join(get_settings().startup_problems)
    assert "localhost" in problems


def test_development_starts_with_problems_and_only_warns(make_client):
    """A developer with half a configuration still gets a running service."""
    client, _ = make_client([])

    assert get_settings().startup_problems
    assert client.get("/health").status_code == 200


def test_a_temporary_outage_is_not_a_startup_problem(production):
    """Reachability is deliberately absent: a blip must not need a human."""
    problems = " ".join(get_settings().startup_problems).lower()

    assert problems == ""


# --- CORS --------------------------------------------------------------------


def test_production_cors_allows_only_the_configured_origin(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    allowed = client.options(
        "/api/v1/automations/runs",
        headers={
            "Origin": "https://admin.example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert allowed.headers.get("access-control-allow-origin") == "https://admin.example.com"

    refused = client.options(
        "/api/v1/automations/runs",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert refused.headers.get("access-control-allow-origin") is None


def test_cors_never_pairs_an_allowlist_with_credentials(production, make_client):
    client, _ = identity_client(make_client, admins={ADMIN_ID})

    response = client.get(
        "/api/v1/health",
        headers={"Origin": "https://admin.example.com"},
    )

    assert response.headers.get("access-control-allow-origin") == "https://admin.example.com"
    assert response.headers.get("access-control-allow-credentials") is None


# --- request id --------------------------------------------------------------


def test_a_request_id_is_returned_and_generated_when_absent(make_client):
    client, _ = make_client([])

    response = client.get("/health")

    assert len(response.headers.get("X-Request-ID", "")) == 32


def test_a_caller_supplied_request_id_is_echoed(make_client):
    client, _ = make_client([])

    response = client.get("/health", headers={"X-Request-ID": "deploy-2026-09-14.1"})

    assert response.headers["X-Request-ID"] == "deploy-2026-09-14.1"


def test_a_hostile_request_id_is_replaced_rather_than_echoed():
    """It is a log label, never a credential, and never a way into a log line."""
    for hostile in ("a" * 65, "bad value", "x\ny", "drop\ttable", "", None, "id;rm -rf /"):
        resolved = resolve_request_id(hostile)
        assert len(resolved) == 32
        assert resolved.isalnum()

    assert resolve_request_id("abc-123_ok:1") == "abc-123_ok:1"

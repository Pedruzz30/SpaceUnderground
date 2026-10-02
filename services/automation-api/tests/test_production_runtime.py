"""What has to hold once this service is reachable from the internet.

Who may call it, what it refuses, what it says about itself, and what it must
never say. Authorization is the database's own answer
(`public.has_permission`, asked with the member's token); the fake below
answers per member and per key the way the RBAC catalog does.
"""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.security import reset_identity_cache
from app.main import resolve_request_id
from app.services.supabase_service import SupabaseRejected, SupabaseUnavailable
from tests.conftest import BEARER, COLLABORATOR, MANAGER, MEMBER_ID, OWNER, SEO, member_client, project_row

PRODUCTION_ENV = {
    "APP_ENV": "production",
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_abc123",
    "ADMIN_ORIGIN": "https://admin.example.com",
}

PUBLISHED = {"event": "project.published", "entity_id": "1"}


@pytest.fixture
def production(monkeypatch):
    for key, value in PRODUCTION_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    reset_identity_cache()
    return monkeypatch


def healthy_project():
    return project_row(live_preview_enabled=False, preview_url=None)


# --- member access token -------------------------------------------------------


def test_a_member_with_the_permission_is_accepted(production, make_client):
    client, fake = member_client(make_client, OWNER)

    response = client.get("/api/v1/automations/runs", headers=BEARER)

    assert response.status_code == 200
    # Identity from Supabase Auth, authorization from the database itself.
    assert "get_token_user" in fake.calls
    assert "has_permission:logs.read" in fake.calls


def test_public_admins_is_never_consulted(production, make_client):
    """Since the security foundation it is history: a suspended former admin
    keeps their row there."""
    client, fake = member_client(make_client, OWNER)

    client.get("/api/v1/automations/runs", headers=BEARER)

    assert not any("admin" in call for call in fake.calls)


def test_an_invalid_access_token_is_refused(production, make_client):
    client, _ = member_client(make_client, OWNER)

    response = client.get("/api/v1/automations/runs", headers={"Authorization": "Bearer forged-token"})

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_a_signed_in_user_without_the_permission_is_forbidden(production, make_client):
    """Authentication is not authorisation: signing in is not access."""
    client, _ = member_client(make_client, COLLABORATOR)

    response = client.get("/api/v1/automations/runs", headers=BEARER)

    # 403, not 401: the Admin can then say "your account lacks access" instead
    # of bouncing a correctly signed-in member back to the login screen.
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
    assert "logs.read" in response.json()["message"]


def test_someone_who_is_not_a_member_at_all_is_forbidden(production, make_client):
    # other-token belongs to a real Supabase user with no membership: the
    # database grants them nothing.
    client, _ = member_client(make_client, OWNER)

    response = client.get("/api/v1/automations/runs", headers={"Authorization": "Bearer other-token"})

    assert response.status_code == 403


def test_each_event_needs_the_permission_of_its_effect(production, make_client):
    """project.published needs projects.publish: a member who could not publish
    cannot run the publication workflow either."""
    client, _ = member_client(make_client, {"logs.read", "projects.read"}, rows=[healthy_project()])

    response = client.post("/api/v1/automations/dispatch", json=PUBLISHED, headers=BEARER)

    assert response.status_code == 403
    assert "projects.publish" in response.json()["message"]


def test_a_member_who_may_publish_dispatches_the_publication_workflow(production, make_client):
    client, fake = member_client(make_client, SEO, rows=[healthy_project()])

    response = client.post("/api/v1/automations/dispatch", json=PUBLISHED, headers=BEARER)

    assert response.status_code == 200
    assert response.json()["status"] == "SUCCESS"
    assert response.json()["source"] == "admin"
    # The run records who asked for it.
    assert fake.runs.rows[0]["requested_by"] == MEMBER_ID
    assert response.json()["requested_by"] == MEMBER_ID


def test_mfa_or_a_revoked_session_is_decided_by_the_database(production, make_client):
    """has_permission answers false for a member whose MFA is incomplete or whose
    session was revoked; the service has no rule of its own to get wrong."""
    client, fake = member_client(make_client, OWNER)
    fake.grants[MEMBER_ID] = set()  # what the database answers for that member

    response = client.get("/api/v1/automations/runs", headers=BEARER)

    assert response.status_code == 403


def test_a_database_without_the_permission_check_fails_closed(production, make_client):
    """has_permission missing (security foundation not applied) is not access."""
    client, _ = member_client(
        make_client, OWNER, permission_error=SupabaseRejected("missing", status=404, code="PGRST202")
    )

    response = client.get("/api/v1/automations/runs", headers=BEARER)

    assert response.status_code == 503
    assert response.json()["code"] == "not_configured"


def test_no_credentials_at_all_is_refused_in_production(production, make_client):
    client, _ = member_client(make_client, OWNER)

    assert client.get("/api/v1/automations/runs").status_code == 401


def test_a_malformed_authorization_header_is_refused(production, make_client):
    client, _ = member_client(make_client, OWNER)

    for header in ("good-token", "Basic good-token", "Bearer", "Bearer "):
        response = client.get("/api/v1/automations/runs", headers={"Authorization": header})
        assert response.status_code == 401, header


def test_supabase_being_down_is_not_reported_as_forbidden(production, make_client):
    """A blip must not look like a permissions problem.

    Reporting 401/403 here would send an operator hunting for an access rule
    that was never wrong, so an unverifiable caller is a 503 instead.
    """
    client, _ = member_client(make_client, OWNER, identity_error=SupabaseUnavailable("down"))

    response = client.get("/api/v1/automations/runs", headers=BEARER)

    assert response.status_code == 503
    assert response.json()["code"] == "unavailable"


def test_a_permission_check_that_cannot_reach_the_database_is_unavailable(production, make_client):
    client, _ = member_client(make_client, OWNER, permission_error=SupabaseUnavailable("down"))

    response = client.get("/api/v1/automations/runs", headers=BEARER)

    assert response.status_code == 503
    assert response.json()["code"] == "unavailable"


def test_a_verified_identity_is_not_re_checked_on_every_call(production, make_client):
    """The Dashboard polls; verification must not cost round trips a poll."""
    client, fake = member_client(make_client, OWNER)

    for _ in range(3):
        assert client.get("/api/v1/automations/runs", headers=BEARER).status_code == 200

    assert fake.calls.count("get_token_user") == 1
    assert fake.calls.count("has_permission:logs.read") == 1


def test_a_workflow_that_writes_asks_for_its_permissions_fresh(production, make_client):
    """A member revoked seconds ago must not slip one last business write in."""
    from tests.conftest import opportunity_row

    client, fake = member_client(make_client, OWNER, opportunities=[opportunity_row()])
    body = {
        "event": "commercial.opportunity.won",
        "entity_id": opportunity_row()["id"],
        "payload": {"project_category": "System"},
    }

    client.post("/api/v1/automations/dispatch", json=body, headers=BEARER)
    client.post("/api/v1/automations/dispatch", json=body, headers=BEARER)

    # Asked on each dispatch, never answered from the cache.
    assert fake.calls.count("has_permission:projects.create") == 2


def test_auth_me_reports_what_the_member_may_do(production, make_client):
    client, _ = member_client(make_client, MANAGER)

    body = client.get("/api/v1/auth/me", headers=BEARER).json()

    assert body["kind"] == "member"
    assert body["user_id"] == MEMBER_ID
    assert "commercial.edit" in body["permissions"]
    assert "finance.read" not in body["permissions"]
    assert "token" not in str(body).lower()


# --- service token -------------------------------------------------------------


def test_the_service_token_still_works_for_machines(production, make_client):
    """CI and the scheduler keep a shared secret; only the browser may not."""
    production.setenv("API_TOKEN", "s3rv1ce")
    get_settings.cache_clear()

    client, _ = member_client(make_client, OWNER)

    assert client.get("/api/v1/automations/runs", headers={"X-API-Token": "s3rv1ce"}).status_code == 200
    assert client.get("/api/v1/automations/runs", headers={"X-API-Token": "wrong"}).status_code == 401


def test_a_member_token_still_works_when_a_service_token_exists(production, make_client):
    production.setenv("API_TOKEN", "s3rv1ce")
    get_settings.cache_clear()

    client, _ = member_client(make_client, OWNER)

    assert client.get("/api/v1/automations/runs", headers=BEARER).status_code == 200


def test_a_service_token_is_never_accepted_when_none_is_configured(production, make_client):
    client, _ = member_client(make_client, OWNER)

    response = client.get("/api/v1/automations/runs", headers={"X-API-Token": ""})

    assert response.status_code == 401


# --- health and readiness ------------------------------------------------------


def test_health_never_describes_a_credential(production, make_client):
    client, _ = member_client(make_client, OWNER)

    body = client.get("/api/v1/health").json()
    serialised = str(body)

    assert body["environment"] == "production"
    for secret in ("sb_secret_abc123", "example.supabase.co", "good-token"):
        assert secret not in serialised


def test_health_stays_open_so_a_probe_never_needs_a_secret(production, make_client):
    client, _ = member_client(make_client, OWNER)

    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/ready").status_code == 200


def test_readiness_is_ready_when_configuration_storage_and_schema_are_fine(production, make_client):
    client, _ = member_client(make_client, OWNER)

    response = client.get("/api/v1/ready")

    assert response.status_code == 200
    assert response.json()["ready"] is True


def test_readiness_refuses_when_history_is_unreachable(production, make_client):
    """Not ready, but still alive: the liveness probe must not go down with it."""
    client, _ = make_client([], storage=False)

    response = client.get("/api/v1/ready")

    assert response.status_code == 503
    assert response.json()["ready"] is False
    assert client.get("/health").status_code == 200


def test_readiness_refuses_before_the_v2_migration_is_applied(production, make_client):
    client, _ = make_client([], schema=False)

    body = client.get("/api/v1/ready").json()

    assert body["ready"] is False
    schema = next(check for check in body["checks"] if check["name"] == "automation_schema")
    assert schema["configured"] is False


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


# --- startup -------------------------------------------------------------------


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


@pytest.mark.parametrize("origin", ["*", "https://admin.example.com,*"])
def test_a_wildcard_origin_is_never_accepted(monkeypatch, origin):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc123")
    monkeypatch.setenv("ADMIN_ORIGIN", origin)
    get_settings.cache_clear()

    settings = get_settings()
    assert "*" not in settings.allowed_origins
    assert any("wildcard" in problem for problem in settings.startup_problems)


def test_production_refuses_a_plain_http_origin(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc123")
    monkeypatch.setenv("ADMIN_ORIGIN", "http://admin.example.com")
    get_settings.cache_clear()

    assert any("https" in problem for problem in get_settings().startup_problems)


def test_development_starts_with_problems_and_only_warns(make_client):
    """A developer with half a configuration still gets a running service."""
    client, _ = make_client([])

    assert get_settings().startup_problems
    assert client.get("/health").status_code == 200


def test_a_temporary_outage_is_not_a_startup_problem(production):
    """Reachability is deliberately absent: a blip must not need a human."""
    problems = " ".join(get_settings().startup_problems).lower()

    assert problems == ""


# --- CORS ----------------------------------------------------------------------


def test_production_cors_allows_only_the_configured_origin(production, make_client):
    client, _ = member_client(make_client, OWNER)

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
        headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "GET"},
    )
    assert refused.headers.get("access-control-allow-origin") is None


def test_cors_never_pairs_an_allowlist_with_credentials(production, make_client):
    client, _ = member_client(make_client, OWNER)

    response = client.get("/api/v1/health", headers={"Origin": "https://admin.example.com"})

    assert response.headers.get("access-control-allow-origin") == "https://admin.example.com"
    assert response.headers.get("access-control-allow-credentials") is None


# --- request id ----------------------------------------------------------------


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

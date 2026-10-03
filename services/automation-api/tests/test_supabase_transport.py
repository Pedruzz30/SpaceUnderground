"""The real Supabase client, over a mocked transport.

What leaves this process matters more than what the fakes do: which key goes
in which header, which table or function a request can reach, and how a
database answer is told apart from an outage.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import get_settings
from app.services import supabase_service as module
from app.services.supabase_service import (
    InvalidToken,
    SupabaseConflict,
    SupabaseError,
    SupabaseRejected,
    SupabaseService,
    SupabaseUnavailable,
)

SECRET = "sb_secret_abc123"


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SECRET)
    get_settings.cache_clear()


@pytest.fixture
def transport(monkeypatch):
    """Routes every httpx call through a handler the test controls."""
    sent: list[httpx.Request] = []
    state = {"handler": lambda request: httpx.Response(200, json=[])}

    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        def handle(request: httpx.Request) -> httpx.Response:
            sent.append(request)
            return state["handler"](request)

        kwargs["transport"] = httpx.MockTransport(handle)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(module.httpx, "AsyncClient", client_factory)

    def respond(handler):
        state["handler"] = handler

    return sent, respond


async def test_service_reads_send_only_the_service_key(configured, transport):
    sent, _ = transport

    await SupabaseService().list_projects()

    request = sent[0]
    assert request.headers["apikey"] == SECRET
    # A modern secret key is not a bearer token.
    assert "authorization" not in request.headers


async def test_a_permission_is_asked_as_the_member(configured, transport):
    sent, respond = transport
    respond(lambda request: httpx.Response(200, json=True))

    allowed = await SupabaseService().member_has_permission("member-jwt", "logs.read")

    request = sent[0]
    assert allowed is True
    assert request.url.path == "/rest/v1/rpc/has_permission"
    assert json.loads(request.content) == {"p_permission": "logs.read"}
    # The member's own token is what PostgREST runs the request as.
    assert request.headers["authorization"] == "Bearer member-jwt"


async def test_anything_but_true_is_no(configured, transport):
    _, respond = transport
    for answer in (False, None, "true", 1, {"ok": True}):
        respond(lambda request, answer=answer: httpx.Response(200, json=answer))
        assert await SupabaseService().member_has_permission("member-jwt", "logs.read") is False


async def test_a_refused_member_token_is_an_answer_not_an_outage(configured, transport):
    _, respond = transport
    respond(lambda request: httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"}))

    with pytest.raises(InvalidToken):
        await SupabaseService().member_has_permission("expired", "logs.read")


async def test_only_allowlisted_tables_and_functions_are_reachable(configured, transport):
    sent, _ = transport
    service = SupabaseService()

    for table in (
        "projects",
        "clients",
        "financial_transactions",
        "admins",
        "automation_runs?x=1/../projects",
    ):
        with pytest.raises(SupabaseError):
            await service._write(table, "POST", json={})
    with pytest.raises(SupabaseError):
        await service._rpc("write_audit", {})
    with pytest.raises(SupabaseError):
        await service._member_rpc("jwt", "approve_change_request", {})

    assert sent == [], "nothing refused here may reach the network"


async def test_the_handoff_function_runs_with_the_service_key(configured, transport):
    sent, respond = transport
    respond(lambda request: httpx.Response(200, json={"project_id": "p", "project_created": True}))

    await SupabaseService().open_project_for_opportunity(
        opportunity_id="cccccccc-3333-4333-8333-000000000001",
        category="System",
        name="Portal",
        slug="portal",
        link_finance=False,
        actor_id="not-a-uuid",
        run_id=None,
    )

    request = sent[0]
    assert request.url.path == "/rest/v1/rpc/automation_open_project_for_opportunity"
    assert request.headers["apikey"] == SECRET
    body = json.loads(request.content)
    # An actor that is not a uuid is dropped, never forwarded.
    assert body["p_actor"] is None
    assert body["p_link_finance"] is False


async def test_database_answers_are_told_apart_from_outages(configured, transport):
    _, respond = transport
    service = SupabaseService()

    respond(lambda request: httpx.Response(409, json={"code": "23505"}))
    with pytest.raises(SupabaseConflict):
        await service._write("automation_runs", "POST", json={})

    respond(lambda request: httpx.Response(400, json={"code": "AU002", "message": "not won"}))
    with pytest.raises(SupabaseRejected) as rejected:
        await service._rpc("automation_open_project_for_opportunity", {})
    assert rejected.value.code == "AU002"

    respond(lambda request: httpx.Response(503, text="upstream"))
    with pytest.raises(SupabaseUnavailable):
        await service.list_projects()

    # The service key refused is a configuration fault, not an answer.
    respond(lambda request: httpx.Response(401, json={"message": "Invalid API key"}))
    with pytest.raises(SupabaseUnavailable):
        await service.list_projects()


async def test_a_paged_read_follows_the_row_cap(configured, transport, monkeypatch):
    sent, respond = transport
    monkeypatch.setattr(module, "PAGE_SIZE", 2)
    pages = [[{"id": 1}, {"id": 2}], [{"id": 3}, {"id": 4}], [{"id": 5}]]
    respond(lambda request: httpx.Response(200, json=pages[len(sent) - 1]))

    rows = await SupabaseService().list_projects()

    assert [row["id"] for row in rows] == [1, 2, 3, 4, 5]
    assert [request.url.params["offset"] for request in sent] == ["0", "2", "4"]


async def test_an_identifier_that_is_not_an_id_never_reaches_a_query(configured, transport):
    sent, _ = transport
    service = SupabaseService()

    for bad in ("1;drop", "../etc", "eq.1", ""):
        with pytest.raises(SupabaseError):
            await service.get_project(bad)
    with pytest.raises(SupabaseError):
        await service.get_opportunity("not-a-uuid")

    assert sent == []

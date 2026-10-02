"""`commercial.opportunity.won` on the current pipeline.

The Admin closes the deal and owns the client and the receivables; this
workflow opens the project once, records the handoff and links client and
ledger to it. Every path that could repeat it -- a double click, a network
retry, a manual retry, "Finish closing" -- must converge on one project.
"""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.security import reset_identity_cache
from app.services.supabase_service import SupabaseUnavailable
from tests.conftest import (
    BEARER,
    CLIENT_ID,
    MANAGER,
    MEMBER_ID,
    OPPORTUNITY_ID,
    OWNER,
    SEO,
    client_row,
    member_client,
    opportunity_row,
    receivable_row,
)

DISPATCH = "/api/v1/automations/dispatch"


def won(**payload):
    return {
        "event": "commercial.opportunity.won",
        "entity_type": "opportunity",
        "entity_id": OPPORTUNITY_ID,
        "payload": {"opportunity_id": OPPORTUNITY_ID, "project_category": "System", **payload},
    }


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc123")
    monkeypatch.setenv("ADMIN_ORIGIN", "https://admin.example.com")
    get_settings.cache_clear()
    reset_identity_cache()


def owner_client(make_client, **kwargs):
    kwargs.setdefault("opportunities", [opportunity_row()])
    kwargs.setdefault("clients", [client_row()])
    kwargs.setdefault("transactions", [receivable_row()])
    return member_client(make_client, OWNER, rows=kwargs.pop("rows", []), **kwargs)


def test_a_won_opportunity_opens_one_project_draft(production, make_client):
    client, fake = owner_client(make_client)

    body = client.post(DISPATCH, json=won(), headers=BEARER).json()

    assert body["status"] == "SUCCESS"
    assert body["entity_type"] == "opportunity"
    assert body["result"]["business_status"] == "SUCCESS"

    project = fake.rows[0]
    assert project["editorial_status"] == "DRAFT"
    assert project["visible"] is False
    assert project["category"] == "System"
    assert project["name"] == "Aurora Operations Portal"
    # Linked to the client the Admin created, and to the deal's receivable.
    assert project["client_id"] == CLIENT_ID
    assert fake.transactions[0]["project_id"] == project["id"]
    assert fake.handoffs[0]["opportunity_id"] == OPPORTUNITY_ID
    # Logged as the member who closed the deal.
    assert fake.activity == [
        {"action": "project.created", "entity_id": project["id"], "admin_user_id": MEMBER_ID}
    ]

    actions = {action["action"]: action for action in body["result"]["actions"]}
    assert actions["project.create"]["status"] == "executed"
    assert actions["client.link"]["status"] == "executed"
    assert actions["finance.link"]["fields"] == {"linked": 1}
    assert body["result"]["entities"] == {
        "opportunity_id": OPPORTUNITY_ID,
        "client_id": CLIENT_ID,
        "project_id": project["id"],
    }


def test_it_never_creates_a_client_or_a_receivable(production, make_client):
    """Those are the operator's decisions, already made in the win dialog."""
    client, fake = owner_client(
        make_client, clients=[], transactions=[], opportunities=[opportunity_row(client_id=None)]
    )

    body = client.post(DISPATCH, json=won(), headers=BEARER).json()

    assert body["status"] == "SUCCESS"
    assert fake.clients == []
    assert fake.transactions == []
    # The project is open, and the run says what is missing.
    assert len(fake.rows) == 1
    assert body["result"]["business_status"] == "ATTENTION"
    warnings = body["result"]["summary"]["warnings"]
    assert any("cliente" in warning for warning in warnings)
    assert any("recebível" in warning for warning in warnings)
    assert body["steps"][1]["status"] == "SKIPPED"


def test_the_same_click_twice_is_one_run_and_one_project(production, make_client):
    client, fake = owner_client(make_client)
    dispatch = {**won(), "operation_id": "win-click-0001"}

    first = client.post(DISPATCH, json=dispatch, headers=BEARER).json()
    second = client.post(DISPATCH, json=dispatch, headers=BEARER).json()

    assert second["deduplicated"] is True
    assert second["run_id"] == first["run_id"]
    assert len(fake.runs.rows) == 1
    assert len(fake.rows) == 1


def test_a_second_deliberate_dispatch_finds_the_existing_project(production, make_client):
    """ "Finish closing" dispatches again with a new operation id: the database
    handoff, not the run key, is what keeps the project single."""
    client, fake = owner_client(make_client)

    first = client.post(DISPATCH, json={**won(), "operation_id": "win-click-0001"}, headers=BEARER).json()
    second = client.post(DISPATCH, json={**won(), "operation_id": "finish-click-02"}, headers=BEARER).json()

    assert len(fake.runs.rows) == 2
    assert len(fake.rows) == 1
    assert len(fake.handoffs) == 1
    assert len(fake.activity) == 1
    project_action = {action["action"]: action for action in second["result"]["actions"]}["project.create"]
    assert project_action["status"] == "skipped"
    assert project_action["entity_id"] == fake.rows[0]["id"]
    assert first["result"]["entities"]["project_id"] == second["result"]["entities"]["project_id"]


def test_a_client_linked_later_reaches_the_project_on_the_next_run(production, make_client):
    client, fake = owner_client(make_client, opportunities=[opportunity_row(client_id=None)])

    client.post(DISPATCH, json=won(), headers=BEARER)
    assert fake.rows[0]["client_id"] is None

    # The operator finishes closing: the Admin creates and links the client.
    fake.opportunities[0]["client_id"] = CLIENT_ID
    client.post(DISPATCH, json=won(), headers=BEARER)

    assert len(fake.rows) == 1
    assert fake.rows[0]["client_id"] == CLIENT_ID


def test_a_dry_run_plans_without_writing(production, make_client):
    client, fake = owner_client(make_client)

    body = client.post(DISPATCH, json={**won(), "dry_run": True}, headers=BEARER).json()

    assert body["status"] == "SUCCESS"
    assert body["source"] == "dry_run"
    assert body["result"]["dry_run"] is True
    assert body["result"]["actions"][0]["status"] == "planned"
    assert body["result"]["actions"][0]["fields"]["slug"].startswith("aurora-operations-portal-")
    assert fake.rows == []
    assert fake.handoffs == []
    assert not any(call.startswith("open_project") for call in fake.calls)


def test_an_opportunity_that_is_not_won_is_refused(production, make_client):
    client, fake = owner_client(make_client, opportunities=[opportunity_row(stage="NEGOTIATION")])

    body = client.post(DISPATCH, json=won(), headers=BEARER).json()

    assert body["status"] == "FAILED"
    assert body["result"]["business_status"] == "ATTENTION"
    assert "não está ganha" in body["error"]
    assert fake.rows == []


def test_a_missing_category_stops_before_any_write(production, make_client):
    """Nothing is guessed: the operator chooses the category when closing."""
    client, fake = owner_client(make_client)

    body = client.post(DISPATCH, json=won(project_category=""), headers=BEARER).json()

    assert body["status"] == "FAILED"
    assert "categoria" in body["error"]
    assert fake.rows == []


def test_an_unsupported_category_is_refused(production, make_client):
    client, fake = owner_client(make_client)

    body = client.post(DISPATCH, json=won(project_category="Marketing"), headers=BEARER).json()

    assert body["status"] == "FAILED"
    assert fake.rows == []


def test_an_unknown_opportunity_is_a_failed_run(production, make_client):
    client, _ = owner_client(make_client, opportunities=[])

    body = client.post(DISPATCH, json=won(), headers=BEARER).json()

    assert body["status"] == "FAILED"
    assert OPPORTUNITY_ID in body["error"]


def test_a_failed_open_can_be_retried_into_success(production, make_client):
    client, fake = owner_client(make_client, rpc_error=SupabaseUnavailable("blip"))

    failed = client.post(DISPATCH, json=won(), headers=BEARER).json()
    assert failed["status"] == "FAILED"
    assert failed["retryable"] is True
    assert fake.rows == []

    fake.rpc_error = None
    retry = client.post(
        f"/api/v1/automations/runs/{failed['run_id']}/retry",
        json={"operation_id": "retry-click-01"},
        headers=BEARER,
    ).json()

    assert retry["status"] == "SUCCESS"
    assert retry["retry_of"] == failed["run_id"]
    assert len(fake.rows) == 1
    # The failed attempt is history and stays as it was.
    assert fake.runs.rows[0]["status"] == "FAILED"


def test_a_member_who_cannot_create_projects_cannot_open_one(production, make_client):
    client, fake = member_client(
        make_client,
        {"logs.read", "commercial.read", "commercial.edit"},
        opportunities=[opportunity_row()],
        clients=[client_row()],
    )

    response = client.post(DISPATCH, json=won(), headers=BEARER)

    assert response.status_code == 403
    assert "projects.create" in response.json()["message"]
    assert fake.rows == []


def test_a_member_without_commercial_edit_cannot_dispatch(production, make_client):
    client, _ = member_client(make_client, SEO, opportunities=[opportunity_row()])

    response = client.post(DISPATCH, json=won(), headers=BEARER)

    assert response.status_code == 403
    assert "commercial.edit" in response.json()["message"]


def test_a_manager_opens_the_project_but_does_not_touch_the_ledger(production, make_client):
    """MANAGER holds commercial.edit and projects.create, not finance.*: the
    project opens, the ledger link is skipped, and the finance review is not
    run for them."""
    client, fake = member_client(
        make_client,
        MANAGER,
        rows=[],
        opportunities=[opportunity_row()],
        clients=[client_row()],
        transactions=[receivable_row()],
    )

    body = client.post(DISPATCH, json=won(), headers=BEARER).json()

    assert body["status"] == "SUCCESS"
    assert len(fake.rows) == 1
    assert fake.transactions[0]["project_id"] is None
    finance = {action["action"]: action for action in body["result"]["actions"]}["finance.link"]
    assert finance["status"] == "skipped"
    assert "finance.edit" in finance["reason"]
    assert body["steps"][3]["status"] == "SKIPPED"


def test_the_finance_review_is_withheld_from_readers_without_finance_read(production, make_client):
    """Run history is open to logs.read; the ledger is not."""
    client, fake = owner_client(make_client)
    run = client.post(DISPATCH, json=won(), headers=BEARER).json()
    assert run["steps"][3]["result"]["receivables"] == 1

    # Another member, with logs.read but no finance.read, opens the run.
    fake.tokens["seo-token"] = "seo-user"
    fake.grants["seo-user"] = SEO
    seen = client.get(
        f"/api/v1/automations/runs/{run['run_id']}", headers={"Authorization": "Bearer seo-token"}
    ).json()

    finance_step = next(step for step in seen["steps"] if step["name"] == "review_financial")
    assert finance_step["result"] is None
    assert finance_step["redacted"] is True
    assert seen["redacted"] is True

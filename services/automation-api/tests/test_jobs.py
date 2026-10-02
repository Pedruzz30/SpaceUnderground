"""Scheduled jobs: detect, record, signal -- and nothing else."""

from __future__ import annotations

import pytest

from app.automations.jobs import job_names
from app.core.config import get_settings
from app.core.security import reset_identity_cache
from tests.conftest import (
    BEARER,
    MANAGER,
    OWNER,
    SEO,
    member_client,
    opportunity_row,
    project_row,
    receivable_row,
)

RUN = "/api/v1/jobs/run"
SERVICE = {"X-API-Token": "sch3dule-s3cret"}


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc123")
    monkeypatch.setenv("ADMIN_ORIGIN", "https://admin.example.com")
    monkeypatch.setenv("API_TOKEN", "sch3dule-s3cret")
    get_settings.cache_clear()
    reset_identity_cache()


def data():
    return {
        "rows": [
            project_row(),
            # Published, incoherent: published but hidden, no poster.
            project_row(
                id="11111111-2222-3333-4444-000000000002",
                case_number=2,
                slug="two",
                visible=False,
                poster_url=None,
            ),
            project_row(
                id="11111111-2222-3333-4444-000000000003",
                case_number=3,
                slug="three",
                editorial_status="DRAFT",
            ),
        ],
        "transactions": [
            receivable_row(id="dddddddd-4444-4444-8444-000000000001", due_date="2020-01-01", amount=100),
            receivable_row(id="dddddddd-4444-4444-8444-000000000002", due_date="2020-02-01", amount=50.5),
            receivable_row(id="dddddddd-4444-4444-8444-000000000003", due_date="2099-01-01"),
            receivable_row(id="dddddddd-4444-4444-8444-000000000004", due_date="2020-01-01", status="PAID"),
            receivable_row(id="dddddddd-4444-4444-8444-000000000005", due_date="2020-01-01", type="EXPENSE"),
        ],
        "opportunities": [
            opportunity_row(
                id="cccccccc-3333-4333-8333-000000000002",
                stage="CONTACTED",
                next_action="Ligar",
                next_action_at="2020-01-01",
            ),
            opportunity_row(
                id="cccccccc-3333-4333-8333-000000000003", stage="PROPOSAL", next_action_at="2099-01-01"
            ),
            opportunity_row(
                id="cccccccc-3333-4333-8333-000000000004", stage="WON", next_action_at="2020-01-01"
            ),
        ],
    }


def test_only_jobs_over_real_data_are_registered():
    # No "overdue project" job: projects have no deadline field.
    assert job_names() == ("commercial.follow_up_check", "financial.overdue_check", "projects.health_check")


def test_the_scheduler_runs_every_job_once_and_records_each(production, make_client):
    client, fake = make_client(**data())

    body = client.post(RUN, json={"scheduled": True}, headers=SERVICE).json()

    runs = {run["entity_id"]: run for run in body["runs"]}
    assert set(runs) == set(job_names())
    assert all(run["source"] == "scheduler" for run in runs.values())
    assert len(fake.runs.rows) == 3

    overdue = runs["financial.overdue_check"]
    assert overdue["status"] == "SUCCESS"
    assert overdue["result"]["business_status"] == "ATTENTION"
    scan = overdue["steps"][0]["result"]
    assert scan["count"] == 2
    assert scan["total"] == 150.5

    follow_up = runs["commercial.follow_up_check"]["steps"][0]["result"]
    assert [item["opportunity_id"] for item in follow_up["items"]] == ["cccccccc-3333-4333-8333-000000000002"]

    health = runs["projects.health_check"]["steps"][0]["result"]
    assert health["checked"] == 2
    assert [item["case_number"] for item in health["items"]] == [2]


def test_a_job_only_reads(production, make_client):
    """Copilot, not actor: nothing is written but its own run."""
    client, fake = make_client(**data())
    before = [dict(row) for row in fake.transactions]

    client.post(RUN, json={"scheduled": True}, headers=SERVICE)

    assert fake.transactions == before
    assert fake.activity == []
    assert not any(call.startswith("open_project") for call in fake.calls)


def test_a_schedule_that_fires_twice_runs_once_per_day(production, make_client):
    client, fake = make_client(**data())

    client.post(RUN, json={"scheduled": True}, headers=SERVICE)
    again = client.post(RUN, json={"scheduled": True}, headers=SERVICE).json()

    assert len(fake.runs.rows) == 3
    assert all(run["deduplicated"] for run in again["runs"])


def test_nothing_found_is_a_quiet_success(production, make_client):
    client, _ = make_client([])

    body = client.post(RUN, json={"jobs": ["financial.overdue_check"]}, headers=SERVICE).json()

    assert body["runs"][0]["result"]["business_status"] == "SUCCESS"
    assert body["runs"][0]["result"]["summary"]["signals"] == 0


def test_the_scheduler_endpoint_is_never_open(production, make_client):
    client, fake = make_client(**data())

    assert client.post(RUN, json={}).status_code == 401
    assert client.post(RUN, json={}, headers={"X-API-Token": "guess"}).status_code == 401
    assert fake.runs.rows == []


def test_a_member_needs_settings_edit_to_run_jobs_by_hand(production, make_client):
    client, _ = member_client(make_client, MANAGER, **data())

    response = client.post(RUN, json={"jobs": ["projects.health_check"]}, headers=BEARER)

    assert response.status_code == 403
    assert "settings.edit" in response.json()["message"]


def test_an_owner_runs_a_job_by_hand_and_it_is_not_the_schedule(production, make_client):
    client, fake = member_client(make_client, OWNER, **data())

    body = client.post(
        RUN,
        json={"jobs": ["projects.health_check"], "scheduled": True, "operation_id": "manual-run-01"},
        headers=BEARER,
    ).json()

    # "scheduled" is only honoured for the scheduler's own token.
    assert body["runs"][0]["source"] == "admin"
    assert fake.runs.rows[0]["idempotency_key"] == "job:projects.health_check:op:manual-run-01"


def test_an_unknown_job_is_refused(production, make_client):
    client, _ = make_client(**data())

    response = client.post(RUN, json={"jobs": ["send.invoices"]}, headers=SERVICE)

    assert response.status_code == 400


def test_a_finance_scan_is_hidden_from_a_reader_without_finance_read(production, make_client):
    client, fake = make_client(**data())
    run = client.post(RUN, json={"jobs": ["financial.overdue_check"]}, headers=SERVICE).json()["runs"][0]

    fake.tokens["good-token"] = "seo-user"
    fake.grants["seo-user"] = SEO
    seen = client.get(f"/api/v1/automations/runs/{run['run_id']}", headers=BEARER).json()

    assert seen["redacted"] is True
    assert seen["result"].get("summary") is None
    assert all(step["result"] is None for step in seen["steps"])
    # Nor is the finding named among the runs that need attention.
    stats = client.get("/api/v1/automations/runs/stats", headers=BEARER).json()
    assert all(item["event"] != "job.financial.overdue_check" for item in stats["attention"])

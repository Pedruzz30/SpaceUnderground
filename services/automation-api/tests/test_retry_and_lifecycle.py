"""Retry semantics and the project lifecycle events."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from tests.conftest import project_row

DISPATCH = "/api/v1/automations/dispatch"


def healthy(**overrides):
    return project_row(live_preview_enabled=False, preview_url=None, **overrides)


def failed_run(client):
    run = client.post(DISPATCH, json={"event": "project.published", "entity_id": "1"}).json()
    assert run["status"] == "FAILED"
    return run


# --- retry ---------------------------------------------------------------------


def test_the_same_retry_click_twice_is_one_new_run(make_client):
    client, fake = make_client([])
    original = failed_run(client)
    fake.rows.append(healthy())

    url = f"/api/v1/automations/runs/{original['run_id']}/retry"
    first = client.post(url, json={"operation_id": "retry-click-01"}).json()
    second = client.post(url, json={"operation_id": "retry-click-01"}).json()

    assert second["deduplicated"] is True
    assert second["run_id"] == first["run_id"]
    assert len(fake.runs.rows) == 2


def test_two_deliberate_retries_are_two_runs_and_history_is_kept(make_client):
    client, fake = make_client([])
    original = failed_run(client)

    url = f"/api/v1/automations/runs/{original['run_id']}/retry"
    client.post(url, json={"operation_id": "retry-click-01"})
    client.post(url, json={"operation_id": "retry-click-02"})

    assert len(fake.runs.rows) == 3
    assert fake.runs.rows[0]["status"] == "FAILED"
    assert fake.runs.rows[0]["error"] == original["error"]
    assert all(row["retry_of"] == original["run_id"] for row in fake.runs.rows[1:])


def test_a_retry_body_with_a_hostile_operation_id_is_refused(make_client):
    client, _ = make_client([])
    original = failed_run(client)

    response = client.post(
        f"/api/v1/automations/runs/{original['run_id']}/retry", json={"operation_id": "x;drop"}
    )

    assert response.status_code == 422


def test_an_abandoned_running_run_can_be_retried(make_client):
    """A process that died mid-run leaves RUNNING forever; it must not be a
    dead end. The abandoned run itself is left as it was."""
    client, fake = make_client([healthy()])
    started = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    fake.runs.rows.append(
        {
            "id": "00000000-0000-4000-8000-00000000abcd",
            "event": "project.published",
            "status": "RUNNING",
            "source": "admin",
            "entity_type": "project",
            "entity_id": "1",
            "payload": {},
            "started_at": started,
            "created_at": started,
        }
    )

    listed = client.get("/api/v1/automations/runs").json()["runs"][0]
    assert listed["stale"] is True
    assert listed["retryable"] is True

    retry = client.post("/api/v1/automations/runs/00000000-0000-4000-8000-00000000abcd/retry").json()

    assert retry["status"] == "SUCCESS"
    assert fake.runs.rows[0]["status"] == "RUNNING"
    stats = client.get("/api/v1/automations/runs/stats").json()
    assert stats["running_stale"] == 1


def test_a_recent_running_run_is_not_retryable(make_client):
    client, fake = make_client([healthy()])
    now = datetime.now(UTC).isoformat()
    fake.runs.rows.append(
        {
            "id": "00000000-0000-4000-8000-00000000abce",
            "event": "project.published",
            "status": "RUNNING",
            "started_at": now,
        }
    )

    response = client.post("/api/v1/automations/runs/00000000-0000-4000-8000-00000000abce/retry")

    assert response.status_code == 400


def test_a_retired_event_is_readable_but_not_runnable(make_client):
    """commercial.proposal.accepted ran in production before Commercial moved to
    the opportunities pipeline. Its runs stay; running it again does not."""
    client, fake = make_client([])
    fake.runs.rows.append(
        {
            "id": "00000000-0000-4000-8000-0000000000ff",
            "event": "commercial.proposal.accepted",
            "status": "FAILED",
            "entity_type": "commercial_proposal",
            "error": "Commercial proposal not found",
            "created_at": "2026-09-14T03:00:00Z",
        }
    )

    listed = client.get("/api/v1/automations/runs").json()["runs"][0]
    assert listed["event"] == "commercial.proposal.accepted"
    assert listed["retryable"] is False

    retry = client.post("/api/v1/automations/runs/00000000-0000-4000-8000-0000000000ff/retry")
    assert retry.status_code == 400
    assert "retired" in retry.json()["message"]

    dispatch = client.post(DISPATCH, json={"event": "commercial.proposal.accepted"})
    assert dispatch.status_code == 400
    assert "commercial.opportunity.won" in dispatch.json()["message"]


# --- project.published ---------------------------------------------------------


def test_project_published_confirms_the_stored_row_is_published(make_client):
    """Dispatched after the save; a row that is not published means the save
    did not land as the Admin believed, and the run says so."""
    client, _ = make_client([healthy(editorial_status="DRAFT", visible=False)])

    body = client.post(DISPATCH, json={"event": "project.published", "entity_id": "1"}).json()

    assert body["status"] == "FAILED"
    assert "não está publicado" in body["error"]


def test_project_published_flags_a_published_but_incoherent_project(make_client):
    client, _ = make_client([healthy(poster_url=None)])

    body = client.post(DISPATCH, json={"event": "project.published", "entity_id": "1"}).json()

    assert body["status"] == "SUCCESS"
    assert body["result"]["business_status"] == "ATTENTION"


def test_project_published_never_writes(make_client):
    client, fake = make_client([healthy()])
    before = dict(fake.rows[0])

    client.post(DISPATCH, json={"event": "project.published", "entity_id": "1"})

    assert fake.rows[0] == before
    assert not any(call.startswith("open_project") for call in fake.calls)


# --- project.completed ---------------------------------------------------------


def test_project_completed_requires_the_stored_status_to_be_live(make_client):
    client, _ = make_client([healthy(status="In Development")])

    body = client.post(DISPATCH, json={"event": "project.completed", "entity_id": "1"}).json()

    assert body["status"] == "FAILED"
    assert "Live" in body["error"]


def test_project_completed_reads_the_ledger_through_the_handoff(make_client):
    """A won deal's receivables exist before its project: the review finds them
    through the opportunity the project was opened from. It never writes."""
    from tests.conftest import OPPORTUNITY_ID, receivable_row

    project = healthy()
    client, fake = make_client(
        [project],
        handoffs=[{"opportunity_id": OPPORTUNITY_ID, "project_id": project["id"]}],
        transactions=[
            receivable_row(due_date="2020-01-01"),
            receivable_row(id="dddddddd-4444-4444-8444-000000000002", status="PAID"),
            receivable_row(
                id="dddddddd-4444-4444-8444-000000000003", status="CANCELLED", due_date="2020-01-01"
            ),
        ],
    )
    before = [dict(row) for row in fake.transactions]

    body = client.post(DISPATCH, json={"event": "project.completed", "entity_id": project["id"]}).json()

    finance = next(step for step in body["steps"] if step["name"] == "finance_review")["result"]
    assert finance["status"] == "ATTENTION"
    assert finance["overdue"] == 1
    assert finance["paid"] == 1
    assert finance["receivables"] == 2, "a cancelled entry counts nowhere"
    assert body["result"]["business_status"] == "ATTENTION"
    assert body["result"]["summary"]["finance_status"] == "ATTENTION"
    assert fake.transactions == before


def test_a_missing_project_is_a_failed_run_for_every_project_event(make_client):
    client, _ = make_client([])

    for event in ("project.published", "project.completed"):
        body = client.post(DISPATCH, json={"event": event, "entity_id": "999"}).json()
        assert body["status"] == "FAILED"
        assert "999" in body["error"]


def test_an_analysis_of_a_missing_project_is_a_404(make_client):
    client, _ = make_client([])

    response = client.post("/api/v1/projects/999/analyze")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_an_analysis_describes_the_stored_row(make_client):
    client, fake = make_client([healthy()])

    body = client.post(f"/api/v1/projects/{fake.rows[0]['id']}/analyze").json()

    assert body["project_id"] == fake.rows[0]["id"]
    assert body["status"] in {"healthy", "attention"}

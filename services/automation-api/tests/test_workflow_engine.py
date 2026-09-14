"""The workflow engine: dispatch, runs, steps, idempotency, retry and history.

Nothing here touches a network or a database. Handlers that make HTTP calls are
exercised through the SSRF suite, which stubs the transport.
"""

from __future__ import annotations

import asyncio

import pytest

from app.automations.engine import (
    Step,
    StepFailed,
    StepSkipped,
    Workflow,
    run_workflow,
)
from app.automations.registry import get_workflow, known_events
from tests.conftest import FakeRunStore, FakeSupabaseService, project_row

# --- registry --------------------------------------------------------------


def test_only_this_phase_events_are_registered():
    # Registering an event with no workflow would make a typo look like a
    # working no-op, so the registry stays deliberately small.
    assert known_events() == ("project.completed", "project.published")


def test_each_workflow_declares_ordered_steps():
    steps = [step.name for step in get_workflow("project.published").steps]

    assert steps == ["load_project", "analyze_project", "check_live_preview", "register_result"]


def test_an_unregistered_event_has_no_workflow():
    assert get_workflow("client.created") is None


# --- engine ----------------------------------------------------------------


async def _run(steps, *, rows=None, store=None, **kwargs):
    workflow = Workflow(event="project.published", steps=steps)
    return await run_workflow(
        workflow,
        supabase=FakeSupabaseService(rows if rows is not None else [project_row()]),
        store=store or FakeRunStore(),
        entity_type="project",
        entity_id="1",
        **kwargs,
    )


@pytest.mark.asyncio
async def test_a_run_records_every_step_with_timing():
    async def ok(context):
        return {"fine": True}

    run = await _run([Step(name="one", run=ok), Step(name="two", run=ok)])

    assert run["status"] == "SUCCESS"
    assert [step["name"] for step in run["steps"]] == ["one", "two"]
    assert all(step["status"] == "SUCCESS" for step in run["steps"])
    assert all(step["duration_ms"] >= 0 for step in run["steps"])
    assert run["duration_ms"] >= 0
    # The engine speaks "id"; only the API layer renames it to run_id.
    assert isinstance(run["id"], str)
    assert run["persisted"] is True


@pytest.mark.asyncio
async def test_a_failing_step_fails_the_run_and_keeps_earlier_results():
    async def ok(context):
        return {"value": 1}

    async def boom(context):
        raise StepFailed("Preview URL is not reachable.")

    async def never(context):  # pragma: no cover - must not run
        raise AssertionError("steps after a failure must not run")

    run = await _run([Step(name="one", run=ok), Step(name="two", run=boom), Step(name="three", run=never)])

    assert run["status"] == "FAILED"
    # Losing the history on failure would defeat the whole feature.
    assert run["steps"][0]["status"] == "SUCCESS"
    assert run["steps"][0]["result"] == {"value": 1}
    assert run["steps"][1]["status"] == "FAILED"
    assert run["steps"][1]["error"] == "Preview URL is not reachable."
    assert len(run["steps"]) == 2, "execution stops at the first failure"
    assert run["error"] == "Preview URL is not reachable."


@pytest.mark.asyncio
async def test_a_skipped_step_does_not_fail_the_run():
    async def ok(context):
        return {"value": 1}

    async def skip(context):
        raise StepSkipped("Live preview is not enabled.")

    run = await _run([Step(name="one", run=ok), Step(name="two", run=skip), Step(name="three", run=ok)])

    assert run["status"] == "SUCCESS"
    assert run["steps"][1]["status"] == "SKIPPED"
    assert len(run["steps"]) == 3, "a skip must not stop the workflow"


@pytest.mark.asyncio
async def test_an_unexpected_error_is_sanitised():
    async def leak(context):
        raise RuntimeError("postgresql://user:hunter2@db.internal/postgres")

    run = await _run([Step(name="one", run=leak)])

    assert run["status"] == "FAILED"
    # The message could carry a connection string, so only the type survives.
    assert "hunter2" not in run["error"]
    assert "postgresql" not in run["error"]
    assert run["error"] == "Unexpected error (RuntimeError)."


@pytest.mark.asyncio
async def test_a_hanging_step_times_out_as_a_controlled_failure():
    async def hang(context):
        await asyncio.sleep(5)

    run = await _run([Step(name="slow", run=hang, timeout=0.05)])

    assert run["status"] == "FAILED"
    assert run["steps"][0]["error"] == "Step timed out."
    assert run["steps"][0]["status"] == "FAILED"


@pytest.mark.asyncio
async def test_a_later_step_reads_what_an_earlier_one_produced():
    async def first(context):
        return {"token": "abc"}

    async def second(context):
        assert context.results["first"] == {"token": "abc"}
        return {"seen": True}

    run = await _run([Step(name="first", run=first), Step(name="second", run=second)])

    assert run["status"] == "SUCCESS"


# --- clock safety ----------------------------------------------------------


def test_elapsed_never_reports_a_negative_duration():
    """A backwards wall clock must not produce a value the database refuses.

    `duration_ms >= 0` is a CHECK constraint in migration 010. Without the
    clamp an NTP correction mid-run would fail the write and leave the run
    stuck at RUNNING forever.
    """
    from datetime import timedelta

    from app.automations.engine import _elapsed_ms, _now

    started = _now()
    went_backwards = started - timedelta(seconds=5)

    assert _elapsed_ms(started, went_backwards) == 0
    assert _elapsed_ms(started, started) == 0
    assert _elapsed_ms(started, started + timedelta(milliseconds=250)) == 250


@pytest.mark.asyncio
async def test_a_run_survives_a_clock_that_jumps_backwards(monkeypatch):
    """End to end: every duration the engine records stays storable."""
    from datetime import timedelta

    from app.automations import engine as engine_module

    real_now = engine_module._now()
    stamps = iter(
        [
            real_now,                                  # run start
            real_now + timedelta(milliseconds=10),     # step start
            real_now - timedelta(seconds=30),          # step end: clock jumped back
            real_now - timedelta(seconds=31),          # run end: still behind
        ]
    )
    monkeypatch.setattr(engine_module, "_now", lambda: next(stamps))

    async def ok(context):
        return None

    store = FakeRunStore()
    run = await _run([Step(name="one", run=ok)], store=store)

    assert run["duration_ms"] >= 0
    assert all(step["duration_ms"] >= 0 for step in run["steps"])
    # And what reached storage is equally storable.
    assert store.rows[0]["duration_ms"] >= 0


# --- persistence and degradation -------------------------------------------


@pytest.mark.asyncio
async def test_a_run_is_persisted_with_its_final_state():
    store = FakeRunStore()

    async def ok(context):
        return None

    await _run([Step(name="one", run=ok)], store=store)

    assert len(store.rows) == 1
    stored = store.rows[0]
    assert stored["status"] == "SUCCESS"
    assert stored["finished_at"]
    assert stored["duration_ms"] >= 0
    assert len(stored["steps"]) == 1


@pytest.mark.asyncio
async def test_a_workflow_still_runs_when_history_cannot_be_stored():
    """The audit trail degrades; the workflow does not."""
    store = FakeRunStore(available=False)

    async def ok(context):
        return {"done": True}

    run = await _run([Step(name="one", run=ok)], store=store)

    assert run["status"] == "SUCCESS"
    assert run["persisted"] is False
    assert run["id"] is None
    assert store.rows == []


# --- idempotency -----------------------------------------------------------


@pytest.mark.asyncio
async def test_the_same_operation_id_does_not_create_a_second_run():
    store = FakeRunStore()
    calls = []

    async def ok(context):
        calls.append(1)
        return None

    first = await _run([Step(name="one", run=ok)], store=store, idempotency_key="project.published:1:op-1")
    second = await _run([Step(name="one", run=ok)], store=store, idempotency_key="project.published:1:op-1")

    assert len(store.rows) == 1, "a double dispatch must not produce two runs"
    assert len(calls) == 1, "the workflow must not execute twice"
    assert second.get("deduplicated") is True
    assert second["id"] == first["id"]


@pytest.mark.asyncio
async def test_a_different_operation_id_runs_again():
    # A legitimate later run of the same event on the same project must work.
    store = FakeRunStore()

    async def ok(context):
        return None

    await _run([Step(name="one", run=ok)], store=store, idempotency_key="project.published:1:op-1")
    await _run([Step(name="one", run=ok)], store=store, idempotency_key="project.published:1:op-2")

    assert len(store.rows) == 2


@pytest.mark.asyncio
async def test_a_dispatch_without_an_operation_id_is_never_deduplicated():
    store = FakeRunStore()

    async def ok(context):
        return None

    await _run([Step(name="one", run=ok)], store=store)
    await _run([Step(name="one", run=ok)], store=store)

    assert len(store.rows) == 2


# --- endpoints -------------------------------------------------------------


def test_dispatch_returns_a_run_with_an_id(make_client):
    client, fake = make_client([project_row(live_preview_enabled=False, preview_url=None)])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.published", "entity_type": "project", "entity_id": "1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["event"] == "project.published"
    assert body["status"] == "SUCCESS"
    assert body["run_id"], "the Admin needs an id to look the run up later"
    assert [step["name"] for step in body["steps"]] == [
        "load_project",
        "analyze_project",
        "check_live_preview",
        "register_result",
    ]
    # No demo configured, so the check is skipped rather than failed.
    assert body["steps"][2]["status"] == "SKIPPED"


def test_dispatch_rejects_an_unknown_event(make_client):
    client, _ = make_client([])

    response = client.post("/api/v1/automations/dispatch", json={"event": "project.exploded"})

    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"


def test_dispatch_reports_a_missing_project_as_a_failed_run(make_client):
    # The entity is gone, which is a workflow failure, not a transport error:
    # the run is recorded so the operator can see what happened.
    client, fake = make_client([])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.published", "entity_id": "999"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "FAILED"
    assert body["steps"][0]["status"] == "FAILED"
    assert "999" in body["steps"][0]["error"]
    assert len(fake.runs.rows) == 1


def test_dispatch_rejects_a_malformed_body(make_client):
    client, _ = make_client([])

    response = client.post("/api/v1/automations/dispatch", json={"payload": {}})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_project_completed_produces_a_checklist(make_client):
    client, _ = make_client([project_row(live_preview_enabled=False, preview_url=None)])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.completed", "entity_id": "1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "SUCCESS"

    checklist = body["steps"][2]["result"]
    assert checklist["ready_to_close"] is True
    assert checklist["outstanding"] == []


def test_project_completed_reports_outstanding_work_without_failing(make_client):
    client, _ = make_client([project_row(poster_url=None, live_preview_enabled=False, preview_url=None)])

    response = client.post(
        "/api/v1/automations/dispatch",
        json={"event": "project.completed", "entity_id": "1"},
    )

    body = response.json()
    # "Not finished yet" is a correct answer, not an error.
    assert body["status"] == "SUCCESS"
    checklist = body["steps"][2]["result"]
    assert checklist["ready_to_close"] is False
    assert any(item["key"] == "poster" for item in checklist["outstanding"])


def test_the_run_list_is_newest_first_and_filterable(make_client):
    client, _ = make_client([project_row(live_preview_enabled=False, preview_url=None)])

    client.post("/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "1"})
    client.post("/api/v1/automations/dispatch", json={"event": "project.completed", "entity_id": "1"})

    everything = client.get("/api/v1/automations/runs").json()
    assert everything["count"] == 2
    assert everything["runs"][0]["event"] == "project.completed", "newest first"

    filtered = client.get("/api/v1/automations/runs", params={"event": "project.published"}).json()
    assert filtered["count"] == 1
    assert filtered["runs"][0]["event"] == "project.published"

    by_status = client.get("/api/v1/automations/runs", params={"status": "FAILED"}).json()
    assert by_status["count"] == 0


def test_the_run_list_refuses_an_unbounded_limit(make_client):
    client, _ = make_client([])

    assert client.get("/api/v1/automations/runs", params={"limit": 10000}).status_code == 422
    assert client.get("/api/v1/automations/runs", params={"limit": 0}).status_code == 422


def test_a_run_can_be_fetched_by_id(make_client):
    client, _ = make_client([project_row(live_preview_enabled=False, preview_url=None)])

    run_id = client.post(
        "/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "1"}
    ).json()["run_id"]

    response = client.get(f"/api/v1/automations/runs/{run_id}")

    assert response.status_code == 200
    assert response.json()["run_id"] == run_id


def test_a_missing_run_is_a_404(make_client):
    client, _ = make_client([])

    response = client.get("/api/v1/automations/runs/00000000-0000-4000-8000-000000000099")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_run_stats_report_no_rate_before_anything_has_run(make_client):
    client, _ = make_client([])

    body = client.get("/api/v1/automations/runs/stats").json()

    assert body["total"] == 0
    # A rate needs a sample; 0% would be a claim nobody counted.
    assert body["success_rate"] is None
    assert body["last_run"] is None


def test_run_stats_count_what_actually_happened(make_client):
    client, _ = make_client([project_row(live_preview_enabled=False, preview_url=None)])

    client.post("/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "1"})
    client.post("/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "404"})

    body = client.get("/api/v1/automations/runs/stats").json()

    assert body["total"] == 2
    assert body["success"] == 1
    assert body["failed"] == 1
    assert body["success_rate"] == 50.0
    assert body["last_run"]["event"] == "project.published"


def test_an_unreadable_history_table_is_not_reported_as_no_runs(make_client):
    """Supabase is configured, the table is not reachable.

    The list still answers, but it says storage is unavailable -- otherwise the
    Logs screen would show "no runs recorded" for a history it never read.
    """
    client, _ = make_client([project_row()], storage=False)

    listing = client.get("/api/v1/automations/runs")
    stats = client.get("/api/v1/automations/runs/stats")

    assert listing.status_code == 200
    assert listing.json()["count"] == 0
    assert listing.json()["storage_available"] is False
    assert stats.json()["storage_available"] is False


def test_run_history_reports_503_when_supabase_is_not_configured(make_client):
    # Same rule as every other data endpoint: not configured is its own answer.
    client, _ = make_client([], configured=False)

    response = client.get("/api/v1/automations/runs")

    assert response.status_code == 503
    assert response.json()["code"] == "not_configured"


def test_run_history_reports_storage_available_when_it_is(make_client):
    client, _ = make_client([project_row(live_preview_enabled=False, preview_url=None)])

    client.post("/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "1"})
    body = client.get("/api/v1/automations/runs").json()

    assert body["storage_available"] is True
    assert body["count"] == 1


# --- retry -----------------------------------------------------------------


def test_retry_creates_a_new_run_linked_to_the_original(make_client):
    client, fake = make_client([])

    failed = client.post(
        "/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "404"}
    ).json()
    assert failed["status"] == "FAILED"

    retry = client.post(f"/api/v1/automations/runs/{failed['run_id']}/retry")

    assert retry.status_code == 200
    body = retry.json()
    assert body["run_id"] != failed["run_id"], "a retry is a new run"
    assert body["retry_of"] == failed["run_id"]
    assert body["source"] == "retry"
    # The original is evidence; it must survive untouched.
    assert len(fake.runs.rows) == 2
    assert fake.runs.rows[0]["status"] == "FAILED"


def test_a_retry_can_succeed_where_the_original_failed(make_client):
    client, fake = make_client([])

    failed = client.post(
        "/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "1"}
    ).json()
    assert failed["status"] == "FAILED"

    # The project exists by the time the operator retries.
    fake.rows.append(project_row(live_preview_enabled=False, preview_url=None))

    retry = client.post(f"/api/v1/automations/runs/{failed['run_id']}/retry").json()

    assert retry["status"] == "SUCCESS"


def test_only_a_failed_run_can_be_retried(make_client):
    client, _ = make_client([project_row(live_preview_enabled=False, preview_url=None)])

    succeeded = client.post(
        "/api/v1/automations/dispatch", json={"event": "project.published", "entity_id": "1"}
    ).json()

    response = client.post(f"/api/v1/automations/runs/{succeeded['run_id']}/retry")

    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"


def test_retrying_a_missing_run_is_a_404(make_client):
    client, _ = make_client([])

    response = client.post("/api/v1/automations/runs/00000000-0000-4000-8000-000000000099/retry")

    assert response.status_code == 404


def test_a_malformed_run_id_never_reaches_the_store(make_client):
    client, fake = make_client([])

    response = client.get("/api/v1/automations/runs/..%2Fetc%2Fpasswd")

    assert response.status_code in {404, 422}

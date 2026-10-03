"""Persistence for workflow runs (`public.automation_runs`).

Separated from the engine so the engine never knows whether history is being
stored: a workflow must not stop working because its audit trail has nowhere
to go.

So every method here degrades. A storage failure is logged, reported through
`available`, and returned to the caller as "not stored" -- never raised into
the middle of a run. The run still executes and the caller still gets its
result; only the history is missing, and the Admin is told so.

The table's primary key is `id`. The API calls it `run_id`; that mapping lives
in one place (api/v1/automations.py) and nowhere else.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.logging import get_logger, log_event
from app.services.supabase_service import (
    SupabaseConflict,
    SupabaseError,
    SupabaseRejected,
    SupabaseService,
)
from app.utils.dates import parse_timestamp

logger = get_logger("runs")

TABLE = "automation_runs"

RUN_COLUMNS = ",".join(
    [
        "id",
        "event",
        "status",
        "source",
        "entity_type",
        "entity_id",
        "payload",
        "steps",
        "result",
        "error",
        "started_at",
        "finished_at",
        "duration_ms",
        "retry_of",
        "requested_by",
        "created_at",
    ]
)

# Nothing unbounded ever leaves this module.
DEFAULT_LIMIT = 25
MAX_LIMIT = 100

# How many runs needing attention the statistics name.
ATTENTION_LIMIT = 5

# Below this many runs a success rate is noise, not a rate.
MIN_RATE_SAMPLE = 5


def is_stale(run: dict[str, Any], *, minutes: int, now: datetime | None = None) -> bool:
    """A RUNNING run older than `minutes`: its process stopped mid-run."""
    if run.get("status") != "RUNNING":
        return False
    started = parse_timestamp(run.get("started_at") or run.get("created_at"))
    if started is None:
        return False
    return (now or datetime.now(UTC)) - started > timedelta(minutes=minutes)


class RunStore:
    def __init__(self, supabase: SupabaseService) -> None:
        self._supabase = supabase
        # Latches once storage is confirmed broken, so one request does not
        # retry a doomed write on every step.
        self._storage_broken = False

    @property
    def configured(self) -> bool:
        return self._supabase.configured

    async def available(self) -> bool:
        """Whether run history can actually be read. Used by health."""
        if not self._supabase.configured or self._storage_broken:
            return False

        try:
            await self._supabase._get(TABLE, {"select": "id", "limit": "1"})
            return True
        except SupabaseError:
            return False

    async def schema_current(self) -> bool:
        """Whether the table has every column this version writes.

        False when the automation v2 migration has not been applied: the
        service would then lose each run's author on insert. Used by /ready.
        """
        if not self._supabase.configured:
            return False
        try:
            await self._supabase._get(TABLE, {"select": RUN_COLUMNS, "limit": "1"})
            # Same migration: the opportunity handoff the commercial workflow writes.
            await self._supabase._get(
                "commercial_project_handoffs", {"select": "opportunity_id,run_id", "limit": "1"}
            )
            return True
        except SupabaseError:
            return False

    async def create(self, run: dict[str, Any]) -> tuple[dict[str, Any] | None, bool]:
        """Inserts a run. Returns (row, inserted).

        `inserted` is False when the idempotency key was already taken: the
        row returned is then the run that holds it, recorded by an identical
        dispatch. (None, False) means history could not be written at all.
        """
        if not self._supabase.configured or self._storage_broken:
            return None, False

        try:
            rows = await self._supabase._write(TABLE, "POST", json=run)
            return (rows[0] if rows else None), bool(rows)
        except SupabaseConflict:
            key = run.get("idempotency_key")
            log_event(logger, logging.INFO, "automation.run.duplicate", idempotency_key=key)
            existing = await self.find_by_idempotency_key(key) if key else None
            return existing, False
        except SupabaseError as error:
            self._note_failure("create", error)
            return None, False

    async def update(self, run_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        if not run_id or not self._supabase.configured or self._storage_broken:
            return None

        try:
            rows = await self._supabase._write(TABLE, "PATCH", json=changes, params={"id": f"eq.{run_id}"})
            return rows[0] if rows else None
        except SupabaseError as error:
            self._note_failure("update", error)
            return None

    async def find_by_idempotency_key(self, key: str | None) -> dict[str, Any] | None:
        if not key or not self._supabase.configured or self._storage_broken:
            return None

        try:
            rows = await self._supabase._get(
                TABLE, {"select": RUN_COLUMNS, "idempotency_key": f"eq.{key}", "limit": "1"}
            )
            return rows[0] if rows else None
        except SupabaseError as error:
            self._note_failure("lookup", error)
            return None

    async def get(self, run_id: str) -> dict[str, Any] | None:
        if not run_id or not self._supabase.configured or self._storage_broken:
            return None

        try:
            rows = await self._supabase._get(
                TABLE, {"select": RUN_COLUMNS, "id": f"eq.{run_id}", "limit": "1"}
            )
            return rows[0] if rows else None
        except SupabaseError as error:
            self._note_failure("get", error)
            return None

    async def list(
        self,
        *,
        event: str | None = None,
        status: str | None = None,
        entity_id: str | None = None,
        retry_of: str | None = None,
        limit: int = DEFAULT_LIMIT,
    ) -> list[dict[str, Any]]:
        """Newest first, always bounded."""
        if not self._supabase.configured or self._storage_broken:
            return []

        params = {
            "select": RUN_COLUMNS,
            "order": "created_at.desc",
            # Clamped here rather than trusted from the query string: a caller
            # asking for 10000 rows gets MAX_LIMIT.
            "limit": str(max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))),
        }
        if event:
            params["event"] = f"eq.{event}"
        if status:
            params["status"] = f"eq.{status}"
        if entity_id:
            params["entity_id"] = f"eq.{entity_id}"
        if retry_of:
            params["retry_of"] = f"eq.{retry_of}"

        try:
            return await self._supabase._get(TABLE, params)
        except SupabaseError as error:
            self._note_failure("list", error)
            return []

    async def stats(self, *, limit: int = MAX_LIMIT, stale_minutes: int = 15) -> dict[str, Any]:
        """Counts over the most recent runs.

        Computed from the same bounded window the Logs screen reads, so the
        Dashboard never claims a rate it did not actually count.
        """
        runs = await self.list(limit=limit)
        now = datetime.now(UTC)

        total = len(runs)
        success = sum(1 for run in runs if run.get("status") == "SUCCESS")
        failed = sum(1 for run in runs if run.get("status") == "FAILED")
        stale = [run for run in runs if is_stale(run, minutes=stale_minutes, now=now)]
        last = runs[0] if runs else None

        # A failed run stops needing attention once a retry of it succeeded.
        retried_ok = {
            run.get("retry_of") for run in runs if run.get("retry_of") and run.get("status") == "SUCCESS"
        }
        attention: list[dict[str, Any]] = []
        for run in runs:
            if len(attention) >= ATTENTION_LIMIT:
                break
            business = (
                (run.get("result") or {}).get("business_status")
                if isinstance(run.get("result"), dict)
                else None
            )
            if run.get("status") == "FAILED" and run.get("id") not in retried_ok:
                reason = "failed"
            elif run in stale:
                reason = "stale"
            elif run.get("status") == "SUCCESS" and business == "ATTENTION":
                reason = "attention"
            else:
                continue
            attention.append(
                {
                    "run_id": run.get("id"),
                    "event": run.get("event"),
                    "status": run.get("status"),
                    "reason": reason,
                    "entity_type": run.get("entity_type"),
                    "entity_id": run.get("entity_id"),
                    "error": run.get("error"),
                    "created_at": run.get("created_at"),
                }
            )

        return {
            "total": total,
            "success": success,
            "failed": failed,
            "running_stale": len(stale),
            # None rather than a number when there is too little to count: a
            # rate needs a sample.
            "success_rate": round((success / total) * 100, 1) if total >= MIN_RATE_SAMPLE else None,
            "last_run": (
                {
                    "run_id": last.get("id"),
                    "event": last.get("event"),
                    "status": last.get("status"),
                    "created_at": last.get("created_at"),
                }
                if last
                else None
            ),
            "attention": attention,
        }

    def _note_failure(self, operation: str, error: Exception) -> None:
        log_event(
            logger,
            logging.WARNING,
            "automation.storage.unavailable",
            operation=operation,
            error=type(error).__name__,
            code=getattr(error, "code", "") if isinstance(error, SupabaseRejected) else "",
        )
        self._storage_broken = True


def get_run_store(supabase: SupabaseService) -> RunStore:
    return RunStore(supabase)

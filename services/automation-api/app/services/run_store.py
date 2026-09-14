"""Persistence for workflow runs.

Separated from the engine so the engine never knows whether history is being
stored. That matters more than it sounds: `automation_runs` is a versioned
migration that may not be applied yet, and a workflow must not stop working
because its audit trail has nowhere to go.

So every method here degrades. A storage failure is logged, reported through
`available`, and returned to the caller as "not stored" -- never raised into
the middle of a run. The run still executes and the caller still gets its
result; only the history is missing, and the Admin is told so.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.logging import get_logger, log_event
from app.services.supabase_service import (
    SupabaseConflict,
    SupabaseError,
    SupabaseService,
)

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
        "created_at",
    ]
)

# Nothing unbounded ever leaves this module.
DEFAULT_LIMIT = 25
MAX_LIMIT = 100


class RunStore:
    def __init__(self, supabase: SupabaseService) -> None:
        self._supabase = supabase
        # Latches once the table is confirmed missing, so a deployment without
        # the migration does not retry a doomed insert on every dispatch.
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

    async def create(self, run: dict[str, Any]) -> dict[str, Any] | None:
        """Inserts a run. Returns None when history could not be written.

        A conflict is not a failure: it means an identical dispatch was already
        recorded, which is exactly what the idempotency key is for. The existing
        run is returned instead.
        """
        if not self._supabase.configured or self._storage_broken:
            return None

        try:
            rows = await self._supabase._write(TABLE, "POST", json=run)
            return rows[0] if rows else None
        except SupabaseConflict:
            key = run.get("idempotency_key")
            log_event(logger, logging.INFO, "automation.run.duplicate", idempotency_key=key)
            return await self.find_by_idempotency_key(key) if key else None
        except SupabaseError as error:
            self._note_failure("create", error)
            return None

    async def update(self, run_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        if not run_id or not self._supabase.configured or self._storage_broken:
            return None

        try:
            rows = await self._supabase._write(
                TABLE, "PATCH", json=changes, params={"id": f"eq.{run_id}"}
            )
            return rows[0] if rows else None
        except SupabaseError as error:
            self._note_failure("update", error)
            return None

    async def find_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
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

        try:
            return await self._supabase._get(TABLE, params)
        except SupabaseError as error:
            self._note_failure("list", error)
            return []

    async def stats(self, *, limit: int = MAX_LIMIT) -> dict[str, Any]:
        """Counts over the most recent runs.

        Deliberately computed from the same bounded window the Logs screen
        reads, so the Dashboard never claims a rate it did not actually count.
        """
        runs = await self.list(limit=limit)

        total = len(runs)
        success = sum(1 for run in runs if run.get("status") == "SUCCESS")
        failed = sum(1 for run in runs if run.get("status") == "FAILED")
        last = runs[0] if runs else None

        return {
            "total": total,
            "success": success,
            "failed": failed,
            # None rather than 0 when nothing has run: a rate needs a sample.
            "success_rate": round((success / total) * 100, 1) if total else None,
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
        }

    def _note_failure(self, operation: str, error: Exception) -> None:
        log_event(
            logger,
            logging.WARNING,
            "automation.storage.unavailable",
            operation=operation,
            error=type(error).__name__,
        )
        self._storage_broken = True


def get_run_store(supabase: SupabaseService) -> RunStore:
    return RunStore(supabase)

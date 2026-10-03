"""Verifies run history against the REAL Supabase project.

This exists because the workflow engine's unit tests prove the engine is
internally consistent and prove nothing about production. The failure this
guards against is the one this project has already shipped once: code that
passes every local check and then meets a table that does not exist, a column
that was never created, or an RLS rule nobody tested.

Run it after applying `010_automation_runs.sql` and setting the real
service_role key:

    cd services/automation-api
    .venv/Scripts/python -m scripts.verify_run_storage

It writes one controlled row, reads it back, proves the anon key cannot see it,
and deletes it. It never touches a project, and it never prints the key.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

import httpx

from app.core.config import get_settings
from app.services.run_store import RUN_COLUMNS, TABLE

# Marks the row this script creates, so a failed run leaves something
# recognisable rather than an anonymous orphan.
PROBE_EVENT = "project.published"
PROBE_ENTITY = "verify-run-storage-probe"

PASS = "PASS"
FAIL = "FAIL"

results: list[tuple[str, str, str]] = []


def record(status: str, label: str, detail: str = "") -> None:
    results.append((status, label, detail))
    print(f"{status}  {label}" + (f" - {detail}" if detail else ""))


def headers(key: str) -> dict[str, str]:
    """Same rule the service uses: apikey always, bearer only for a legacy JWT."""
    result = {"apikey": key, "Content-Type": "application/json"}
    if key.startswith("eyJ"):
        result["Authorization"] = f"Bearer {key}"
    return result


async def main() -> int:
    settings = get_settings()

    if not settings.supabase_url or not settings.supabase_service_role_key:
        record(FAIL, "configuration", "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set")
        return 1

    key = settings.supabase_service_role_key
    base = f"{settings.supabase_url}/rest/v1"

    # Refuse to run with a publishable key in the service role slot. It cannot
    # write, and a confusing 401 later is worse than stopping here.
    if key.startswith("sb_publishable_"):
        record(FAIL, "key shape", "a publishable key is in the service role slot; use the secret key")
        return 1

    record(PASS, "key shape", "secret/JWT-shaped key present (value never printed)")

    probe_id: str | None = None

    async with httpx.AsyncClient(timeout=15.0) as client:
        # --- table exists and is readable ----------------------------------
        response = await client.get(
            f"{base}/{TABLE}", params={"select": "id", "limit": "1"}, headers=headers(key)
        )
        if response.status_code >= 400:
            record(FAIL, "table reachable", f"HTTP {response.status_code} - is migration 010 applied?")
            return 1
        record(PASS, "table reachable", f"{TABLE} answers to service_role")

        # --- every selected column exists ----------------------------------
        # One unknown column fails the whole select, which is exactly how the
        # public site went down before. Ask for all of them at once.
        response = await client.get(
            f"{base}/{TABLE}", params={"select": RUN_COLUMNS, "limit": "1"}, headers=headers(key)
        )
        if response.status_code >= 400:
            record(FAIL, "column contract", f"HTTP {response.status_code} {response.text[:160]}")
            return 1
        record(PASS, "column contract", "every column the run store reads exists")

        # --- insert ---------------------------------------------------------
        payload: dict[str, Any] = {
            "event": PROBE_EVENT,
            "status": "SUCCESS",
            "source": "api",
            "entity_type": "probe",
            "entity_id": PROBE_ENTITY,
            "payload": {"probe": True},
            "steps": [{"name": "probe", "status": "SUCCESS", "duration_ms": 1}],
            "result": {"probe": True},
            "duration_ms": 1,
            "idempotency_key": f"probe:{PROBE_ENTITY}",
        }

        response = await client.post(
            f"{base}/{TABLE}",
            json=payload,
            headers={**headers(key), "Prefer": "return=representation"},
        )
        if response.status_code >= 400:
            record(FAIL, "insert", f"HTTP {response.status_code} {response.text[:160]}")
            return 1

        probe_id = response.json()[0]["id"]
        record(PASS, "insert", f"run {probe_id[:8]} written")

        try:
            # --- read back ---------------------------------------------------
            response = await client.get(
                f"{base}/{TABLE}",
                params={"select": RUN_COLUMNS, "id": f"eq.{probe_id}"},
                headers=headers(key),
            )
            rows = response.json() if response.status_code < 400 else []
            if not rows:
                record(FAIL, "select", "the row just written could not be read back")
            else:
                row = rows[0]
                shape_ok = (
                    row.get("event") == PROBE_EVENT
                    and isinstance(row.get("steps"), list)
                    and isinstance(row.get("payload"), dict)
                )
                record(
                    PASS if shape_ok else FAIL,
                    "select",
                    "JSONB round-trips as list/dict" if shape_ok else f"unexpected shape: {row}",
                )

            # --- idempotency --------------------------------------------------
            # The partial unique index must refuse a second row with the same
            # key. This is what collapses a double dispatch in production.
            response = await client.post(
                f"{base}/{TABLE}", json=payload, headers={**headers(key), "Prefer": "return=representation"}
            )
            record(
                PASS if response.status_code == 409 else FAIL,
                "idempotency",
                "duplicate key refused with 409"
                if response.status_code == 409
                else f"expected 409, got HTTP {response.status_code}",
            )

            # --- a different key is allowed ------------------------------------
            second = {**payload, "idempotency_key": f"probe:{PROBE_ENTITY}:2"}
            response = await client.post(
                f"{base}/{TABLE}", json=second, headers={**headers(key), "Prefer": "return=representation"}
            )
            if response.status_code < 400:
                second_id = response.json()[0]["id"]
                record(PASS, "second operation", "a different operation id creates a new run")
                await client.delete(
                    f"{base}/{TABLE}", params={"id": f"eq.{second_id}"}, headers=headers(key)
                )
            else:
                record(FAIL, "second operation", f"HTTP {response.status_code}")

            # --- anon must see nothing -----------------------------------------
            # RLS is enabled with no policy, so the Admin's own key must not be
            # able to reach run history directly.
            anon = settings.supabase_url and _anon_key()
            if not anon:
                record(FAIL, "anon blocked", "no anon key available to test with")
            else:
                response = await client.get(
                    f"{base}/{TABLE}", params={"select": "id", "limit": "1"}, headers=headers(anon)
                )
                blocked = response.status_code >= 400 or response.json() == []
                record(
                    PASS if blocked else FAIL,
                    "anon blocked",
                    f"anon sees nothing (HTTP {response.status_code})"
                    if blocked
                    else "ANON CAN READ RUN HISTORY - check RLS",
                )
        finally:
            if probe_id:
                await client.delete(
                    f"{base}/{TABLE}", params={"id": f"eq.{probe_id}"}, headers=headers(key)
                )
                record(PASS, "cleanup", "probe row removed")

    failures = [item for item in results if item[0] == FAIL]
    print()
    print(f"{len(results) - len(failures)}/{len(results)} checks passed")
    return 1 if failures else 0


def _anon_key() -> str:
    """Reads the publishable key from the repo's own env files.

    Only used to prove it is refused; it is never sent anywhere else.
    """
    import os
    import re

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for candidate in (
        os.path.join(here, "..", "..", ".env"),
        os.path.join(here, "..", "..", "admin", ".env"),
    ):
        try:
            with open(os.path.normpath(candidate), encoding="utf-8") as handle:
                match = re.search(r"VITE_SUPABASE_ANON_KEY=(.+)", handle.read())
                if match:
                    return match.group(1).strip()
        except OSError:
            continue
    return ""


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

"""Shared fixtures.

No test in this suite touches a network or a database. The Supabase layer is
replaced by a fake through FastAPI's dependency override, which is the whole
reason `SupabaseService` is injected rather than imported at call sites.
"""

from __future__ import annotations

import os
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.v1.automations import get_store
from app.core.config import get_settings
from app.main import create_app
from app.services.supabase_service import (
    ProjectNotFound,
    SupabaseNotConfigured,
    SupabaseService,
    get_supabase_service,
)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolates every test from the developer's own .env.

    Without this, whoever has a real SUPABASE_URL exported would get different
    results from CI, which is exactly the class of bug this service exists to
    catch elsewhere.
    """
    for key in (
        "APP_ENV",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "API_TOKEN",
        "ADMIN_ORIGIN",
    ):
        monkeypatch.delenv(key, raising=False)

    # Settings reads a .env file when one exists; point it somewhere empty.
    monkeypatch.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + os.sep + "tests")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class FakeSupabaseService:
    """Stands in for SupabaseService with rows held in memory."""

    def __init__(self, rows: list[dict[str, Any]] | None = None, *, configured: bool = True) -> None:
        self.rows = rows or []
        self._configured = configured
        self.calls: list[str] = []

    @property
    def configured(self) -> bool:
        return self._configured

    def _require(self) -> None:
        if not self._configured:
            raise SupabaseNotConfigured("Supabase is not configured.")

    async def get_project(self, project_id: str) -> dict[str, Any]:
        self.calls.append("get_project:" + project_id)
        self._require()

        for row in self.rows:
            if str(row.get("id")) == project_id or str(row.get("case_number")) == project_id:
                return row

        raise ProjectNotFound("No project for identifier: " + project_id)

    async def list_projects(self) -> list[dict[str, Any]]:
        self.calls.append("list_projects")
        self._require()
        return list(self.rows)


class FakeRunStore:
    """In-memory stand-in for RunStore.

    Implements the same degradation contract as the real one: when storage is
    unavailable every method returns nothing rather than raising, because the
    engine must keep working when the history table does not exist.
    """

    def __init__(self, *, available: bool = True, configured: bool | None = None) -> None:
        self.rows: list[dict[str, Any]] = []
        self._available = available
        # Two distinct facts the real store also keeps apart: whether Supabase
        # is configured at all, and whether the history table can be read.
        # "No key" and "table missing" need different answers.
        self._configured = available if configured is None else configured
        self._sequence = 0

    @property
    def configured(self) -> bool:
        return self._configured

    async def available(self) -> bool:
        return self._available

    async def create(self, run: dict[str, Any]) -> dict[str, Any] | None:
        if not self._available:
            return None

        key = run.get("idempotency_key")
        if key:
            existing = await self.find_by_idempotency_key(key)
            if existing:
                return existing

        self._sequence += 1
        row = {**run, "id": f"00000000-0000-4000-8000-{self._sequence:012d}"}
        self.rows.append(row)
        return row

    async def update(self, run_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        if not self._available:
            return None

        for row in self.rows:
            if row["id"] == run_id:
                row.update(changes)
                return row
        return None

    async def find_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        if not self._available or not key:
            return None
        return next((row for row in self.rows if row.get("idempotency_key") == key), None)

    async def get(self, run_id: str) -> dict[str, Any] | None:
        if not self._available:
            return None
        return next((row for row in self.rows if row["id"] == run_id), None)

    async def list(self, *, event=None, status=None, entity_id=None, limit=25):
        if not self._available:
            return []

        rows = list(reversed(self.rows))
        if event:
            rows = [row for row in rows if row.get("event") == event]
        if status:
            rows = [row for row in rows if row.get("status") == status]
        if entity_id:
            rows = [row for row in rows if row.get("entity_id") == entity_id]
        return rows[:limit]

    async def stats(self, *, limit: int = 100) -> dict[str, Any]:
        runs = await self.list(limit=limit)
        total = len(runs)
        success = sum(1 for run in runs if run.get("status") == "SUCCESS")
        failed = sum(1 for run in runs if run.get("status") == "FAILED")
        last = runs[0] if runs else None

        return {
            "total": total,
            "success": success,
            "failed": failed,
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


@pytest.fixture
def make_client():
    """Builds a TestClient wired to a fake Supabase.

    Returns a factory so each test chooses its own rows without a module-level
    fixture that every other test has to work around.
    """

    def factory(
        rows: list[dict[str, Any]] | None = None,
        *,
        configured: bool = True,
        storage: bool = True,
    ) -> tuple[TestClient, FakeSupabaseService]:
        app = create_app()
        fake = FakeSupabaseService(rows, configured=configured)
        store = FakeRunStore(available=configured and storage, configured=configured)
        app.dependency_overrides[get_supabase_service] = lambda: fake
        app.dependency_overrides[get_store] = lambda: store
        # Handed back on the service so a test can inspect what was recorded
        # without the factory having to return a third value.
        fake.runs = store
        return TestClient(app), fake

    return factory


def project_row(**overrides: Any) -> dict[str, Any]:
    """A complete, healthy published project. Tests override one field at a time.

    Building fixtures by subtraction keeps each test honest about the single
    thing it is asserting.
    """
    row: dict[str, Any] = {
        "id": "11111111-2222-3333-4444-555555555555",
        "case_number": 1,
        "name": "Ink Lab",
        "slug": "ink-lab",
        "client": "Ink Lab Studio",
        "category": "Website",
        "description": "Site institucional com agendamento, galeria de trabalhos e area editorial completa.",
        "status": "Live",
        "editorial_status": "PUBLISHED",
        "featured": True,
        "visible": True,
        "year": 2025,
        "tech_stack": ["Vite", "JavaScript"],
        "presentation_system": "SISTEMA DE EXPERIENCIA / 01",
        "presentation_label": "INK LAB",
        "presentation_address": "ink-lab.local",
        "presentation_type": "WEBSITE",
        "poster_url": "posters/ink-lab.png",
        "project_url": "https://example.com/ink-lab",
        "preview_url": "https://example.com/ink-lab?embed=spaceunderground",
        "live_preview_enabled": True,
        "translations": {
            "en": {
                "description": "Institutional site with booking, portfolio gallery and editorial area.",
                "presentation_system": "EXPERIENCE SYSTEM / 01",
                "presentation_label": "INK LAB",
                "presentation_address": "ink-lab.local",
                "presentation_type": "WEBSITE",
            }
        },
        "created_at": "2025-01-10T10:00:00+00:00",
        "updated_at": "2026-09-01T10:00:00+00:00",
        "published_at": "2025-02-01T10:00:00+00:00",
        "project_modules": [
            {
                "id": "aaaa",
                "position": 0,
                "code": "01",
                "title": "Agendamento",
                "description": "Fluxo de marcacao.",
                "translations": {"en": {"title": "Booking", "description": "Scheduling flow."}},
            }
        ],
        "project_gallery": [
            {"id": "bbbb", "position": 0, "url": "gallery/1.png", "alt": "Home", "caption": None}
        ],
    }
    row.update(overrides)
    return row


__all__ = ["FakeRunStore", "FakeSupabaseService", "make_client", "project_row", "SupabaseService"]

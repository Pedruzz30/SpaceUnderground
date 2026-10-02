"""Shared fixtures.

No test in this suite touches a network or a database. The Supabase layer is
replaced by a fake through FastAPI's dependency override, which is the whole
reason `SupabaseService` is injected rather than imported at call sites.

The fake follows the current schema and access model: projects, clients, the
commercial pipeline (`commercial_opportunities`), the ledger
(`financial_transactions`), opportunity handoffs, and permissions answered the
way `public.has_permission` answers them -- per member, per key.
"""

from __future__ import annotations

import os
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.v1.automations import get_store
from app.core.config import get_settings
from app.core.security import reset_identity_cache
from app.main import create_app
from app.services.run_store import RunStore
from app.services.supabase_service import (
    InvalidToken,
    RecordNotFound,
    SupabaseConflict,
    SupabaseNotConfigured,
    SupabaseRejected,
    SupabaseService,
    get_supabase_service,
)

MEMBER_ID = "84c64f19-83fb-4613-a7ce-83c720c6798c"
OTHER_ID = "11111111-1111-4111-8111-111111111111"

# What each RBAC role holds, for the permissions this service asks about
# (supabase/migrations/20261002033705_security_rbac_approval_foundation.sql).
OWNER = {
    "logs.read",
    "projects.read",
    "projects.create",
    "projects.edit",
    "projects.publish",
    "commercial.read",
    "commercial.edit",
    "finance.read",
    "finance.edit",
    "settings.edit",
}
MANAGER = {
    "logs.read",
    "projects.read",
    "projects.create",
    "projects.edit",
    "projects.publish",
    "commercial.read",
    "commercial.edit",
}
SEO = {"logs.read", "projects.read", "projects.create", "projects.edit", "projects.publish"}
COLLABORATOR: set[str] = set()


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
        "ADMIN_JWT_AUTH",
        "APP_TIMEZONE",
    ):
        monkeypatch.delenv(key, raising=False)

    # Verified identities outlive a Settings reload, so a test that changes the
    # auth configuration must not inherit an identity proven under the old one.
    reset_identity_cache()

    # Settings reads a .env file when one exists; point it somewhere empty.
    monkeypatch.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + os.sep + "tests")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
    reset_identity_cache()


class FakeSupabaseService:
    """Stands in for SupabaseService with rows held in memory."""

    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        *,
        configured: bool = True,
        opportunities: list[dict[str, Any]] | None = None,
        clients: list[dict[str, Any]] | None = None,
        transactions: list[dict[str, Any]] | None = None,
        handoffs: list[dict[str, Any]] | None = None,
        tokens: dict[str, str] | None = None,
        grants: dict[str, set[str]] | None = None,
        identity_error: Exception | None = None,
        permission_error: Exception | None = None,
        rpc_error: Exception | None = None,
    ) -> None:
        self.rows = rows if rows is not None else []
        self.opportunities = opportunities or []
        self.clients = clients or []
        self.transactions = transactions or []
        self.handoffs = handoffs or []
        # Access token -> user id, as Supabase Auth would resolve it. Anything
        # not listed is an invalid token.
        self.tokens = tokens or {}
        # User id -> the permissions public.has_permission grants them.
        self.grants = grants or {}
        self.identity_error = identity_error
        self.permission_error = permission_error
        self.rpc_error = rpc_error
        self._configured = configured
        self.calls: list[str] = []
        self.activity: list[dict[str, Any]] = []

    @property
    def configured(self) -> bool:
        return self._configured

    def _require(self) -> None:
        if not self._configured:
            raise SupabaseNotConfigured("Supabase is not configured.")

    # -- projects --------------------------------------------------------------

    async def get_project(self, project_id: str) -> dict[str, Any]:
        self.calls.append("get_project:" + project_id)
        self._require()
        for row in self.rows:
            if str(row.get("id")) == project_id or str(row.get("case_number")) == project_id.lstrip("0"):
                return row
        raise RecordNotFound("No project for identifier: " + project_id)

    async def list_projects(self) -> list[dict[str, Any]]:
        self.calls.append("list_projects")
        self._require()
        return list(self.rows)

    # -- commercial ------------------------------------------------------------

    async def get_opportunity(self, opportunity_id: str) -> dict[str, Any]:
        self.calls.append("get_opportunity:" + opportunity_id)
        self._require()
        for row in self.opportunities:
            if str(row.get("id")) == opportunity_id:
                return row
        raise RecordNotFound("No opportunity for identifier: " + opportunity_id)

    async def list_open_opportunities_due_before(self, day: str) -> list[dict[str, Any]]:
        self.calls.append("list_open_opportunities_due_before:" + day)
        self._require()
        return [
            row
            for row in self.opportunities
            if row.get("stage") in ("NEW", "CONTACTED", "PROPOSAL", "NEGOTIATION")
            and row.get("next_action_at")
            and str(row["next_action_at"]) < day
        ]

    async def get_handoff_for_opportunity(self, opportunity_id: str) -> dict[str, Any] | None:
        self.calls.append("get_handoff_for_opportunity:" + opportunity_id)
        self._require()
        return next((row for row in self.handoffs if row.get("opportunity_id") == opportunity_id), None)

    async def get_handoff_for_project(self, project_id: str) -> dict[str, Any] | None:
        self.calls.append("get_handoff_for_project:" + project_id)
        self._require()
        return next((row for row in self.handoffs if row.get("project_id") == project_id), None)

    # -- clients ---------------------------------------------------------------

    async def get_client(self, client_id: str) -> dict[str, Any]:
        self.calls.append("get_client:" + client_id)
        self._require()
        for row in self.clients:
            if str(row.get("id")) == client_id:
                return row
        raise RecordNotFound("No client for identifier: " + client_id)

    # -- financial -------------------------------------------------------------

    async def list_transactions_for(self, *, opportunity_id=None, project_id=None) -> list[dict[str, Any]]:
        self.calls.append(f"list_transactions_for:{opportunity_id}:{project_id}")
        self._require()
        return [
            row
            for row in self.transactions
            if (opportunity_id and row.get("opportunity_id") == opportunity_id)
            or (project_id and row.get("project_id") == project_id)
        ]

    async def list_overdue_receivables(self, day: str) -> list[dict[str, Any]]:
        self.calls.append("list_overdue_receivables:" + day)
        self._require()
        return [
            row
            for row in self.transactions
            if row.get("type") == "INCOME"
            and row.get("status") == "PENDING"
            and str(row.get("due_date")) < day
        ]

    # -- the one business write (mirrors the SQL function) -----------------------

    async def open_project_for_opportunity(
        self, *, opportunity_id, category, name, slug, link_finance, actor_id, run_id
    ) -> dict[str, Any]:
        self.calls.append("open_project_for_opportunity:" + opportunity_id)
        self._require()
        if self.rpc_error:
            raise self.rpc_error

        opportunity = next((row for row in self.opportunities if row.get("id") == opportunity_id), None)
        if opportunity is None:
            raise SupabaseRejected("not found", status=400, code="AU001")
        if opportunity.get("stage") != "WON":
            raise SupabaseRejected("not won", status=400, code="AU002")

        handoff = next((row for row in self.handoffs if row.get("opportunity_id") == opportunity_id), None)
        created = handoff is None
        if created:
            final_slug = slug
            taken = {row.get("slug") for row in self.rows}
            suffix = 2
            while final_slug in taken:
                final_slug = f"{slug}-{suffix}"
                suffix += 1
            numbers = [row.get("case_number") for row in self.rows if isinstance(row.get("case_number"), int)]
            project = {
                "id": f"22222222-2222-4222-8222-{len(self.rows) + 1:012d}",
                "case_number": (max(numbers) if numbers else 0) + 1,
                "name": name,
                "slug": final_slug,
                "category": category,
                "status": "In Development",
                "editorial_status": "DRAFT",
                "visible": False,
                "client_id": None,
            }
            self.rows.append(project)
            handoff = {
                "id": f"33333333-3333-4333-8333-{len(self.handoffs) + 1:012d}",
                "opportunity_id": opportunity_id,
                "project_id": project["id"],
                "run_id": run_id,
            }
            self.handoffs.append(handoff)
            self.activity.append(
                {"action": "project.created", "entity_id": project["id"], "admin_user_id": actor_id}
            )
        project = next(row for row in self.rows if row.get("id") == handoff["project_id"])

        client_linked = False
        if project.get("client_id") is None and opportunity.get("client_id"):
            project["client_id"] = opportunity["client_id"]
            client_linked = True

        linked = 0
        if link_finance:
            for row in self.transactions:
                if (
                    row.get("opportunity_id") == opportunity_id
                    and not row.get("project_id")
                    and row.get("status") != "CANCELLED"
                ):
                    row["project_id"] = project["id"]
                    linked += 1

        return {
            "project_id": project["id"],
            "case_number": project["case_number"],
            "slug": project["slug"],
            "handoff_id": handoff["id"],
            "project_created": created,
            "client_linked": client_linked,
            "transactions_linked": linked,
        }

    # -- identity ----------------------------------------------------------------

    async def get_token_user(self, access_token: str) -> dict[str, Any] | None:
        self.calls.append("get_token_user")
        self._require()
        if self.identity_error:
            raise self.identity_error
        user_id = self.tokens.get(access_token)
        return {"id": user_id, "email": f"{user_id}@example.test"} if user_id else None

    async def member_has_permission(self, access_token: str, permission: str) -> bool:
        self.calls.append("has_permission:" + permission)
        self._require()
        if self.permission_error:
            raise self.permission_error
        user_id = self.tokens.get(access_token)
        if not user_id:
            raise InvalidToken("refused")
        return permission in self.grants.get(user_id, set())

    async def member_access(self, access_token: str) -> dict[str, Any]:
        self.calls.append("my_access")
        return {}


class FakeRunStore:
    """In-memory stand-in for RunStore.

    Implements the same degradation contract as the real one: when storage is
    unavailable every method returns nothing rather than raising, because the
    engine must keep working when the history table does not exist.
    """

    def __init__(
        self, *, available: bool = True, configured: bool | None = None, schema: bool = True
    ) -> None:
        self.rows: list[dict[str, Any]] = []
        self._available = available
        # Two distinct facts the real store also keeps apart: whether Supabase
        # is configured at all, and whether the history table can be read.
        self._configured = available if configured is None else configured
        self._schema = schema
        self._sequence = 0
        # Set by a test to simulate a concurrent identical dispatch that wins
        # the race between the lookup and the insert.
        self.race_winner: dict[str, Any] | None = None

    @property
    def configured(self) -> bool:
        return self._configured

    async def available(self) -> bool:
        return self._available

    async def schema_current(self) -> bool:
        return self._available and self._schema

    async def create(self, run: dict[str, Any]) -> tuple[dict[str, Any] | None, bool]:
        if not self._available:
            return None, False

        if self.race_winner is not None:
            winner, self.race_winner = self.race_winner, None
            self.rows.append(winner)
            return winner, False

        key = run.get("idempotency_key")
        if key:
            existing = await self.find_by_idempotency_key(key)
            if existing:
                return existing, False

        self._sequence += 1
        row = {
            **run,
            "id": f"00000000-0000-4000-8000-{self._sequence:012d}",
            "created_at": f"2026-10-02T12:00:{self._sequence % 60:02d}Z",
        }
        self.rows.append(row)
        return row, True

    async def update(self, run_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        if not self._available:
            return None
        for row in self.rows:
            if row["id"] == run_id:
                row.update(changes)
                return row
        return None

    async def find_by_idempotency_key(self, key: str | None) -> dict[str, Any] | None:
        if not self._available or not key:
            return None
        return next((row for row in self.rows if row.get("idempotency_key") == key), None)

    async def get(self, run_id: str) -> dict[str, Any] | None:
        if not self._available:
            return None
        return next((row for row in self.rows if row["id"] == run_id), None)

    async def list(self, *, event=None, status=None, entity_id=None, retry_of=None, limit=25):
        if not self._available:
            return []
        rows = list(reversed(self.rows))
        if event:
            rows = [row for row in rows if row.get("event") == event]
        if status:
            rows = [row for row in rows if row.get("status") == status]
        if entity_id:
            rows = [row for row in rows if row.get("entity_id") == entity_id]
        if retry_of:
            rows = [row for row in rows if row.get("retry_of") == retry_of]
        return rows[:limit]

    async def stats(self, **kwargs) -> dict[str, Any]:
        # The real aggregation, over the fake's rows.
        return await RunStore.stats(self, **kwargs)


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
        schema: bool = True,
        **fake_kwargs: Any,
    ) -> tuple[TestClient, FakeSupabaseService]:
        app = create_app()
        fake = FakeSupabaseService(rows, configured=configured, **fake_kwargs)
        store = FakeRunStore(available=configured and storage, configured=configured, schema=schema)
        app.dependency_overrides[get_supabase_service] = lambda: fake
        app.dependency_overrides[get_store] = lambda: store
        # Handed back on the service so a test can inspect what was recorded
        # without the factory having to return a third value.
        fake.runs = store
        return TestClient(app), fake

    return factory


def member_client(make_client, role: set[str], rows=None, **kwargs):
    """A client whose `good-token` belongs to a member holding `role`."""
    grants = {MEMBER_ID: role, **kwargs.pop("grants", {})}
    tokens = {"good-token": MEMBER_ID, "other-token": OTHER_ID, **kwargs.pop("tokens", {})}
    return make_client(rows, tokens=tokens, grants=grants, **kwargs)


BEARER = {"Authorization": "Bearer good-token"}


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
        "client_id": None,
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
        "version": 3,
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


CLIENT_ID = "aaaaaaaa-1111-4111-8111-000000000001"
OPPORTUNITY_ID = "cccccccc-3333-4333-8333-000000000001"


def client_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "id": CLIENT_ID,
        "code": "CLIENT-001",
        "name": "Aurora Labs",
        "company": "Aurora Labs Ltda",
        "email": "ops@example.com",
        "phone": None,
        "status": "ACTIVE",
        "archived_at": None,
    }
    row.update(overrides)
    return row


def opportunity_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "id": OPPORTUNITY_ID,
        "title": "Aurora Operations Portal",
        "stage": "WON",
        "priority": "HIGH",
        "client_id": CLIENT_ID,
        "plan_id": None,
        "contact_name": "Ana",
        "company": "Aurora Labs Ltda",
        "estimated_value": 12000,
        "expected_close_date": "2026-09-30",
        "next_action": None,
        "next_action_at": None,
        "closed_at": "2026-10-01T10:00:00+00:00",
        "updated_at": "2026-10-01T10:00:00+00:00",
    }
    row.update(overrides)
    return row


def receivable_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "id": "dddddddd-4444-4444-8444-000000000001",
        "type": "INCOME",
        "status": "PENDING",
        "category": "PROJECT",
        "description": "Aurora Operations Portal",
        "amount": 6000,
        "due_date": "2099-01-10",
        "paid_at": None,
        "client_id": CLIENT_ID,
        "project_id": None,
        "opportunity_id": OPPORTUNITY_ID,
    }
    row.update(overrides)
    return row


__all__ = [
    "BEARER",
    "CLIENT_ID",
    "COLLABORATOR",
    "MANAGER",
    "MEMBER_ID",
    "OPPORTUNITY_ID",
    "OTHER_ID",
    "OWNER",
    "SEO",
    "FakeRunStore",
    "FakeSupabaseService",
    "SupabaseConflict",
    "SupabaseService",
    "client_row",
    "make_client",
    "member_client",
    "opportunity_row",
    "project_row",
    "receivable_row",
]

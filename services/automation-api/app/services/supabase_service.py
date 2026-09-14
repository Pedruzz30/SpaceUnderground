"""The only place in this service that talks to Supabase.

Everything else asks this module for rows. Keeping the HTTP details in one
file is what lets the analysis and reporting rules be tested with plain
dictionaries instead of a database.

PostgREST is called directly with httpx rather than through the Supabase Python
SDK. The SDK would add a dependency and a client lifecycle to manage in
exchange for a thin wrapper over the same REST calls. Writes stay behind named
methods and a hard allowlist; no endpoint accepts a table name or SQL.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.core.logging import get_logger, log_event

logger = get_logger("supabase")

# Columns the analysis and the reports read. Listed explicitly so a schema
# drift fails as a clear PostgREST error naming the column, rather than as a
# missing key deep inside a scoring rule.
PROJECT_COLUMNS = ",".join(
    [
        "id",
        "case_number",
        "name",
        "slug",
        "client",
        "category",
        "description",
        "status",
        "editorial_status",
        "featured",
        "visible",
        "year",
        "tech_stack",
        "presentation_system",
        "presentation_label",
        "presentation_address",
        "presentation_type",
        "poster_url",
        "project_url",
        "preview_url",
        "live_preview_enabled",
        "translations",
        "created_at",
        "updated_at",
        "published_at",
        "project_modules(id,position,code,title,description,translations)",
        "project_gallery(id,position,url,alt,caption,translations)",
    ]
)

CLIENT_COLUMNS = ",".join(["id", "code", "name", "company", "email", "phone", "status"])

PLAN_COLUMNS = ",".join(
    [
        "id",
        "slug",
        "name",
        "category",
        "range",
        "scope",
        "scope_short",
        "status",
        "description",
        "timeline",
        "visible",
    ]
)

PROPOSAL_COLUMNS = ",".join(
    [
        "id",
        "proposal_number",
        "title",
        "status",
        "amount",
        "currency",
        "payment_terms",
        "project_category",
        "accepted_at",
        "client_id",
        "plan_id",
    ]
)


class SupabaseError(Exception):
    """Base class for every failure raised by this layer."""


class SupabaseNotConfigured(SupabaseError):
    """No URL/key pair. The caller should report 503, not pretend to answer."""


class SupabaseUnavailable(SupabaseError):
    """Reachable code path, unreachable database."""


class ProjectNotFound(SupabaseError):
    """The identifier resolved to no row."""


class SupabaseConflict(SupabaseError):
    """A unique constraint refused the write. Not an outage."""


def _auth_headers(key: str) -> dict[str, str]:
    """Builds the PostgREST auth headers for whichever key format is in use.

    A legacy key is a JWT and is a valid bearer token. A modern
    `sb_secret_...` / `sb_publishable_...` key is not: sending one as
    `Authorization: Bearer` makes the request fail before row level security is
    evaluated. This already took the public site down once, so the rule is
    encoded rather than remembered.
    """
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _looks_like_uuid(value: str) -> bool:
    parts = value.split("-")
    if len(parts) != 5:
        return False
    return all(part and all(char in "0123456789abcdefABCDEF" for char in part) for part in parts)


# Tables this service is allowed to write. `automation_runs` is its own history.
# `projects` is the only business write path in Phase 4, and only through the
# proposal handoff method below. No caller can choose an arbitrary table.
WRITABLE_TABLES = {"automation_runs", "projects", "commercial_project_handoffs"}


class SupabaseService:
    """PostgREST client for named catalogue and handoff operations.

    No endpoint accepts SQL -- callers choose a named method, never a query --
    and `_write` refuses any table outside WRITABLE_TABLES.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    @property
    def configured(self) -> bool:
        return self._settings.supabase_configured

    def _require_configuration(self) -> None:
        if not self.configured:
            raise SupabaseNotConfigured(
                "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
            )

    async def _get(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        self._require_configuration()

        url = f"{self._settings.supabase_url}/rest/v1/{path}"
        headers = _auth_headers(self._settings.supabase_service_role_key)

        try:
            async with httpx.AsyncClient(timeout=self._settings.supabase_timeout_seconds) as client:
                response = await client.get(url, params=params, headers=headers)
        except httpx.HTTPError as error:
            log_event(logger, logging.ERROR, "supabase.request.failed", path=path, error=type(error).__name__)
            raise SupabaseUnavailable("Could not reach Supabase.") from error

        if response.status_code >= 400:
            # The PostgREST body can name columns and constraints, so it is
            # logged for the operator and never returned to the caller.
            log_event(
                logger,
                logging.ERROR,
                "supabase.response.error",
                path=path,
                status=response.status_code,
                body=response.text[:300],
            )
            raise SupabaseUnavailable(f"Supabase returned {response.status_code}.")

        payload = response.json()
        return payload if isinstance(payload, list) else [payload]

    async def _write(
        self,
        path: str,
        method: str,
        *,
        json: Any = None,
        params: dict[str, str] | None = None,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        """POST/PATCH against an allowed table."""
        table = path.split("?")[0].strip("/")
        if table not in WRITABLE_TABLES:
            raise SupabaseError(f"Refusing to write to {table}.")

        self._require_configuration()

        url = f"{self._settings.supabase_url}/rest/v1/{path}"
        headers = {**_auth_headers(self._settings.supabase_service_role_key), "Prefer": prefer}

        try:
            async with httpx.AsyncClient(timeout=self._settings.supabase_timeout_seconds) as client:
                response = await client.request(method, url, params=params, json=json, headers=headers)
        except httpx.HTTPError as error:
            log_event(logger, logging.ERROR, "supabase.write.failed", path=path, error=type(error).__name__)
            raise SupabaseUnavailable("Could not reach Supabase.") from error

        if response.status_code >= 400:
            log_event(
                logger,
                logging.ERROR,
                "supabase.write.error",
                path=path,
                status=response.status_code,
                body=response.text[:300],
            )
            # 409 is a unique violation, which is how an idempotency key
            # collapses a duplicate dispatch. The caller needs to tell that
            # apart from an outage.
            if response.status_code == 409:
                raise SupabaseConflict("Conflicting row.")
            raise SupabaseUnavailable(f"Supabase returned {response.status_code}.")

        if not response.content:
            return []

        payload = response.json()
        return payload if isinstance(payload, list) else [payload]

    async def get_project(self, project_id: str) -> dict[str, Any]:
        """Fetches one project by uuid or by case number.

        The Admin addresses projects by padded case number (`001`) as well as by
        uuid, so both are accepted here for the same reason the JavaScript
        repository accepts both.
        """
        identifier = project_id.strip()
        if not identifier:
            raise ProjectNotFound("Empty project identifier.")

        if _looks_like_uuid(identifier):
            params = {"select": PROJECT_COLUMNS, "id": f"eq.{identifier}", "limit": "1"}
        elif identifier.isdigit():
            params = {"select": PROJECT_COLUMNS, "case_number": f"eq.{int(identifier)}", "limit": "1"}
        else:
            # Not a uuid and not a number: nothing can match, and building a
            # filter from it would only forward user input into a query string.
            raise ProjectNotFound(f"Unknown project identifier: {identifier}")

        rows = await self._get("projects", params)
        if not rows:
            raise ProjectNotFound(f"No project for identifier: {identifier}")

        return rows[0]

    async def list_projects(self) -> list[dict[str, Any]]:
        """Every project, for the operational report."""
        return await self._get(
            "projects",
            {"select": PROJECT_COLUMNS, "order": "case_number.asc"},
        )

    async def get_commercial_proposal(self, proposal_id: str) -> dict[str, Any]:
        identifier = proposal_id.strip()
        if not _looks_like_uuid(identifier):
            raise SupabaseError("Invalid proposal identifier.")

        rows = await self._get(
            "commercial_proposals",
            {"select": PROPOSAL_COLUMNS, "id": f"eq.{identifier}", "limit": "1"},
        )
        if not rows:
            raise ProjectNotFound("No commercial proposal for identifier: " + identifier)
        return rows[0]

    async def get_client(self, client_id: str) -> dict[str, Any]:
        identifier = client_id.strip()
        if not _looks_like_uuid(identifier):
            raise SupabaseError("Invalid client identifier.")

        rows = await self._get("clients", {"select": CLIENT_COLUMNS, "id": f"eq.{identifier}", "limit": "1"})
        if not rows:
            raise ProjectNotFound("No client for identifier: " + identifier)
        return rows[0]

    async def get_plan(self, plan_id: str) -> dict[str, Any]:
        identifier = plan_id.strip()
        if not _looks_like_uuid(identifier):
            raise SupabaseError("Invalid plan identifier.")

        rows = await self._get("plans", {"select": PLAN_COLUMNS, "id": f"eq.{identifier}", "limit": "1"})
        if not rows:
            raise ProjectNotFound("No service plan for identifier: " + identifier)
        return rows[0]

    async def get_project_by_proposal(self, proposal_id: str) -> dict[str, Any] | None:
        identifier = proposal_id.strip()
        if not _looks_like_uuid(identifier):
            raise SupabaseError("Invalid proposal identifier.")

        rows = await self._get(
            "commercial_project_handoffs",
            {
                "select": "project_id,projects(" + PROJECT_COLUMNS + ")",
                "proposal_id": f"eq.{identifier}",
                "limit": "1",
            },
        )
        if rows and isinstance(rows[0].get("projects"), dict):
            return rows[0]["projects"]
        return None

    async def get_project_by_slug(self, slug: str) -> dict[str, Any] | None:
        identifier = slug.strip()
        if not identifier:
            raise SupabaseError("Invalid project slug.")

        rows = await self._get(
            "projects",
            {"select": PROJECT_COLUMNS, "slug": f"eq.{identifier}", "limit": "1"},
        )
        return rows[0] if rows else None

    async def next_project_case_number(self) -> int:
        rows = await self._get(
            "projects",
            {"select": "case_number", "order": "case_number.desc", "limit": "1"},
        )
        if not rows:
            return 1

        value = rows[0].get("case_number")
        return int(value) + 1 if isinstance(value, int) else 1

    async def create_project_from_proposal(self, project: dict[str, Any]) -> dict[str, Any]:
        payload = dict(project)
        proposal_id = str(payload.pop("_proposal_id"))
        rows = await self._write("projects", "POST", json=payload)
        if not rows:
            raise SupabaseUnavailable("Project creation returned no row.")
        created = rows[0]

        await self._write(
            "commercial_project_handoffs",
            "POST",
            json={"proposal_id": proposal_id, "project_id": created.get("id"), "action": "project.create"},
        )
        return created


def get_supabase_service() -> SupabaseService:
    """FastAPI dependency. Overridden in tests with a fake."""
    return SupabaseService()

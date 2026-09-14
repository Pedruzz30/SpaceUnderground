"""The only place in this service that talks to Supabase.

Everything else asks this module for rows. Keeping the HTTP details in one
file is what lets the analysis and reporting rules be tested with plain
dictionaries instead of a database.

PostgREST is called directly with httpx rather than through the Supabase Python
SDK. The SDK would add a dependency and a client lifecycle to manage in
exchange for a thin wrapper over the same REST calls; this service only reads,
so the wrapper earns nothing. If it later needs Realtime or Storage signed
URLs, that is the point to reconsider.
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


# The only table this service is allowed to write. Project, plan and content
# rows belong to the Admin and to Supabase; the automation service reads them
# and never edits them. Run history is its own, so it writes that and nothing
# else -- enforced here rather than left to each caller to remember.
WRITABLE_TABLES = {"automation_runs"}


class SupabaseService:
    """PostgREST client: reads the catalogue, writes only its own run history.

    No endpoint accepts SQL -- callers choose a named method, never a query --
    and `_write` refuses any table outside WRITABLE_TABLES, so a future handler
    cannot quietly start editing projects.
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


def get_supabase_service() -> SupabaseService:
    """FastAPI dependency. Overridden in tests with a fake."""
    return SupabaseService()

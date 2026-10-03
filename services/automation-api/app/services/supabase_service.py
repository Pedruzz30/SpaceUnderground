"""The only place in this service that talks to Supabase.

Everything else asks this module for rows. Keeping the HTTP details in one
file is what lets the analysis, the workflows and the jobs be tested with
plain dictionaries instead of a database.

PostgREST is called directly with httpx rather than through the Supabase Python
SDK: the SDK would add a dependency and a client lifecycle in exchange for a
thin wrapper over the same REST calls.

Two kinds of request leave this module, and they never mix:

* **As the service** (the service role key). Reads for workflows and jobs, the
  run history, and one named write function. Writes are refused outside a
  hard allowlist, and no endpoint accepts a table name, a filter or SQL.

* **As the member** (their own access token). Only to ask the database who
  they are and what they may do -- `has_permission` and `my_access`, the same
  functions row level security uses. Nothing is ever written this way.

Every column list below is the current schema (the migrations up to
`20261002033705_security_rbac_approval_foundation` plus the automation v2
migration). They are explicit so a drift fails as a PostgREST error naming the
column, instead of as a missing key deep inside a rule.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.core.logging import get_logger, log_event

logger = get_logger("supabase")

PROJECT_COLUMNS = ",".join(
    [
        "id",
        "case_number",
        "name",
        "slug",
        "client",
        "client_id",
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
        "version",
        "created_at",
        "updated_at",
        "published_at",
        "project_modules(id,position,code,title,description,translations)",
        "project_gallery(id,position,url,alt,caption,translations)",
    ]
)

CLIENT_COLUMNS = ",".join(["id", "code", "name", "company", "email", "phone", "status", "archived_at"])

OPPORTUNITY_COLUMNS = ",".join(
    [
        "id",
        "title",
        "stage",
        "priority",
        "client_id",
        "plan_id",
        "contact_name",
        "company",
        "estimated_value",
        "expected_close_date",
        "next_action",
        "next_action_at",
        "closed_at",
        "updated_at",
    ]
)

TRANSACTION_COLUMNS = ",".join(
    [
        "id",
        "type",
        "status",
        "category",
        "description",
        "amount",
        "due_date",
        "paid_at",
        "client_id",
        "project_id",
        "opportunity_id",
    ]
)

HANDOFF_COLUMNS = ",".join(
    ["id", "opportunity_id", "proposal_id", "project_id", "action", "run_id", "created_at"]
)

# Stages the Commercial pipeline counts as open (admin/src/utils/commercial-metrics.js).
OPEN_STAGES = ("NEW", "CONTACTED", "PROPOSAL", "NEGOTIATION")

# Supabase's default PostgREST row cap. Reads that must see everything page
# through it instead of trusting one response to be complete.
PAGE_SIZE = 1000
MAX_PAGES = 50

# Tables this service may write directly: only its own history. Business data
# changes go through the named database function below, in one transaction.
WRITABLE_TABLES = {"automation_runs"}

# Functions this service may call with the service role.
SERVICE_RPCS = {"automation_open_project_for_opportunity"}

# Functions it may call *as the member*, with their token. Read-only questions.
MEMBER_RPCS = {"has_permission", "my_access"}

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class SupabaseError(Exception):
    """Base class for every failure raised by this layer."""


class SupabaseNotConfigured(SupabaseError):
    """No URL/key pair. The caller should report 503, not pretend to answer."""


class SupabaseUnavailable(SupabaseError):
    """Reachable code path, unreachable (or failing) database."""


class SupabaseRejected(SupabaseError):
    """The database answered and refused the request (a 4xx).

    `code` is the PostgREST / SQLSTATE code -- what callers branch on. The
    database message stays in the log: it can name columns and constraints.
    """

    def __init__(self, message: str, *, status: int, code: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class SupabaseConflict(SupabaseRejected):
    """A unique constraint refused the write. Not an outage."""


class InvalidToken(SupabaseError):
    """The member's access token was refused (expired, forged, signed out)."""


class RecordNotFound(SupabaseError):
    """The identifier resolved to no row."""


# Kept as its own name: the project endpoints and handlers branch on it.
ProjectNotFound = RecordNotFound


def is_uuid(value: str) -> bool:
    return bool(_UUID.match(value or ""))


def _service_headers(key: str) -> dict[str, str]:
    """PostgREST auth headers for whichever key format is in use.

    A legacy key is a JWT and is a valid bearer token. A modern `sb_secret_...`
    key is not: sending one as `Authorization: Bearer` fails before row level
    security is evaluated. This already took the public site down once, so the
    rule is encoded rather than remembered.
    """
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _member_headers(key: str, access_token: str) -> dict[str, str]:
    """Headers for a request made *as the member*.

    The apikey only gets the request through the gateway; the member's own
    token in Authorization is what PostgREST runs the request as (role
    `authenticated`, their claims). Were the gateway ever to ignore it, the
    database would see no user at all and every check would answer "no" --
    it fails closed, never open.
    """
    return {"apikey": key, "Authorization": f"Bearer {access_token}"}


def _error_code(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    return str(body.get("code") or "") if isinstance(body, dict) else ""


class SupabaseService:
    """PostgREST client for named reads, one named write, and member checks."""

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

    # -- transport -----------------------------------------------------------

    async def _send(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str],
        params: dict[str, str] | None = None,
        json: Any = None,
        label: str,
    ) -> httpx.Response:
        url = f"{self._settings.supabase_url}/rest/v1/{path}"
        try:
            async with httpx.AsyncClient(timeout=self._settings.supabase_timeout_seconds) as client:
                return await client.request(method, url, params=params, json=json, headers=headers)
        except httpx.HTTPError as error:
            log_event(
                logger, logging.ERROR, f"supabase.{label}.failed", path=path, error=type(error).__name__
            )
            raise SupabaseUnavailable("Could not reach Supabase.") from error

    def _raise_for(self, response: httpx.Response, path: str, label: str) -> None:
        if response.status_code < 400:
            return

        code = _error_code(response)
        # The body can name columns and constraints: logged for the operator,
        # never returned to the caller.
        log_event(
            logger,
            logging.ERROR,
            f"supabase.{label}.error",
            path=path,
            status=response.status_code,
            code=code,
            body=response.text[:300],
        )

        if response.status_code == 409 or code == "23505":
            raise SupabaseConflict("Conflicting row.", status=response.status_code, code=code or "23505")
        # A 401/403 against the service key is a configuration problem, and a
        # 5xx is the database failing: both are "unavailable", not an answer.
        if response.status_code in (401, 403) or response.status_code >= 500:
            raise SupabaseUnavailable(f"Supabase returned {response.status_code}.")
        raise SupabaseRejected(
            f"Supabase refused the request ({code or response.status_code}).",
            status=response.status_code,
            code=code,
        )

    async def _get(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        self._require_configuration()
        response = await self._send(
            "GET",
            path,
            headers=_service_headers(self._settings.supabase_service_role_key),
            params=params,
            label="read",
        )
        self._raise_for(response, path, "read")
        payload = response.json()
        return payload if isinstance(payload, list) else [payload]

    async def _get_all(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        """Every matching row, paged past PostgREST's row cap.

        Requires an `order` so pages do not overlap; bounded so a runaway
        table can never turn one job into an unbounded read.
        """
        if "order" not in params:
            raise ValueError("A paged read needs an explicit order.")

        rows: list[dict[str, Any]] = []
        for page in range(MAX_PAGES):
            batch = await self._get(
                path, {**params, "limit": str(PAGE_SIZE), "offset": str(page * PAGE_SIZE)}
            )
            rows.extend(batch)
            if len(batch) < PAGE_SIZE:
                return rows
        log_event(logger, logging.WARNING, "supabase.read.truncated", path=path, rows=len(rows))
        return rows

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
        # The exact table name, nothing appended: filters travel in `params`,
        # so a path carrying a query string or a segment is refused outright.
        if path not in WRITABLE_TABLES:
            raise SupabaseError("Refusing to write outside the allowed tables.")

        self._require_configuration()
        headers = {**_service_headers(self._settings.supabase_service_role_key), "Prefer": prefer}
        response = await self._send(method, path, headers=headers, params=params, json=json, label="write")
        self._raise_for(response, path, "write")

        if not response.content:
            return []
        payload = response.json()
        return payload if isinstance(payload, list) else [payload]

    async def _rpc(self, function: str, args: dict[str, Any]) -> Any:
        if function not in SERVICE_RPCS:
            raise SupabaseError(f"Refusing to call {function}.")

        self._require_configuration()
        path = f"rpc/{function}"
        response = await self._send(
            "POST",
            path,
            headers=_service_headers(self._settings.supabase_service_role_key),
            json=args,
            label="rpc",
        )
        self._raise_for(response, path, "rpc")
        return response.json() if response.content else None

    async def _member_rpc(self, access_token: str, function: str, args: dict[str, Any]) -> Any:
        if function not in MEMBER_RPCS:
            raise SupabaseError(f"Refusing to call {function} as a member.")

        self._require_configuration()
        path = f"rpc/{function}"
        response = await self._send(
            "POST",
            path,
            headers=_member_headers(self._settings.supabase_service_role_key, access_token),
            json=args,
            label="member",
        )
        # PostgREST verifies the token itself; a bad one is an answer, not an
        # outage.
        if response.status_code in (401, 403):
            raise InvalidToken("The access token was refused.")
        self._raise_for(response, path, "member")
        return response.json() if response.content else None

    # -- projects ------------------------------------------------------------

    async def get_project(self, project_id: str) -> dict[str, Any]:
        """One project by uuid or by case number (the Admin uses both)."""
        identifier = str(project_id or "").strip()
        if is_uuid(identifier):
            params = {"select": PROJECT_COLUMNS, "id": f"eq.{identifier}", "limit": "1"}
        elif identifier.isdigit():
            params = {"select": PROJECT_COLUMNS, "case_number": f"eq.{int(identifier)}", "limit": "1"}
        else:
            # Neither shape: nothing can match, and building a filter from it
            # would only forward user input into a query string.
            raise RecordNotFound(f"Unknown project identifier: {identifier}")

        rows = await self._get("projects", params)
        if not rows:
            raise RecordNotFound(f"No project for identifier: {identifier}")
        return rows[0]

    async def list_projects(self) -> list[dict[str, Any]]:
        """Every project, for the overview and the health job."""
        return await self._get_all("projects", {"select": PROJECT_COLUMNS, "order": "case_number.asc"})

    # -- commercial ----------------------------------------------------------

    async def get_opportunity(self, opportunity_id: str) -> dict[str, Any]:
        identifier = str(opportunity_id or "").strip()
        if not is_uuid(identifier):
            raise RecordNotFound("Invalid opportunity identifier.")

        rows = await self._get(
            "commercial_opportunities",
            {"select": OPPORTUNITY_COLUMNS, "id": f"eq.{identifier}", "limit": "1"},
        )
        if not rows:
            raise RecordNotFound(f"No opportunity for identifier: {identifier}")
        return rows[0]

    async def list_open_opportunities_due_before(self, day: str) -> list[dict[str, Any]]:
        """Open deals whose next action date is before `day` (YYYY-MM-DD)."""
        return await self._get_all(
            "commercial_opportunities",
            {
                "select": OPPORTUNITY_COLUMNS,
                "stage": f"in.({','.join(OPEN_STAGES)})",
                "next_action_at": f"lt.{day}",
                "order": "next_action_at.asc,id.asc",
            },
        )

    async def get_handoff_for_opportunity(self, opportunity_id: str) -> dict[str, Any] | None:
        if not is_uuid(opportunity_id):
            raise RecordNotFound("Invalid opportunity identifier.")
        rows = await self._get(
            "commercial_project_handoffs",
            {"select": HANDOFF_COLUMNS, "opportunity_id": f"eq.{opportunity_id}", "limit": "1"},
        )
        return rows[0] if rows else None

    async def get_handoff_for_project(self, project_id: str) -> dict[str, Any] | None:
        if not is_uuid(project_id):
            return None
        rows = await self._get(
            "commercial_project_handoffs",
            {"select": HANDOFF_COLUMNS, "project_id": f"eq.{project_id}", "limit": "1"},
        )
        return rows[0] if rows else None

    # -- clients -------------------------------------------------------------

    async def get_client(self, client_id: str) -> dict[str, Any]:
        identifier = str(client_id or "").strip()
        if not is_uuid(identifier):
            raise RecordNotFound("Invalid client identifier.")

        rows = await self._get("clients", {"select": CLIENT_COLUMNS, "id": f"eq.{identifier}", "limit": "1"})
        if not rows:
            raise RecordNotFound(f"No client for identifier: {identifier}")
        return rows[0]

    # -- financial -----------------------------------------------------------

    async def list_transactions_for(
        self, *, opportunity_id: str | None = None, project_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Ledger entries tied to an opportunity and/or a project."""
        filters = []
        if opportunity_id and is_uuid(opportunity_id):
            filters.append(f"opportunity_id.eq.{opportunity_id}")
        if project_id and is_uuid(project_id):
            filters.append(f"project_id.eq.{project_id}")
        if not filters:
            return []

        return await self._get_all(
            "financial_transactions",
            {"select": TRANSACTION_COLUMNS, "or": f"({','.join(filters)})", "order": "due_date.asc,id.asc"},
        )

    async def list_overdue_receivables(self, day: str) -> list[dict[str, Any]]:
        """Pending income due before `day` (YYYY-MM-DD). Overdue is computed,
        never stored: the ledger has no OVERDUE status."""
        return await self._get_all(
            "financial_transactions",
            {
                "select": TRANSACTION_COLUMNS,
                "type": "eq.INCOME",
                "status": "eq.PENDING",
                "due_date": f"lt.{day}",
                "order": "due_date.asc,id.asc",
            },
        )

    # -- the one business write ----------------------------------------------

    async def open_project_for_opportunity(
        self,
        *,
        opportunity_id: str,
        category: str,
        name: str,
        slug: str,
        link_finance: bool,
        actor_id: str | None,
        run_id: str | None,
    ) -> dict[str, Any]:
        """Opens (or finds) the project draft of a won opportunity.

        One database transaction, serialised per opportunity and idempotent
        through the unique handoff: called twice, it returns the same project
        and creates nothing the second time. See the automation v2 migration.
        """
        result = await self._rpc(
            "automation_open_project_for_opportunity",
            {
                "p_opportunity": opportunity_id,
                "p_category": category,
                "p_name": name,
                "p_slug": slug,
                "p_link_finance": link_finance,
                "p_actor": actor_id if actor_id and is_uuid(actor_id) else None,
                "p_run": run_id if run_id and is_uuid(run_id) else None,
            },
        )
        if not isinstance(result, dict):
            raise SupabaseUnavailable("The project handoff returned no result.")
        return result

    # -- identity --------------------------------------------------------------
    #
    # Who is calling and what they may do, answered by Supabase and the
    # database rather than by this service. The token is never decoded here: a
    # signature this process does not verify is not evidence.

    async def get_token_user(self, access_token: str) -> dict[str, Any] | None:
        """Resolves a Supabase access token to its user. None when invalid."""
        self._require_configuration()

        url = f"{self._settings.supabase_url}/auth/v1/user"
        headers = {
            "apikey": self._settings.supabase_service_role_key,
            "Authorization": f"Bearer {access_token}",
        }

        try:
            async with httpx.AsyncClient(timeout=self._settings.supabase_timeout_seconds) as client:
                response = await client.get(url, headers=headers)
        except httpx.HTTPError as error:
            log_event(logger, logging.ERROR, "supabase.auth.failed", error=type(error).__name__)
            raise SupabaseUnavailable("Could not reach Supabase.") from error

        # 401/403 mean the token is not good: an answer, not an outage.
        # Anything else is Supabase failing, and must not read as "not
        # allowed", which would lock every member out during a blip.
        if response.status_code in (401, 403):
            return None
        if response.status_code >= 400:
            log_event(logger, logging.ERROR, "supabase.auth.error", status=response.status_code)
            raise SupabaseUnavailable(f"Supabase returned {response.status_code}.")

        payload = response.json()
        return payload if isinstance(payload, dict) and payload.get("id") else None

    async def member_has_permission(self, access_token: str, permission: str) -> bool:
        """public.has_permission(permission), evaluated as the member.

        The authorization decision the database itself makes: an active
        member, a current session, a role that grants the key, and MFA as the
        key's risk requires. Default deny.
        """
        result = await self._member_rpc(access_token, "has_permission", {"p_permission": permission})
        return result is True

    async def member_access(self, access_token: str) -> dict[str, Any]:
        """public.my_access() as the member: status, roles and MFA state."""
        result = await self._member_rpc(access_token, "my_access", {})
        return result if isinstance(result, dict) else {}


def get_supabase_service() -> SupabaseService:
    """FastAPI dependency. Overridden in tests with a fake."""
    return SupabaseService()

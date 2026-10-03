"""Who is calling, and what they may do.

This service holds a Supabase key that can read and write every row, so the
question it must never get wrong is "may this caller do this?" -- and it must
never answer it more generously than the database would.

There are two kinds of caller:

* **A member using the Admin.** The Admin is a browser bundle, so it has no
  secret to offer. It sends the member's own Supabase access token. This
  service asks Supabase whose token it is (`/auth/v1/user`), and then asks the
  database itself, *with that same token*, whether the member holds the
  permission an endpoint needs: `public.has_permission(key)`. That is the very
  function row level security runs, so membership status, access windows,
  revoked sessions, role grants and MFA are all decided in one place, by the
  RBAC the Admin already uses. The service keeps no list of its own.

  `public.admins` is no longer consulted: since the security foundation it is
  history, and a former admin keeps their row there after being suspended.

* **The scheduler.** GitHub Actions sends the dedicated
  `X-Scheduler-Token`. That identity has no member permissions and is accepted
  only by the jobs runner endpoint.

Local development may run with neither, because requiring a credential
before there is anywhere to store one only teaches people to disable the
check. Every deployed environment (production, staging) may not: with no
usable mechanism the guard refuses everything (fail closed).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from dataclasses import dataclass, field

from fastapi import Depends, Header

from app.core.config import Settings, get_settings
from app.core.errors import forbidden, not_configured, unauthorized, unavailable
from app.core.logging import get_logger, log_event
from app.services.supabase_service import (
    InvalidToken,
    SupabaseError,
    SupabaseNotConfigured,
    SupabaseRejected,
    SupabaseService,
    get_supabase_service,
)

logger = get_logger("security")

SCHEDULER_TOKEN_HEADER = "X-Scheduler-Token"

SCHEDULER = "scheduler"
MEMBER = "member"
ANONYMOUS = "anonymous"


@dataclass(frozen=True)
class Caller:
    """Who made the request, once proven.

    The token is kept so the member's permissions can be asked of the
    database as the member; it is excluded from repr so it never reaches a
    log line by accident.
    """

    kind: str
    user_id: str | None = None
    token: str | None = field(default=None, repr=False, compare=False)

    @property
    def is_member(self) -> bool:
        return self.kind == MEMBER

    @property
    def is_scheduler(self) -> bool:
        return self.kind == SCHEDULER


# Verified identities and permission answers, held briefly so a polling
# Dashboard does not cost a round trip per request. Keyed by a digest of the
# token, never the token itself, so a memory dump or a stray log never yields
# something replayable. Short by design: a revocation takes effect within it.
_identity_cache: dict[str, tuple[float, str | None]] = {}
_permission_cache: dict[tuple[str, str], tuple[float, bool]] = {}
_CACHE_LIMIT = 2048


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached(cache: dict, key, now: float):
    entry = cache.get(key)
    if not entry:
        return False, None
    expires_at, value = entry
    if expires_at < now:
        cache.pop(key, None)
        return False, None
    return True, value


def _remember(cache: dict, key, value, ttl: float) -> None:
    # Bounded so a stream of junk tokens cannot grow this without limit.
    if len(cache) >= _CACHE_LIMIT:
        cache.clear()
    cache[key] = (time.monotonic() + ttl, value)


def reset_identity_cache() -> None:
    """Clears verified identities and permission answers (tests, config changes)."""
    _identity_cache.clear()
    _permission_cache.clear()


def token_required(settings: Settings) -> bool:
    """Whether a caller must prove anything at all.

    Every deployed environment -- production and staging alike -- always
    requires a credential: a staging service is reachable from the internet
    and holds a key that can read every row, so it must never run open. Only
    local development may skip it, and only until a shared secret exists to
    check against. A member token that is presented is verified in every
    environment, so a local service pointed at a real Supabase applies the
    real permissions.
    """
    return settings.app_env != "development"


def _bearer(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


def _verification_failed(error: Exception):
    """Supabase being unreachable is not the caller's fault, and must not be
    reported as "not allowed": that would send an operator hunting for a
    permission problem that does not exist."""
    if isinstance(error, SupabaseNotConfigured):
        return not_configured("The service cannot verify credentials: Supabase is not configured.")
    return unavailable("Could not verify the caller right now.")


async def _verify_member(token: str, settings: Settings, supabase: SupabaseService) -> Caller:
    key = _digest(token)
    hit, user_id = _cached(_identity_cache, key, time.monotonic())
    if hit:
        if not user_id:
            raise unauthorized("Invalid or expired access token.")
        return Caller(kind=MEMBER, user_id=user_id, token=token)

    try:
        user = await supabase.get_token_user(token)
    except SupabaseError as error:
        log_event(logger, logging.ERROR, "security.identity.unavailable", error=type(error).__name__)
        raise _verification_failed(error) from error

    if not user:
        _remember(_identity_cache, key, None, settings.admin_jwt_cache_seconds)
        log_event(logger, logging.WARNING, "security.jwt.rejected")
        raise unauthorized("Invalid or expired access token.")

    user_id = str(user.get("id") or "")
    _remember(_identity_cache, key, user_id, settings.admin_jwt_cache_seconds)
    return Caller(kind=MEMBER, user_id=user_id, token=token)


async def verify_caller(
    x_scheduler_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    supabase: SupabaseService = Depends(get_supabase_service),
) -> Caller:
    """FastAPI dependency. Proves the caller or refuses the request."""
    settings = get_settings()

    # This identity is intentionally narrow. Access.can() grants it no RBAC
    # permission; POST /jobs/run is the only handler that explicitly accepts
    # it. Comparing in constant time avoids leaking useful prefix information.
    if x_scheduler_token is not None:
        if settings.scheduler_token and hmac.compare_digest(
            x_scheduler_token.encode("utf-8"), settings.scheduler_token.encode("utf-8")
        ):
            return Caller(kind=SCHEDULER)
        log_event(logger, logging.WARNING, "security.scheduler_token.rejected")
        raise unauthorized("Invalid or missing scheduler token.")

    bearer = _bearer(authorization)
    if bearer and settings.admin_jwt_auth:
        if not settings.supabase_configured:
            # Nothing to verify against. Refusing beats trusting the token.
            log_event(logger, logging.ERROR, "security.jwt.unverifiable")
            raise not_configured("The service cannot verify credentials: Supabase is not configured.")
        return await _verify_member(bearer, settings, supabase)

    if not token_required(settings):
        return Caller(kind=ANONYMOUS)

    if not settings.admin_jwt_auth:
        # Production with nothing configured: refuse rather than run open.
        log_event(logger, logging.ERROR, "security.no_mechanism", env=settings.app_env)
        raise not_configured("No authentication mechanism is configured on the server.")

    log_event(logger, logging.WARNING, "security.credentials.missing", provided=bool(x_scheduler_token))
    raise unauthorized("Authentication is required.")


class Access:
    """The caller plus the permission questions asked on their behalf.

    An unauthenticated development caller is the local deployment and passes
    checks. The scheduler has no RBAC permissions; its one allowed endpoint
    recognizes it explicitly. A member passes exactly what
    `public.has_permission` grants them.
    """

    def __init__(self, caller: Caller, supabase: SupabaseService, settings: Settings | None = None) -> None:
        self.caller = caller
        self._supabase = supabase
        self._settings = settings or get_settings()

    @property
    def user_id(self) -> str | None:
        return self.caller.user_id

    async def can(self, permission: str, *, fresh: bool = False) -> bool:
        """Whether the caller holds `permission` right now.

        `fresh` skips the cache: used before a workflow writes business data,
        so a member revoked a few seconds ago cannot slip one last write in.
        """
        if self.caller.is_scheduler:
            return False
        if not self.caller.is_member:
            return True

        token = self.caller.token or ""
        key = (_digest(token), permission)
        if not fresh:
            hit, allowed = _cached(_permission_cache, key, time.monotonic())
            if hit:
                return bool(allowed)

        try:
            allowed = await self._supabase.member_has_permission(token, permission)
        except InvalidToken as error:
            raise unauthorized("Invalid or expired access token.") from error
        except SupabaseRejected as error:
            # has_permission missing means the security foundation is not
            # applied where this service points. Fail closed, and say why.
            log_event(logger, logging.ERROR, "security.permission.unverifiable", code=error.code)
            raise not_configured(
                "The database does not expose the permission check this service needs."
            ) from error
        except SupabaseError as error:
            log_event(logger, logging.ERROR, "security.permission.unavailable", error=type(error).__name__)
            raise _verification_failed(error) from error

        _remember(_permission_cache, key, allowed, self._settings.admin_jwt_cache_seconds)
        return allowed

    async def require(self, *permissions: str, fresh: bool = False) -> None:
        """Every one of `permissions`, or 403 naming the first one missing."""
        for permission in permissions:
            if not await self.can(permission, fresh=fresh):
                log_event(
                    logger,
                    logging.WARNING,
                    "security.permission.denied",
                    user_id=self.caller.user_id,
                    permission=permission,
                )
                raise forbidden(
                    f"This account does not have the permission this action needs ({permission})."
                )


def require_permissions(*permissions: str):
    """Endpoint dependency: a proven caller holding every one of `permissions`."""

    async def dependency(
        caller: Caller = Depends(verify_caller),
        supabase: SupabaseService = Depends(get_supabase_service),
    ) -> Access:
        access = Access(caller, supabase)
        await access.require(*permissions)
        return access

    return dependency


async def current_access(
    caller: Caller = Depends(verify_caller),
    supabase: SupabaseService = Depends(get_supabase_service),
) -> Access:
    """Endpoint dependency: a proven caller, permissions checked by the handler."""
    return Access(caller, supabase)

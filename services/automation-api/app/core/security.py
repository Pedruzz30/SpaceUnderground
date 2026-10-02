"""Request authentication.

This service holds a Supabase key that can read every row in the database, so
it is not a public endpoint even while it runs on localhost.

There are two kinds of caller, and they are not the same thing:

* **A person using the Admin.** The Admin is a browser bundle, so it has no
  secret to offer -- anything shipped to a browser is public by definition.
  It therefore authenticates as its signed-in user: it sends the Supabase
  access token it already holds, and this service asks Supabase who that is,
  then requires the user to hold a row in `public.admins`. That is the same
  table `public.is_admin()` consults, so the API and row level security agree
  on who an administrator is rather than each keeping its own list.

* **Another machine.** CI, scripts, technical administration. These can keep a
  secret, so they send the shared `X-API-Token`.

Development may run without either, because requiring a credential before
there is anywhere to store one only teaches people to disable the check.
Production may not: with no usable mechanism the guard refuses everything,
which fails closed.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.logging import get_logger, log_event
from app.services.supabase_service import (
    SupabaseError,
    SupabaseService,
    get_supabase_service,
)

logger = get_logger("security")

API_TOKEN_HEADER = "X-API-Token"


@dataclass(frozen=True)
class Caller:
    """Who made the request, once proven.

    `kind` is what authorisation should branch on if it ever needs to: a
    service token is the deployment itself, an admin user is a person.
    """

    kind: str  # "service" | "admin_user" | "anonymous"
    user_id: str | None = None

    @property
    def is_service(self) -> bool:
        return self.kind == "service"


# Verified identities, held briefly so a polling Dashboard does not cost two
# Supabase round trips per request. Keyed by a digest rather than the token, so
# a memory dump or a stray log never yields something replayable. The window is
# short by design: revoking an admin takes effect within it.
_identity_cache: dict[str, tuple[float, str | None]] = {}


def _cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached_user(key: str, ttl: float) -> str | None | bool:
    """Returns the cached user id, None for "known bad", or False for a miss."""
    entry = _identity_cache.get(key)
    if not entry:
        return False

    expires_at, user_id = entry
    if expires_at < time.monotonic():
        _identity_cache.pop(key, None)
        return False

    return user_id


def _remember(key: str, user_id: str | None, ttl: float) -> None:
    # Bounded so a stream of junk tokens cannot grow this without limit.
    if len(_identity_cache) > 512:
        _identity_cache.clear()
    _identity_cache[key] = (time.monotonic() + ttl, user_id)


def reset_identity_cache() -> None:
    """Clears verified identities. Used by tests and after a config change."""
    _identity_cache.clear()


def token_required(settings: Settings) -> bool:
    """Whether a caller must prove anything at all.

    `admin_jwt_auth` deliberately does not appear here. It is on by default
    because the Bearer path should always be *available*, but switching it on
    must not silently start demanding a Supabase session from a developer
    running the service against a local .env with no token -- which is how the
    whole Phase 3/4 workflow is exercised.

    So the rule stays what it was: production always requires a credential, and
    development requires one only once a shared secret exists to check against.
    """
    return settings.is_production or bool(settings.api_token)


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=message)


def _bearer(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


async def _verify_admin_user(
    token: str,
    settings: Settings,
    supabase: SupabaseService,
) -> Caller:
    key = _cache_key(token)
    cached = _cached_user(key, settings.admin_jwt_cache_seconds)
    if cached is not False:
        if cached is None:
            raise _unauthorized("Not authorized to use the automation service.")
        return Caller(kind="admin_user", user_id=cached)

    try:
        user = await supabase.get_token_user(token)
    except SupabaseError as error:
        # Supabase being unreachable is not the caller's fault and must not be
        # reported as "you are not an admin", which would send an operator
        # hunting for a permissions problem that does not exist.
        log_event(logger, logging.ERROR, "security.identity.unavailable", error=type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not verify the caller right now.",
        ) from error

    if not user:
        log_event(logger, logging.WARNING, "security.jwt.rejected")
        raise _unauthorized("Invalid or expired access token.")

    user_id = str(user.get("id") or "")

    try:
        allowed = await supabase.user_is_admin(user_id)
    except SupabaseError as error:
        log_event(logger, logging.ERROR, "security.admins.unavailable", error=type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not verify the caller right now.",
        ) from error

    if not allowed:
        # Authenticated but not authorised: a real distinction, and 403 is what
        # lets the Admin say "your account lacks access" instead of "log in".
        _remember(key, None, settings.admin_jwt_cache_seconds)
        log_event(logger, logging.WARNING, "security.admin.denied", user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not authorized to use the automation service.",
        )

    _remember(key, user_id, settings.admin_jwt_cache_seconds)
    return Caller(kind="admin_user", user_id=user_id)


async def verify_caller(
    x_api_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    supabase: SupabaseService = Depends(get_supabase_service),
) -> Caller:
    """FastAPI dependency. Proves the caller or refuses the request."""
    settings = get_settings()

    if not token_required(settings):
        return Caller(kind="anonymous")

    # The shared secret wins when present: it is the cheaper check and it is
    # what a machine sends.
    if x_api_token is not None and settings.api_token:
        if hmac.compare_digest(x_api_token, settings.api_token):
            return Caller(kind="service")
        log_event(logger, logging.WARNING, "security.token.rejected")
        raise _unauthorized("Invalid or missing API token.")

    bearer = _bearer(authorization)
    if bearer and settings.admin_jwt_auth:
        if not settings.supabase_configured:
            # Nothing to verify against. Refusing beats trusting the token.
            log_event(logger, logging.ERROR, "security.jwt.unverifiable")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The service cannot verify credentials right now.",
            )
        return await _verify_admin_user(bearer, settings, supabase)

    if not settings.api_token and not settings.admin_jwt_auth:
        # Production with nothing configured: refuse rather than run open.
        log_event(logger, logging.ERROR, "security.no_mechanism", env=settings.app_env)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No authentication mechanism is configured on the server.",
        )

    log_event(logger, logging.WARNING, "security.credentials.missing", provided=bool(x_api_token))
    raise _unauthorized("Authentication is required.")


async def verify_api_token(caller: Caller = Depends(verify_caller)) -> Caller:
    """Backwards-compatible name for the router dependency."""
    return caller

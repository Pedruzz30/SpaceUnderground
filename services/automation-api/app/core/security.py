"""Request authentication.

This service holds a Supabase key that can read every row in the database, so
it is not a public endpoint even while it runs on localhost. The guard is a
shared secret rather than user auth: the caller is the Admin, not a person.

Development may run without a token, because requiring one before there is
anywhere to store it only teaches people to disable the check. Production may
not: `verify_api_token` refuses every request when the token is missing there,
which fails closed.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import Header, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.logging import get_logger, log_event

logger = get_logger("security")

API_TOKEN_HEADER = "X-API-Token"


def token_required(settings: Settings) -> bool:
    return bool(settings.api_token) or settings.is_production


async def verify_api_token(x_api_token: str | None = Header(default=None)) -> None:
    """FastAPI dependency. Raises 401 when the shared secret does not match."""
    settings = get_settings()

    if not token_required(settings):
        return

    if not settings.api_token:
        # Production with no token configured: refuse rather than run open.
        log_event(logger, logging.ERROR, "security.token.missing_config", env=settings.app_env)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API token is not configured on the server.",
        )

    # compare_digest keeps the check constant-time.
    if not x_api_token or not hmac.compare_digest(x_api_token, settings.api_token):
        log_event(logger, logging.WARNING, "security.token.rejected", provided=bool(x_api_token))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API token.",
        )

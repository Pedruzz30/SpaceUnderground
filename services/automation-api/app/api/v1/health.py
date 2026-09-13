"""Health endpoints.

Health is intentionally unauthenticated: a probe that needs a secret is a probe
that stops working the moment the secret rotates. It reports whether
dependencies are *configured*, never how -- no URLs, no key fragments.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.common import DependencyHealth, DetailedHealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=DetailedHealthResponse, summary="Service health")
async def health(settings: Settings = Depends(get_settings)) -> DetailedHealthResponse:
    dependencies = [
        DependencyHealth(
            name="supabase",
            configured=settings.supabase_configured,
            detail=(
                None
                if settings.supabase_configured
                else "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set."
            ),
        ),
        DependencyHealth(
            name="api_token",
            configured=bool(settings.api_token),
            detail=(
                None
                if settings.api_token
                else "No shared secret configured; requests are unauthenticated."
            ),
        ),
    ]

    return DetailedHealthResponse(
        status="ok",
        service=settings.service_name,
        version=settings.version,
        environment=settings.app_env,
        dependencies=dependencies,
    )

"""Health endpoints.

Health is intentionally unauthenticated: a probe that needs a secret is a probe
that stops working the moment the secret rotates. It reports whether
dependencies are *configured*, never how -- no URLs, no key fragments.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.common import DependencyHealth, DetailedHealthResponse
from app.services.run_store import RunStore
from app.services.supabase_service import SupabaseService, get_supabase_service

router = APIRouter(tags=["health"])


def _supabase_detail(settings: Settings) -> str | None:
    """Why Supabase is unusable, without ever describing the key itself."""
    if settings.supabase_configured:
        return None
    if settings.service_role_key_is_public:
        # The most valuable message here: the slot is filled, just wrongly.
        return "A public key is set as SUPABASE_SERVICE_ROLE_KEY; a secret/service role key is required."
    return "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set."


@router.get("/health", response_model=DetailedHealthResponse, summary="Service health")
async def health(
    settings: Settings = Depends(get_settings),
    supabase: SupabaseService = Depends(get_supabase_service),
) -> DetailedHealthResponse:
    dependencies = [
        DependencyHealth(
            name="supabase",
            configured=settings.supabase_configured,
            detail=_supabase_detail(settings),
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

    # One bounded row, so versioned health stays cheap. The root probe does no
    # I/O at all and is left alone.
    if settings.supabase_configured:
        storage_available = await RunStore(supabase).available()
        dependencies.append(
            DependencyHealth(
                name="automation_storage",
                configured=storage_available,
                detail=(
                    None
                    if storage_available
                    else "automation_runs is not reachable; history is not being stored."
                ),
            )
        )
    else:
        dependencies.append(
            DependencyHealth(
                name="automation_storage",
                configured=False,
                detail="Supabase is not configured; run history is not being stored.",
            )
        )

    return DetailedHealthResponse(
        status="ok",
        service=settings.service_name,
        version=settings.version,
        environment=settings.app_env,
        dependencies=dependencies,
    )

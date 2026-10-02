"""Health endpoints.

Health is intentionally unauthenticated: a probe that needs a secret is a probe
that stops working the moment the secret rotates. It reports whether
dependencies are *configured*, never how -- no URLs, no key fragments.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.api.v1.automations import get_store
from app.core.config import Settings, get_settings
from app.schemas.common import DependencyHealth, DetailedHealthResponse, ReadinessResponse
from app.services.run_store import RunStore

router = APIRouter(tags=["health"])


def _supabase_detail(settings: Settings) -> str | None:
    """Why Supabase is unusable, without ever describing the key itself."""
    if settings.supabase_configured:
        return None
    if settings.service_role_key_is_public:
        # The most valuable message here: the slot is filled, just wrongly.
        return "A public key is set as SUPABASE_SERVICE_ROLE_KEY; a secret/service role key is required."
    return "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set."


def _auth_detail(settings: Settings) -> str | None:
    """Which mechanisms are enabled -- never a credential, not even its shape."""
    mechanisms = []
    if settings.admin_jwt_auth:
        mechanisms.append("admin access token")
    if settings.api_token:
        mechanisms.append("service token")

    if not mechanisms:
        return "No authentication is configured; requests are unauthenticated."
    return ", ".join(mechanisms)


@router.get("/health", response_model=DetailedHealthResponse, summary="Service health")
async def health(
    settings: Settings = Depends(get_settings),
    store: RunStore = Depends(get_store),
) -> DetailedHealthResponse:
    dependencies = [
        DependencyHealth(
            name="supabase",
            configured=settings.supabase_configured,
            detail=_supabase_detail(settings),
        ),
        DependencyHealth(
            name="authentication",
            configured=settings.admin_jwt_auth or bool(settings.api_token),
            # Says which mechanisms are on, never what any credential is.
            detail=_auth_detail(settings),
        ),
    ]

    # One bounded row, so versioned health stays cheap. The root probe does no
    # I/O at all and is left alone.
    if settings.supabase_configured:
        storage_available = await store.available()
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


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    responses={503: {"description": "Not ready"}},
)
async def ready(
    response: Response,
    settings: Settings = Depends(get_settings),
    store: RunStore = Depends(get_store),
) -> ReadinessResponse:
    """Whether the service can serve automation work right now.

    Answers 503 when it cannot, so a deploy can wait rather than send traffic
    into a process that will refuse it. Nothing here restarts or kills the
    service: a Supabase outage makes this endpoint say "not ready" and then say
    "ready" again by itself, without anyone intervening.
    """
    problems = settings.startup_problems
    checks = (
        [DependencyHealth(name="configuration", configured=False, detail=problem) for problem in problems]
        if problems
        else [DependencyHealth(name="configuration", configured=True)]
    )

    storage_available = False
    if settings.supabase_configured:
        storage_available = await store.available()

    checks.append(
        DependencyHealth(
            name="automation_storage",
            configured=storage_available,
            detail=None if storage_available else "automation_runs is not reachable.",
        )
    )

    is_ready = all(check.configured for check in checks)
    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadinessResponse(ready=is_ready, environment=settings.app_env, checks=checks)

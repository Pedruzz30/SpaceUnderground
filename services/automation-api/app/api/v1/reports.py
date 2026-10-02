"""Operational reporting endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.errors import not_configured, upstream
from app.core.permissions import ANALYZE_PROJECTS
from app.core.security import Access, require_permissions
from app.schemas.report import OverviewReport
from app.services.reporting_service import build_overview
from app.services.supabase_service import (
    SupabaseError,
    SupabaseNotConfigured,
    SupabaseService,
    get_supabase_service,
)

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/overview", response_model=OverviewReport, summary="Operations overview")
async def overview(
    _: Access = Depends(require_permissions(*ANALYZE_PROJECTS)),
    supabase: SupabaseService = Depends(get_supabase_service),
) -> OverviewReport:
    try:
        rows = await supabase.list_projects()
    except SupabaseNotConfigured as error:
        raise not_configured(str(error)) from error
    except SupabaseError as error:
        raise upstream("Could not read projects from Supabase.") from error

    return build_overview(rows)

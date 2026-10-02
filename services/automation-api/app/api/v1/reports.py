"""Operational reporting endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import verify_api_token
from app.schemas.report import OverviewReport
from app.services.reporting_service import build_overview
from app.services.supabase_service import (
    SupabaseNotConfigured,
    SupabaseService,
    SupabaseUnavailable,
    get_supabase_service,
)

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(verify_api_token)])


@router.get("/overview", response_model=OverviewReport, summary="Operations overview")
async def overview(
    supabase: SupabaseService = Depends(get_supabase_service),
) -> OverviewReport:
    try:
        rows = await supabase.list_projects()
    except SupabaseNotConfigured as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    except SupabaseUnavailable as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not read projects from Supabase.",
        ) from error

    return build_overview(rows)

"""Project processing endpoints.

Only processing lives here. Reading and writing a project is the Admin's job
through Supabase directly; routing plain CRUD through Python would add a hop
that does nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, status

from app.core.security import verify_api_token
from app.schemas.project import ProjectAnalysis
from app.services.project_analysis_service import analyze_project
from app.services.supabase_service import (
    ProjectNotFound,
    SupabaseNotConfigured,
    SupabaseService,
    SupabaseUnavailable,
    get_supabase_service,
)

router = APIRouter(prefix="/projects", tags=["projects"], dependencies=[Depends(verify_api_token)])


@router.post(
    "/{project_id}/analyze",
    response_model=ProjectAnalysis,
    summary="Operational analysis of one project",
)
async def analyze(
    # Bounded and pattern-checked at the edge: the identifier reaches a query
    # string, so it never accepts arbitrary text.
    project_id: str = Path(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9-]+$"),
    supabase: SupabaseService = Depends(get_supabase_service),
) -> ProjectAnalysis:
    try:
        row = await supabase.get_project(project_id)
    except SupabaseNotConfigured as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    except ProjectNotFound as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.") from error
    except SupabaseUnavailable as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not read the project from Supabase.",
        ) from error

    return analyze_project(row)

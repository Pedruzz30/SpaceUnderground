"""Project processing endpoints.

Only processing lives here. Reading and writing a project is the Admin's job
through Supabase directly; routing plain CRUD through Python would add a hop
that does nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path

from app.core.errors import not_configured, not_found, upstream
from app.core.permissions import ANALYZE_PROJECTS
from app.core.security import Access, require_permissions
from app.schemas.project import ProjectAnalysis
from app.services.project_analysis_service import analyze_project
from app.services.supabase_service import (
    RecordNotFound,
    SupabaseError,
    SupabaseNotConfigured,
    SupabaseService,
    get_supabase_service,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post(
    "/{project_id}/analyze",
    response_model=ProjectAnalysis,
    summary="Operational analysis of one stored project",
)
async def analyze(
    # Bounded and pattern-checked at the edge: the identifier reaches a query
    # string, so it never accepts arbitrary text.
    project_id: str = Path(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9-]+$"),
    _: Access = Depends(require_permissions(*ANALYZE_PROJECTS)),
    supabase: SupabaseService = Depends(get_supabase_service),
) -> ProjectAnalysis:
    try:
        row = await supabase.get_project(project_id)
    except SupabaseNotConfigured as error:
        raise not_configured(str(error)) from error
    except RecordNotFound as error:
        raise not_found("Project not found.") from error
    except SupabaseError as error:
        raise upstream("Could not read the project from Supabase.") from error

    return analyze_project(row)

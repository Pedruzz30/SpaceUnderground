"""Project analysis response shapes."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import AnalysisStatus, CheckStatus


class AnalysisCheck(BaseModel):
    key: str = Field(examples=["poster"])
    status: CheckStatus
    message: str = Field(examples=["Poster configurado."])


class ProjectAnalysis(BaseModel):
    project_id: str
    case_number: int | None = None
    name: str | None = None
    score: int = Field(ge=0, le=100)
    status: AnalysisStatus
    checks: list[AnalysisCheck]
    warnings: list[str] = []
    recommendations: list[str] = []


class ProjectSummary(BaseModel):
    """Minimal identity, for automation results that should not echo a row."""

    project_id: str
    case_number: int | None = None
    name: str | None = None

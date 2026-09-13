"""Shapes shared by more than one endpoint."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class CheckStatus(str, Enum):
    """Outcome of a single operational check.

    Deliberately three states. `warn` is what makes the analysis usable on a
    real catalogue: a project that predates a requirement is not broken, and
    calling it broken trains people to ignore the report.
    """

    OK = "ok"
    WARN = "warn"
    FAIL = "fail"


class AnalysisStatus(str, Enum):
    """Overall verdict.

    The vocabulary matches the Admin's existing health states so both can be
    rendered by the same UI without a translation table.
    """

    HEALTHY = "healthy"
    ATTENTION = "attention"
    INCOMPLETE = "incomplete"


class HealthResponse(BaseModel):
    status: str = Field(examples=["ok"])
    service: str = Field(examples=["space-underground-automation"])
    version: str = Field(examples=["0.1.0"])


class DependencyHealth(BaseModel):
    """Whether a dependency is usable, without leaking how it is configured."""

    name: str
    configured: bool
    detail: str | None = None


class DetailedHealthResponse(HealthResponse):
    environment: str
    dependencies: list[DependencyHealth]


class ErrorResponse(BaseModel):
    """The only error body this service returns.

    `code` is stable and meant to be branched on; `message` is for humans and
    never carries a stack trace or a database string.
    """

    code: str = Field(examples=["not_found"])
    message: str = Field(examples=["Project not found."])

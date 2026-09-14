"""Automation engine shapes."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AutomationEvent(BaseModel):
    """An event submitted for dispatch.

    The payload is free-form because each workflow reads what it needs, but it
    is never trusted: handlers read named keys, ignore the rest, and load the
    entity back from the database rather than believing the payload.
    """

    event: str = Field(min_length=1, max_length=100, examples=["project.published"])
    entity_type: str | None = Field(default=None, max_length=50, examples=["project"])
    entity_id: str | None = Field(default=None, max_length=100, examples=["001"])

    # Supplied by the caller to collapse an accidental double dispatch. Two
    # clicks on publish share one id; a deliberate re-run later uses a new one.
    operation_id: str | None = Field(default=None, max_length=100)

    payload: dict[str, Any] = Field(default_factory=dict)
    dry_run: bool = False

    def idempotency_key(self) -> str | None:
        """event + entity + operation, or None when there is nothing to key on.

        Without an operation id there is no key at all: keying on event and
        entity alone would block every legitimate later run of the same event
        on the same project, which is a normal thing to want.
        """
        if not self.operation_id:
            return None
        entity = self.entity_id or self.payload.get("project_id") or self.payload.get("proposal_id") or "-"
        return f"{self.event}:{entity}:{self.operation_id}"


class AutomationStep(BaseModel):
    name: str
    status: str = Field(examples=["SUCCESS", "FAILED", "SKIPPED"])
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    result: Any = None
    error: str | None = None


class AutomationRun(BaseModel):
    """One execution, as the Admin sees it."""

    run_id: str | None = Field(default=None, description="Null when history could not be persisted.")
    event: str
    status: str = Field(examples=["SUCCESS", "FAILED", "SKIPPED", "RUNNING", "PENDING"])
    source: str = "api"
    entity_type: str | None = None
    entity_id: str | None = None
    steps: list[AutomationStep] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    retry_of: str | None = None
    created_at: str | None = None

    # True when the workflow ran but its history could not be stored, so the
    # Admin can say so instead of showing a run it will never find again.
    persisted: bool = True
    # True when an identical dispatch had already been recorded.
    deduplicated: bool = False


class AutomationRunList(BaseModel):
    runs: list[AutomationRun]
    count: int
    limit: int
    # An empty list means two very different things -- nothing has run, or the
    # history table cannot be read. Without this the Logs screen would report
    # the second as the first.
    storage_available: bool = True


class AutomationStats(BaseModel):
    """Counted over the most recent runs, never estimated."""

    total: int
    success: int
    failed: int
    # Null rather than 0 when nothing has run: a rate needs a sample.
    success_rate: float | None = None
    last_run: dict[str, Any] | None = None
    storage_available: bool = True


class RegisteredAutomation(BaseModel):
    event: str
    steps: list[str]

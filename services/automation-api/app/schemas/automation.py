"""Automation engine shapes."""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, field_validator

# An operation id names one deliberate action (a click). It becomes part of a
# unique database key, so it is held to a shape that cannot smuggle anything.
_OPERATION_ID = re.compile(r"^[A-Za-z0-9._:-]{8,100}$")


def _operation_id(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not _OPERATION_ID.match(value):
        raise ValueError("operation_id must be 8-100 characters of letters, digits, '.', '_', ':' or '-'.")
    return value


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

    @field_validator("operation_id")
    @classmethod
    def _check_operation(cls, value: str | None) -> str | None:
        return _operation_id(value)

    @field_validator("payload")
    @classmethod
    def _bounded_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        # Stored with the run and replayed on retry: kept small and flat.
        if len(value) > 20 or len(repr(value)) > 4000:
            raise ValueError("payload is too large.")
        return value

    def subject_id(self) -> str | None:
        value = self.entity_id or self.payload.get("project_id") or self.payload.get("opportunity_id")
        return str(value) if value else None

    def idempotency_key(self) -> str | None:
        """event + entity + operation, or None when there is nothing to key on.

        Without an operation id there is no key at all: keying on event and
        entity alone would block every legitimate later run of the same event
        on the same project, which is a normal thing to want.
        """
        if not self.operation_id:
            return None
        return f"{self.event}:{self.subject_id() or '-'}:{self.operation_id}"


class RetryRequest(BaseModel):
    """A retry is a deliberate action too: its id collapses a double click."""

    operation_id: str | None = Field(default=None, max_length=100)

    @field_validator("operation_id")
    @classmethod
    def _check_operation(cls, value: str | None) -> str | None:
        return _operation_id(value)


class JobRunRequest(BaseModel):
    # None runs every registered job.
    jobs: list[str] | None = Field(default=None, max_length=20)
    operation_id: str | None = Field(default=None, max_length=100)
    # Sent by the scheduler: at most one run per job per business day, however
    # many times the schedule fires. Only honoured for the scheduler token.
    scheduled: bool = False

    @field_validator("operation_id")
    @classmethod
    def _check_operation(cls, value: str | None) -> str | None:
        return _operation_id(value)


class AutomationStep(BaseModel):
    name: str
    status: str = Field(examples=["SUCCESS", "FAILED", "SKIPPED"])
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    result: Any = None
    error: str | None = None
    # True when the reader may not see this step's result (see Step.visible_with).
    redacted: bool = False


class AutomationRun(BaseModel):
    """One execution, as the Admin sees it. `run_id` is the table's `id`."""

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
    requested_by: str | None = None
    created_at: str | None = None

    # True when the workflow ran but its history could not be stored, so the
    # Admin can say so instead of showing a run it will never find again.
    persisted: bool = True
    # True when an identical dispatch had already been recorded.
    deduplicated: bool = False
    # RUNNING for longer than any step can take: its process stopped mid-run.
    stale: bool = False
    # Whether this reader may retry it: failed or stale, and still registered.
    retryable: bool = False
    # True when part of the result was withheld from this reader.
    redacted: bool = False


class AutomationRunList(BaseModel):
    runs: list[AutomationRun]
    count: int
    limit: int
    # An empty list means two very different things -- nothing has run, or the
    # history table cannot be read. Without this the Logs screen would report
    # the second as the first.
    storage_available: bool = True


class AttentionItem(BaseModel):
    run_id: str | None = None
    event: str | None = None
    status: str | None = None
    reason: str = Field(examples=["failed", "stale", "attention"])
    entity_type: str | None = None
    entity_id: str | None = None
    error: str | None = None
    created_at: str | None = None


class AutomationStats(BaseModel):
    """Counted over the most recent runs, never estimated."""

    total: int
    success: int
    failed: int
    running_stale: int = 0
    # Null rather than a number when the sample is too small to be a rate.
    success_rate: float | None = None
    last_run: dict[str, Any] | None = None
    attention: list[AttentionItem] = Field(default_factory=list)
    window: int = 100
    storage_available: bool = True


class RegisteredAutomation(BaseModel):
    event: str
    description: str = ""
    entity_type: str | None = None
    steps: list[str]
    permissions: list[str] = Field(default_factory=list)
    writes: bool = False


class RegisteredJob(BaseModel):
    job: str
    event: str
    description: str = ""
    steps: list[str]


class JobRunResponse(BaseModel):
    runs: list[AutomationRun]

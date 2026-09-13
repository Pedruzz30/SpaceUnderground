"""Automation engine shapes."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AutomationEvent(BaseModel):
    """An event submitted for dispatch.

    The payload is free-form because each handler validates what it needs, but
    it is never trusted: handlers read named keys and ignore the rest, and no
    handler in this phase writes anything back to Supabase.
    """

    event: str = Field(min_length=1, max_length=100, examples=["project.published"])
    payload: dict[str, Any] = Field(default_factory=dict)


class AutomationResult(BaseModel):
    event: str
    handler: str
    status: str = Field(examples=["ok", "skipped", "failed"])
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class AutomationDispatch(BaseModel):
    event: str
    handled: bool
    results: list[AutomationResult]


class RegisteredAutomation(BaseModel):
    event: str
    handlers: list[str]

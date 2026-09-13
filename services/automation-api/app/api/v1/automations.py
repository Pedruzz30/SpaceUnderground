"""Automation endpoints.

Dispatch is synchronous on purpose. The handlers in this phase only read and
analyse, so they finish in one request, and an in-process call is far easier to
reason about than a queue nobody needs yet.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import verify_api_token
from app.schemas.automation import AutomationDispatch, AutomationEvent, RegisteredAutomation
from app.services.automation_service import KNOWN_EVENTS, dispatch, registered_automations
from app.services.supabase_service import (
    SupabaseNotConfigured,
    SupabaseService,
    get_supabase_service,
)

router = APIRouter(prefix="/automations", tags=["automations"], dependencies=[Depends(verify_api_token)])


@router.get("", response_model=list[RegisteredAutomation], summary="Registered automations")
async def list_automations() -> list[RegisteredAutomation]:
    return registered_automations()


@router.post("/dispatch", response_model=AutomationDispatch, summary="Dispatch an automation event")
async def dispatch_event(
    event: AutomationEvent,
    supabase: SupabaseService = Depends(get_supabase_service),
) -> AutomationDispatch:
    # An unknown event name is a caller mistake worth reporting, not something
    # to absorb silently: a typo would otherwise look like a working no-op.
    if event.event not in KNOWN_EVENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown event: " + event.event,
        )

    try:
        results = await dispatch(event.event, event.payload, supabase)
    except SupabaseNotConfigured as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error

    return AutomationDispatch(event=event.event, handled=bool(results), results=results)

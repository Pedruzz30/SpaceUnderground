"""Who the service sees, and what that caller may do here.

Display only: it lets Settings say "authenticated as SU-00001, may view runs"
and lets the Admin hide a control a member cannot use. Every other endpoint
checks its own permission again, so a stale or forged answer here unlocks
nothing.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from app.core.permissions import REPORTED
from app.core.security import Access, current_access
from app.schemas.common import CallerSession

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=CallerSession, summary="The caller and its permissions here")
async def me(access: Access = Depends(current_access)) -> CallerSession:
    caller = access.caller
    answers = await asyncio.gather(*(access.can(permission) for permission in REPORTED))
    return CallerSession(
        kind=caller.kind,
        user_id=caller.user_id,
        permissions=[permission for permission, allowed in zip(REPORTED, answers, strict=True) if allowed],
    )

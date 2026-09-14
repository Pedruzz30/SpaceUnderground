"""Explicit map from event name to workflow.

A dict rather than a chain of if/elif, and one module per handler rather than
one growing file. Adding an event is adding a module and one entry here, which
also means the full set of supported events is readable in one place.
"""

from __future__ import annotations

from app.automations.engine import Workflow
from app.automations.handlers import project_completed, project_published

# Only the two events this phase implements. An event that has no workflow is
# rejected at the edge rather than silently accepted, so a typo in a dispatch
# is visible instead of looking like a working no-op.
WORKFLOWS: dict[str, Workflow] = {
    project_published.EVENT: project_published.WORKFLOW,
    project_completed.EVENT: project_completed.WORKFLOW,
}


def known_events() -> tuple[str, ...]:
    return tuple(sorted(WORKFLOWS))


def get_workflow(event: str) -> Workflow | None:
    return WORKFLOWS.get(event)

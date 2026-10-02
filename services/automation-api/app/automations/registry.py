"""Explicit map from event name to workflow.

A dict rather than a chain of if/elif, and one module per handler rather than
one growing file. Adding an event is adding a module and one entry here, which
also means the full set of supported events is readable in one place.

Retired events are listed too. Their runs stay in the history and stay
readable, but they can no longer be dispatched or retried: the model they
were written against is gone.
"""

from __future__ import annotations

from app.automations.engine import Workflow
from app.automations.handlers import commercial_opportunity_won, project_completed, project_published
from app.automations.jobs import JOBS

# An event without a workflow is rejected at the edge rather than silently
# accepted, so a typo in a dispatch is visible instead of looking like a no-op.
WORKFLOWS: dict[str, Workflow] = {
    project_published.EVENT: project_published.WORKFLOW,
    project_completed.EVENT: project_completed.WORKFLOW,
    commercial_opportunity_won.EVENT: commercial_opportunity_won.WORKFLOW,
}

# Workflows the scheduler runs, by their run event (job.<name>). Reachable for
# history and retry, never through /dispatch.
JOB_WORKFLOWS: dict[str, Workflow] = {workflow.event: workflow for workflow in JOBS.values()}

# Events that ran in production before the current pipeline existed.
# `commercial.proposal.accepted` read `commercial_proposals`, which nothing in
# the Admin writes since Commercial moved to `commercial_opportunities`.
RETIRED_EVENTS = {
    "commercial.proposal.accepted": "commercial.opportunity.won",
}


def known_events() -> tuple[str, ...]:
    return tuple(sorted(WORKFLOWS))


def get_workflow(event: str) -> Workflow | None:
    """A dispatchable workflow."""
    return WORKFLOWS.get(event)


def get_run_workflow(event: str) -> Workflow | None:
    """The workflow behind a stored run, events and jobs alike (for retry and
    for deciding what a reader may see)."""
    return WORKFLOWS.get(event) or JOB_WORKFLOWS.get(event)

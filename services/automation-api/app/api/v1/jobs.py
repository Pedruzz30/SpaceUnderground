"""Scheduled jobs: the endpoint a scheduler calls.

The scheduler is deliberately outside this process (a GitHub Actions cron,
see .github/workflows/automation-jobs.yml): a web service that schedules its
own work runs it twice when it scales to two instances and never when it
sleeps. Here there is only an authenticated endpoint that runs the registered
jobs, once per business day when the call says it is the schedule.

Never open: the service token (the scheduler) or a member holding
settings.edit (a manual "run now").
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1.automations import get_store, present_run, source_for
from app.automations.engine import run_workflow
from app.automations.jobs import JOBS, get_job, job_names
from app.core.config import get_settings
from app.core.errors import bad_request, not_configured
from app.core.permissions import RUN_JOBS, VIEW_RUNS
from app.core.security import Access, current_access, require_permissions
from app.schemas.automation import JobRunRequest, JobRunResponse, RegisteredJob
from app.services.run_store import RunStore
from app.services.supabase_service import SupabaseService, get_supabase_service
from app.utils.dates import business_today

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=list[RegisteredJob], summary="Registered jobs")
async def list_jobs(_: Access = Depends(require_permissions(*VIEW_RUNS))) -> list[RegisteredJob]:
    return [
        RegisteredJob(
            job=name,
            event=JOBS[name].event,
            description=JOBS[name].description,
            steps=[step.name for step in JOBS[name].steps],
        )
        for name in job_names()
    ]


@router.post("/run", response_model=JobRunResponse, summary="Run scheduled jobs")
async def run_jobs(
    request: JobRunRequest,
    access: Access = Depends(current_access),
    supabase: SupabaseService = Depends(get_supabase_service),
    store: RunStore = Depends(get_store),
) -> JobRunResponse:
    await access.require(*RUN_JOBS)

    names = request.jobs or list(job_names())
    unknown = [name for name in names if get_job(name) is None]
    if unknown:
        raise bad_request("Unknown job(s): " + ", ".join(sorted(unknown)))
    if not supabase.configured:
        raise not_configured("Supabase is not configured on the automation service.")

    # The schedule's own key: one run per job per business day, however many
    # times the cron fires (a GitHub Actions retry, a manual re-run). A person
    # running it by hand is a separate, deliberate action.
    scheduled = request.scheduled and access.caller.is_service
    window = business_today(get_settings().app_timezone).isoformat()
    source = "scheduler" if scheduled else source_for(access)

    runs = []
    for name in dict.fromkeys(names):
        if scheduled:
            key = f"job:{name}:{window}"
        elif request.operation_id:
            key = f"job:{name}:op:{request.operation_id}"
        else:
            key = None

        run = await run_workflow(
            get_job(name),
            supabase=supabase,
            store=store,
            entity_type="job",
            entity_id=name,
            payload={"job": name, "window": window},
            source=source,
            idempotency_key=key,
            access=access,
        )
        runs.append(await present_run(run, access))

    return JobRunResponse(runs=runs)

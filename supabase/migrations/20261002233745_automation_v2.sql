-- Space Underground - automation v2
--
-- Additive. Reintegrates the automation service (services/automation-api) on
-- top of the current pipeline (commercial_opportunities), ledger
-- (financial_transactions) and access model (the security foundation,
-- 20261002033705). Nothing existing is renamed, dropped or rewritten, and no
-- row is deleted; earlier runs and handoffs stay exactly as they are.
--
--   1. automation_runs.requested_by    who asked for a run
--   2. automation_runs grants           made explicit: service role only
--   3. commercial_project_handoffs      keyed by opportunity, once
--   4. automation_open_project_for_opportunity()
--                                       the one business write of the
--                                       service: one transaction, idempotent
--
-- Who owns what when a deal is won: the Admin moves the opportunity to WON and
-- records the client and the receivables the operator confirms (that already
-- works, with its own retry recovery). The automation opens the project, the
-- handoff and the links, through the function below. Neither creates what the
-- other owns.

-- ---------------------------------------------------------------------------
-- 1. automation_runs.requested_by
-- ---------------------------------------------------------------------------
--
-- The member whose request started a run (a dispatch or a retry), as the
-- automation service verified them. Null for the scheduler and for runs from
-- before this column. Not a foreign key that cascades: a run is history and
-- outlives the account.

alter table public.automation_runs
  add column if not exists requested_by uuid references auth.users (id) on delete set null;

comment on column public.automation_runs.requested_by is
  'Member who dispatched or retried the run, as verified by the automation service. Null for scheduled and service runs.';

-- "What retried this run?" -- read by the run statistics.
create index if not exists automation_runs_retry_of_idx
  on public.automation_runs (retry_of)
  where retry_of is not null;

-- ---------------------------------------------------------------------------
-- 2. automation_runs grants
-- ---------------------------------------------------------------------------
--
-- Row level security with no policy already hides every row from anon and
-- authenticated; this removes the table-level privileges Supabase's default
-- grants hand out as well, so the intent does not rest on RLS alone. The
-- service role keeps what it has. The Admin reads run history through the
-- automation API, which checks logs.read in the database first.

revoke all on table public.automation_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. commercial_project_handoffs, keyed by opportunity
-- ---------------------------------------------------------------------------
--
-- A handoff links the commercial record a project was opened from to that
-- project. It came from a proposal (commercial.proposal.accepted, retired:
-- nothing writes commercial_proposals since Commercial V2); it now comes from
-- an opportunity. The unique index is the durable idempotency guard: one
-- project per won opportunity, whatever retries or double clicks happen.
-- run_id points at the automation run that opened it.

alter table public.commercial_project_handoffs
  add column if not exists opportunity_id uuid references public.commercial_opportunities (id) on delete set null,
  add column if not exists run_id uuid references public.automation_runs (id) on delete set null;

alter table public.commercial_project_handoffs
  alter column proposal_id drop not null;

do $handoffs$
begin
  -- From one source, never two. (Both null is allowed: the source record
  -- was deleted and its link set to null, the project stays.)
  if not exists (
    select 1 from pg_constraint
    where conname = 'commercial_project_handoffs_one_source'
      and conrelid = 'public.commercial_project_handoffs'::regclass
  ) then
    alter table public.commercial_project_handoffs
      add constraint commercial_project_handoffs_one_source
      check (proposal_id is null or opportunity_id is null);
  end if;
end
$handoffs$;

create unique index if not exists commercial_project_handoffs_opportunity_key
  on public.commercial_project_handoffs (opportunity_id)
  where opportunity_id is not null;

comment on column public.commercial_project_handoffs.opportunity_id is
  'Won opportunity the project was opened from. Unique: one project per opportunity.';
comment on column public.commercial_project_handoffs.run_id is
  'Automation run that opened the project, when its history was stored.';

-- ---------------------------------------------------------------------------
-- 4. automation_open_project_for_opportunity()
-- ---------------------------------------------------------------------------
--
-- Opens the project draft of a won opportunity, or finds the one already
-- opened, and converges the links. In one transaction:
--
--   - serialised per opportunity (an advisory lock), so two concurrent calls
--     cannot both find "no handoff" and both create a project
--   - project: DRAFT, hidden, not featured, In Development, with the next case
--     number and a free slug derived from the one given
--   - handoff: opportunity -> project (unique on the opportunity)
--   - client: set on the project when the deal has one and the project has
--     none yet (a client linked later reaches it on the next call)
--   - ledger: when p_link_finance, the deal's non-cancelled entries without a
--     project are linked to it. Amounts, statuses and dates are never touched
--   - activity_log: one entry per thing that changed, authored by p_actor
--
-- Calling it again changes nothing that is already right, so a double click,
-- a network retry, a manual retry and "Finish closing" all end on the same
-- single project.
--
-- Errors carry their own SQLSTATE, which the service turns into a message:
--   AU001  the opportunity does not exist
--   AU002  the opportunity is not WON
--   AU003  invalid project input (name, slug, category)
--   42501  not called by the automation service
--
-- Security definer so it can check p_actor against auth.users; reachable only
-- by the service role (EXECUTE below), and it refuses anything else anyway.
-- Permissions are the caller's responsibility: the automation service asks
-- public.has_permission('projects.create'), ('commercial.edit') and, for the
-- ledger link, ('finance.edit') as the member before calling it.

create or replace function public.automation_open_project_for_opportunity(
  p_opportunity uuid,
  p_category text,
  p_name text,
  p_slug text,
  p_link_finance boolean default false,
  p_actor uuid default null,
  p_run uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_opportunity public.commercial_opportunities%rowtype;
  v_handoff public.commercial_project_handoffs%rowtype;
  v_project public.projects%rowtype;
  v_actor uuid;
  v_run uuid;
  v_client_label text;
  v_base_slug text;
  v_slug text;
  v_case integer;
  v_attempt integer := 0;
  v_created boolean := false;
  v_client_linked boolean := false;
  v_linked integer := 0;
begin
  if not public.is_trusted_backend() then
    raise exception 'only the automation service may open a project for an opportunity'
      using errcode = '42501';
  end if;

  if p_opportunity is null then
    raise exception 'an opportunity is required' using errcode = 'AU003';
  end if;
  if p_category is null or p_category not in ('Website', 'System', 'Automation', 'AI', 'Other') then
    raise exception 'unsupported project category' using errcode = 'AU003';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'a project name is required' using errcode = 'AU003';
  end if;

  v_base_slug := btrim(regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base_slug = '' or length(v_base_slug) > 120 then
    raise exception 'a valid project slug is required' using errcode = 'AU003';
  end if;

  -- One opener per opportunity at a time. A concurrent call waits here, then
  -- finds the handoff the first one wrote.
  perform pg_advisory_xact_lock(hashtextextended('automation.open_project:' || p_opportunity::text, 0));

  select * into v_opportunity
  from public.commercial_opportunities
  where id = p_opportunity
  for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'AU001';
  end if;
  if v_opportunity.stage <> 'WON' then
    raise exception 'opportunity is not won' using errcode = 'AU002';
  end if;

  -- Only real references are written: an unknown actor or run becomes null
  -- rather than failing the transaction on a foreign key.
  select id into v_actor from auth.users where id = p_actor;
  select id into v_run from public.automation_runs where id = p_run;

  select * into v_handoff
  from public.commercial_project_handoffs
  where opportunity_id = p_opportunity;

  if found then
    select * into v_project from public.projects where id = v_handoff.project_id;
  else
    -- The public label shown on a case card; the private link is client_id.
    if v_opportunity.client_id is not null then
      select coalesce(nullif(btrim(company), ''), name) into v_client_label
      from public.clients
      where id = v_opportunity.client_id;
    end if;
    v_client_label := coalesce(
      v_client_label,
      nullif(btrim(coalesce(v_opportunity.company, '')), ''),
      nullif(btrim(coalesce(v_opportunity.contact_name, '')), '')
    );

    v_slug := v_base_slug;
    while exists (select 1 from public.projects where slug = v_slug) loop
      v_attempt := v_attempt + 1;
      if v_attempt > 50 then
        raise exception 'no free slug for this project' using errcode = 'AU003';
      end if;
      v_slug := v_base_slug || '-' || (v_attempt + 1);
    end loop;

    -- case_number has no default: the next one is taken here. A concurrent
    -- insert from the Admin can take it first; the unique constraint refuses
    -- the duplicate and the next number is tried.
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      select coalesce(max(case_number), 0) + 1 into v_case from public.projects;
      begin
        insert into public.projects (
          case_number, name, slug, client, client_id, category,
          status, editorial_status, featured, visible, tech_stack
        )
        values (
          v_case, btrim(p_name), v_slug, v_client_label, v_opportunity.client_id, p_category,
          'In Development', 'DRAFT', false, false, '{}'
        )
        returning * into v_project;
        exit;
      exception when unique_violation then
        if v_attempt >= 5 then
          raise;
        end if;
        if exists (select 1 from public.projects where slug = v_slug) then
          v_slug := v_base_slug || '-' || substr(md5(clock_timestamp()::text || v_attempt::text), 1, 6);
        end if;
      end;
    end loop;

    insert into public.commercial_project_handoffs (opportunity_id, project_id, action, run_id)
    values (p_opportunity, v_project.id, 'project.create', v_run)
    returning * into v_handoff;

    v_created := true;
    v_client_linked := v_project.client_id is not null;

    insert into public.activity_log (admin_user_id, action, entity_type, entity_id, title, detail)
    values (
      v_actor,
      'project.created',
      'project',
      v_project.id::text,
      'Project created',
      format('CASE %s opened by automation from won opportunity "%s"', lpad(v_project.case_number::text, 3, '0'), v_opportunity.title)
    );
  end if;

  -- A client linked to the deal after the project was opened reaches it now.
  if v_project.client_id is null and v_opportunity.client_id is not null then
    update public.projects
    set client_id = v_opportunity.client_id
    where id = v_project.id
    returning * into v_project;
    v_client_linked := true;

    insert into public.activity_log (admin_user_id, action, entity_type, entity_id, title, detail)
    values (
      v_actor,
      'client.project_linked',
      'project',
      v_project.id::text,
      'Client linked to project',
      format('CASE %s linked to the client of won opportunity "%s"', lpad(v_project.case_number::text, 3, '0'), v_opportunity.title)
    );
  end if;

  -- Only the link: no amount, status or date changes.
  if p_link_finance then
    update public.financial_transactions
    set project_id = v_project.id
    where opportunity_id = p_opportunity
      and project_id is null
      and status <> 'CANCELLED';
    get diagnostics v_linked = row_count;

    if v_linked > 0 then
      insert into public.activity_log (admin_user_id, action, entity_type, entity_id, title, detail)
      values (
        v_actor,
        'financial.updated',
        'project',
        v_project.id::text,
        'Receivables linked to project',
        format('%s ledger entr%s of won opportunity "%s" linked to CASE %s',
          v_linked, case when v_linked = 1 then 'y' else 'ies' end,
          v_opportunity.title, lpad(v_project.case_number::text, 3, '0'))
      );
    end if;
  end if;

  return jsonb_build_object(
    'project_id', v_project.id,
    'case_number', v_project.case_number,
    'slug', v_project.slug,
    'handoff_id', v_handoff.id,
    'project_created', v_created,
    'client_linked', v_client_linked,
    'transactions_linked', v_linked
  );
end;
$fn$;

comment on function public.automation_open_project_for_opportunity(uuid, text, text, text, boolean, uuid, uuid) is
  'Automation service only: opens (or finds) the project of a won opportunity, its handoff and links, in one idempotent transaction.';

revoke all on function public.automation_open_project_for_opportunity(uuid, text, text, text, boolean, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.automation_open_project_for_opportunity(uuid, text, text, text, boolean, uuid, uuid)
  to service_role;

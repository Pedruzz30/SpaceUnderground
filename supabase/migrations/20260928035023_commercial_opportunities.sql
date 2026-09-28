-- Space Underground - commercial opportunities (Commercial V2)
--
-- Replaces the presentation-only pipeline in admin/src/data/operations-demo.js
-- with a real table. One row is one deal the studio is working, from the first
-- contact to the decision:
--
--   stage     NEW -> CONTACTED -> PROPOSAL -> NEGOTIATION -> WON | LOST
--
-- A lead usually arrives before anyone is a client or a service is chosen, so
-- client_id and plan_id are optional and the contact is kept on the row
-- (contact_name, company, email, phone). public.commercial_proposals stays as
-- it is: it requires a client and a plan, and it is the contract the
-- automation service reads when a proposal is accepted. Nothing here writes
-- to it.
--
-- The database owns three facts:
--   stage_changed_at  when the deal entered its current stage ("days in stage")
--   closed_at         when it was won or lost, cleared if it is reopened
--   lost_reason       required while LOST, cleared when it leaves LOST
--
-- Admin-only. Nothing here is read by the public site, anon has no grant and
-- every policy requires public.is_admin().

-- ---------------------------------------------------------------------------
-- prerequisite
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.clients') is null or to_regclass('public.plans') is null then
    raise exception 'commercial_opportunities requires 20260927225753_clients_foundation (public.clients) and 004_plans_cms (public.plans) to be applied first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- table
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  stage text not null default 'NEW'
    check (stage in ('NEW', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST')),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH')),
  source text not null default 'OTHER'
    check (source in ('REFERRAL', 'INSTAGRAM', 'WEBSITE', 'WHATSAPP', 'EVENT', 'OTHER')),
  client_id uuid references public.clients (id) on delete set null,
  plan_id uuid references public.plans (id) on delete set null,
  contact_name text,
  company text,
  email text,
  phone text,
  estimated_value numeric(12, 2) check (estimated_value is null or estimated_value >= 0),
  expected_close_date date,
  next_action text,
  next_action_at date,
  last_contact_at date,
  lost_reason text
    check (lost_reason is null or lost_reason in ('PRICE', 'TIMING', 'NO_RESPONSE', 'COMPETITOR', 'SCOPE', 'OTHER')),
  position double precision not null default 0,
  notes text,
  stage_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.commercial_opportunities is
  'Admin-only sales pipeline. A lead may have no client or plan yet; the contact lives on the row.';
comment on column public.commercial_opportunities.position is
  'Order inside a stage column. Fractional so a card can be placed between two others with one write.';
comment on column public.commercial_opportunities.closed_at is
  'Set by the database when the deal becomes WON or LOST, cleared when it is reopened.';

-- ---------------------------------------------------------------------------
-- stage bookkeeping is owned by the database
-- ---------------------------------------------------------------------------

create or replace function public.stamp_commercial_opportunity_stage()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;

  if new.stage in ('WON', 'LOST') then
    if tg_op = 'UPDATE' and old.stage = new.stage then
      new.closed_at := coalesce(old.closed_at, now());
    else
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;

  if new.stage <> 'LOST' then
    new.lost_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists commercial_opportunities_stamp_stage on public.commercial_opportunities;
create trigger commercial_opportunities_stamp_stage
  before insert or update on public.commercial_opportunities
  for each row execute function public.stamp_commercial_opportunity_stage();

drop trigger if exists commercial_opportunities_touch_updated_at on public.commercial_opportunities;
create trigger commercial_opportunities_touch_updated_at
  before update on public.commercial_opportunities
  for each row execute function public.touch_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commercial_opportunities_lost_needs_reason'
      and conrelid = 'public.commercial_opportunities'::regclass
  ) then
    alter table public.commercial_opportunities add constraint commercial_opportunities_lost_needs_reason
      check (stage <> 'LOST' or lost_reason is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'commercial_opportunities_closed_at_matches_stage'
      and conrelid = 'public.commercial_opportunities'::regclass
  ) then
    alter table public.commercial_opportunities add constraint commercial_opportunities_closed_at_matches_stage
      check ((stage in ('WON', 'LOST')) = (closed_at is not null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
-- The board reads every open deal ordered inside its column; the reports read
-- closed deals by date; client pages look up only the linked rows.

create index if not exists commercial_opportunities_stage_idx
  on public.commercial_opportunities (stage, position);

create index if not exists commercial_opportunities_closed_idx
  on public.commercial_opportunities (closed_at desc)
  where closed_at is not null;

create index if not exists commercial_opportunities_client_idx
  on public.commercial_opportunities (client_id)
  where client_id is not null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.commercial_opportunities enable row level security;
revoke all on table public.commercial_opportunities from anon;
grant select, insert, update, delete on table public.commercial_opportunities to authenticated;
grant select, insert, update, delete on table public.commercial_opportunities to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_opportunities' and policyname = 'commercial_opportunities_admin_select') then
    create policy commercial_opportunities_admin_select on public.commercial_opportunities
      for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_opportunities' and policyname = 'commercial_opportunities_admin_insert') then
    create policy commercial_opportunities_admin_insert on public.commercial_opportunities
      for insert to authenticated with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_opportunities' and policyname = 'commercial_opportunities_admin_update') then
    create policy commercial_opportunities_admin_update on public.commercial_opportunities
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_opportunities' and policyname = 'commercial_opportunities_admin_delete') then
    create policy commercial_opportunities_admin_delete on public.commercial_opportunities
      for delete to authenticated using (public.is_admin());
  end if;
end $$;

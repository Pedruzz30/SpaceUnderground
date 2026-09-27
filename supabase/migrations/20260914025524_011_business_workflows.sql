-- Space Underground - business workflows
--
-- Proposed additive schema for Phase 4. This file is intentionally not applied
-- automatically by Codex. It creates the minimum real entities required for a
-- commercial proposal handoff and keeps commercial relationships out of the
-- public projects row.

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null check (btrim(name) <> ''),
  company text,
  email text,
  phone text,
  status text not null default 'LEAD'
    check (status in ('LEAD', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is
  'Private operational client records used by the Admin and business workflows.';

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'clients_touch_updated_at'
      and tgrelid = 'public.clients'::regclass
  ) then
    create trigger clients_touch_updated_at
      before update on public.clients
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- commercial_proposals
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_proposals (
  id uuid primary key default gen_random_uuid(),
  proposal_number text not null unique check (btrim(proposal_number) <> ''),
  client_id uuid not null references public.clients (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  title text not null check (btrim(title) <> ''),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'ARCHIVED')),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  currency text not null default 'BRL' check (btrim(currency) <> ''),
  payment_terms text,
  project_category text
    check (
      project_category is null
      or project_category in ('Website', 'System', 'Automation', 'AI', 'Other')
    ),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.commercial_proposals is
  'Private commercial proposals. Accepted proposals can open operational project drafts.';
comment on column public.commercial_proposals.project_category is
  'Explicit project category for the generated draft. Required by the workflow when status is ACCEPTED.';

create index if not exists commercial_proposals_client_idx
  on public.commercial_proposals (client_id);

create index if not exists commercial_proposals_plan_idx
  on public.commercial_proposals (plan_id);

create index if not exists commercial_proposals_status_idx
  on public.commercial_proposals (status);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'commercial_proposals_touch_updated_at'
      and tgrelid = 'public.commercial_proposals'::regclass
  ) then
    create trigger commercial_proposals_touch_updated_at
      before update on public.commercial_proposals
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- commercial_project_handoffs
-- ---------------------------------------------------------------------------
-- Links a proposal to the one project draft opened from it. The unique
-- proposal_id is the durable idempotency guard for the business side effect.

create table if not exists public.commercial_project_handoffs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.commercial_proposals (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  action text not null default 'project.create' check (action in ('project.create')),
  created_at timestamptz not null default now(),
  unique (proposal_id),
  unique (project_id)
);

comment on table public.commercial_project_handoffs is
  'Private audit link between accepted proposals and project drafts created by business workflows.';

create index if not exists commercial_project_handoffs_proposal_idx
  on public.commercial_project_handoffs (proposal_id);

create index if not exists commercial_project_handoffs_project_idx
  on public.commercial_project_handoffs (project_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.commercial_proposals enable row level security;
alter table public.commercial_project_handoffs enable row level security;

revoke all on table public.clients from anon, authenticated;
revoke all on table public.commercial_proposals from anon, authenticated;
revoke all on table public.commercial_project_handoffs from anon, authenticated;

grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.commercial_proposals to authenticated;
grant select, insert, update, delete on table public.commercial_project_handoffs to authenticated;

grant select, insert, update, delete on table public.clients to service_role;
grant select, insert, update, delete on table public.commercial_proposals to service_role;
grant select, insert, update, delete on table public.commercial_project_handoffs to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_admin_select') then
    create policy clients_admin_select on public.clients for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_admin_insert') then
    create policy clients_admin_insert on public.clients for insert to authenticated with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_admin_update') then
    create policy clients_admin_update on public.clients for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_admin_delete') then
    create policy clients_admin_delete on public.clients for delete to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_proposals' and policyname = 'commercial_proposals_admin_select') then
    create policy commercial_proposals_admin_select on public.commercial_proposals for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_proposals' and policyname = 'commercial_proposals_admin_insert') then
    create policy commercial_proposals_admin_insert on public.commercial_proposals for insert to authenticated with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_proposals' and policyname = 'commercial_proposals_admin_update') then
    create policy commercial_proposals_admin_update on public.commercial_proposals for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_proposals' and policyname = 'commercial_proposals_admin_delete') then
    create policy commercial_proposals_admin_delete on public.commercial_proposals for delete to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_project_handoffs' and policyname = 'commercial_project_handoffs_admin_select') then
    create policy commercial_project_handoffs_admin_select on public.commercial_project_handoffs for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_project_handoffs' and policyname = 'commercial_project_handoffs_admin_insert') then
    create policy commercial_project_handoffs_admin_insert on public.commercial_project_handoffs for insert to authenticated with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_project_handoffs' and policyname = 'commercial_project_handoffs_admin_update') then
    create policy commercial_project_handoffs_admin_update on public.commercial_project_handoffs for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commercial_project_handoffs' and policyname = 'commercial_project_handoffs_admin_delete') then
    create policy commercial_project_handoffs_admin_delete on public.commercial_project_handoffs for delete to authenticated using (public.is_admin());
  end if;
end $$;

-- Space Underground - clients foundation (Clients V2)
--
-- Incremental over 20260914025524_011_business_workflows.sql, which already created
-- public.clients and its admin-only policies. This migration turns that table
-- into the record the Admin Client Hub edits:
--
--   - internal notes and a database-owned archived_at timestamp;
--   - a code (CLIENT-001) that is always present, assigned from a sequence and
--     never derived from count(*), which collides after deletes;
--   - an optional projects.client_id, so one client can own many projects
--     while every existing project keeps working without one.
--
-- Nothing here is read by the public site. projects.client_id is nullable and
-- no public query selects it, so Selected Work does not depend on clients.

-- ---------------------------------------------------------------------------
-- prerequisite
-- ---------------------------------------------------------------------------
-- Fail loudly instead of half-applying: every statement below alters the table
-- the business workflows migration creates.

do $$
begin
  if to_regclass('public.clients') is null then
    raise exception 'clients_foundation requires 20260914025524_011_business_workflows (public.clients) to be applied first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- clients: new columns
-- ---------------------------------------------------------------------------

alter table public.clients add column if not exists notes text;
alter table public.clients add column if not exists archived_at timestamptz;

comment on column public.clients.notes is
  'Internal notes. Never shown outside the Admin.';
comment on column public.clients.archived_at is
  'Set by the database when status becomes ARCHIVED, cleared when it leaves ARCHIVED.';

-- ---------------------------------------------------------------------------
-- clients.code
-- ---------------------------------------------------------------------------
-- The sequence only ever moves forward, so a deleted client never hands its
-- number to the next one. The generator also skips codes that were typed by
-- hand, which keeps the unique constraint from firing on a plain insert.

create sequence if not exists public.clients_code_seq as bigint minvalue 1;

-- Start after the highest CLIENT-n already stored, and never move backwards
-- when this file is applied twice.
do $$
declare
  highest bigint;
  current_value bigint;
  called boolean;
begin
  select coalesce(max((substring(code from '^CLIENT-([0-9]{1,18})$'))::bigint), 0)
    into highest
    from public.clients;

  select last_value, is_called into current_value, called from public.clients_code_seq;
  if not called then
    current_value := 0;
  end if;

  if greatest(highest, current_value) > 0 then
    perform setval('public.clients_code_seq', greatest(highest, current_value), true);
  end if;
end $$;

-- SECURITY DEFINER so the uniqueness probe sees every row regardless of the
-- caller's policies, and so callers need no direct grant on the sequence.
create or replace function public.next_client_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n bigint;
  candidate text;
begin
  loop
    n := nextval('public.clients_code_seq');
    -- lpad truncates longer input, so the width grows past 999 instead.
    candidate := 'CLIENT-' || lpad(n::text, greatest(3, length(n::text)), '0');
    exit when not exists (select 1 from public.clients where code = candidate);
  end loop;
  return candidate;
end;
$$;

revoke all on function public.next_client_code() from public;
grant execute on function public.next_client_code() to authenticated, service_role;

-- Rows created before this migration may have no code. Backfill them in
-- creation order so the numbering reads chronologically.
do $$
declare
  target record;
begin
  for target in
    select id from public.clients
    where code is null or btrim(code) = ''
    order by created_at, id
  loop
    update public.clients set code = public.next_client_code() where id = target.id;
  end loop;
end $$;

alter table public.clients alter column code set default public.next_client_code();
alter table public.clients alter column code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_code_not_blank' and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients add constraint clients_code_not_blank check (btrim(code) <> '');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- clients.archived_at
-- ---------------------------------------------------------------------------
-- Owned by the database, like updated_at and published_at. Entering ARCHIVED
-- stamps it, staying archived keeps the original stamp, leaving clears it.

update public.clients
set archived_at = updated_at
where status = 'ARCHIVED' and archived_at is null;

update public.clients
set archived_at = null
where status <> 'ARCHIVED' and archived_at is not null;

create or replace function public.stamp_client_archived_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'ARCHIVED' then
    if tg_op = 'UPDATE' and old.status = 'ARCHIVED' then
      new.archived_at := coalesce(old.archived_at, now());
    else
      new.archived_at := now();
    end if;
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_stamp_archived_at on public.clients;
create trigger clients_stamp_archived_at
  before insert or update on public.clients
  for each row execute function public.stamp_client_archived_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_archived_at_matches_status' and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients add constraint clients_archived_at_matches_status
      check ((status = 'ARCHIVED') = (archived_at is not null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- clients: indexes
-- ---------------------------------------------------------------------------
-- code is already indexed by its unique constraint. The hub filters by status
-- and lists most recently updated first.

create index if not exists clients_status_idx
  on public.clients (status);

create index if not exists clients_updated_at_idx
  on public.clients (updated_at desc);

-- ---------------------------------------------------------------------------
-- projects.client_id
-- ---------------------------------------------------------------------------
-- Optional on purpose: existing projects, public cases and project drafts from
-- the business workflow all stay valid without a client. `on delete set null`
-- keeps a project alive if a client row is ever removed by hand; the Admin
-- itself never hard-deletes clients.
--
-- projects.client (free text) is untouched: it is the public label a case
-- shows, not the relationship.

alter table public.projects
  add column if not exists client_id uuid references public.clients (id) on delete set null;

comment on column public.projects.client_id is
  'Optional owning client (public.clients). Admin-only relationship; the public site does not select it.';

-- Partial: most projects have no client, and only linked rows are looked up.
create index if not exists projects_client_idx
  on public.projects (client_id)
  where client_id is not null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- business workflows already enabled RLS on clients, revoked anon and created the four
-- admin-only policies. Re-asserted here so this file never depends on a
-- partially applied business workflows migration; nothing is widened.

alter table public.clients enable row level security;
revoke all on table public.clients from anon;

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
end $$;

-- Space Underground - financial foundation (Financial V2)
--
-- Replaces the presentation-only ledger the Admin used to ship in
-- admin/src/data/operations-demo.js with a real table. One row is one entry
-- the studio expects to receive or pay:
--
--   - type is INCOME or EXPENSE. "To receive" is income still PENDING and
--     "to pay" is an expense still PENDING: there is no third type, so money
--     can never be counted twice or fall between buckets.
--   - status is PENDING, PAID or CANCELLED. Only PAID counts toward revenue,
--     expenses and the result.
--   - amount is always positive; the sign comes from type.
--   - due_date is when the money is expected, paid_at when it actually moved.
--     paid_at is owned by the database: set when an entry becomes PAID (today
--     unless the Admin supplies the real date), cleared when it leaves PAID.
--   - client_id and project_id are optional links. Removing a client or a
--     project keeps the entry and drops the link (on delete set null).
--
-- Admin-only. Nothing here is read by the public site, anon has no grant and
-- every policy requires public.is_admin().

-- ---------------------------------------------------------------------------
-- prerequisite
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.clients') is null or to_regclass('public.projects') is null then
    raise exception 'financial_foundation requires 20260927225753_clients_foundation (public.clients) and 001_admin_foundation (public.projects) to be applied first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- table
-- ---------------------------------------------------------------------------

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('INCOME', 'EXPENSE')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'CANCELLED')),
  description text not null check (btrim(description) <> ''),
  category text not null default 'OTHER' check (
    category in (
      'PROJECT', 'RETAINER', 'CONSULTING',
      'INFRASTRUCTURE', 'SOFTWARE', 'FREELANCER', 'MARKETING', 'TAXES', 'OFFICE',
      'OTHER'
    )
  ),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  due_date date not null,
  paid_at date,
  client_id uuid references public.clients (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.financial_transactions is
  'Admin-only ledger. INCOME/EXPENSE entries; PENDING is money still expected, only PAID counts toward revenue and expenses.';
comment on column public.financial_transactions.amount is
  'Always positive. The sign is the type: INCOME adds, EXPENSE subtracts.';
comment on column public.financial_transactions.paid_at is
  'Set by the database when status becomes PAID (today unless given), cleared when it leaves PAID.';

-- ---------------------------------------------------------------------------
-- paid_at is owned by the database
-- ---------------------------------------------------------------------------
-- The same rule the clients archive stamp follows: entering PAID stamps the
-- date (keeping one the caller supplied), staying PAID keeps it, leaving PAID
-- clears it. The constraint below makes the pairing impossible to break.

create or replace function public.stamp_financial_paid_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'PAID' then
    new.paid_at := coalesce(new.paid_at, case when tg_op = 'UPDATE' then old.paid_at end, current_date);
  else
    new.paid_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists financial_transactions_stamp_paid_at on public.financial_transactions;
create trigger financial_transactions_stamp_paid_at
  before insert or update on public.financial_transactions
  for each row execute function public.stamp_financial_paid_at();

drop trigger if exists financial_transactions_touch_updated_at on public.financial_transactions;
create trigger financial_transactions_touch_updated_at
  before update on public.financial_transactions
  for each row execute function public.touch_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'financial_transactions_paid_at_matches_status'
      and conrelid = 'public.financial_transactions'::regclass
  ) then
    alter table public.financial_transactions add constraint financial_transactions_paid_at_matches_status
      check ((status = 'PAID') = (paid_at is not null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
-- The ledger lists by date and filters by status; client and project pages
-- look up only the rows linked to them, so those two are partial.

create index if not exists financial_transactions_due_date_idx
  on public.financial_transactions (due_date desc);

create index if not exists financial_transactions_status_idx
  on public.financial_transactions (status, type);

create index if not exists financial_transactions_client_idx
  on public.financial_transactions (client_id)
  where client_id is not null;

create index if not exists financial_transactions_project_idx
  on public.financial_transactions (project_id)
  where project_id is not null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Supabase grants every new table in public to anon by default, so the revoke
-- is explicit. authenticated keeps the table grant, but only an admin matches
-- a policy: public sign-up is open, and a signed-in visitor sees no row.

alter table public.financial_transactions enable row level security;
revoke all on table public.financial_transactions from anon;
grant select, insert, update, delete on table public.financial_transactions to authenticated;
grant select, insert, update, delete on table public.financial_transactions to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_transactions' and policyname = 'financial_transactions_admin_select') then
    create policy financial_transactions_admin_select on public.financial_transactions
      for select to authenticated using (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_transactions' and policyname = 'financial_transactions_admin_insert') then
    create policy financial_transactions_admin_insert on public.financial_transactions
      for insert to authenticated with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_transactions' and policyname = 'financial_transactions_admin_update') then
    create policy financial_transactions_admin_update on public.financial_transactions
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_transactions' and policyname = 'financial_transactions_admin_delete') then
    create policy financial_transactions_admin_delete on public.financial_transactions
      for delete to authenticated using (public.is_admin());
  end if;
end $$;

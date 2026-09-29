-- Space Underground - security foundation
--
-- Identity, RBAC, project access, account lifecycle, MFA and step-up, drafts
-- with approvals, and an append-only security audit log. NOT APPLIED by
-- anyone automatically: review it, then apply it by hand
-- (docs/security-architecture.md, "Applying the migration").
--
-- Before this migration a single function, public.is_admin() (a row in
-- public.admins), gated every table: any admin could do anything, and there
-- was no way to limit, suspend, expire or audit anyone. After it:
--
--   authentication  Supabase Auth, unchanged: email + individual password,
--                   plus TOTP MFA through auth.mfa_*. No password, token or
--                   TOTP secret is ever stored here.
--   identity        public.team_members, keyed by auth.users.id, with an
--                   immutable RU (SU-00001). The RU is a display identifier:
--                   never a key for authorization, never a secret.
--   lifecycle       INVITED -> ACTIVE <-> SUSPENDED, ACTIVE -> EXPIRED (by
--                   its access window), any -> OFFBOARDED (terminal).
--   authorization   roles -> role_permissions -> permissions, resolved on
--                   every request by public.has_permission(). Nothing about
--                   authorization lives in the JWT, so a suspension, a
--                   removed role or an expiry applies to the very next query,
--                   even for a token issued before it.
--   sessions        revoking sessions, suspending or offboarding moves the
--                   member's sessions_valid_after forward: every access token
--                   issued before it (JWT iat) is refused from then on, even
--                   after a reactivation. Only a new sign-in works again.
--   project access  public.project_members for roles without projects.read.
--   MFA             every permission of a privileged role needs an aal2
--                   session from its first use, with no grace period;
--                   CRITICAL permissions need an MFA verification younger
--                   than the step-up window, read from the JWT's amr claim.
--   approvals       public.change_requests: a draft never touches the live
--                   project; only approve_change_request() applies it, in one
--                   transaction, against the version it was based on.
--   audit           public.security_audit_log: written only by the database;
--                   append-only for every application role and path. The
--                   database owner, who can alter schema and triggers, is
--                   outside that trust boundary.
--
-- Existing rows of public.admins become OWNER; like every privileged member
-- they must enable MFA at their first sign-in (the Admin opens the enrolment
-- screen), and hold no permission until they do.
-- Nobody becomes ABSOLUTE_ADMIN here: that is a one-off bootstrap run in the
-- SQL editor (public.bootstrap_member). public.admins is kept as history and
-- is no longer consulted for authorization.
--
-- Default deny throughout: unknown permission, unknown role, missing
-- membership, status other than ACTIVE, expired access, missing MFA -> false.
--
-- Roles, permissions and their grants mirror admin/src/security/catalog.js;
-- admin/tests/security-catalog.test.mjs fails when the two drift apart.

-- ---------------------------------------------------------------------------
-- 0. prerequisite
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.commercial_opportunities') is null or to_regclass('public.financial_transactions') is null then
    raise exception 'security_rbac_approval_foundation requires 20260928035023_commercial_opportunities (and every migration before it) to be applied first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. catalog: roles, permissions, grants, approval routes
-- ---------------------------------------------------------------------------

create table if not exists public.roles (
  key text primary key check (key ~ '^[A-Z][A-Z_]*$'),
  rank integer not null check (rank between 0 and 100),
  requires_mfa boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.roles is
  'A named, default set of permissions. rank orders roles for anti-escalation: nobody manages a member whose highest rank is equal to or above their own.';

create table if not exists public.permissions (
  key text primary key check (key ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  module text not null check (btrim(module) <> ''),
  risk_level text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  created_at timestamptz not null default now()
);

comment on table public.permissions is
  'Concrete capabilities. risk_level drives MFA and step-up: CRITICAL always needs a fresh MFA verification.';

create table if not exists public.role_permissions (
  role_key text not null references public.roles (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_key, permission_key)
);

create table if not exists public.approval_routes (
  permission_key text primary key references public.permissions (key) on delete cascade,
  via_permission_key text not null references public.permissions (key) on delete cascade
);

comment on table public.approval_routes is
  'A member without permission_key but holding via_permission_key (and approvals.request) may ask for the change instead of executing it.';

-- Generated from admin/src/security/catalog.js. Re-running updates rank, MFA
-- and risk, and adds grants; it never removes a grant made later.
insert into public.roles (key, rank, requires_mfa) values
  ('ABSOLUTE_ADMIN', 100, true),
  ('OWNER', 80, true),
  ('SEO', 60, true),
  ('MANAGER', 60, true),
  ('COLLABORATOR', 30, false),
  ('VIEWER', 10, false)
on conflict (key) do update set rank = excluded.rank, requires_mfa = excluded.requires_mfa;

insert into public.permissions (key, module, risk_level) values
  ('projects.read', 'projects', 'LOW'),
  ('projects.read_assigned', 'projects', 'LOW'),
  ('projects.create', 'projects', 'MEDIUM'),
  ('projects.edit', 'projects', 'MEDIUM'),
  ('projects.draft', 'projects', 'LOW'),
  ('projects.publish', 'projects', 'MEDIUM'),
  ('projects.archive', 'projects', 'MEDIUM'),
  ('projects.delete', 'projects', 'HIGH'),
  ('files.read', 'files', 'LOW'),
  ('files.upload', 'files', 'LOW'),
  ('files.delete', 'files', 'HIGH'),
  ('clients.read', 'clients', 'LOW'),
  ('clients.create', 'clients', 'MEDIUM'),
  ('clients.edit', 'clients', 'MEDIUM'),
  ('clients.archive', 'clients', 'MEDIUM'),
  ('clients.delete', 'clients', 'HIGH'),
  ('commercial.read', 'commercial', 'LOW'),
  ('commercial.edit', 'commercial', 'MEDIUM'),
  ('commercial.delete', 'commercial', 'HIGH'),
  ('services.read', 'services', 'LOW'),
  ('services.edit', 'services', 'MEDIUM'),
  ('cms.read', 'cms', 'LOW'),
  ('cms.edit', 'cms', 'MEDIUM'),
  ('seo.read', 'seo', 'LOW'),
  ('seo.edit', 'seo', 'MEDIUM'),
  ('finance.read', 'finance', 'LOW'),
  ('finance.edit', 'finance', 'HIGH'),
  ('finance.delete', 'finance', 'HIGH'),
  ('logs.read', 'logs', 'LOW'),
  ('settings.read', 'settings', 'LOW'),
  ('settings.edit', 'settings', 'MEDIUM'),
  ('data.export', 'settings', 'HIGH'),
  ('approvals.read', 'approvals', 'LOW'),
  ('approvals.read_all', 'approvals', 'LOW'),
  ('approvals.request', 'approvals', 'LOW'),
  ('approvals.approve', 'approvals', 'MEDIUM'),
  ('approvals.reject', 'approvals', 'MEDIUM'),
  ('team.read', 'team', 'LOW'),
  ('team.invite', 'team', 'HIGH'),
  ('team.edit_access', 'team', 'HIGH'),
  ('team.suspend', 'team', 'HIGH'),
  ('team.offboard', 'team', 'HIGH'),
  ('sessions.revoke', 'team', 'HIGH'),
  ('roles.read', 'roles', 'LOW'),
  ('roles.manage', 'roles', 'CRITICAL'),
  ('permissions.read', 'roles', 'LOW'),
  ('permissions.manage', 'roles', 'CRITICAL'),
  ('audit.read', 'audit', 'LOW'),
  ('audit.read_all', 'audit', 'MEDIUM'),
  ('security.read', 'security', 'LOW'),
  ('security.manage', 'security', 'CRITICAL'),
  ('critical_settings.manage', 'security', 'CRITICAL')
on conflict (key) do update set module = excluded.module, risk_level = excluded.risk_level;

insert into public.role_permissions (role_key, permission_key) values
  ('ABSOLUTE_ADMIN', 'projects.read'),
  ('ABSOLUTE_ADMIN', 'projects.read_assigned'),
  ('ABSOLUTE_ADMIN', 'projects.create'),
  ('ABSOLUTE_ADMIN', 'projects.edit'),
  ('ABSOLUTE_ADMIN', 'projects.draft'),
  ('ABSOLUTE_ADMIN', 'projects.publish'),
  ('ABSOLUTE_ADMIN', 'projects.archive'),
  ('ABSOLUTE_ADMIN', 'projects.delete'),
  ('ABSOLUTE_ADMIN', 'files.read'),
  ('ABSOLUTE_ADMIN', 'files.upload'),
  ('ABSOLUTE_ADMIN', 'files.delete'),
  ('ABSOLUTE_ADMIN', 'clients.read'),
  ('ABSOLUTE_ADMIN', 'clients.create'),
  ('ABSOLUTE_ADMIN', 'clients.edit'),
  ('ABSOLUTE_ADMIN', 'clients.archive'),
  ('ABSOLUTE_ADMIN', 'clients.delete'),
  ('ABSOLUTE_ADMIN', 'commercial.read'),
  ('ABSOLUTE_ADMIN', 'commercial.edit'),
  ('ABSOLUTE_ADMIN', 'commercial.delete'),
  ('ABSOLUTE_ADMIN', 'services.read'),
  ('ABSOLUTE_ADMIN', 'services.edit'),
  ('ABSOLUTE_ADMIN', 'cms.read'),
  ('ABSOLUTE_ADMIN', 'cms.edit'),
  ('ABSOLUTE_ADMIN', 'seo.read'),
  ('ABSOLUTE_ADMIN', 'seo.edit'),
  ('ABSOLUTE_ADMIN', 'finance.read'),
  ('ABSOLUTE_ADMIN', 'finance.edit'),
  ('ABSOLUTE_ADMIN', 'finance.delete'),
  ('ABSOLUTE_ADMIN', 'logs.read'),
  ('ABSOLUTE_ADMIN', 'settings.read'),
  ('ABSOLUTE_ADMIN', 'settings.edit'),
  ('ABSOLUTE_ADMIN', 'data.export'),
  ('ABSOLUTE_ADMIN', 'approvals.read'),
  ('ABSOLUTE_ADMIN', 'approvals.read_all'),
  ('ABSOLUTE_ADMIN', 'approvals.request'),
  ('ABSOLUTE_ADMIN', 'approvals.approve'),
  ('ABSOLUTE_ADMIN', 'approvals.reject'),
  ('ABSOLUTE_ADMIN', 'team.read'),
  ('ABSOLUTE_ADMIN', 'team.invite'),
  ('ABSOLUTE_ADMIN', 'team.edit_access'),
  ('ABSOLUTE_ADMIN', 'team.suspend'),
  ('ABSOLUTE_ADMIN', 'team.offboard'),
  ('ABSOLUTE_ADMIN', 'sessions.revoke'),
  ('ABSOLUTE_ADMIN', 'roles.read'),
  ('ABSOLUTE_ADMIN', 'roles.manage'),
  ('ABSOLUTE_ADMIN', 'permissions.read'),
  ('ABSOLUTE_ADMIN', 'permissions.manage'),
  ('ABSOLUTE_ADMIN', 'audit.read'),
  ('ABSOLUTE_ADMIN', 'audit.read_all'),
  ('ABSOLUTE_ADMIN', 'security.read'),
  ('ABSOLUTE_ADMIN', 'security.manage'),
  ('ABSOLUTE_ADMIN', 'critical_settings.manage'),
  ('OWNER', 'projects.read'),
  ('OWNER', 'projects.read_assigned'),
  ('OWNER', 'projects.create'),
  ('OWNER', 'projects.edit'),
  ('OWNER', 'projects.draft'),
  ('OWNER', 'projects.publish'),
  ('OWNER', 'projects.archive'),
  ('OWNER', 'projects.delete'),
  ('OWNER', 'files.read'),
  ('OWNER', 'files.upload'),
  ('OWNER', 'files.delete'),
  ('OWNER', 'clients.read'),
  ('OWNER', 'clients.create'),
  ('OWNER', 'clients.edit'),
  ('OWNER', 'clients.archive'),
  ('OWNER', 'clients.delete'),
  ('OWNER', 'commercial.read'),
  ('OWNER', 'commercial.edit'),
  ('OWNER', 'commercial.delete'),
  ('OWNER', 'services.read'),
  ('OWNER', 'services.edit'),
  ('OWNER', 'cms.read'),
  ('OWNER', 'cms.edit'),
  ('OWNER', 'seo.read'),
  ('OWNER', 'seo.edit'),
  ('OWNER', 'finance.read'),
  ('OWNER', 'finance.edit'),
  ('OWNER', 'finance.delete'),
  ('OWNER', 'logs.read'),
  ('OWNER', 'settings.read'),
  ('OWNER', 'settings.edit'),
  ('OWNER', 'data.export'),
  ('OWNER', 'approvals.read'),
  ('OWNER', 'approvals.read_all'),
  ('OWNER', 'approvals.request'),
  ('OWNER', 'approvals.approve'),
  ('OWNER', 'approvals.reject'),
  ('OWNER', 'team.read'),
  ('OWNER', 'team.invite'),
  ('OWNER', 'team.edit_access'),
  ('OWNER', 'team.suspend'),
  ('OWNER', 'team.offboard'),
  ('OWNER', 'sessions.revoke'),
  ('OWNER', 'roles.read'),
  ('OWNER', 'permissions.read'),
  ('OWNER', 'audit.read'),
  ('OWNER', 'audit.read_all'),
  ('OWNER', 'security.read'),
  ('SEO', 'projects.read'),
  ('SEO', 'projects.create'),
  ('SEO', 'projects.edit'),
  ('SEO', 'projects.draft'),
  ('SEO', 'projects.publish'),
  ('SEO', 'projects.archive'),
  ('SEO', 'files.read'),
  ('SEO', 'files.upload'),
  ('SEO', 'approvals.read'),
  ('SEO', 'approvals.read_all'),
  ('SEO', 'approvals.request'),
  ('SEO', 'approvals.approve'),
  ('SEO', 'approvals.reject'),
  ('SEO', 'roles.read'),
  ('SEO', 'permissions.read'),
  ('SEO', 'audit.read'),
  ('SEO', 'logs.read'),
  ('SEO', 'settings.read'),
  ('SEO', 'files.delete'),
  ('SEO', 'cms.read'),
  ('SEO', 'cms.edit'),
  ('SEO', 'seo.read'),
  ('SEO', 'seo.edit'),
  ('SEO', 'services.read'),
  ('SEO', 'services.edit'),
  ('SEO', 'clients.read'),
  ('MANAGER', 'projects.read'),
  ('MANAGER', 'projects.create'),
  ('MANAGER', 'projects.edit'),
  ('MANAGER', 'projects.draft'),
  ('MANAGER', 'projects.publish'),
  ('MANAGER', 'projects.archive'),
  ('MANAGER', 'files.read'),
  ('MANAGER', 'files.upload'),
  ('MANAGER', 'approvals.read'),
  ('MANAGER', 'approvals.read_all'),
  ('MANAGER', 'approvals.request'),
  ('MANAGER', 'approvals.approve'),
  ('MANAGER', 'approvals.reject'),
  ('MANAGER', 'roles.read'),
  ('MANAGER', 'permissions.read'),
  ('MANAGER', 'audit.read'),
  ('MANAGER', 'logs.read'),
  ('MANAGER', 'settings.read'),
  ('MANAGER', 'clients.read'),
  ('MANAGER', 'clients.create'),
  ('MANAGER', 'clients.edit'),
  ('MANAGER', 'clients.archive'),
  ('MANAGER', 'commercial.read'),
  ('MANAGER', 'commercial.edit'),
  ('MANAGER', 'services.read'),
  ('MANAGER', 'cms.read'),
  ('MANAGER', 'seo.read'),
  ('MANAGER', 'team.read'),
  ('COLLABORATOR', 'projects.read_assigned'),
  ('COLLABORATOR', 'projects.draft'),
  ('COLLABORATOR', 'files.read'),
  ('COLLABORATOR', 'files.upload'),
  ('COLLABORATOR', 'approvals.read'),
  ('COLLABORATOR', 'approvals.request'),
  ('COLLABORATOR', 'audit.read'),
  ('VIEWER', 'projects.read_assigned'),
  ('VIEWER', 'files.read'),
  ('VIEWER', 'approvals.read'),
  ('VIEWER', 'audit.read')
on conflict do nothing;

insert into public.approval_routes (permission_key, via_permission_key) values
  ('projects.edit', 'projects.draft'),
  ('projects.publish', 'projects.draft')
on conflict (permission_key) do update set via_permission_key = excluded.via_permission_key;

-- ---------------------------------------------------------------------------
-- 2. identity: team_members and the RU
-- ---------------------------------------------------------------------------

create sequence if not exists public.team_member_ru_seq;

-- SECURITY DEFINER so the column default works for the definer functions that
-- insert members, while no API role can draw numbers through /rpc.
create or replace function public.next_member_ru()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n bigint := nextval('public.team_member_ru_seq');
begin
  -- lpad truncates longer input, so the width grows past 99999 instead.
  return 'SU-' || lpad(n::text, greatest(5, length(n::text)), '0');
end;
$$;

create table if not exists public.team_members (
  user_id uuid primary key references auth.users (id) on delete restrict,
  ru text not null unique default public.next_member_ru() check (ru ~ '^SU-[0-9]{5,}$'),
  display_name text not null check (btrim(display_name) <> '' and length(display_name) <= 120),
  email text not null check (position('@' in email) > 1 and length(email) <= 254),
  status text not null default 'INVITED'
    check (status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'OFFBOARDED')),
  status_reason text check (status_reason is null or length(status_reason) <= 500),
  access_starts_at timestamptz,
  access_expires_at timestamptz,
  sessions_valid_after timestamptz,
  mfa_enrolled_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz,
  invite_expires_at timestamptz,
  activated_at timestamptz,
  last_sign_in_at timestamptz,
  suspended_at timestamptz,
  offboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_access_window check (
    access_expires_at is null or access_starts_at is null or access_expires_at > access_starts_at
  )
);

comment on table public.team_members is
  'One row per person with Admin access. user_id is the identity (auth.users.id); ru is an immutable display identifier, never a secret. Written only by security definer functions.';
comment on column public.team_members.ru is
  'Space Underground RU (SU-00001). Unique, immutable, never reused, derived from nothing personal.';
comment on column public.team_members.sessions_valid_after is
  'Access tokens issued before this moment (JWT iat) authorize nothing. Moved forward by session revocation, suspension and offboarding; never back.';

create unique index if not exists team_members_email_key on public.team_members (lower(email));
create index if not exists team_members_status_idx on public.team_members (status);

-- The RU and the user are identities; OFFBOARDED is terminal; the session
-- cutoff only moves forward, so no reactivation can bring an old token back.
-- Enforced here so that no definer function, and no plain UPDATE, can quietly
-- break them.
create or replace function public.guard_team_member_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'team_members.user_id is immutable' using errcode = '42501';
  end if;
  if new.ru is distinct from old.ru then
    raise exception 'team_members.ru is immutable' using errcode = '42501';
  end if;
  if old.status = 'OFFBOARDED' and new.status is distinct from 'OFFBOARDED' then
    raise exception 'an offboarded member cannot be reactivated' using errcode = 'SU008';
  end if;
  if old.sessions_valid_after is not null
    and (new.sessions_valid_after is null or new.sessions_valid_after < old.sessions_valid_after) then
    raise exception 'team_members.sessions_valid_after only moves forward' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists team_members_guard_identity on public.team_members;
create trigger team_members_guard_identity
  before update on public.team_members
  for each row execute function public.guard_team_member_identity();

-- ---------------------------------------------------------------------------
-- 3. access grants: roles and projects per member
-- ---------------------------------------------------------------------------
-- Rows are revoked, never deleted: revoked_at keeps who had what, and when.

create table if not exists public.user_roles (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.team_members (user_id) on delete restrict,
  role_key text not null references public.roles (key) on delete restrict,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);

create unique index if not exists user_roles_active_key
  on public.user_roles (user_id, role_key)
  where revoked_at is null;

create index if not exists user_roles_user_idx on public.user_roles (user_id);

create table if not exists public.project_members (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.team_members (user_id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete cascade,
  access_level text not null default 'VIEW' check (access_level in ('VIEW', 'EDIT')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);

comment on table public.project_members is
  'Which projects a member without projects.read may see (VIEW) or draft on (EDIT).';

create unique index if not exists project_members_active_key
  on public.project_members (user_id, project_id)
  where revoked_at is null;

create index if not exists project_members_project_idx on public.project_members (project_id);

-- ---------------------------------------------------------------------------
-- 4. invitations, security settings, change requests, audit log
-- ---------------------------------------------------------------------------

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (position('@' in email) > 1 and length(email) <= 254),
  display_name text not null check (btrim(display_name) <> '' and length(display_name) <= 120),
  role_keys text[] not null check (cardinality(role_keys) between 1 and 6),
  projects jsonb not null default '[]'::jsonb check (jsonb_typeof(projects) = 'array'),
  access_starts_at timestamptz,
  access_expires_at timestamptz,
  invited_by uuid not null references auth.users (id) on delete restrict,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'ACCEPTED', 'CANCELLED', 'FAILED', 'EXPIRED')),
  user_id uuid references auth.users (id) on delete set null,
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz not null
);

create unique index if not exists team_invitations_open_email_key
  on public.team_invitations (lower(email))
  where status in ('PENDING', 'SENT');

create index if not exists team_invitations_inviter_idx on public.team_invitations (invited_by, created_at desc);

-- One row. Changing it is critical_settings.manage (CRITICAL: step-up).
create table if not exists public.security_settings (
  key text primary key default 'global' check (key = 'global'),
  step_up_max_age_seconds integer not null default 600 check (step_up_max_age_seconds between 60 and 3600),
  approval_expiry_days integer not null default 14 check (approval_expiry_days between 1 and 90),
  invitation_expiry_days integer not null default 7 check (invitation_expiry_days between 1 and 30),
  invitations_per_hour integer not null default 20 check (invitations_per_hour between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.security_settings (key) values ('global') on conflict (key) do nothing;

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  requester_id uuid not null references public.team_members (user_id) on delete restrict,
  reviewer_id uuid references public.team_members (user_id) on delete restrict,
  resource_type text not null check (resource_type in ('project')),
  resource_id uuid not null,
  action text not null check (action in ('project.update', 'project.publish')),
  proposed jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed) = 'object'),
  base_version integer not null check (base_version > 0),
  applied_changes jsonb,
  applied_version integer,
  risk_level text not null default 'LOW' check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  request_message text check (request_message is null or length(request_message) <= 2000),
  review_message text check (review_message is null or length(review_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  expires_at timestamptz,
  constraint change_requests_reviewed check (
    (status in ('APPROVED', 'REJECTED')) = (reviewer_id is not null and reviewed_at is not null)
  ),
  constraint change_requests_rejection_reason check (
    status <> 'REJECTED' or btrim(coalesce(review_message, '')) <> ''
  )
);

comment on table public.change_requests is
  'Proposed changes to a resource. A draft never touches the resource; approve_change_request() applies it atomically against base_version. Written only by security definer functions.';

-- One open request per person and resource: a draft is edited many times,
-- then submitted once.
create unique index if not exists change_requests_open_key
  on public.change_requests (requester_id, resource_type, resource_id)
  where status in ('DRAFT', 'PENDING');

create index if not exists change_requests_status_idx on public.change_requests (status, submitted_at desc);
create index if not exists change_requests_resource_idx on public.change_requests (resource_type, resource_id);

create table if not exists public.security_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_ru text,
  action text not null check (action ~ '^[A-Z][A-Z_]*$'),
  resource_type text,
  resource_id text,
  target_user_id uuid,
  request_id uuid,
  aal text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

comment on table public.security_audit_log is
  'Append-only security events. Inserted only by security definer functions and triggers; UPDATE, DELETE and TRUNCATE are refused by triggers on every normal path, for every application role. Infrastructure changes by the database owner (altering schema or triggers) are outside this trust boundary.';

create index if not exists security_audit_log_created_idx on public.security_audit_log (created_at desc);
create index if not exists security_audit_log_actor_idx on public.security_audit_log (actor_user_id, created_at desc);
create index if not exists security_audit_log_target_idx on public.security_audit_log (target_user_id, created_at desc);
create index if not exists security_audit_log_request_idx on public.security_audit_log (request_id) where request_id is not null;
create index if not exists security_audit_log_resource_idx on public.security_audit_log (resource_type, resource_id);

create or replace function public.refuse_audit_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'security_audit_log is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists security_audit_log_append_only on public.security_audit_log;
create trigger security_audit_log_append_only
  before update or delete on public.security_audit_log
  for each row execute function public.refuse_audit_changes();

drop trigger if exists security_audit_log_no_truncate on public.security_audit_log;
create trigger security_audit_log_no_truncate
  before truncate on public.security_audit_log
  for each statement execute function public.refuse_audit_changes();

-- ---------------------------------------------------------------------------
-- 5. request context: who is calling, and how strongly authenticated
-- ---------------------------------------------------------------------------

-- The service role (Edge Functions, the automation service) and SQL run
-- directly against the database (migrations, the SQL editor) are trusted
-- backends. PostgREST always sets request.jwt.claims, even to '{}' for an
-- anonymous request, so an API call can never pass as "no JWT context".
-- Always true or false, never null: callers write "not is_trusted_backend()",
-- and a null there would skip the check it guards (claims without a role).
create or replace function public.is_trusted_backend()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  raw_claims text := nullif(current_setting('request.jwt.claims', true), '');
  legacy_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  legacy_sub text := nullif(current_setting('request.jwt.claim.sub', true), '');
begin
  if raw_claims is null and legacy_role is null and legacy_sub is null then
    return true;
  end if;
  return coalesce(raw_claims::jsonb ->> 'role', legacy_role, '') = 'service_role';
end;
$$;

create or replace function public.request_claims()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  raw_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  return coalesce(raw_claims::jsonb, '{}'::jsonb);
exception
  when others then return '{}'::jsonb;
end;
$$;

create or replace function public.jwt_aal()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.request_claims() ->> 'aal', 'aal1');
$$;

-- An MFA verification younger than the step-up window. aal2 alone is not
-- enough for CRITICAL actions: a session that verified MFA hours ago must
-- verify again (supabase.auth.mfa.challengeAndVerify), which refreshes amr.
create or replace function public.step_up_satisfied()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claims jsonb := public.request_claims();
  max_age integer;
begin
  if coalesce(claims ->> 'aal', 'aal1') <> 'aal2' or jsonb_typeof(claims -> 'amr') is distinct from 'array' then
    return false;
  end if;
  select step_up_max_age_seconds into max_age from public.security_settings where key = 'global';
  return exists (
    select 1
    from jsonb_array_elements(claims -> 'amr') as entry
    where entry ->> 'method' in ('totp', 'phone', 'webauthn')
      and (entry ->> 'timestamp') ~ '^[0-9]{1,12}$'
      and (entry ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - coalesce(max_age, 600)
  );
end;
$$;

-- Whether a user has a verified MFA factor. plpgsql so the reference to
-- auth.mfa_factors is resolved when called, not when created.
create or replace function public.user_has_verified_factor(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null or to_regclass('auth.mfa_factors') is null then
    return false;
  end if;
  return exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. authorization helpers
-- ---------------------------------------------------------------------------

create or replace function public.member_row_active(m public.team_members)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select m.status = 'ACTIVE'
    and (m.access_starts_at is null or m.access_starts_at <= now())
    and (m.access_expires_at is null or m.access_expires_at > now());
$$;

-- The status a person is actually in: ACTIVE past its expiry reads EXPIRED.
create or replace function public.member_effective_status(m public.team_members)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when m.status = 'ACTIVE' and m.access_expires_at is not null and m.access_expires_at <= now() then 'EXPIRED'
    else m.status
  end;
$$;

create or replace function public.member_is_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select public.member_row_active(m) from public.team_members m where m.user_id = p_user), false);
$$;

-- Whether the caller's access token was issued after their last session
-- revocation (team_members.sessions_valid_after). Every decision about the
-- caller goes through it, so a token issued before a revocation, a
-- suspension or an offboarding never authorizes again, even once the member
-- is reactivated. iat is whole seconds: a token from the same second as the
-- cutoff is refused too (fail closed; signing in again a second later works).
-- No cutoff, or no member row: nothing to refuse here.
create or replace function public.caller_token_current()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cutoff timestamptz;
  issued text := public.request_claims() ->> 'iat';
begin
  select sessions_valid_after into cutoff from public.team_members where user_id = auth.uid();
  if cutoff is null then
    return true;
  end if;
  if issued is null or issued !~ '^[0-9]{1,12}(\.[0-9]+)?$' then
    return false;
  end if;
  return issued::numeric >= extract(epoch from cutoff);
end;
$$;

create or replace function public.current_member_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.member_is_active(auth.uid()) and public.caller_token_current();
$$;

-- Active, unexpired role grants of a member.
create or replace function public.member_roles(p_user uuid)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ur.role_key
  from public.user_roles ur
  where ur.user_id = p_user
    and ur.revoked_at is null
    and (ur.expires_at is null or ur.expires_at > now());
$$;

create or replace function public.member_max_rank(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(max(r.rank), 0)
  from public.roles r
  where r.key in (select public.member_roles(p_user));
$$;

create or replace function public.member_requires_mfa(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.roles r
    where r.key in (select public.member_roles(p_user)) and r.requires_mfa
  );
$$;

-- The MFA part of every permission check.
--   CRITICAL                  -> a fresh MFA verification (step-up)
--   aal2 session              -> allowed
--   verified factor, aal1     -> denied: an enrolled person must finish MFA
--   privileged, no factor     -> denied: roles with approval powers need MFA
--                                from their first use, migrated accounts too
--   not privileged, no factor -> allowed
-- Enrolling a factor goes through Supabase Auth, not through a permission,
-- so a privileged member without MFA is never locked out of enabling it.
create or replace function public.mfa_gate(p_user uuid, p_risk text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_risk = 'CRITICAL' then
    return public.step_up_satisfied();
  end if;
  if public.jwt_aal() = 'aal2' then
    return true;
  end if;
  if public.user_has_verified_factor(p_user) then
    return false;
  end if;
  return not public.member_requires_mfa(p_user);
end;
$$;

-- Whether the member's roles grant a permission, before MFA. Used to tell
-- "not allowed" apart from "allowed after step-up".
create or replace function public.role_grants_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.member_is_active(p_user)
    and exists (
      select 1 from public.role_permissions rp
      where rp.permission_key = p_permission
        and rp.role_key in (select public.member_roles(p_user))
    );
$$;

-- The authorization decision. Default deny: no session, a token issued
-- before the member's last session revocation, no membership, not ACTIVE,
-- outside the access window, permission not granted by an active role,
-- unknown permission, or MFA not satisfied for its risk -> false.
create or replace function public.has_permission(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  risk text;
begin
  if uid is null or not public.caller_token_current() then
    return false;
  end if;
  select risk_level into risk from public.permissions where key = p_permission;
  if risk is null or not public.role_grants_permission(uid, p_permission) then
    return false;
  end if;
  return public.mfa_gate(uid, risk);
end;
$$;

-- Raises instead of returning false, with the reason the Admin shows:
--   SU013  this token was issued before the member's sessions were revoked:
--          sign in again
--   SU006  the roles grant it, but this session has not completed MFA (enrol
--          a factor, or verify the one enrolled)
--   SU005  the roles grant it, the session has MFA, and the action is
--          CRITICAL: verify again (step-up)
--   42501  not granted at all
create or replace function public.require_permission(p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.has_permission(p_permission) then
    return;
  end if;
  if auth.uid() is not null and not public.caller_token_current() then
    raise exception 'this session was ended; sign in again' using errcode = 'SU013';
  end if;
  if auth.uid() is not null and public.role_grants_permission(auth.uid(), p_permission) then
    if public.jwt_aal() = 'aal2' then
      raise exception 'this action needs a recent MFA verification (%)', p_permission using errcode = 'SU005';
    end if;
    raise exception 'this account must complete MFA first (%)', p_permission using errcode = 'SU006';
  end if;
  raise exception 'not allowed: %', p_permission using errcode = '42501';
end;
$$;

-- Assigned-project access for roles without projects.read.
create or replace function public.is_project_member(p_project uuid, p_write boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_project is not null
    and public.has_permission(case when p_write then 'projects.draft' else 'projects.read_assigned' end)
    and exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id = p_project
        and pm.revoked_at is null
        and (pm.expires_at is null or pm.expires_at > now())
        and (not p_write or pm.access_level = 'EDIT')
    );
$$;

create or replace function public.has_project_access(p_project uuid, p_write boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission(case when p_write then 'projects.edit' else 'projects.read' end)
    or public.is_project_member(p_project, p_write);
$$;

-- The old binary check, redefined so that anything that still called it
-- would fail closed: an active OWNER or ABSOLUTE_ADMIN with a current token
-- and MFA in order. No policy, function, view or client calls it after this
-- migration, so no API role may execute it (section 17).
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.member_is_active(uid) or not public.caller_token_current() then
    return false;
  end if;
  if not exists (select 1 from public.member_roles(uid) role_key where role_key in ('OWNER', 'ABSOLUTE_ADMIN')) then
    return false;
  end if;
  return public.mfa_gate(uid, 'MEDIUM');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. audit writer
-- ---------------------------------------------------------------------------

-- The only way into security_audit_log. Secrets never reach it: metadata keys
-- that look like credentials or personal documents are dropped.
create or replace function public.write_audit(
  p_action text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_target uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_request uuid default null,
  p_actor uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := coalesce(p_actor, auth.uid());
  clean jsonb := '{}'::jsonb;
  item record;
begin
  if p_action not in (
    'LOGIN_SUCCESS', 'MFA_ENROLLED', 'MFA_REMOVED',
    'USER_INVITED', 'INVITATION_CANCELLED', 'INVITATION_FAILED', 'USER_ACTIVATED',
    'USER_SUSPENDED', 'USER_REACTIVATED', 'USER_EXPIRED', 'USER_OFFBOARDED',
    'ROLE_ASSIGNED', 'ROLE_REMOVED', 'PROJECT_ACCESS_GRANTED', 'PROJECT_ACCESS_CHANGED', 'PROJECT_ACCESS_REVOKED',
    'ACCESS_UPDATED', 'PERMISSION_CHANGED', 'SESSION_REVOKED', 'SECURITY_SETTING_CHANGED', 'BOOTSTRAP_GRANT',
    'PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_PUBLISHED', 'PROJECT_UNPUBLISHED', 'PROJECT_ARCHIVED', 'PROJECT_DELETED',
    'APPROVAL_DRAFTED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'APPROVAL_CANCELLED',
    'APPROVAL_EXPIRED', 'APPROVAL_REBASED'
  ) then
    raise exception 'unknown audit action %', p_action;
  end if;

  for item in select key, value from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) loop
    if item.key !~* '(pass|secret|token|authorization|cookie|cpf|totp|otp|service_role|api_key|apikey)' then
      clean := clean || jsonb_build_object(item.key, item.value);
    end if;
  end loop;

  insert into public.security_audit_log (actor_user_id, actor_ru, action, resource_type, resource_id, target_user_id, request_id, aal, metadata)
  values (
    actor,
    (select ru from public.team_members where user_id = actor),
    p_action,
    p_resource_type,
    p_resource_id,
    p_target,
    p_request,
    case when public.is_trusted_backend() then null else public.jwt_aal() end,
    clean
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. projects: version, lifecycle guard, audit
-- ---------------------------------------------------------------------------

alter table public.projects add column if not exists version integer not null default 1 check (version > 0);

comment on column public.projects.version is
  'Bumped by the database on every update. Drafts record the version they were based on; approving one against a newer version is a conflict.';

-- The version belongs to the database. Publishing, unpublishing, archiving
-- and toggling a published project's visibility each need their own
-- permission on top of projects.edit, so an editor cannot publish by editing.
create or replace function public.guard_project_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    if not public.is_trusted_backend() and new.editorial_status = 'PUBLISHED' then
      perform public.require_permission('projects.publish');
    end if;
    return new;
  end if;

  new.version := old.version + 1;
  if public.is_trusted_backend() then
    return new;
  end if;

  if new.editorial_status is distinct from old.editorial_status then
    if new.editorial_status = 'ARCHIVED' or old.editorial_status = 'ARCHIVED' then
      perform public.require_permission('projects.archive');
    end if;
    if new.editorial_status = 'PUBLISHED' or old.editorial_status = 'PUBLISHED' then
      perform public.require_permission('projects.publish');
    end if;
  elsif old.editorial_status = 'PUBLISHED'
    and (new.visible is distinct from old.visible or new.featured is distinct from old.featured) then
    perform public.require_permission('projects.publish');
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_change on public.projects;
create trigger projects_guard_change
  before insert or update on public.projects
  for each row execute function public.guard_project_change();

create or replace function public.audit_project_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request uuid := nullif(current_setting('app.change_request_id', true), '')::uuid;
  changed text[];
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('PROJECT_CREATED', 'project', new.id::text, null, jsonb_build_object('case_number', new.case_number, 'name', new.name), request);
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.write_audit('PROJECT_DELETED', 'project', old.id::text, null, jsonb_build_object('case_number', old.case_number, 'name', old.name), request);
    return old;
  end if;

  select coalesce(array_agg(key order by key), '{}') into changed
  from jsonb_each(to_jsonb(new)) as fresh(key, value)
  where key not in ('updated_at', 'version') and fresh.value is distinct from to_jsonb(old) -> key;

  if new.editorial_status is distinct from old.editorial_status and new.editorial_status = 'PUBLISHED' then
    perform public.write_audit('PROJECT_PUBLISHED', 'project', new.id::text, null, jsonb_build_object('fields', changed, 'version', new.version), request);
  elsif new.editorial_status is distinct from old.editorial_status and new.editorial_status = 'ARCHIVED' then
    perform public.write_audit('PROJECT_ARCHIVED', 'project', new.id::text, null, jsonb_build_object('fields', changed, 'version', new.version), request);
  elsif new.editorial_status is distinct from old.editorial_status and old.editorial_status = 'PUBLISHED' then
    perform public.write_audit('PROJECT_UNPUBLISHED', 'project', new.id::text, null, jsonb_build_object('fields', changed, 'version', new.version), request);
  elsif cardinality(changed) > 0 then
    perform public.write_audit('PROJECT_UPDATED', 'project', new.id::text, null, jsonb_build_object('fields', changed, 'version', new.version), request);
  end if;
  return new;
end;
$$;

drop trigger if exists projects_audit_change on public.projects;
create trigger projects_audit_change
  after insert or update or delete on public.projects
  for each row execute function public.audit_project_change();

-- ---------------------------------------------------------------------------
-- 9. field-level guards on existing tables
-- ---------------------------------------------------------------------------

-- Archiving a client, or bringing one back, is clients.archive.
create or replace function public.guard_client_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_backend()
    and (new.status = 'ARCHIVED' or (tg_op = 'UPDATE' and old.status = 'ARCHIVED'))
    and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform public.require_permission('clients.archive');
  end if;
  return new;
end;
$$;

drop trigger if exists clients_guard_archive on public.clients;
create trigger clients_guard_archive
  before insert or update on public.clients
  for each row execute function public.guard_client_archive();

-- site_settings is one row with two owners: identity fields are
-- settings.edit, search and sharing fields are seo.edit. RLS is per row, so
-- the split is per column here. updated_by is the caller, never the client.
create or replace function public.guard_site_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  identity_changed boolean;
  search_changed boolean;
begin
  if public.is_trusted_backend() then
    return new;
  end if;
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    -- An upsert fires this before it finds the existing row; the UPDATE that
    -- follows compares against that row, so only a real first insert counts.
    if exists (select 1 from public.site_settings s where s.key = new.key) then
      return new;
    end if;
    identity_changed := coalesce(new.site_name, new.site_url, new.contact_email, new.locale) is not null;
    search_changed := coalesce(new.seo_title, new.seo_description, new.og_image_path) is not null
      or coalesce(new.translations, '{}'::jsonb) <> '{}'::jsonb;
  else
    identity_changed := new.site_name is distinct from old.site_name
      or new.site_url is distinct from old.site_url
      or new.contact_email is distinct from old.contact_email
      or new.locale is distinct from old.locale;
    search_changed := new.seo_title is distinct from old.seo_title
      or new.seo_description is distinct from old.seo_description
      or new.og_image_path is distinct from old.og_image_path
      or new.translations is distinct from old.translations;
  end if;
  if identity_changed then
    perform public.require_permission('settings.edit');
  end if;
  if search_changed then
    perform public.require_permission('seo.edit');
  end if;
  return new;
end;
$$;

drop trigger if exists site_settings_guard on public.site_settings;
create trigger site_settings_guard
  before insert or update on public.site_settings
  for each row execute function public.guard_site_settings();

-- The activity log's author is the caller, never a value the browser sends.
create or replace function public.stamp_activity_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_backend() then
    new.admin_user_id := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists activity_log_stamp_author on public.activity_log;
create trigger activity_log_stamp_author
  before insert on public.activity_log
  for each row execute function public.stamp_activity_author();

-- public.admins is history now. Access is granted through the Team module or
-- public.bootstrap_member(); a new row here would grant nothing, so it is
-- refused with a pointer instead of silently ignored.
create or replace function public.refuse_legacy_admin_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'public.admins is no longer used for access; grant roles with the Team module or public.bootstrap_member()'
    using errcode = '42501';
end;
$$;

drop trigger if exists admins_refuse_writes on public.admins;
create trigger admins_refuse_writes
  before insert or update on public.admins
  for each row execute function public.refuse_legacy_admin_write();

-- Client codes. Until now the generator was the column default, which made
-- it an RPC every signed-in account could call (the default runs as the
-- inserting role, so it needed EXECUTE). Now a trigger assigns the code when
-- a client is inserted without one, and the generator is reachable only from
-- that trigger and from SQL without a request JWT (migrations, the SQL
-- editor). An insert by anyone without clients.create is refused here, before
-- a number is drawn: a sequence is not transactional.
create or replace function public.next_client_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n bigint;
  candidate text;
begin
  if not public.is_trusted_backend() and not public.has_permission('clients.create') then
    raise exception 'not authorized to generate client codes' using errcode = '42501';
  end if;
  loop
    n := nextval('public.clients_code_seq');
    candidate := 'CLIENT-' || lpad(n::text, greatest(3, length(n::text)), '0');
    exit when not exists (select 1 from public.clients where code = candidate);
  end loop;
  return candidate;
end;
$$;

-- Assigns the code of a client inserted without one. SECURITY DEFINER, so the
-- inserting role needs no EXECUTE on the generator. An explicit code is kept
-- as it is (a blank one still fails the table's check).
create or replace function public.assign_client_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.code is null then
    new.code := public.next_client_code();
  end if;
  return new;
end;
$$;

drop trigger if exists clients_assign_code on public.clients;
create trigger clients_assign_code
  before insert on public.clients
  for each row execute function public.assign_client_code();

alter table public.clients alter column code drop default;

-- ---------------------------------------------------------------------------
-- 10. row level security: every is_admin() policy replaced by permissions
-- ---------------------------------------------------------------------------
-- Public read policies (anon: published projects, their gallery, modules and
-- media, visible plans, site content and settings) are untouched.
-- (select ...) around a row-independent check makes Postgres evaluate it once
-- per statement instead of once per row.

-- projects
drop policy if exists projects_admin_all on public.projects;
drop policy if exists projects_member_select on public.projects;
drop policy if exists projects_member_insert on public.projects;
drop policy if exists projects_member_update on public.projects;
drop policy if exists projects_member_delete on public.projects;
create policy projects_member_select on public.projects for select to authenticated
  using ((select public.has_permission('projects.read')) or public.is_project_member(id));
create policy projects_member_insert on public.projects for insert to authenticated
  with check ((select public.has_permission('projects.create')));
create policy projects_member_update on public.projects for update to authenticated
  using ((select public.has_permission('projects.edit')))
  with check ((select public.has_permission('projects.edit')));
create policy projects_member_delete on public.projects for delete to authenticated
  using ((select public.has_permission('projects.delete')));

-- project_gallery and project_modules follow their project
drop policy if exists project_gallery_admin_all on public.project_gallery;
drop policy if exists project_gallery_member_select on public.project_gallery;
drop policy if exists project_gallery_member_write on public.project_gallery;
create policy project_gallery_member_select on public.project_gallery for select to authenticated
  using (public.has_project_access(project_id));
create policy project_gallery_member_write on public.project_gallery for all to authenticated
  using ((select public.has_permission('projects.edit')))
  with check ((select public.has_permission('projects.edit')));

drop policy if exists project_modules_admin_all on public.project_modules;
drop policy if exists project_modules_member_select on public.project_modules;
drop policy if exists project_modules_member_write on public.project_modules;
create policy project_modules_member_select on public.project_modules for select to authenticated
  using (public.has_project_access(project_id));
create policy project_modules_member_write on public.project_modules for all to authenticated
  using ((select public.has_permission('projects.edit')))
  with check ((select public.has_permission('projects.edit')));

-- project media (storage)
drop policy if exists project_media_admin_all on storage.objects;
drop policy if exists project_media_member_select on storage.objects;
drop policy if exists project_media_member_insert on storage.objects;
drop policy if exists project_media_member_update on storage.objects;
drop policy if exists project_media_member_delete on storage.objects;
create policy project_media_member_select on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and (select public.has_permission('files.read'))
    and ((select public.has_permission('projects.read')) or public.is_project_member(public.media_project_id(storage.objects.name)))
  );
-- A collaborator may upload into an assigned project's folder (for a draft);
-- replacing or deleting stored files is for global editors.
create policy project_media_member_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and (select public.has_permission('files.upload'))
    and ((select public.has_permission('projects.edit')) or public.is_project_member(public.media_project_id(storage.objects.name), true))
  );
create policy project_media_member_update on storage.objects for update to authenticated
  using (bucket_id = 'project-media' and (select public.has_permission('files.upload')) and (select public.has_permission('projects.edit')))
  with check (bucket_id = 'project-media' and (select public.has_permission('files.upload')) and (select public.has_permission('projects.edit')));
create policy project_media_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-media' and (select public.has_permission('files.delete')));

-- services (plans)
drop policy if exists plans_admin_all on public.plans;
drop policy if exists plans_member_select on public.plans;
drop policy if exists plans_member_write on public.plans;
create policy plans_member_select on public.plans for select to authenticated
  using ((select public.has_permission('services.read')));
create policy plans_member_write on public.plans for all to authenticated
  using ((select public.has_permission('services.edit')))
  with check ((select public.has_permission('services.edit')));

drop policy if exists plan_features_admin_all on public.plan_features;
drop policy if exists plan_features_member_select on public.plan_features;
drop policy if exists plan_features_member_write on public.plan_features;
create policy plan_features_member_select on public.plan_features for select to authenticated
  using ((select public.has_permission('services.read')));
create policy plan_features_member_write on public.plan_features for all to authenticated
  using ((select public.has_permission('services.edit')))
  with check ((select public.has_permission('services.edit')));

-- CMS
drop policy if exists site_content_admin_all on public.site_content;
drop policy if exists site_content_member_write on public.site_content;
create policy site_content_member_write on public.site_content for all to authenticated
  using ((select public.has_permission('cms.edit')))
  with check ((select public.has_permission('cms.edit')));

-- settings (per-column split in guard_site_settings)
drop policy if exists site_settings_admin_all on public.site_settings;
drop policy if exists site_settings_member_insert on public.site_settings;
drop policy if exists site_settings_member_update on public.site_settings;
drop policy if exists site_settings_member_delete on public.site_settings;
create policy site_settings_member_insert on public.site_settings for insert to authenticated
  with check ((select public.has_permission('settings.edit')) or (select public.has_permission('seo.edit')));
create policy site_settings_member_update on public.site_settings for update to authenticated
  using ((select public.has_permission('settings.edit')) or (select public.has_permission('seo.edit')))
  with check ((select public.has_permission('settings.edit')) or (select public.has_permission('seo.edit')));
create policy site_settings_member_delete on public.site_settings for delete to authenticated
  using ((select public.has_permission('settings.edit')));

-- activity log: the whole log is logs.read; everyone reads their own entries
drop policy if exists activity_log_admin_read on public.activity_log;
drop policy if exists activity_log_admin_insert on public.activity_log;
drop policy if exists activity_log_member_select on public.activity_log;
drop policy if exists activity_log_member_insert on public.activity_log;
create policy activity_log_member_select on public.activity_log for select to authenticated
  using ((select public.has_permission('logs.read')) or (admin_user_id = (select auth.uid()) and (select public.current_member_active())));
create policy activity_log_member_insert on public.activity_log for insert to authenticated
  with check ((select public.current_member_active()));

-- clients
drop policy if exists clients_admin_select on public.clients;
drop policy if exists clients_admin_insert on public.clients;
drop policy if exists clients_admin_update on public.clients;
drop policy if exists clients_admin_delete on public.clients;
create policy clients_admin_select on public.clients for select to authenticated
  using ((select public.has_permission('clients.read')));
create policy clients_admin_insert on public.clients for insert to authenticated
  with check ((select public.has_permission('clients.create')));
create policy clients_admin_update on public.clients for update to authenticated
  using ((select public.has_permission('clients.edit')))
  with check ((select public.has_permission('clients.edit')));
create policy clients_admin_delete on public.clients for delete to authenticated
  using ((select public.has_permission('clients.delete')));

-- commercial (pipeline, legacy proposals and handoffs)
drop policy if exists commercial_opportunities_admin_select on public.commercial_opportunities;
drop policy if exists commercial_opportunities_admin_insert on public.commercial_opportunities;
drop policy if exists commercial_opportunities_admin_update on public.commercial_opportunities;
drop policy if exists commercial_opportunities_admin_delete on public.commercial_opportunities;
create policy commercial_opportunities_admin_select on public.commercial_opportunities for select to authenticated
  using ((select public.has_permission('commercial.read')));
create policy commercial_opportunities_admin_insert on public.commercial_opportunities for insert to authenticated
  with check ((select public.has_permission('commercial.edit')));
create policy commercial_opportunities_admin_update on public.commercial_opportunities for update to authenticated
  using ((select public.has_permission('commercial.edit')))
  with check ((select public.has_permission('commercial.edit')));
create policy commercial_opportunities_admin_delete on public.commercial_opportunities for delete to authenticated
  using ((select public.has_permission('commercial.delete')));

drop policy if exists commercial_proposals_admin_select on public.commercial_proposals;
drop policy if exists commercial_proposals_admin_insert on public.commercial_proposals;
drop policy if exists commercial_proposals_admin_update on public.commercial_proposals;
drop policy if exists commercial_proposals_admin_delete on public.commercial_proposals;
create policy commercial_proposals_admin_select on public.commercial_proposals for select to authenticated
  using ((select public.has_permission('commercial.read')));
create policy commercial_proposals_admin_insert on public.commercial_proposals for insert to authenticated
  with check ((select public.has_permission('commercial.edit')));
create policy commercial_proposals_admin_update on public.commercial_proposals for update to authenticated
  using ((select public.has_permission('commercial.edit')))
  with check ((select public.has_permission('commercial.edit')));
create policy commercial_proposals_admin_delete on public.commercial_proposals for delete to authenticated
  using ((select public.has_permission('commercial.delete')));

drop policy if exists commercial_project_handoffs_admin_select on public.commercial_project_handoffs;
drop policy if exists commercial_project_handoffs_admin_insert on public.commercial_project_handoffs;
drop policy if exists commercial_project_handoffs_admin_update on public.commercial_project_handoffs;
drop policy if exists commercial_project_handoffs_admin_delete on public.commercial_project_handoffs;
create policy commercial_project_handoffs_admin_select on public.commercial_project_handoffs for select to authenticated
  using ((select public.has_permission('commercial.read')));
create policy commercial_project_handoffs_admin_insert on public.commercial_project_handoffs for insert to authenticated
  with check ((select public.has_permission('commercial.edit')));
create policy commercial_project_handoffs_admin_update on public.commercial_project_handoffs for update to authenticated
  using ((select public.has_permission('commercial.edit')))
  with check ((select public.has_permission('commercial.edit')));
create policy commercial_project_handoffs_admin_delete on public.commercial_project_handoffs for delete to authenticated
  using ((select public.has_permission('commercial.delete')));

-- finance
drop policy if exists financial_transactions_admin_select on public.financial_transactions;
drop policy if exists financial_transactions_admin_insert on public.financial_transactions;
drop policy if exists financial_transactions_admin_update on public.financial_transactions;
drop policy if exists financial_transactions_admin_delete on public.financial_transactions;
create policy financial_transactions_admin_select on public.financial_transactions for select to authenticated
  using ((select public.has_permission('finance.read')));
create policy financial_transactions_admin_insert on public.financial_transactions for insert to authenticated
  with check ((select public.has_permission('finance.edit')));
create policy financial_transactions_admin_update on public.financial_transactions for update to authenticated
  using ((select public.has_permission('finance.edit')))
  with check ((select public.has_permission('finance.edit')));
create policy financial_transactions_admin_delete on public.financial_transactions for delete to authenticated
  using ((select public.has_permission('finance.delete')));

-- legacy admins roster: your own row, or the team's
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select to authenticated
  using ((user_id = (select auth.uid()) and (select public.caller_token_current())) or (select public.has_permission('team.read')));

-- ---------------------------------------------------------------------------
-- 11. row level security on the new tables
-- ---------------------------------------------------------------------------
-- Every write goes through a security definer function below, so no API role
-- has INSERT, UPDATE or DELETE on any of these tables.

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.approval_routes enable row level security;
alter table public.team_members enable row level security;
alter table public.user_roles enable row level security;
alter table public.project_members enable row level security;
alter table public.team_invitations enable row level security;
alter table public.security_settings enable row level security;
alter table public.change_requests enable row level security;
alter table public.security_audit_log enable row level security;

revoke all on table public.roles, public.permissions, public.role_permissions, public.approval_routes,
  public.team_members, public.user_roles, public.project_members, public.team_invitations,
  public.security_settings, public.change_requests, public.security_audit_log
  from public, anon, authenticated, service_role;

grant select on table public.roles, public.permissions, public.role_permissions, public.approval_routes,
  public.team_members, public.user_roles, public.project_members, public.team_invitations,
  public.security_settings, public.change_requests, public.security_audit_log
  to authenticated, service_role;

revoke all on sequence public.team_member_ru_seq from public, anon, authenticated, service_role;

-- The catalog is not secret; any active member reads it to word the Admin.
drop policy if exists roles_member_read on public.roles;
create policy roles_member_read on public.roles for select to authenticated using ((select public.current_member_active()));
drop policy if exists permissions_member_read on public.permissions;
create policy permissions_member_read on public.permissions for select to authenticated using ((select public.current_member_active()));
drop policy if exists role_permissions_member_read on public.role_permissions;
create policy role_permissions_member_read on public.role_permissions for select to authenticated using ((select public.current_member_active()));
drop policy if exists approval_routes_member_read on public.approval_routes;
create policy approval_routes_member_read on public.approval_routes for select to authenticated using ((select public.current_member_active()));
drop policy if exists security_settings_member_read on public.security_settings;
create policy security_settings_member_read on public.security_settings for select to authenticated using ((select public.current_member_active()));

-- People: yourself (with a current token), or the team (team.read). Emails
-- are personal data.
drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members for select to authenticated
  using ((user_id = (select auth.uid()) and (select public.caller_token_current())) or (select public.has_permission('team.read')));
drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles for select to authenticated
  using ((user_id = (select auth.uid()) and (select public.caller_token_current())) or (select public.has_permission('team.read')));
drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members for select to authenticated
  using ((user_id = (select auth.uid()) and (select public.caller_token_current())) or (select public.has_permission('team.read')));
drop policy if exists team_invitations_read on public.team_invitations;
create policy team_invitations_read on public.team_invitations for select to authenticated
  using ((select public.has_permission('team.read')));

-- Requests: your own, or, for reviewers, everyone's once submitted. A draft
-- stays with its author until they ask for review.
drop policy if exists change_requests_read on public.change_requests;
create policy change_requests_read on public.change_requests for select to authenticated
  using (
    (requester_id = (select auth.uid()) and (select public.has_permission('approvals.read')))
    or (status <> 'DRAFT' and (select public.has_permission('approvals.read_all')))
  );

-- Audit: events you took part in, or everything with audit.read_all.
drop policy if exists security_audit_log_read on public.security_audit_log;
create policy security_audit_log_read on public.security_audit_log for select to authenticated
  using (
    (select public.has_permission('audit.read_all'))
    or ((select public.has_permission('audit.read')) and (actor_user_id = (select auth.uid()) or target_user_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- 12. session revocation and sign-in bans
-- ---------------------------------------------------------------------------
-- Deleting a user's auth sessions deletes their refresh tokens (cascade), so
-- no new access token can be minted. An access token already issued stays
-- valid until it expires, which is why every permission check above reads the
-- member's current status instead of trusting the token: a suspended member's
-- old token authorizes nothing.
--
-- Both helpers are defence in depth on top of that check. They touch Supabase
-- Auth's own tables, so they return null instead of failing the suspension or
-- offboarding they belong to when the platform refuses (see
-- docs/security-architecture.md, "Verify after applying").
create or replace function public.revoke_auth_sessions(p_user uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer := 0;
begin
  if to_regclass('auth.sessions') is null then
    return null;
  end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics removed = row_count;
  return removed;
exception
  when insufficient_privilege then return null;
end;
$$;

-- Ends every session of a member at once. The cutoff makes each access token
-- issued so far worthless from the next request on (caller_token_current);
-- deleting the auth sessions stops any of them from being refreshed. The
-- cutoff only moves forward, so a later reactivation brings nothing back.
create or replace function public.end_member_sessions(p_user uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.team_members
  set sessions_valid_after = greatest(coalesce(sessions_valid_after, now()), now())
  where user_id = p_user;
  return public.revoke_auth_sessions(p_user);
end;
$$;

-- A banned user cannot sign in or refresh a session (Supabase Auth checks
-- auth.users.banned_until). Suspension and offboarding ban; reactivation lifts
-- the ban.
create or replace function public.set_auth_ban(p_user uuid, p_banned boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until'
  ) then
    return null;
  end if;
  execute 'update auth.users set banned_until = $2 where id = $1'
    using p_user, case when p_banned then now() + interval '100 years' else null end;
  return true;
exception
  when insufficient_privilege then return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. the caller's own access (drives the Admin's interface)
-- ---------------------------------------------------------------------------
-- Answers for the caller only. The Admin uses it to choose what to show; the
-- database still checks every query on its own.
create or replace function public.my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.team_members%rowtype;
  enrolled boolean;
  requires boolean;
  aal text := public.jwt_aal();
  blocked text;
  granted jsonb;
begin
  if uid is null then
    return jsonb_build_object('member', null, 'blocked_reason', 'UNAUTHENTICATED');
  end if;
  select * into m from public.team_members where user_id = uid;
  if not found then
    return jsonb_build_object('member', null, 'blocked_reason', 'NOT_MEMBER');
  end if;

  enrolled := public.user_has_verified_factor(uid);
  requires := public.member_requires_mfa(uid);
  blocked := case
    when m.status = 'OFFBOARDED' then 'OFFBOARDED'
    when m.status = 'SUSPENDED' then 'SUSPENDED'
    when public.member_effective_status(m) = 'EXPIRED' then 'EXPIRED'
    when not public.caller_token_current() then 'SESSION_REVOKED'
    when m.status = 'INVITED' then 'INVITED'
    when m.access_starts_at is not null and m.access_starts_at > now() then 'NOT_STARTED'
    when enrolled and aal <> 'aal2' then 'MFA_CHALLENGE_REQUIRED'
    when requires and not enrolled and aal <> 'aal2' then 'MFA_ENROLL_REQUIRED'
    else null
  end;

  select coalesce(jsonb_agg(jsonb_build_object('key', p.key, 'risk', p.risk_level) order by p.key), '[]'::jsonb)
    into granted
  from public.permissions p
  where public.member_row_active(m)
    and public.caller_token_current()
    and p.key in (select rp.permission_key from public.role_permissions rp where rp.role_key in (select public.member_roles(uid)));

  return jsonb_build_object(
    'member', jsonb_build_object(
      'user_id', m.user_id,
      'ru', m.ru,
      'display_name', m.display_name,
      'email', m.email,
      'status', m.status,
      'effective_status', public.member_effective_status(m),
      'access_starts_at', m.access_starts_at,
      'access_expires_at', m.access_expires_at,
      'invite_expires_at', m.invite_expires_at,
      'activated_at', m.activated_at
    ),
    'blocked_reason', blocked,
    'roles', (
      select coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'rank', r.rank, 'requires_mfa', r.requires_mfa) order by r.rank desc), '[]'::jsonb)
      from public.roles r where r.key in (select public.member_roles(uid))
    ),
    'permissions', granted,
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object('project_id', pm.project_id, 'access_level', pm.access_level, 'expires_at', pm.expires_at)), '[]'::jsonb)
      from public.project_members pm
      where pm.user_id = uid and pm.revoked_at is null and (pm.expires_at is null or pm.expires_at > now())
    ),
    'approval_routes', (
      select coalesce(jsonb_agg(jsonb_build_object('permission', ar.permission_key, 'via', ar.via_permission_key)), '[]'::jsonb)
      from public.approval_routes ar
    ),
    'mfa', jsonb_build_object(
      'required', requires,
      'enrolled', enrolled,
      'aal', aal,
      'step_up', public.step_up_satisfied()
    ),
    'settings', (
      select jsonb_build_object('step_up_max_age_seconds', s.step_up_max_age_seconds, 'approval_expiry_days', s.approval_expiry_days, 'invitation_expiry_days', s.invitation_expiry_days)
      from public.security_settings s where s.key = 'global'
    )
  );
end;
$$;

-- Names and RUs of other members, for the people named on requests and in
-- the audit trail. Any active member may resolve ids they already hold; emails
-- are never returned, and someone else's status only to the team (team.read).
create or replace function public.member_directory(p_ids uuid[])
returns table (user_id uuid, ru text, display_name text, status text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.user_id, m.ru, m.display_name,
    case when m.user_id = auth.uid() or public.has_permission('team.read') then public.member_effective_status(m) end
  from public.team_members m
  where public.current_member_active()
    and m.user_id = any ((coalesce(p_ids, '{}'::uuid[]))[1:200]);
$$;

-- ---------------------------------------------------------------------------
-- 14. self-service: activation, login and MFA records
-- ---------------------------------------------------------------------------

-- Whether a Supabase Auth user has a password. Only the emptiness of the hash
-- is read; the hash itself never leaves this function.
create or replace function public.auth_user_has_password(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from auth.users u
    where u.id = p_user and coalesce(to_jsonb(u) ->> 'encrypted_password', '') <> ''
  );
end;
$$;

-- INVITED -> ACTIVE, by the invited person, while the invitation is valid and
-- once they have chosen their own password.
create or replace function public.activate_my_membership()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m public.team_members%rowtype;
begin
  select * into m from public.team_members where user_id = uid for update;
  if not found then
    raise exception 'not a team member' using errcode = '42501';
  end if;
  if not public.caller_token_current() then
    raise exception 'this session was ended; sign in again' using errcode = 'SU013';
  end if;
  if m.status = 'ACTIVE' then
    return public.my_access();
  end if;
  if m.status <> 'INVITED' then
    raise exception 'membership is %', m.status using errcode = 'SU008';
  end if;
  if m.invite_expires_at is not null and m.invite_expires_at <= now() then
    raise exception 'the invitation expired; ask for a new one' using errcode = 'SU011';
  end if;
  if not public.auth_user_has_password(uid) then
    raise exception 'choose a password before activating the account' using errcode = 'SU008';
  end if;
  update public.team_members set status = 'ACTIVE', activated_at = now(), status_reason = null where user_id = uid;
  update public.team_invitations set status = 'ACCEPTED' where user_id = uid and status = 'SENT';
  perform public.write_audit('USER_ACTIVATED', 'team_member', uid::text, uid);
  return public.my_access();
end;
$$;

-- A sign-in, recorded once per session. The time comes from auth.users, not
-- from the browser.
create or replace function public.record_sign_in()
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_id text := public.request_claims() ->> 'session_id';
  signed_in timestamptz;
begin
  if uid is null or not exists (select 1 from public.team_members where user_id = uid) or not public.caller_token_current() then
    return;
  end if;
  if session_id is not null and exists (
    select 1 from public.security_audit_log
    where action = 'LOGIN_SUCCESS' and actor_user_id = uid and metadata ->> 'session_id' = session_id
  ) then
    return;
  end if;
  select (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz into signed_in from auth.users u where u.id = uid;
  update public.team_members set last_sign_in_at = coalesce(signed_in, now()) where user_id = uid;
  perform public.write_audit('LOGIN_SUCCESS', 'team_member', uid::text, uid, jsonb_build_object('session_id', session_id));
end;
$$;

-- "Sign out everywhere", by the member: every access token issued so far,
-- this one included, stops authorizing at once, and no session can be
-- refreshed. A token that is already out of date changes nothing.
create or replace function public.revoke_my_sessions()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  revoked integer;
begin
  if uid is null or not exists (select 1 from public.team_members where user_id = uid) or not public.caller_token_current() then
    return jsonb_build_object('sessions_revoked', 0);
  end if;
  revoked := public.end_member_sessions(uid);
  perform public.write_audit('SESSION_REVOKED', 'team_member', uid::text, uid, jsonb_build_object('sessions', revoked, 'cause', 'self'));
  return jsonb_build_object('sessions_revoked', revoked);
end;
$$;

-- Records an MFA enrolment or removal the database can verify for itself.
create or replace function public.record_mfa_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  enrolled boolean := public.user_has_verified_factor(uid);
  m public.team_members%rowtype;
begin
  select * into m from public.team_members where user_id = uid for update;
  if not found or not public.caller_token_current() then
    return public.my_access();
  end if;
  if enrolled and m.mfa_enrolled_at is null then
    update public.team_members set mfa_enrolled_at = now() where user_id = uid;
    perform public.write_audit('MFA_ENROLLED', 'team_member', uid::text, uid);
  elsif not enrolled and m.mfa_enrolled_at is not null then
    update public.team_members set mfa_enrolled_at = null where user_id = uid;
    perform public.write_audit('MFA_REMOVED', 'team_member', uid::text, uid);
  end if;
  return public.my_access();
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. team lifecycle
-- ---------------------------------------------------------------------------

-- The administrative roles; granting, removing or managing a holder of one is
-- CRITICAL (step-up).
create or replace function public.is_administrative_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select requires_mfa from public.roles where key = p_role), false);
$$;

-- Anti-escalation for acting on another member: never yourself, never someone
-- ranked at or above you; an administrative target is CRITICAL.
create or replace function public.assert_can_manage(p_target uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_target = actor then
    raise exception 'you cannot change your own access' using errcode = 'SU009';
  end if;
  if not exists (select 1 from public.team_members where user_id = p_target) then
    raise exception 'member not found' using errcode = 'SU010';
  end if;
  if public.member_max_rank(p_target) >= public.member_max_rank(actor)
    and 'ABSOLUTE_ADMIN' not in (select public.member_roles(actor)) then
    raise exception 'you cannot manage a member ranked at or above you' using errcode = 'SU009';
  end if;
  if exists (select 1 from public.member_roles(p_target) held where public.is_administrative_role(held))
    and not public.step_up_satisfied() then
    raise exception 'managing an administrative member needs a recent MFA verification' using errcode = 'SU005';
  end if;
end;
$$;

-- Whether the caller may hand out (or take away) a role: strictly below their
-- own rank, and administrative roles only with step-up. ABSOLUTE_ADMIN may
-- grant any role, itself included, with step-up.
create or replace function public.assert_can_grant_role(p_role text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  role_rank integer;
begin
  select rank into role_rank from public.roles where key = p_role;
  if role_rank is null then
    raise exception 'unknown role %', p_role using errcode = 'SU004';
  end if;
  if role_rank >= public.member_max_rank(auth.uid())
    and 'ABSOLUTE_ADMIN' not in (select public.member_roles(auth.uid())) then
    raise exception 'you cannot grant % (ranked at or above you)', p_role using errcode = 'SU009';
  end if;
  if public.is_administrative_role(p_role) and not public.step_up_satisfied() then
    raise exception 'granting % needs a recent MFA verification', p_role using errcode = 'SU005';
  end if;
end;
$$;

-- Validates a list of {project_id, access_level, expires_at}.
create or replace function public.normalize_project_grants(p_projects jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  result jsonb := '[]'::jsonb;
  seen uuid[] := '{}';
  project uuid;
  level text;
  ends_at timestamptz;
begin
  if p_projects is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_projects) <> 'array' or jsonb_array_length(p_projects) > 200 then
    raise exception 'projects must be a list of at most 200 grants' using errcode = 'SU004';
  end if;
  for item in select value from jsonb_array_elements(p_projects) loop
    begin
      project := (item ->> 'project_id')::uuid;
      ends_at := nullif(item ->> 'expires_at', '')::timestamptz;
    exception when others then
      raise exception 'invalid project grant' using errcode = 'SU004';
    end;
    if jsonb_typeof(item) <> 'object' or project is null then
      raise exception 'invalid project grant' using errcode = 'SU004';
    end if;
    if project = any (seen) then
      raise exception 'project % is listed twice', project using errcode = 'SU004';
    end if;
    seen := seen || project;
    level := upper(coalesce(item ->> 'access_level', 'VIEW'));
    if level not in ('VIEW', 'EDIT') then
      raise exception 'invalid access level %', level using errcode = 'SU004';
    end if;
    if ends_at is not null and ends_at <= now() then
      raise exception 'project access must end in the future' using errcode = 'SU004';
    end if;
    if not exists (select 1 from public.projects where id = project) then
      raise exception 'project % not found', project using errcode = 'SU010';
    end if;
    result := result || jsonb_build_array(jsonb_build_object('project_id', project, 'access_level', level, 'expires_at', ends_at));
  end loop;
  return result;
end;
$$;

-- At most security_settings.invitations_per_hour invitations and resends per
-- inviter per hour. Supabase Auth limits the emails themselves on top.
create or replace function public.assert_invitation_budget(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  budget integer;
  used integer;
begin
  select invitations_per_hour into budget from public.security_settings where key = 'global';
  select
    (select count(*) from public.team_invitations where invited_by = p_actor and created_at > now() - interval '1 hour')
    + (select count(*) from public.security_audit_log
       where actor_user_id = p_actor and action = 'USER_INVITED' and metadata ->> 'resend' = 'true' and created_at > now() - interval '1 hour')
    into used;
  if used >= coalesce(budget, 20) then
    raise exception 'too many invitations in the last hour' using errcode = 'SU007';
  end if;
end;
$$;

-- Step 1 of an invitation, as the inviter (the team-invite Edge Function calls
-- it with the inviter's own JWT). Validates everything and records the
-- invitation; the Edge Function then asks Supabase Auth to send it.
create or replace function public.prepare_invitation(
  p_email text,
  p_display_name text,
  p_roles text[],
  p_projects jsonb default '[]'::jsonb,
  p_access_starts_at timestamptz default null,
  p_access_expires_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_role text;
  expiry_days integer;
  invitation public.team_invitations%rowtype;
  grants jsonb;
begin
  perform public.require_permission('team.invite');

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
    raise exception 'invalid email' using errcode = 'SU004';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'invalid name' using errcode = 'SU004';
  end if;
  if coalesce(cardinality(p_roles), 0) = 0 or cardinality(p_roles) > 6 then
    raise exception 'choose between one and six roles' using errcode = 'SU004';
  end if;
  foreach v_role in array p_roles loop
    perform public.assert_can_grant_role(v_role);
  end loop;
  if p_access_expires_at is not null and p_access_expires_at <= greatest(coalesce(p_access_starts_at, now()), now()) then
    raise exception 'access must end in the future, after it starts' using errcode = 'SU004';
  end if;
  grants := public.normalize_project_grants(p_projects);

  if exists (select 1 from public.team_members m where lower(m.email) = v_email) then
    raise exception 'this email already belongs to a team member' using errcode = 'SU008';
  end if;
  perform public.assert_invitation_budget(actor);

  update public.team_invitations i set status = 'EXPIRED'
  where lower(i.email) = v_email and i.status in ('PENDING', 'SENT') and i.expires_at <= now();

  select invitation_expiry_days into expiry_days from public.security_settings where key = 'global';
  insert into public.team_invitations (email, display_name, role_keys, projects, access_starts_at, access_expires_at, invited_by, expires_at)
  values (v_email, v_name, (select array_agg(distinct r) from unnest(p_roles) r), grants, p_access_starts_at, p_access_expires_at, actor,
    now() + make_interval(days => coalesce(expiry_days, 7)))
  returning * into invitation;

  return jsonb_build_object('invitation_id', invitation.id, 'email', invitation.email, 'expires_at', invitation.expires_at);
exception
  when unique_violation then
    raise exception 'an invitation for this email is already open' using errcode = 'SU008';
end;
$$;

-- Step 2, by the Edge Function with the service role, once Supabase Auth has
-- created the invited user: the member, their roles and projects. An auth
-- user that already has a password was not created by this invitation (a
-- sign-up from before, say), and whoever chose that password could use the
-- access, so it is refused for a person to check.
create or replace function public.complete_invitation(p_invitation uuid, p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  invitation public.team_invitations%rowtype;
  v_role text;
  grant_row jsonb;
  member public.team_members%rowtype;
begin
  if not public.is_trusted_backend() then
    raise exception 'only the service role completes invitations' using errcode = '42501';
  end if;
  select * into invitation from public.team_invitations where id = p_invitation for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'SU010';
  end if;
  if invitation.status <> 'PENDING' then
    raise exception 'invitation is %', invitation.status using errcode = 'SU008';
  end if;
  if invitation.expires_at <= now() then
    raise exception 'invitation expired' using errcode = 'SU011';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and lower(to_jsonb(u) ->> 'email') = invitation.email) then
    raise exception 'auth user not found for this invitation' using errcode = 'SU010';
  end if;
  if public.auth_user_has_password(p_user) then
    raise exception 'this email already has an account with a password; verify who owns it before granting access' using errcode = 'SU008';
  end if;

  insert into public.team_members (user_id, display_name, email, status, access_starts_at, access_expires_at, invited_by, invited_at, invite_expires_at)
  values (p_user, invitation.display_name, invitation.email, 'INVITED', invitation.access_starts_at, invitation.access_expires_at,
    invitation.invited_by, now(), invitation.expires_at)
  returning * into member;

  foreach v_role in array invitation.role_keys loop
    insert into public.user_roles (user_id, role_key, granted_by) values (p_user, v_role, invitation.invited_by);
  end loop;
  for grant_row in select value from jsonb_array_elements(invitation.projects) loop
    insert into public.project_members (user_id, project_id, access_level, granted_by, expires_at)
    values (p_user, (grant_row ->> 'project_id')::uuid, grant_row ->> 'access_level', invitation.invited_by,
      nullif(grant_row ->> 'expires_at', '')::timestamptz);
  end loop;

  update public.team_invitations set status = 'SENT', user_id = p_user, sent_at = now() where id = p_invitation;
  perform public.write_audit('USER_INVITED', 'team_member', p_user::text, p_user,
    jsonb_build_object('roles', invitation.role_keys, 'projects', jsonb_array_length(invitation.projects), 'ru', member.ru,
      'access_expires_at', invitation.access_expires_at),
    null, invitation.invited_by);
  return jsonb_build_object('user_id', p_user, 'ru', member.ru, 'status', member.status);
end;
$$;

create or replace function public.fail_invitation(p_invitation uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  inviter uuid;
begin
  if not public.is_trusted_backend() then
    raise exception 'only the service role fails invitations' using errcode = '42501';
  end if;
  update public.team_invitations set status = 'FAILED', failure_reason = left(coalesce(p_reason, 'unknown'), 500)
  where id = p_invitation and status = 'PENDING'
  returning invited_by into inviter;
  if inviter is not null then
    perform public.write_audit('INVITATION_FAILED', 'team_invitation', p_invitation::text, null,
      jsonb_build_object('reason', left(coalesce(p_reason, 'unknown'), 200)), null, inviter);
  end if;
end;
$$;

-- Before the Edge Function sends a new link to a member who has not accepted
-- yet (Supabase Auth re-sends an invitation to an unconfirmed user): gives the
-- invitation a new deadline and returns the address to send it to.
create or replace function public.prepare_invitation_resend(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  m public.team_members%rowtype;
  expiry_days integer;
  deadline timestamptz;
begin
  perform public.require_permission('team.invite');
  perform public.assert_can_manage(p_user);
  select * into m from public.team_members where user_id = p_user for update;
  if m.status <> 'INVITED' then
    raise exception 'member is %', m.status using errcode = 'SU008';
  end if;
  perform public.assert_invitation_budget(auth.uid());
  select invitation_expiry_days into expiry_days from public.security_settings where key = 'global';
  deadline := now() + make_interval(days => coalesce(expiry_days, 7));
  update public.team_members set invite_expires_at = deadline where user_id = p_user;
  update public.team_invitations set expires_at = deadline, sent_at = now() where user_id = p_user and status = 'SENT';
  perform public.write_audit('USER_INVITED', 'team_member', p_user::text, p_user, jsonb_build_object('resend', true, 'ru', m.ru));
  return jsonb_build_object('user_id', p_user, 'email', m.email, 'invite_expires_at', deadline);
end;
$$;

-- Cancels an open invitation; an invited member who never activated is
-- offboarded with it.
create or replace function public.cancel_invitation(p_invitation uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  invitation public.team_invitations%rowtype;
begin
  perform public.require_permission('team.invite');
  select * into invitation from public.team_invitations where id = p_invitation for update;
  if not found or invitation.status not in ('PENDING', 'SENT', 'FAILED') then
    raise exception 'invitation is not open' using errcode = 'SU008';
  end if;
  if invitation.user_id is not null then
    perform public.assert_can_manage(invitation.user_id);
  end if;
  update public.team_invitations set status = 'CANCELLED' where id = p_invitation;
  if invitation.user_id is not null and exists (select 1 from public.team_members where user_id = invitation.user_id and status = 'INVITED') then
    update public.team_members set status = 'OFFBOARDED', offboarded_at = now(), status_reason = 'invitation cancelled'
    where user_id = invitation.user_id;
    update public.user_roles set revoked_at = now(), revoked_by = auth.uid() where user_id = invitation.user_id and revoked_at is null;
    update public.project_members set revoked_at = now(), revoked_by = auth.uid() where user_id = invitation.user_id and revoked_at is null;
    perform public.end_member_sessions(invitation.user_id);
    perform public.set_auth_ban(invitation.user_id, true);
  end if;
  perform public.write_audit('INVITATION_CANCELLED', 'team_invitation', p_invitation::text, invitation.user_id,
    jsonb_build_object('email_domain', split_part(invitation.email, '@', 2)));
end;
$$;

-- Roles, projects, the access window and the display name of another member.
-- Every role added or removed is checked for escalation and audited.
create or replace function public.update_member_access(
  p_user uuid,
  p_roles text[],
  p_projects jsonb,
  p_access_expires_at timestamptz,
  p_display_name text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  m public.team_members%rowtype;
  current_roles text[];
  v_role text;
  grants jsonb;
  grant_row jsonb;
  existing public.project_members%rowtype;
  wanted uuid[];
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  perform public.require_permission('team.edit_access');
  perform public.assert_can_manage(p_user);
  select * into m from public.team_members where user_id = p_user for update;
  if m.status = 'OFFBOARDED' then
    raise exception 'an offboarded member cannot be changed' using errcode = 'SU008';
  end if;
  if coalesce(cardinality(p_roles), 0) = 0 or cardinality(p_roles) > 6 then
    raise exception 'choose between one and six roles' using errcode = 'SU004';
  end if;
  if p_access_expires_at is not null and p_access_expires_at <= now() and p_access_expires_at is distinct from m.access_expires_at then
    raise exception 'access must end in the future' using errcode = 'SU004';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'invalid name' using errcode = 'SU004';
  end if;

  select coalesce(array_agg(r), '{}') into current_roles from public.member_roles(p_user) r;

  foreach v_role in array current_roles loop
    if not v_role = any (p_roles) then
      perform public.assert_can_grant_role(v_role);
      update public.user_roles ur set revoked_at = now(), revoked_by = actor
      where ur.user_id = p_user and ur.role_key = v_role and ur.revoked_at is null;
      perform public.write_audit('ROLE_REMOVED', 'team_member', p_user::text, p_user, jsonb_build_object('role', v_role));
    end if;
  end loop;
  foreach v_role in array (select array_agg(distinct r) from unnest(p_roles) r) loop
    if not v_role = any (current_roles) then
      perform public.assert_can_grant_role(v_role);
      -- An expired grant of the same role is closed before the new one opens.
      update public.user_roles ur set revoked_at = now(), revoked_by = actor
      where ur.user_id = p_user and ur.role_key = v_role and ur.revoked_at is null;
      insert into public.user_roles (user_id, role_key, granted_by) values (p_user, v_role, actor);
      perform public.write_audit('ROLE_ASSIGNED', 'team_member', p_user::text, p_user, jsonb_build_object('role', v_role));
    end if;
  end loop;

  grants := public.normalize_project_grants(coalesce(p_projects, '[]'::jsonb));
  select coalesce(array_agg((g ->> 'project_id')::uuid), '{}') into wanted from jsonb_array_elements(grants) g;

  for existing in select * from public.project_members pm where pm.user_id = p_user and pm.revoked_at is null loop
    if not existing.project_id = any (wanted) or (existing.expires_at is not null and existing.expires_at <= now()) then
      update public.project_members set revoked_at = now(), revoked_by = actor where id = existing.id;
      if not existing.project_id = any (wanted) then
        perform public.write_audit('PROJECT_ACCESS_REVOKED', 'project', existing.project_id::text, p_user,
          jsonb_build_object('access_level', existing.access_level));
      end if;
    end if;
  end loop;
  for grant_row in select value from jsonb_array_elements(grants) loop
    select * into existing from public.project_members pm
    where pm.user_id = p_user and pm.project_id = (grant_row ->> 'project_id')::uuid and pm.revoked_at is null;
    if not found then
      insert into public.project_members (user_id, project_id, access_level, granted_by, expires_at)
      values (p_user, (grant_row ->> 'project_id')::uuid, grant_row ->> 'access_level', actor, nullif(grant_row ->> 'expires_at', '')::timestamptz);
      perform public.write_audit('PROJECT_ACCESS_GRANTED', 'project', grant_row ->> 'project_id', p_user,
        jsonb_build_object('access_level', grant_row ->> 'access_level', 'expires_at', grant_row -> 'expires_at'));
    elsif existing.access_level is distinct from grant_row ->> 'access_level'
      or existing.expires_at is distinct from nullif(grant_row ->> 'expires_at', '')::timestamptz then
      update public.project_members
      set access_level = grant_row ->> 'access_level', expires_at = nullif(grant_row ->> 'expires_at', '')::timestamptz
      where id = existing.id;
      perform public.write_audit('PROJECT_ACCESS_CHANGED', 'project', grant_row ->> 'project_id', p_user,
        jsonb_build_object('access_level', grant_row ->> 'access_level', 'expires_at', grant_row -> 'expires_at'));
    end if;
  end loop;

  if m.access_expires_at is distinct from p_access_expires_at or (v_name is not null and v_name is distinct from m.display_name) then
    update public.team_members
    set access_expires_at = p_access_expires_at, display_name = coalesce(v_name, display_name)
    where user_id = p_user;
    perform public.write_audit('ACCESS_UPDATED', 'team_member', p_user::text, p_user,
      jsonb_build_object('access_expires_at', p_access_expires_at, 'renamed', v_name is not null and v_name is distinct from m.display_name));
  end if;

  return jsonb_build_object('user_id', p_user, 'roles', (select coalesce(jsonb_agg(r), '[]'::jsonb) from public.member_roles(p_user) r));
end;
$$;

-- ACTIVE (or INVITED, or EXPIRED) -> SUSPENDED: no access at all, sessions
-- ended (tokens issued before now never authorize again, even after a
-- reactivation), sign-in banned, until reactivated.
create or replace function public.suspend_member(p_user uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  m public.team_members%rowtype;
  revoked integer;
  banned boolean;
begin
  perform public.require_permission('team.suspend');
  perform public.assert_can_manage(p_user);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required' using errcode = 'SU004';
  end if;
  select * into m from public.team_members where user_id = p_user for update;
  if m.status not in ('ACTIVE', 'INVITED', 'EXPIRED') then
    raise exception 'member is %', m.status using errcode = 'SU008';
  end if;
  update public.team_members set status = 'SUSPENDED', suspended_at = now(), status_reason = left(btrim(p_reason), 500) where user_id = p_user;
  revoked := public.end_member_sessions(p_user);
  banned := public.set_auth_ban(p_user, true);
  perform public.write_audit('USER_SUSPENDED', 'team_member', p_user::text, p_user,
    jsonb_build_object('reason', left(btrim(p_reason), 200), 'previous_status', public.member_effective_status(m), 'sign_in_banned', banned));
  perform public.write_audit('SESSION_REVOKED', 'team_member', p_user::text, p_user, jsonb_build_object('sessions', revoked, 'cause', 'suspension'));
  return jsonb_build_object('user_id', p_user, 'status', 'SUSPENDED', 'sessions_revoked', revoked, 'sign_in_banned', banned);
end;
$$;

-- SUSPENDED or EXPIRED -> ACTIVE. Once the access window has ended, the new
-- end date (or none, for permanent access) is the caller's explicit choice; a
-- suspension inside the window keeps its end date unless a new one is given.
-- The session cutoff is left where the suspension put it: the member signs in
-- again, and no token from before comes back.
create or replace function public.reactivate_member(p_user uuid, p_access_expires_at timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  m public.team_members%rowtype;
  ends_at timestamptz;
  unbanned boolean;
begin
  perform public.require_permission('team.suspend');
  perform public.assert_can_manage(p_user);
  select * into m from public.team_members where user_id = p_user for update;
  if public.member_effective_status(m) not in ('SUSPENDED', 'EXPIRED') then
    raise exception 'member is %', public.member_effective_status(m) using errcode = 'SU008';
  end if;
  if p_access_expires_at is not null and p_access_expires_at <= now() then
    raise exception 'access must end in the future' using errcode = 'SU004';
  end if;
  ends_at := case
    when m.access_expires_at is not null and m.access_expires_at <= now() then p_access_expires_at
    else coalesce(p_access_expires_at, m.access_expires_at)
  end;
  update public.team_members
  set status = 'ACTIVE', status_reason = null, suspended_at = null, access_expires_at = ends_at,
      activated_at = coalesce(activated_at, now())
  where user_id = p_user;
  unbanned := public.set_auth_ban(p_user, false);
  perform public.write_audit('USER_REACTIVATED', 'team_member', p_user::text, p_user,
    jsonb_build_object('previous_status', public.member_effective_status(m), 'access_expires_at', ends_at, 'sign_in_unbanned', unbanned));
  return jsonb_build_object('user_id', p_user, 'status', 'ACTIVE', 'access_expires_at', ends_at);
end;
$$;

-- Anything but OFFBOARDED -> OFFBOARDED, for good. Roles and projects are
-- revoked, open requests cancelled, sessions revoked, sign-in banned. The
-- member row, RU, authorship and audit trail stay.
create or replace function public.offboard_member(p_user uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  m public.team_members%rowtype;
  revoked integer;
  cancelled integer;
  banned boolean;
begin
  perform public.require_permission('team.offboard');
  perform public.assert_can_manage(p_user);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required' using errcode = 'SU004';
  end if;
  select * into m from public.team_members where user_id = p_user for update;
  if m.status = 'OFFBOARDED' then
    raise exception 'member is already offboarded' using errcode = 'SU008';
  end if;
  update public.team_members set status = 'OFFBOARDED', offboarded_at = now(), status_reason = left(btrim(p_reason), 500) where user_id = p_user;
  update public.user_roles set revoked_at = now(), revoked_by = actor where user_id = p_user and revoked_at is null;
  update public.project_members set revoked_at = now(), revoked_by = actor where user_id = p_user and revoked_at is null;
  update public.change_requests set status = 'CANCELLED', review_message = 'requester offboarded', updated_at = now()
  where requester_id = p_user and status in ('DRAFT', 'PENDING');
  get diagnostics cancelled = row_count;
  update public.team_invitations set status = 'CANCELLED' where user_id = p_user and status in ('PENDING', 'SENT');
  revoked := public.end_member_sessions(p_user);
  banned := public.set_auth_ban(p_user, true);
  perform public.write_audit('USER_OFFBOARDED', 'team_member', p_user::text, p_user,
    jsonb_build_object('reason', left(btrim(p_reason), 200), 'previous_status', public.member_effective_status(m),
      'requests_cancelled', cancelled, 'sign_in_banned', banned));
  perform public.write_audit('SESSION_REVOKED', 'team_member', p_user::text, p_user, jsonb_build_object('sessions', revoked, 'cause', 'offboarding'));
  return jsonb_build_object('user_id', p_user, 'status', 'OFFBOARDED', 'sessions_revoked', revoked, 'requests_cancelled', cancelled,
    'sign_in_banned', banned);
end;
$$;

create or replace function public.revoke_member_sessions(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  revoked integer;
begin
  perform public.require_permission('sessions.revoke');
  perform public.assert_can_manage(p_user);
  revoked := public.end_member_sessions(p_user);
  perform public.write_audit('SESSION_REVOKED', 'team_member', p_user::text, p_user, jsonb_build_object('sessions', revoked, 'cause', 'manual'));
  return jsonb_build_object('user_id', p_user, 'sessions_revoked', revoked);
end;
$$;

-- Marks ACTIVE members past their access window as EXPIRED and pending
-- requests past their deadline as EXPIRED. Harmless to run at any time (a
-- scheduled job, or the Admin opening the Team module); authorization already
-- treats both as expired before this runs.
create or replace function public.expire_stale_access()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  member_row record;
  request_row record;
  members integer := 0;
  requests integer := 0;
begin
  if not public.is_trusted_backend() and not public.current_member_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for member_row in
    update public.team_members set status = 'EXPIRED'
    where status = 'ACTIVE' and access_expires_at is not null and access_expires_at <= now()
    returning user_id
  loop
    members := members + 1;
    perform public.write_audit('USER_EXPIRED', 'team_member', member_row.user_id::text, member_row.user_id, '{}'::jsonb, null, null);
  end loop;
  for request_row in
    update public.change_requests set status = 'EXPIRED', updated_at = now()
    where status = 'PENDING' and expires_at is not null and expires_at <= now()
    returning id, requester_id, resource_id
  loop
    requests := requests + 1;
    perform public.write_audit('APPROVAL_EXPIRED', 'project', request_row.resource_id::text, request_row.requester_id, '{}'::jsonb, request_row.id, null);
  end loop;
  return jsonb_build_object('members', members, 'requests', requests);
end;
$$;

-- Adds or removes one permission from one role. CRITICAL: step-up. The
-- ABSOLUTE_ADMIN role always holds everything, so it cannot be edited.
create or replace function public.set_role_permission(p_role text, p_permission text, p_granted boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_permission('permissions.manage');
  if p_role = 'ABSOLUTE_ADMIN' then
    raise exception 'ABSOLUTE_ADMIN always holds every permission' using errcode = 'SU009';
  end if;
  if not exists (select 1 from public.roles where key = p_role) or not exists (select 1 from public.permissions where key = p_permission) then
    raise exception 'unknown role or permission' using errcode = 'SU010';
  end if;
  if p_granted then
    insert into public.role_permissions (role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
  else
    delete from public.role_permissions where role_key = p_role and permission_key = p_permission;
  end if;
  perform public.write_audit('PERMISSION_CHANGED', 'role', p_role, null, jsonb_build_object('permission', p_permission, 'granted', p_granted));
end;
$$;

create or replace function public.update_security_settings(
  p_step_up_max_age_seconds integer,
  p_approval_expiry_days integer,
  p_invitation_expiry_days integer,
  p_invitations_per_hour integer
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  before_row public.security_settings%rowtype;
begin
  perform public.require_permission('critical_settings.manage');
  select * into before_row from public.security_settings where key = 'global' for update;
  update public.security_settings
  set step_up_max_age_seconds = p_step_up_max_age_seconds,
      approval_expiry_days = p_approval_expiry_days,
      invitation_expiry_days = p_invitation_expiry_days,
      invitations_per_hour = p_invitations_per_hour,
      updated_at = now(),
      updated_by = auth.uid()
  where key = 'global';
  perform public.write_audit('SECURITY_SETTING_CHANGED', 'security_settings', 'global', null,
    jsonb_build_object(
      'step_up_max_age_seconds', jsonb_build_object('old', before_row.step_up_max_age_seconds, 'new', p_step_up_max_age_seconds),
      'approval_expiry_days', jsonb_build_object('old', before_row.approval_expiry_days, 'new', p_approval_expiry_days),
      'invitation_expiry_days', jsonb_build_object('old', before_row.invitation_expiry_days, 'new', p_invitation_expiry_days),
      'invitations_per_hour', jsonb_build_object('old', before_row.invitations_per_hour, 'new', p_invitations_per_hour)));
end;
$$;

-- Break-glass bootstrap, run in the SQL editor only: grants a role to an
-- existing Supabase Auth user (creating their member row if needed). Refused
-- for any request with a JWT, so it can never be reached through the API; it
-- exists for the first privileged account and for recovery, not for daily use.
create or replace function public.bootstrap_member(p_email text, p_role text default 'OWNER', p_display_name text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
  target_email text;
  member public.team_members%rowtype;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
    or nullif(current_setting('request.jwt.claim.sub', true), '') is not null
    or nullif(current_setting('request.jwt.claim.role', true), '') is not null then
    raise exception 'bootstrap_member runs only in the SQL editor' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles where key = p_role) then
    raise exception 'unknown role %', p_role using errcode = 'SU010';
  end if;
  select u.id, to_jsonb(u) ->> 'email' into target, target_email
  from auth.users u where lower(to_jsonb(u) ->> 'email') = lower(btrim(p_email));
  if target is null then
    raise exception 'no Supabase Auth user with email %; create or invite the user first', p_email using errcode = 'SU010';
  end if;

  insert into public.team_members (user_id, display_name, email, status, activated_at)
  values (target, left(coalesce(nullif(btrim(p_display_name), ''), split_part(target_email, '@', 1)), 120), lower(target_email), 'ACTIVE', now())
  on conflict (user_id) do nothing;
  select * into member from public.team_members where user_id = target;
  if member.status = 'OFFBOARDED' then
    raise exception 'member is offboarded' using errcode = 'SU008';
  end if;
  if not exists (select 1 from public.member_roles(target) held where held = p_role) then
    update public.user_roles ur set revoked_at = now() where ur.user_id = target and ur.role_key = p_role and ur.revoked_at is null;
    insert into public.user_roles (user_id, role_key, granted_by) values (target, p_role, null);
  end if;
  perform public.write_audit('BOOTSTRAP_GRANT', 'team_member', target::text, target, jsonb_build_object('role', p_role, 'ru', member.ru), null, null);
  return jsonb_build_object('user_id', target, 'ru', member.ru, 'role', p_role, 'status', member.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. drafts and approvals (projects)
-- ---------------------------------------------------------------------------

-- Server-side validation of proposed project fields: only the allowed columns
-- (catalog.js DRAFT_FIELDS), each with its type and bounds. Anything else is
-- refused, never stored or executed.
create or replace function public.validate_project_draft(p_project uuid, p_fields jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  allowed text[] := array[
    'name', 'client', 'category', 'description', 'status', 'year', 'accent', 'tech_stack', 'poster_url',
    'project_url', 'presentation_system', 'presentation_label', 'presentation_address', 'presentation_type',
    'origin', 'coordinates', 'translations'
  ];
  field text;
  value jsonb;
  kind text;
  text_value text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'fields must be an object' using errcode = 'SU004';
  end if;
  for field, value in select key, v from jsonb_each(p_fields) as e(key, v) loop
    if not field = any (allowed) then
      raise exception 'field % cannot be changed by a draft', field using errcode = 'SU004';
    end if;
    kind := jsonb_typeof(value);
    if field in ('tech_stack', 'coordinates') then
      if kind <> 'array' or jsonb_array_length(value) > 30
        or exists (select 1 from jsonb_array_elements(value) item where jsonb_typeof(item) <> 'string' or length(item #>> '{}') > 80) then
        raise exception '% must be a list of at most 30 short texts', field using errcode = 'SU004';
      end if;
    elsif field = 'translations' then
      if kind <> 'object' or not public.valid_i18n_translations(value) then
        raise exception 'translations are invalid' using errcode = 'SU004';
      end if;
    elsif field = 'year' then
      if kind = 'null' then
        continue;
      end if;
      if kind <> 'number' or (value #>> '{}') !~ '^[0-9]{4}$' or (value #>> '{}')::integer not between 1990 and 2100 then
        raise exception 'year must be between 1990 and 2100' using errcode = 'SU004';
      end if;
    else
      if kind = 'null' then
        if field in ('name', 'category', 'status') then
          raise exception '% cannot be empty', field using errcode = 'SU004';
        end if;
        continue;
      end if;
      if kind <> 'string' then
        raise exception '% must be text', field using errcode = 'SU004';
      end if;
      text_value := value #>> '{}';
      if length(text_value) > (case when field = 'description' then 8000 else 500 end) then
        raise exception '% is too long', field using errcode = 'SU004';
      end if;
      if field = 'name' and btrim(text_value) = '' then
        raise exception 'name cannot be empty' using errcode = 'SU004';
      end if;
      if field = 'category' and text_value not in ('Website', 'System', 'Automation', 'AI', 'Other') then
        raise exception 'invalid category' using errcode = 'SU004';
      end if;
      if field = 'status' and text_value not in ('Live', 'Prototype', 'MVP', 'Pilot', 'In Development', 'Research', 'Archived') then
        raise exception 'invalid project status' using errcode = 'SU004';
      end if;
      if field = 'accent' and text_value <> '' and text_value !~* '^#([0-9a-f]{3}|[0-9a-f]{6})$' then
        raise exception 'accent must be a hex colour' using errcode = 'SU004';
      end if;
      if field = 'project_url' and text_value <> '' and text_value !~* '^https?://[^\s]+$' then
        raise exception 'project_url must be an http(s) address' using errcode = 'SU004';
      end if;
      -- A draft may point at an image in its own project's folder, or at an
      -- https address; never at another project's media.
      if field = 'poster_url' and text_value <> ''
        and text_value !~* '^https://[^\s]+$'
        and text_value !~ ('^projects/' || p_project::text || '/(poster|gallery)/[A-Za-z0-9._-]+$') then
        raise exception 'poster must be an image of this project' using errcode = 'SU004';
      end if;
    end if;
  end loop;
  return p_fields;
end;
$$;

-- The risk of a request: publishing, or changing something already public,
-- is MEDIUM; changing an unpublished project is LOW.
create or replace function public.change_request_risk(p_project uuid, p_publish boolean)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_publish then 'MEDIUM'
    when exists (select 1 from public.projects where id = p_project and editorial_status = 'PUBLISHED') then 'MEDIUM'
    else 'LOW'
  end;
$$;

-- Creates or updates the caller's draft for a project. Saving a draft changes
-- nothing live and does not ask anyone for anything; base_version is fixed
-- when the draft is created, so a later change to the project is caught as a
-- conflict at approval.
create or replace function public.save_project_draft(
  p_project uuid,
  p_fields jsonb,
  p_publish boolean default false,
  p_message text default null
)
returns public.change_requests
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  current_project public.projects%rowtype;
  existing public.change_requests%rowtype;
  saved public.change_requests%rowtype;
  fields jsonb;
begin
  perform public.require_permission('projects.draft');
  perform public.require_permission('approvals.request');
  if not public.has_project_access(p_project, true) then
    raise exception 'no draft access to this project' using errcode = '42501';
  end if;
  select * into current_project from public.projects where id = p_project;
  if not found then
    raise exception 'project not found' using errcode = 'SU010';
  end if;
  fields := public.validate_project_draft(p_project, coalesce(p_fields, '{}'::jsonb));
  if fields = '{}'::jsonb and not coalesce(p_publish, false) then
    raise exception 'a draft needs at least one change' using errcode = 'SU004';
  end if;
  if length(coalesce(p_message, '')) > 2000 then
    raise exception 'message is too long' using errcode = 'SU004';
  end if;

  select * into existing from public.change_requests
  where requester_id = uid and resource_type = 'project' and resource_id = p_project and status in ('DRAFT', 'PENDING')
  for update;

  if found and existing.status = 'PENDING' then
    raise exception 'this draft is waiting for review; cancel it to edit again' using errcode = 'SU003';
  end if;

  if found then
    update public.change_requests
    set proposed = fields,
        action = case when coalesce(p_publish, false) then 'project.publish' else 'project.update' end,
        risk_level = public.change_request_risk(p_project, coalesce(p_publish, false)),
        request_message = nullif(btrim(coalesce(p_message, '')), ''),
        updated_at = now()
    where id = existing.id
    returning * into saved;
  else
    insert into public.change_requests (requester_id, resource_type, resource_id, action, proposed, base_version, risk_level, request_message)
    values (uid, 'project', p_project, case when coalesce(p_publish, false) then 'project.publish' else 'project.update' end,
      fields, current_project.version, public.change_request_risk(p_project, coalesce(p_publish, false)), nullif(btrim(coalesce(p_message, '')), ''))
    returning * into saved;
    perform public.write_audit('APPROVAL_DRAFTED', 'project', p_project::text, null, jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(fields) k)), saved.id);
  end if;
  return saved;
exception
  when unique_violation then
    -- Two saves raced to create the same draft; the other one won.
    raise exception 'this draft was just created elsewhere; reload it' using errcode = 'SU003';
end;
$$;

-- DRAFT -> PENDING, by the requester.
create or replace function public.submit_change_request(p_request uuid, p_message text default null)
returns public.change_requests
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  request public.change_requests%rowtype;
  expiry integer;
begin
  perform public.require_permission('approvals.request');
  select * into request from public.change_requests where id = p_request for update;
  if not found or request.requester_id <> uid then
    raise exception 'request not found' using errcode = 'SU010';
  end if;
  if request.status <> 'DRAFT' then
    raise exception 'request is %', request.status using errcode = 'SU003';
  end if;
  if not public.has_project_access(request.resource_id, true) then
    raise exception 'no draft access to this project' using errcode = '42501';
  end if;
  perform public.validate_project_draft(request.resource_id, request.proposed);
  select approval_expiry_days into expiry from public.security_settings where key = 'global';
  update public.change_requests
  set status = 'PENDING',
      submitted_at = now(),
      expires_at = now() + make_interval(days => coalesce(expiry, 14)),
      risk_level = public.change_request_risk(request.resource_id, request.action = 'project.publish'),
      request_message = coalesce(nullif(btrim(coalesce(p_message, '')), ''), request_message),
      updated_at = now()
  where id = p_request
  returning * into request;
  perform public.write_audit('APPROVAL_REQUESTED', 'project', request.resource_id::text, null,
    jsonb_build_object('number', request.number, 'action', request.action, 'risk', request.risk_level, 'base_version', request.base_version), request.id);
  return request;
end;
$$;

-- DRAFT or PENDING -> CANCELLED, by the requester.
create or replace function public.cancel_change_request(p_request uuid)
returns public.change_requests
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  request public.change_requests%rowtype;
begin
  select * into request from public.change_requests where id = p_request for update;
  if not found or request.requester_id <> auth.uid() or not public.current_member_active() then
    raise exception 'request not found' using errcode = 'SU010';
  end if;
  if request.status not in ('DRAFT', 'PENDING') then
    raise exception 'request is %', request.status using errcode = 'SU003';
  end if;
  update public.change_requests set status = 'CANCELLED', updated_at = now() where id = p_request returning * into request;
  perform public.write_audit('APPROVAL_CANCELLED', 'project', request.resource_id::text, null, jsonb_build_object('number', request.number), request.id);
  return request;
end;
$$;

-- After a conflict: the requester reviews the draft against the current
-- project and re-bases it. Back to DRAFT, to be submitted again on purpose.
create or replace function public.rebase_change_request(p_request uuid)
returns public.change_requests
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  request public.change_requests%rowtype;
  current_version integer;
begin
  perform public.require_permission('projects.draft');
  select * into request from public.change_requests where id = p_request for update;
  if not found or request.requester_id <> auth.uid() then
    raise exception 'request not found' using errcode = 'SU010';
  end if;
  if request.status not in ('DRAFT', 'PENDING') then
    raise exception 'request is %', request.status using errcode = 'SU003';
  end if;
  if not public.has_project_access(request.resource_id, true) then
    raise exception 'no draft access to this project' using errcode = '42501';
  end if;
  select version into current_version from public.projects where id = request.resource_id;
  if current_version is null then
    raise exception 'project not found' using errcode = 'SU010';
  end if;
  update public.change_requests
  set base_version = current_version, status = 'DRAFT', submitted_at = null, expires_at = null, updated_at = now()
  where id = p_request
  returning * into request;
  perform public.write_audit('APPROVAL_REBASED', 'project', request.resource_id::text, null, jsonb_build_object('number', request.number, 'base_version', current_version), request.id);
  return request;
end;
$$;

-- PENDING -> APPROVED, applying the change, all in one transaction:
--   1. the reviewer is an active member with approvals.approve and the
--      permission the change needs (projects.edit, plus projects.publish to
--      publish), with MFA for their risk;
--   2. the request is PENDING (APPROVED again is a safe no-op), not expired,
--      and its requester is still ACTIVE;
--   3. nobody approves their own request;
--   4. the project is locked and still at base_version, else SU001 conflict;
--   5. only validated, allowed fields are written; the version moves on;
--   6. the request records who, when, what changed (old -> new) and the new
--      version, and the audit log records the approval.
create or replace function public.approve_change_request(p_request uuid, p_comment text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  request public.change_requests%rowtype;
  current_project public.projects%rowtype;
  merged public.projects%rowtype;
  changes jsonb := '{}'::jsonb;
  field text;
  new_version integer;
begin
  perform public.require_permission('approvals.approve');
  select * into request from public.change_requests where id = p_request for update;
  if not found then
    raise exception 'request not found' using errcode = 'SU010';
  end if;
  -- Double click, retry, a second reviewer: the first approval already
  -- applied the change, and nothing is applied twice.
  if request.status = 'APPROVED' then
    return jsonb_build_object('status', 'APPROVED', 'already_applied', true, 'applied_version', request.applied_version);
  end if;

  perform public.require_permission('projects.edit');
  if request.action = 'project.publish' then
    perform public.require_permission('projects.publish');
  end if;
  if request.risk_level = 'CRITICAL' and not public.step_up_satisfied() then
    raise exception 'approving a critical change needs a recent MFA verification' using errcode = 'SU005';
  end if;

  if request.status <> 'PENDING' then
    raise exception 'request is %', request.status using errcode = 'SU003';
  end if;
  if request.expires_at is not null and request.expires_at <= now() then
    raise exception 'request expired' using errcode = 'SU011';
  end if;
  if request.requester_id = uid then
    raise exception 'you cannot approve your own request' using errcode = 'SU002';
  end if;
  if not public.member_is_active(request.requester_id) then
    raise exception 'the requester is no longer active' using errcode = 'SU012';
  end if;
  if btrim(coalesce(p_comment, '')) = '' and request.risk_level in ('HIGH', 'CRITICAL') then
    raise exception 'approving a % risk change needs a comment', request.risk_level using errcode = 'SU004';
  end if;

  select * into current_project from public.projects where id = request.resource_id for update;
  if not found then
    raise exception 'project not found' using errcode = 'SU010';
  end if;
  if current_project.version <> request.base_version then
    raise exception 'the project changed since this draft was made (draft version %, current %)', request.base_version, current_project.version
      using errcode = 'SU001';
  end if;

  perform public.validate_project_draft(request.resource_id, request.proposed);
  merged := jsonb_populate_record(current_project, request.proposed);

  for field in select key from jsonb_object_keys(request.proposed) as key loop
    if to_jsonb(current_project) -> field is distinct from request.proposed -> field then
      changes := changes || jsonb_build_object(field, jsonb_build_object('old', to_jsonb(current_project) -> field, 'new', request.proposed -> field));
    end if;
  end loop;

  perform set_config('app.change_request_id', request.id::text, true);
  update public.projects
  set name = merged.name,
      client = merged.client,
      category = merged.category,
      description = merged.description,
      status = merged.status,
      year = merged.year,
      accent = merged.accent,
      tech_stack = merged.tech_stack,
      poster_url = merged.poster_url,
      project_url = merged.project_url,
      presentation_system = merged.presentation_system,
      presentation_label = merged.presentation_label,
      presentation_address = merged.presentation_address,
      presentation_type = merged.presentation_type,
      origin = merged.origin,
      coordinates = merged.coordinates,
      translations = merged.translations,
      editorial_status = case when request.action = 'project.publish' then 'PUBLISHED' else editorial_status end,
      visible = case when request.action = 'project.publish' then true else visible end
  where id = request.resource_id
  returning version into new_version;
  perform set_config('app.change_request_id', '', true);

  if request.action = 'project.publish' and current_project.editorial_status <> 'PUBLISHED' then
    changes := changes || jsonb_build_object('editorial_status', jsonb_build_object('old', current_project.editorial_status, 'new', 'PUBLISHED'));
  end if;

  update public.change_requests
  set status = 'APPROVED',
      reviewer_id = uid,
      reviewed_at = now(),
      review_message = nullif(btrim(coalesce(p_comment, '')), ''),
      applied_changes = changes,
      applied_version = new_version,
      updated_at = now()
  where id = p_request;

  perform public.write_audit('APPROVAL_APPROVED', 'project', request.resource_id::text, request.requester_id,
    jsonb_build_object('number', request.number, 'action', request.action, 'risk', request.risk_level,
      'base_version', request.base_version, 'applied_version', new_version,
      'fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(changes) k)),
    request.id);

  return jsonb_build_object('status', 'APPROVED', 'already_applied', false, 'applied_version', new_version, 'changes', changes);
end;
$$;

-- PENDING -> REJECTED, with a reason. Nothing changes on the project.
create or replace function public.reject_change_request(p_request uuid, p_reason text)
returns public.change_requests
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  request public.change_requests%rowtype;
begin
  perform public.require_permission('approvals.reject');
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'rejecting needs a reason' using errcode = 'SU004';
  end if;
  select * into request from public.change_requests where id = p_request for update;
  if not found then
    raise exception 'request not found' using errcode = 'SU010';
  end if;
  if request.status <> 'PENDING' then
    raise exception 'request is %', request.status using errcode = 'SU003';
  end if;
  if request.requester_id = uid then
    raise exception 'you cannot review your own request' using errcode = 'SU002';
  end if;
  if request.risk_level = 'CRITICAL' and not public.step_up_satisfied() then
    raise exception 'reviewing a critical change needs a recent MFA verification' using errcode = 'SU005';
  end if;
  update public.change_requests
  set status = 'REJECTED', reviewer_id = uid, reviewed_at = now(), review_message = left(btrim(p_reason), 2000), updated_at = now()
  where id = p_request
  returning * into request;
  perform public.write_audit('APPROVAL_REJECTED', 'project', request.resource_id::text, request.requester_id,
    jsonb_build_object('number', request.number, 'reason', left(btrim(p_reason), 200)), request.id);
  return request;
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. privileges on the new functions and sequences
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase adds
-- anon, authenticated and service_role through default privileges. So every
-- function created here starts with no grant at all, and only what the API
-- has to reach is granted back. That includes the two redefined ones:
-- is_admin() has no caller left, and next_client_code() is reached only
-- through the clients_assign_code trigger.

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = any (array[
        'next_member_ru', 'guard_team_member_identity', 'refuse_audit_changes',
        'is_admin', 'next_client_code', 'assign_client_code', 'caller_token_current', 'end_member_sessions',
        'revoke_my_sessions',
        'is_trusted_backend', 'request_claims', 'jwt_aal', 'step_up_satisfied', 'user_has_verified_factor',
        'member_row_active', 'member_effective_status', 'member_is_active', 'current_member_active',
        'member_roles', 'member_max_rank', 'member_requires_mfa', 'mfa_gate', 'role_grants_permission',
        'has_permission', 'require_permission', 'is_project_member', 'has_project_access', 'write_audit',
        'guard_project_change', 'audit_project_change', 'guard_client_archive', 'guard_site_settings',
        'stamp_activity_author', 'refuse_legacy_admin_write', 'revoke_auth_sessions', 'set_auth_ban',
        'my_access', 'member_directory', 'auth_user_has_password', 'activate_my_membership', 'record_sign_in',
        'record_mfa_state', 'is_administrative_role', 'assert_can_manage', 'assert_can_grant_role',
        'normalize_project_grants', 'assert_invitation_budget', 'prepare_invitation', 'complete_invitation',
        'fail_invitation', 'prepare_invitation_resend', 'cancel_invitation', 'update_member_access',
        'suspend_member', 'reactivate_member', 'offboard_member', 'revoke_member_sessions', 'expire_stale_access',
        'set_role_permission', 'update_security_settings', 'bootstrap_member', 'validate_project_draft',
        'change_request_risk', 'save_project_draft', 'submit_change_request', 'cancel_change_request',
        'rebase_change_request', 'approve_change_request', 'reject_change_request'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end $$;

-- Checked inside policies, as the signed-in caller.
grant execute on function
  public.is_trusted_backend(), public.request_claims(), public.jwt_aal(), public.step_up_satisfied(),
  public.caller_token_current(), public.current_member_active(), public.has_permission(text), public.require_permission(text),
  public.is_project_member(uuid, boolean), public.has_project_access(uuid, boolean)
  to authenticated, service_role;

-- What the Admin calls. Each one authorizes the caller itself.
grant execute on function
  public.my_access(), public.member_directory(uuid[]), public.activate_my_membership(),
  public.record_sign_in(), public.record_mfa_state(), public.revoke_my_sessions(),
  public.prepare_invitation(text, text, text[], jsonb, timestamptz, timestamptz),
  public.prepare_invitation_resend(uuid), public.cancel_invitation(uuid),
  public.update_member_access(uuid, text[], jsonb, timestamptz, text), public.suspend_member(uuid, text),
  public.reactivate_member(uuid, timestamptz), public.offboard_member(uuid, text), public.revoke_member_sessions(uuid),
  public.expire_stale_access(), public.set_role_permission(text, text, boolean),
  public.update_security_settings(integer, integer, integer, integer),
  public.save_project_draft(uuid, jsonb, boolean, text), public.submit_change_request(uuid, text),
  public.cancel_change_request(uuid), public.rebase_change_request(uuid),
  public.approve_change_request(uuid, text), public.reject_change_request(uuid, text)
  to authenticated;

-- The invitation steps only the team-invite Edge Function performs, and the
-- expiry sweep for a scheduled job.
grant execute on function
  public.complete_invitation(uuid, uuid), public.fail_invitation(uuid, text), public.expire_stale_access()
  to service_role;

-- The client code sequence is used only by the generator, which runs as its
-- owner; the service role no longer needs it either.
revoke all on sequence public.clients_code_seq from public, anon, authenticated, service_role;

-- Functions from earlier migrations that the Security Advisor flags for a
-- mutable search_path. Their bodies only call built-ins or schema-qualified
-- functions (storage.foldername), so pinning the path changes nothing they
-- do; it only stops an object earlier in a caller's path from shadowing one.
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.stamp_published_at() set search_path = public, pg_temp;
alter function public.media_project_id(text) set search_path = public, pg_temp;
alter function public.valid_i18n_translations(jsonb) set search_path = public, pg_temp;
alter function public.stamp_client_archived_at() set search_path = public, pg_temp;
alter function public.stamp_financial_paid_at() set search_path = public, pg_temp;
alter function public.stamp_commercial_opportunity_stage() set search_path = public, pg_temp;

-- Identity columns draw from sequences that default privileges also hand to
-- every API role; nobody but the definer functions needs them.
do $$
declare
  seq text;
begin
  for seq in
    select pg_get_serial_sequence(format('public.%I', t.table_name), t.column_name)
    from (values ('user_roles', 'id'), ('project_members', 'id'), ('change_requests', 'number'), ('security_audit_log', 'id')) as t(table_name, column_name)
  loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', seq);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 18. bootstrap: today's admins become OWNER
-- ---------------------------------------------------------------------------
-- Every row of public.admins has full access today, whatever its role column
-- says, so each one becomes OWNER: nobody loses their role by applying this.
-- There is no grace period: like every privileged member, they enable MFA at
-- their first sign-in (the Admin shows the enrolment screen; enrolling needs
-- no permission) and hold nothing until they do. Review and narrow the roles
-- afterwards in the Team module. Nobody becomes ABSOLUTE_ADMIN here.

do $$
declare
  legacy record;
  member_ru text;
begin
  for legacy in
    select a.user_id, a.role as legacy_role, a.created_at,
           to_jsonb(u) ->> 'email' as email,
           coalesce(nullif(to_jsonb(u) -> 'raw_user_meta_data' ->> 'full_name', ''), nullif(to_jsonb(u) -> 'raw_user_meta_data' ->> 'name', '')) as full_name
    from public.admins a
    join auth.users u on u.id = a.user_id
    where not exists (select 1 from public.team_members m where m.user_id = a.user_id)
    order by a.created_at, a.user_id
  loop
    insert into public.team_members (user_id, display_name, email, status, activated_at, created_at)
    values (
      legacy.user_id,
      left(coalesce(legacy.full_name, split_part(coalesce(legacy.email, 'admin@unknown'), '@', 1)), 120),
      lower(coalesce(legacy.email, legacy.user_id::text || '@unknown.invalid')),
      'ACTIVE',
      now(),
      legacy.created_at
    )
    returning ru into member_ru;
    insert into public.user_roles (user_id, role_key, granted_by) values (legacy.user_id, 'OWNER', null);
    perform public.write_audit('BOOTSTRAP_GRANT', 'team_member', legacy.user_id::text, legacy.user_id,
      jsonb_build_object('role', 'OWNER', 'ru', member_ru, 'source', 'public.admins', 'legacy_role', legacy.legacy_role), null, null);
  end loop;
end $$;

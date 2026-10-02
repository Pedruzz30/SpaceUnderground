// What the security repositories send to Supabase, against a fake client that
// records every call: the RPC names and argument names the migration
// defines, the team-invite Edge Function's body and error shapes, and the
// filters on reads (never a raw id into a PostgREST expression).
//
//   npm test

import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

const { setSupabaseClientForTests } = await import("../src/lib/supabase.js");
const { supabaseAccessRepository } = await import("../src/services/repositories/supabase-access-repository.js");
const { supabaseTeamRepository } = await import("../src/services/repositories/supabase-team-repository.js");
const { supabaseApprovalRepository } = await import("../src/services/repositories/supabase-approval-repository.js");
const { supabaseAuditRepository } = await import("../src/services/repositories/supabase-audit-repository.js");

const MEMBER = "a0000000-0000-4000-8000-000000000001";

// responses: { rpc: { name: result }, tables: { table: rows }, invoke: result }
function fakeClient(responses = {}) {
  const calls = [];
  const from = (table) => {
    const request = { table, filters: [], head: false };
    const query = {
      select(columns, options) {
        request.columns = columns;
        request.head = Boolean(options?.head);
        return query;
      },
      eq: (column, value) => (request.filters.push(["eq", column, value]), query),
      in: (column, values) => (request.filters.push(["in", column, values]), query),
      is: (column, value) => (request.filters.push(["is", column, value]), query),
      or: (expression) => (request.filters.push(["or", expression]), query),
      lt: (column, value) => (request.filters.push(["lt", column, value]), query),
      order: () => query,
      limit: (value) => ((request.limit = value), query),
      maybeSingle: () => {
        request.single = true;
        return query;
      },
      then(resolve, reject) {
        calls.push({ kind: "from", ...request });
        const rows = responses.tables?.[table] ?? [];
        const data = request.single ? rows[0] ?? null : rows;
        return Promise.resolve({ data: request.head ? null : data, error: null, count: request.head ? rows.length : null }).then(resolve, reject);
      },
    };
    return query;
  };
  const client = {
    from,
    rpc: async (name, args) => {
      calls.push({ kind: "rpc", name, args });
      return responses.rpc?.[name] ?? { data: null, error: null };
    },
    auth: {
      mfa: {
        unenroll: async ({ factorId }) => {
          calls.push({ kind: "auth", name: "mfa.unenroll", factorId });
          return responses.auth?.unenroll ?? { data: {}, error: null };
        },
      },
      refreshSession: async () => {
        calls.push({ kind: "auth", name: "refreshSession" });
        return responses.auth?.refreshSession ?? { data: {}, error: null };
      },
    },
    functions: {
      invoke: async (name, options) => {
        calls.push({ kind: "invoke", name, body: options?.body });
        return responses.invoke ?? { data: {}, error: null };
      },
    },
  };
  return { client, calls };
}

afterEach(() => setSupabaseClientForTests(null));

describe("access repository", () => {
  it("reads the member's access from my_access()", async () => {
    const fake = fakeClient({ rpc: { my_access: { data: { member: { user_id: MEMBER } }, error: null } } });
    setSupabaseClientForTests(fake.client);
    assert.deepEqual(await supabaseAccessRepository.myAccess(), { member: { user_id: MEMBER } });
  });

  it("recognises a database without the security migration", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function" }, { code: "42883" }]) {
      setSupabaseClientForTests(fakeClient({ rpc: { my_access: { data: null, error } } }).client);
      assert.deepEqual(await supabaseAccessRepository.myAccess(), { legacy: true });
    }
  });

  it("reports any other refusal instead of guessing", async () => {
    setSupabaseClientForTests(fakeClient({ rpc: { my_access: { data: null, error: { code: "42501" } } } }).client);
    await assert.rejects(supabaseAccessRepository.myAccess(), (error) => error.code === "42501");
  });
});

describe("MFA through Supabase Auth", () => {
  it("removes a factor and refreshes the session with Supabase Auth's own calls", async () => {
    const fake = fakeClient();
    setSupabaseClientForTests(fake.client);
    await supabaseAccessRepository.unenroll("factor-1");
    await supabaseAccessRepository.refreshSession();
    assert.deepEqual(fake.calls, [
      { kind: "auth", name: "mfa.unenroll", factorId: "factor-1" },
      { kind: "auth", name: "refreshSession" },
    ]);
  });

  it("reports a refresh Supabase Auth refused", async () => {
    setSupabaseClientForTests(fakeClient({ auth: { refreshSession: { data: null, error: { message: "Refresh Token Not Found" } } } }).client);
    await assert.rejects(supabaseAccessRepository.refreshSession(), (error) => error.message === "Refresh Token Not Found");
  });
});

describe("team repository", () => {
  it("lists members with their active roles and projects", async () => {
    const fake = fakeClient({
      tables: {
        team_members: [{ user_id: MEMBER, ru: "SU-00001", display_name: "Ana", email: "ana@x.dev", status: "ACTIVE" }],
        user_roles: [
          { user_id: MEMBER, role_key: "COLLABORATOR" },
          { user_id: MEMBER, role_key: "SEO", expires_at: "2020-01-01T00:00:00Z" },
        ],
        project_members: [{ user_id: MEMBER, project_id: "p-1", access_level: "EDIT" }],
      },
    });
    setSupabaseClientForTests(fake.client);
    const [member] = await supabaseTeamRepository.listMembers();
    assert.deepEqual(member.roles, ["COLLABORATOR"], "an expired role grant is not a role");
    assert.deepEqual(member.projects.map((grant) => [grant.projectId, grant.accessLevel]), [["p-1", "EDIT"]]);
    assert.ok(fake.calls.some((call) => call.table === "user_roles" && call.filters.some(([op, column, value]) => op === "is" && column === "revoked_at" && value === null)));
  });

  it("invites through the Edge Function with the body it expects", async () => {
    const fake = fakeClient({ invoke: { data: { user_id: MEMBER, ru: "SU-00002" }, error: null } });
    setSupabaseClientForTests(fake.client);
    await supabaseTeamRepository.invite({ email: "n@x.dev", displayName: "N", roles: ["COLLABORATOR"], projects: [{ projectId: "p-1", accessLevel: "VIEW" }], accessExpiresAt: null });
    assert.deepEqual(fake.calls[0], {
      kind: "invoke",
      name: "team-invite",
      body: { action: "invite", email: "n@x.dev", display_name: "N", roles: ["COLLABORATOR"], projects: [{ project_id: "p-1", access_level: "VIEW", expires_at: null }], access_expires_at: null },
    });
  });

  it("reads the Edge Function's refusal, and says when it is not deployed", async () => {
    const refusal = { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status: 403, json: async () => ({ error: "SU005", message: "step-up" }) } };
    setSupabaseClientForTests(fakeClient({ invoke: { data: null, error: refusal } }).client);
    await assert.rejects(supabaseTeamRepository.resend(MEMBER), (error) => error.code === "SU005");

    const missing = { name: "FunctionsHttpError", message: "not found", context: { status: 404, json: async () => { throw new Error("not json"); } } };
    setSupabaseClientForTests(fakeClient({ invoke: { data: null, error: missing } }).client);
    await assert.rejects(supabaseTeamRepository.resend(MEMBER), (error) => error.code === "function_unavailable");
  });

  it("changes access and lifecycle only through the security functions", async () => {
    const fake = fakeClient();
    setSupabaseClientForTests(fake.client);
    await supabaseTeamRepository.updateAccess(MEMBER, { roles: ["VIEWER"], projects: [{ projectId: "p-1", accessLevel: "EDIT" }], accessExpiresAt: null });
    await supabaseTeamRepository.suspend(MEMBER, "Paused");
    await supabaseTeamRepository.reactivate(MEMBER, null);
    await supabaseTeamRepository.offboard(MEMBER, "Left");
    await supabaseTeamRepository.revokeSessions(MEMBER);
    assert.deepEqual(fake.calls.map((call) => call.name), ["update_member_access", "suspend_member", "reactivate_member", "offboard_member", "revoke_member_sessions"]);
    assert.deepEqual(fake.calls[0].args, {
      p_user: MEMBER,
      p_roles: ["VIEWER"],
      p_projects: [{ project_id: "p-1", access_level: "EDIT", expires_at: null }],
      p_access_expires_at: null,
      p_display_name: null,
    });
    assert.ok(fake.calls.every((call) => call.kind === "rpc"), "no direct table write");
  });
});

describe("approval repository", () => {
  it("drafts, submits and reviews through the security functions", async () => {
    const row = { id: "r-1", number: 7, requester_id: MEMBER, resource_type: "project", resource_id: "p-1", action: "project.update", proposed: { name: "x" }, base_version: 3, status: "DRAFT" };
    const fake = fakeClient({ rpc: { save_project_draft: { data: row, error: null }, submit_change_request: { data: [{ ...row, status: "PENDING" }], error: null } } });
    setSupabaseClientForTests(fake.client);
    const saved = await supabaseApprovalRepository.saveDraft("p-1", { name: "x" }, { publish: true, message: "m" });
    assert.equal(saved.number, 7);
    assert.equal((await supabaseApprovalRepository.submit("r-1")).status, "PENDING", "a set-returning function's row");
    await supabaseApprovalRepository.approve("r-1", "ok");
    await supabaseApprovalRepository.reject("r-1", "no");
    assert.deepEqual(fake.calls[0].args, { p_project: "p-1", p_fields: { name: "x" }, p_publish: true, p_message: "m" });
    assert.deepEqual(fake.calls.map((call) => call.name), ["save_project_draft", "submit_change_request", "approve_change_request", "reject_change_request"]);
  });

  it("counts pending requests without downloading them", async () => {
    const fake = fakeClient({ tables: { change_requests: [{ id: 1 }, { id: 2 }] } });
    setSupabaseClientForTests(fake.client);
    assert.equal(await supabaseApprovalRepository.pendingCount(), 2);
    assert.equal(fake.calls[0].head, true);
  });
});

describe("audit repository", () => {
  it("filters by member only with a real uuid", async () => {
    const fake = fakeClient({ tables: { security_audit_log: [{ id: 1, action: "LOGIN_SUCCESS", created_at: "2026-09-28T12:00:00Z" }] } });
    setSupabaseClientForTests(fake.client);
    assert.deepEqual(await supabaseAuditRepository.list({ userId: "x),id.gt.(0" }), [], "a crafted id never shapes the query");
    assert.equal(fake.calls.length, 0);
    const entries = await supabaseAuditRepository.list({ userId: MEMBER });
    assert.equal(entries[0].action, "LOGIN_SUCCESS");
    assert.deepEqual(fake.calls[0].filters, [["or", `actor_user_id.eq.${MEMBER},target_user_id.eq.${MEMBER}`]]);
  });
});

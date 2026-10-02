// The team-invite Edge Function (supabase/functions/team-invite/handler.js):
// the database decides for the caller before the service role sends
// anything, and nothing privileged ever reaches the response.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { handleTeamInvite } from "../../supabase/functions/team-invite/handler.js";

const ORIGIN = "https://admin.example.com";
const TOKEN = ["test-header", "test-payload", "test-signature"].join(".");
const SERVICE_KEY = "service-key-that-must-never-leak";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ADMIN_ALLOWED_ORIGINS: `${ORIGIN}, http://127.0.0.1:5173`,
  ADMIN_INVITE_REDIRECT_URL: `${ORIGIN}/`,
};

// Fake Supabase clients that record every call. responses maps an RPC name
// (or "invite") to what it returns.
function harness(responses = {}) {
  const calls = [];
  const logs = [];
  const createClient = (url, key, options) => {
    const client = {
      key,
      headers: options?.global?.headers ?? {},
      rpc: async (name, args) => {
        calls.push({ client: key, name, args, headers: client.headers });
        return responses[name] ?? { data: null, error: null };
      },
      auth: {
        admin: {
          inviteUserByEmail: async (email, options) => {
            calls.push({ client: key, name: "invite", args: { email, ...options } });
            return responses.invite ?? { data: { user: { id: "new-user" } }, error: null };
          },
        },
      },
    };
    return client;
  };
  return { calls, logs, deps: { env: (name) => ENV[name], createClient, log: (message) => logs.push(message) } };
}

function request(body, { method = "POST", origin = ORIGIN, authorization = `Bearer ${TOKEN}` } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (authorization) headers.set("authorization", authorization);
  return new Request("https://project.supabase.co/functions/v1/team-invite", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const PREPARED = { data: { invitation_id: "inv-1", email: "new@space.local", expires_at: "2026-10-05T00:00:00Z" }, error: null };
const COMPLETED = { data: { user_id: "new-user", ru: "SU-00012", status: "INVITED" }, error: null };
const INVITE = { email: "new@space.local", display_name: "New", roles: ["COLLABORATOR"], projects: [] };

describe("team-invite function", () => {
  it("answers the preflight only for the Admin's origins", async () => {
    const { deps } = harness();
    const allowed = await handleTeamInvite(request(null, { method: "OPTIONS" }), deps);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
    const other = await handleTeamInvite(request(null, { method: "OPTIONS", origin: "https://evil.example" }), deps);
    assert.equal(other.status, 403);
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  });

  it("refuses other origins, other methods and missing tokens before touching anything", async () => {
    const { calls, deps } = harness();
    assert.equal((await handleTeamInvite(request(INVITE, { origin: "https://evil.example" }), deps)).status, 403);
    assert.equal((await handleTeamInvite(request(INVITE, { origin: null }), deps)).status, 403);
    assert.equal((await handleTeamInvite(request(INVITE, { authorization: null }), deps)).status, 401);
    assert.equal((await handleTeamInvite(request(INVITE, { authorization: `Basic ${TOKEN}` }), deps)).status, 401);
    assert.equal((await handleTeamInvite(request(null, { method: "GET" }), deps)).status, 405);
    assert.deepEqual(calls, []);
  });

  it("asks the database as the caller first, and sends nothing when it refuses", async () => {
    const { calls, deps } = harness({ prepare_invitation: { data: null, error: { code: "42501", message: "not allowed: team.invite" } } });
    const response = await handleTeamInvite(request(INVITE), deps);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "42501", message: "not allowed: team.invite" });
    assert.deepEqual(calls.map((call) => [call.client, call.name]), [["anon-key", "prepare_invitation"]]);
    assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`, "the caller's own token decides");
  });

  it("maps step-up, rank, duplicates, the hourly budget and an ended session to their statuses", async () => {
    for (const [code, status] of [["SU005", 403], ["SU009", 403], ["SU008", 409], ["SU007", 429], ["SU004", 422], ["SU013", 401]]) {
      const { deps } = harness({ prepare_invitation: { data: null, error: { code, message: code } } });
      assert.equal((await handleTeamInvite(request(INVITE), deps)).status, status, code);
    }
  });

  it("invites with the service role, then records the member", async () => {
    const { calls, deps } = harness({ prepare_invitation: PREPARED, complete_invitation: COMPLETED });
    const response = await handleTeamInvite(request({ ...INVITE, access_expires_at: "2026-12-31T00:00:00Z" }), deps);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { invitation_id: "inv-1", user_id: "new-user", ru: "SU-00012", status: "INVITED" });
    assert.deepEqual(calls.map((call) => [call.client, call.name]), [
      ["anon-key", "prepare_invitation"],
      [SERVICE_KEY, "invite"],
      [SERVICE_KEY, "complete_invitation"],
    ]);
    assert.equal(calls[0].args.p_access_expires_at, "2026-12-31T00:00:00Z");
    assert.equal(calls[1].args.email, "new@space.local", "the address the database validated");
    assert.equal(calls[1].args.redirectTo, `${ORIGIN}/`);
    assert.deepEqual(calls[2].args, { p_invitation: "inv-1", p_user: "new-user" });
  });

  it("records a failed send instead of leaving the invitation pending", async () => {
    const { calls, deps } = harness({ prepare_invitation: PREPARED, invite: { data: null, error: { code: "email_exists", status: 422 } } });
    const response = await handleTeamInvite(request(INVITE), deps);
    assert.equal(response.status, 409);
    assert.deepEqual(calls.at(-1), { client: SERVICE_KEY, name: "fail_invitation", args: { p_invitation: "inv-1", p_reason: "email_exists" }, headers: {} });
  });

  it("records a refused completion, such as an account registered in advance", async () => {
    const { calls, deps } = harness({
      prepare_invitation: PREPARED,
      complete_invitation: { data: null, error: { code: "SU008", message: "this email already has an account with a password" } },
    });
    const response = await handleTeamInvite(request(INVITE), deps);
    assert.equal(response.status, 409);
    assert.equal(calls.at(-1).name, "fail_invitation");
  });

  it("resends through the database's own check", async () => {
    const { calls, deps } = harness({
      prepare_invitation_resend: { data: { user_id: "u-1", email: "late@space.local", invite_expires_at: "2026-10-10T00:00:00Z" }, error: null },
    });
    const response = await handleTeamInvite(request({ action: "resend", user_id: "u-1" }), deps);
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map((call) => [call.client, call.name]), [
      ["anon-key", "prepare_invitation_resend"],
      [SERVICE_KEY, "invite"],
    ]);
  });

  it("never puts a key or the caller's token in a response or a log line", async () => {
    const scenarios = [
      harness({ prepare_invitation: PREPARED, complete_invitation: COMPLETED }),
      harness({ prepare_invitation: PREPARED, invite: { data: null, error: { code: "boom" } } }),
      harness({ prepare_invitation: { data: null, error: { code: "42501", message: "no" } } }),
    ];
    for (const { deps, logs } of scenarios) {
      const response = await handleTeamInvite(request(INVITE), deps);
      const text = await response.text();
      for (const secret of [SERVICE_KEY, TOKEN, "anon-key"]) {
        assert.ok(!text.includes(secret), "response leaks a secret");
        assert.ok(!logs.join(" ").includes(secret), "log leaks a secret");
      }
    }
  });

  it("refuses to run half-configured", async () => {
    const { calls, deps } = harness();
    const response = await handleTeamInvite(request(INVITE), { ...deps, env: (name) => (name === "SUPABASE_SERVICE_ROLE_KEY" ? undefined : ENV[name]) });
    assert.equal(response.status, 500);
    assert.deepEqual(calls, []);
  });
});
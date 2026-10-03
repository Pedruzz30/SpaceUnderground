// The Admin's client for the automation service (src/services/automation-api.js)
// and the state every page derives from it (src/utils/automation-state.js).
//
// The service is optional: an unconfigured Admin must fail locally and
// instantly, never attempt a request, and the outcomes an operator acts on
// differently -- not configured, unavailable, no access -- must stay apart.
//
//   npm test

import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

const client = await import("../src/services/automation-api.js");
const state = await import("../src/utils/automation-state.js");

const BASE = "http://127.0.0.1:8000";

function configure(url) {
  globalThis.__SPACE_ADMIN_ENV__ = { VITE_ADMIN_DATA_SOURCE: "mock", VITE_AUTOMATION_API_URL: url, VITE_AUTOMATION_SCHEDULER_TOKEN: "s3cret" };
}

let calls = [];
let responses = [];
const originalFetch = globalThis.fetch;

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  calls = [];
  responses = [];
  configure(BASE);
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (typeof next === "function") return next(input, init);
    return next ?? json({});
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__SPACE_ADMIN_ENV__;
});

const failsWith = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
};

describe("automation api client", () => {
  it("is unavailable without a URL and never touches the network", async () => {
    configure("");
    assert.equal(client.isAutomationApiAvailable(), false);
    assert.equal(client.automationApiUrl("/api/v1/health"), "");
    for (const call of [
      () => client.getAutomationHealth(),
      () => client.getAutomationRuns(),
      () => client.analyzeProject("001"),
      () => client.dispatchAutomation("project.published", { entityId: "x" }),
      () => client.retryAutomationRun("abc"),
      () => client.runAutomationJobs(),
    ]) {
      await failsWith(call(), "not_configured");
    }
    assert.equal(calls.length, 0);
  });

  it("builds URLs from the configured base", () => {
    configure(`${BASE}/`);
    assert.equal(client.automationApiUrl("/api/v1/health"), `${BASE}/api/v1/health`);
    assert.equal(client.automationApiUrl("api/v1/health"), `${BASE}/api/v1/health`);
  });

  it("never sends a shared secret, and no Authorization without a session", async () => {
    await client.getAutomationHealth();
    const { headers } = calls[0].init;
    assert.equal("X-Scheduler-Token" in headers, false);
    assert.doesNotMatch(JSON.stringify(headers), /s3cret/);
    // Mock mode has no Supabase session; whether that is acceptable is the
    // service's decision (production refuses it).
    assert.equal("Authorization" in headers, false);
  });

  it("tells apart the outcomes an operator acts on differently", async () => {
    const cases = [
      [401, { code: "unauthorized", message: "x" }, "unauthorized"],
      [403, { code: "forbidden", message: "x" }, "forbidden"],
      [404, { code: "not_found", message: "x" }, "not_found"],
      // A 503 says which kind: a missing server configuration needs a deploy
      // fix, a dependency outage only time.
      [503, { code: "not_configured", message: "x" }, "not_configured"],
      [503, { code: "unavailable", message: "x" }, "unavailable"],
      [503, { code: "something_else" }, "unavailable"],
      [500, { code: "internal_error", message: "x" }, "internal_error"],
    ];
    for (const [status, body, code] of cases) {
      responses.push(json(body, status));
      await failsWith(client.getAutomationRuns(), code);
    }
  });

  it("reports a proxy page (no JSON body) without guessing", async () => {
    responses.push({ ok: false, status: 502, json: async () => { throw new SyntaxError("html"); } });
    await failsWith(client.getAutomationHealth(), "automation_error");
  });

  it("reports an unreachable service and a timeout as such", async () => {
    responses.push(() => Promise.reject(new TypeError("Failed to fetch")));
    await failsWith(client.getAutomationHealth(), "network_error");

    responses.push(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    await failsWith(client.getAutomationHealth(), "timeout");
  });

  it("reads 'not ready' as an answer, with its checks", async () => {
    responses.push(json({ ready: false, checks: [{ name: "automation_schema", configured: false }] }, 503));
    const ready = await client.getAutomationReadiness();
    assert.equal(ready.ready, false);
    assert.equal(ready.checks[0].name, "automation_schema");
  });

  it("posts an analysis of the stored project", async () => {
    responses.push(json({ status: "healthy" }));
    await client.analyzeProject("001");
    assert.equal(calls[0].url, `${BASE}/api/v1/projects/001/analyze`);
    assert.equal(calls[0].init.method, "POST");
    await failsWith(client.analyzeProject("  "), "bad_request");
  });

  it("bounds the run history request", async () => {
    await client.getAutomationRuns({ limit: 10000, status: "FAILED" });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get("limit"), "100");
    assert.equal(url.searchParams.get("status"), "FAILED");
  });

  it("dispatches with one operation id and retries a lost request with the same one", async () => {
    responses.push(() => Promise.reject(new TypeError("Failed to fetch")));
    responses.push(json({ run_id: "r1", status: "SUCCESS" }));

    const run = await client.dispatchAutomation("project.published", { entityType: "project", entityId: "p1", operationId: "publish-click-1" });

    assert.equal(run.run_id, "r1");
    assert.equal(calls.length, 2);
    const bodies = calls.map((call) => JSON.parse(call.init.body));
    assert.deepEqual(new Set(bodies.map((body) => body.operation_id)), new Set(["publish-click-1"]));
    assert.equal(bodies[0].event, "project.published");
    assert.equal(bodies[0].entity_id, "p1");
  });

  it("never retries an answer: a refusal is final", async () => {
    responses.push(json({ code: "forbidden", message: "no" }, 403));
    await failsWith(client.dispatchAutomation("project.published", { entityId: "p1" }), "forbidden");
    assert.equal(calls.length, 1);
  });

  it("gives every deliberate action its own operation id", async () => {
    await client.dispatchAutomation("project.published", { entityId: "p1" });
    await client.dispatchAutomation("project.published", { entityId: "p1" });
    const [first, second] = calls.map((call) => JSON.parse(call.init.body).operation_id);
    assert.ok(first && second);
    assert.notEqual(first, second);
    assert.match(first, /^[A-Za-z0-9._:-]{8,100}$/, "the shape the service accepts");
  });

  it("retries a run with an operation id, as a POST to that run", async () => {
    await client.retryAutomationRun("00000000-0000-4000-8000-000000000001", { operationId: "retry-click-1" });
    assert.equal(calls[0].url, `${BASE}/api/v1/automations/runs/00000000-0000-4000-8000-000000000001/retry`);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { operation_id: "retry-click-1" });
  });
});

describe("automation state", () => {
  it("maps each failure onto the state it means", () => {
    assert.equal(state.stateForError({ code: "not_configured" }), state.NOT_CONFIGURED);
    assert.equal(state.stateForError({ code: "forbidden" }), state.FORBIDDEN);
    assert.equal(state.stateForError({ code: "unauthorized" }), state.FORBIDDEN);
    assert.equal(state.stateForError({ code: "unavailable" }), state.ERROR);
    assert.equal(state.stateForError({ code: "timeout" }), state.ERROR);
    assert.equal(state.stateForError({ code: "network_error" }), state.ERROR);
  });

  it("labels not configured, unavailable and no access differently", () => {
    const keys = [state.NOT_CONFIGURED, state.ERROR, state.FORBIDDEN, state.SUCCESS].map(state.serviceStatusKey);
    assert.deepEqual(keys, ["automation.notConfigured", "automation.offline", "automation.forbidden", "automation.online"]);
    assert.equal(new Set(keys).size, 4);
  });

  it("says not configured without making a request", async () => {
    configure("");
    let loads = 0;
    const resource = state.createAutomationResource(async () => {
      loads += 1;
      return {};
    });
    assert.equal((await resource.read()).status, state.NOT_CONFIGURED);
    assert.equal(loads, 0);
  });

  it("caches within its window, and a forced read bypasses it", async () => {
    let loads = 0;
    const resource = state.createAutomationResource(async () => ({ n: ++loads }), { ttl: 1000 });
    assert.equal((await resource.read({ now: 0 })).data.n, 1);
    assert.equal((await resource.read({ now: 500 })).data.n, 1);
    assert.equal((await resource.read({ now: 500, force: true })).data.n, 2);
    assert.equal((await resource.read({ now: 5000 })).data.n, 3);
  });

  it("collapses concurrent reads into one request", async () => {
    let loads = 0;
    const resource = state.createAutomationResource(async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true };
    });
    await Promise.all([resource.read(), resource.read(), resource.read()]);
    assert.equal(loads, 1);
  });

  it("keeps no stale data after a failure", async () => {
    let fail = false;
    const resource = state.createAutomationResource(async () => {
      if (fail) throw Object.assign(new Error("down"), { code: "unavailable" });
      return { ok: true };
    }, { ttl: 0 });
    assert.equal((await resource.read()).status, state.SUCCESS);
    fail = true;
    const after = await resource.read();
    assert.equal(after.status, state.ERROR);
    assert.equal(after.data, null);
  });
});

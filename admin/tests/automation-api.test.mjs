import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// The client reads build-time config through `import.meta.env`, which node:test
// cannot set. The module is therefore imported fresh per scenario with the env
// stubbed first, which is also the only way to cover the unconfigured path --
// the one that decides whether the Admin still works without Python.

async function loadClient({ url = "", token = "" } = {}) {
  globalThis.__SPACE_ADMIN_ENV__ = {
    VITE_ADMIN_DATA_SOURCE: "mock",
    VITE_AUTOMATION_API_URL: url,
    VITE_AUTOMATION_API_TOKEN: token,
  };

  // A unique query string defeats the module cache between scenarios.
  const suffix = `?case=${encodeURIComponent(`${url}|${token}|${Math.random()}`)}`;
  return import(`../src/services/automation-api.js${suffix}`);
}

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("automation api client", () => {
  it("reports itself unavailable when no URL is configured", async () => {
    const client = await loadClient();

    assert.equal(client.isAutomationApiAvailable(), false);
    assert.equal(client.automationApiUrl("/api/v1/health"), "");
  });

  it("never calls fetch when it is not configured", async () => {
    // This is the property that keeps Python optional: an unconfigured Admin
    // must fail locally and instantly, not attempt a request.
    const client = await loadClient();
    const fetchStub = stubFetch(() => jsonResponse({}));

    try {
      await assert.rejects(() => client.getOperationsOverview(), (error) => {
        assert.equal(error.code, "not_configured");
        return true;
      });
      assert.equal(fetchStub.calls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });

  it("builds absolute URLs and trims a trailing slash from the base", async () => {
    const client = await loadClient({ url: "http://127.0.0.1:8000/" });

    assert.equal(client.isAutomationApiAvailable(), true);
    assert.equal(client.automationApiUrl("/api/v1/health"), "http://127.0.0.1:8000/api/v1/health");
    assert.equal(client.automationApiUrl("api/v1/health"), "http://127.0.0.1:8000/api/v1/health");
  });

  it("posts an analysis request for a project", async () => {
    const client = await loadClient({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() => jsonResponse({ project_id: "1", score: 100, status: "healthy" }));

    try {
      const analysis = await client.analyzeProject("001");

      assert.equal(analysis.status, "healthy");
      assert.equal(fetchStub.calls.length, 1);
      assert.equal(fetchStub.calls[0].url, "http://127.0.0.1:8000/api/v1/projects/001/analyze");
      assert.equal(fetchStub.calls[0].init.method, "POST");
    } finally {
      fetchStub.restore();
    }
  });

  it("rejects an empty project id before reaching the network", async () => {
    const client = await loadClient({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() => jsonResponse({}));

    try {
      await assert.rejects(() => client.analyzeProject("  "), (error) => {
        assert.equal(error.code, "bad_request");
        return true;
      });
      assert.equal(fetchStub.calls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });

  it("sends the shared token only when one is configured", async () => {
    const withToken = await loadClient({ url: "http://127.0.0.1:8000", token: "s3cret" });
    const stubbed = stubFetch(() => jsonResponse({ status: "ok" }));

    try {
      await withToken.getAutomationHealth();
      assert.equal(stubbed.calls[0].init.headers["X-API-Token"], "s3cret");
    } finally {
      stubbed.restore();
    }

    const withoutToken = await loadClient({ url: "http://127.0.0.1:8000" });
    const plain = stubFetch(() => jsonResponse({ status: "ok" }));

    try {
      await withoutToken.getAutomationHealth();
      assert.equal("X-API-Token" in plain.calls[0].init.headers, false);
    } finally {
      plain.restore();
    }
  });

  it("turns the service error envelope into a DataError with its code", async () => {
    const client = await loadClient({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() =>
      jsonResponse({ code: "not_found", message: "Project not found." }, 404),
    );

    try {
      await assert.rejects(() => client.analyzeProject("999"), (error) => {
        assert.equal(error.code, "not_found");
        assert.equal(error.message, "Project not found.");
        return true;
      });
    } finally {
      fetchStub.restore();
    }
  });

  it("reports a network failure without leaking the underlying error", async () => {
    const client = await loadClient({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    try {
      await assert.rejects(() => client.getOperationsOverview(), (error) => {
        assert.equal(error.code, "network_error");
        assert.match(error.message, /unreachable/i);
        return true;
      });
    } finally {
      fetchStub.restore();
    }
  });

  it("dispatches an automation event with its payload", async () => {
    const client = await loadClient({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() => jsonResponse({ event: "project.published", handled: true, results: [] }));

    try {
      await client.dispatchAutomation("project.published", {
        entityType: "project",
        entityId: "1",
        operationId: "op-1",
        payload: { project_id: "1" },
      });

      const { url, init } = fetchStub.calls[0];
      assert.equal(url, "http://127.0.0.1:8000/api/v1/automations/dispatch");
      assert.deepEqual(JSON.parse(init.body), {
        event: "project.published",
        entity_type: "project",
        entity_id: "1",
        operation_id: "op-1",
        payload: { project_id: "1" },
      });
    } finally {
      fetchStub.restore();
    }
  });
});

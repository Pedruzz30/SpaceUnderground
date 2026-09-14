import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Run history as the Admin consumes it: the client's run endpoints and the
// presentation helpers behind the Logs screen.
//
// Asserted through calls and state rather than rendered layout. The two things
// asserted about markup -- that a status is written as text, and that a payload
// never reaches the DOM -- are a guarantee and a safety property, not styling.

async function loadModules({ url = "http://127.0.0.1:8000", token = "" } = {}) {
  globalThis.__SPACE_ADMIN_ENV__ = {
    VITE_ADMIN_DATA_SOURCE: "mock",
    VITE_AUTOMATION_API_URL: url,
    VITE_AUTOMATION_API_TOKEN: token,
  };

  const suffix = `?case=${encodeURIComponent(`${url}|${token}|${Math.random()}`)}`;
  return {
    client: await import(`../src/services/automation-api.js${suffix}`),
    runs: await import(`../src/components/automation-runs.js${suffix}`),
  };
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

const RUN = {
  run_id: "abcdef12-3456-4789-abcd-000000000001",
  event: "project.published",
  status: "SUCCESS",
  source: "admin",
  entity_type: "project",
  entity_id: "001",
  steps: [
    { name: "load_project", status: "SUCCESS", duration_ms: 42 },
    { name: "analyze_project", status: "SUCCESS", duration_ms: 231 },
    { name: "check_live_preview", status: "SKIPPED", duration_ms: 1 },
    { name: "register_result", status: "SUCCESS", duration_ms: 18 },
  ],
  result: {},
  error: null,
  duration_ms: 292,
  persisted: true,
};

const FAILED_RUN = {
  ...RUN,
  run_id: "abcdef12-3456-4789-abcd-000000000002",
  status: "FAILED",
  error: "Preview URL is not reachable (timeout).",
  steps: [
    { name: "load_project", status: "SUCCESS", duration_ms: 40 },
    { name: "check_live_preview", status: "FAILED", duration_ms: 8000, error: "Preview URL is not reachable." },
  ],
};

describe("automation run client", () => {
  it("asks for run history with a bounded limit", async () => {
    const { client } = await loadModules();
    const fetchStub = stubFetch(() => jsonResponse({ runs: [RUN], count: 1, limit: 25 }));

    try {
      const body = await client.getAutomationRuns();

      assert.equal(body.count, 1);
      const url = new URL(fetchStub.calls[0].url);
      assert.equal(url.pathname, "/api/v1/automations/runs");
      assert.equal(url.searchParams.get("limit"), "25");
    } finally {
      fetchStub.restore();
    }
  });

  it("clamps a limit the caller should not have asked for", async () => {
    const { client } = await loadModules();
    const fetchStub = stubFetch(() => jsonResponse({ runs: [], count: 0, limit: 100 }));

    try {
      await client.getAutomationRuns({ limit: 100000 });
      assert.equal(new URL(fetchStub.calls[0].url).searchParams.get("limit"), "100");

      await client.getAutomationRuns({ limit: 0 });
      assert.equal(new URL(fetchStub.calls[1].url).searchParams.get("limit"), "25");
    } finally {
      fetchStub.restore();
    }
  });

  it("passes the filters the Logs screen offers", async () => {
    const { client } = await loadModules();
    const fetchStub = stubFetch(() => jsonResponse({ runs: [], count: 0, limit: 10 }));

    try {
      await client.getAutomationRuns({ event: "project.published", status: "FAILED", entityId: "001", limit: 10 });

      const params = new URL(fetchStub.calls[0].url).searchParams;
      assert.equal(params.get("event"), "project.published");
      assert.equal(params.get("status"), "FAILED");
      assert.equal(params.get("entity_id"), "001");
    } finally {
      fetchStub.restore();
    }
  });

  it("fetches one run and posts a retry", async () => {
    const { client } = await loadModules();
    const fetchStub = stubFetch(() => jsonResponse(RUN));

    try {
      await client.getAutomationRun(RUN.run_id);
      assert.equal(fetchStub.calls[0].init.method ?? "GET", "GET");

      await client.retryAutomationRun(RUN.run_id);
      assert.equal(fetchStub.calls[1].init.method, "POST");
      assert.match(fetchStub.calls[1].url, /\/retry$/);
    } finally {
      fetchStub.restore();
    }
  });

  it("rejects an empty run id before reaching the network", async () => {
    const { client } = await loadModules();
    const fetchStub = stubFetch(() => jsonResponse(RUN));

    try {
      await assert.rejects(() => client.getAutomationRun("  "));
      await assert.rejects(() => client.retryAutomationRun(""));
      assert.equal(fetchStub.calls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });

  it("never calls the run endpoints when the API is not configured", async () => {
    const { client } = await loadModules({ url: "" });
    const fetchStub = stubFetch(() => jsonResponse({}));

    try {
      await assert.rejects(() => client.getAutomationRuns(), (error) => {
        assert.equal(error.code, "not_configured");
        return true;
      });
      await assert.rejects(() => client.getAutomationRunStats());
      assert.equal(fetchStub.calls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });

  it("reports an offline service rather than an empty history", async () => {
    // "No runs" and "cannot reach the engine" must never look the same.
    const { client } = await loadModules();
    const fetchStub = stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    try {
      await assert.rejects(() => client.getAutomationRuns(), (error) => {
        assert.equal(error.code, "network_error");
        return true;
      });
    } finally {
      fetchStub.restore();
    }
  });
});

describe("automation run presentation", () => {
  it("writes every status as text, not only as a colour", async () => {
    const { runs } = await loadModules();

    for (const status of ["SUCCESS", "FAILED", "SKIPPED", "RUNNING", "PENDING"]) {
      const markup = runs.runStatusBadge(status);
      assert.match(markup, /<span class="badge badge--/);
      assert.ok(markup.replace(/<[^>]*>/g, "").trim().length > 0, `${status} must carry a label`);
    }
  });

  it("does not render an unknown status as a raw translation key", async () => {
    const { runs } = await loadModules();

    assert.doesNotMatch(runs.runStatusBadge("WARP_SPEED"), /automationRuns\./);
  });

  it("formats a duration in the unit that reads best", async () => {
    const { runs } = await loadModules();

    assert.equal(runs.formatDuration(292), "292 ms");
    assert.equal(runs.formatDuration(8421), "8.42 s");
    assert.equal(runs.formatDuration(null), "");
    assert.equal(runs.formatDuration(-5), "");
  });

  it("shortens a run id for display", async () => {
    const { runs } = await loadModules();

    assert.equal(runs.shortRunId(RUN.run_id), "abcdef12");
    assert.equal(runs.shortRunId(null), "");
  });

  it("says so when there are no runs, rather than rendering nothing", async () => {
    const { runs } = await loadModules();

    assert.match(runs.runRowsMarkup([]), /automationRuns\.empty/);
  });

  it("renders one row per run with its step count and status", async () => {
    const { runs } = await loadModules();
    const markup = runs.runRowsMarkup([RUN, FAILED_RUN]);

    assert.equal(markup.match(/data-run-open=/g).length, 2);
    assert.match(markup, /project\.published/);
    assert.match(markup, /292 ms/);
  });

  it("never puts the payload or an entity id secret into a row", async () => {
    const { runs } = await loadModules();
    const markup = runs.runRowsMarkup([
      { ...RUN, payload: { token: "sb_secret_should_never_render" } },
    ]);

    assert.doesNotMatch(markup, /sb_secret_should_never_render/);
  });

  it("escapes a hostile event name instead of rendering it", async () => {
    const { runs } = await loadModules();
    const markup = runs.runRowsMarkup([{ ...RUN, event: '<img src=x onerror="alert(1)">' }]);

    assert.doesNotMatch(markup, /<img/);
    assert.match(markup, /&lt;img/);
  });

  it("reads the storage flag the service sends", async () => {
    // Asserted on the client contract rather than the rendered page: what
    // matters is that the flag survives the round trip so the screen can tell
    // "no runs" apart from "could not read".
    const { client } = await loadModules();
    const fetchStub = stubFetch(() =>
      jsonResponse({ runs: [], count: 0, limit: 25, storage_available: false }),
    );

    try {
      const body = await client.getAutomationRuns();
      assert.equal(body.storage_available, false);
      assert.equal(body.count, 0);
    } finally {
      fetchStub.restore();
    }
  });

  it("disables the row when a run was never persisted", async () => {
    // With no history table there is no id to open, and a dead link would be
    // worse than a disabled one.
    const { runs } = await loadModules();
    const markup = runs.runRowsMarkup([{ ...RUN, run_id: null, persisted: false }]);

    assert.match(markup, /disabled/);
  });
});

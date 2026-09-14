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

// The business half of a run detail. Phase 3 runs carry an empty result and
// must keep rendering exactly as they did; Phase 4 runs add a business status,
// a summary and a list of actions. Everything here is asserted on markup
// because the guarantee being protected is what reaches the DOM.

const COMMERCIAL_RUN = {
  run_id: "abcdef12-3456-4789-abcd-000000000003",
  event: "commercial.proposal.accepted",
  status: "SUCCESS",
  source: "admin",
  entity_type: "proposal",
  entity_id: "20d77737-448e-4c36-b4e4-cf8e324fda88",
  duration_ms: 2080,
  steps: [
    { name: "validate_proposal", status: "SUCCESS", duration_ms: 413 },
    { name: "register_handoff", status: "SUCCESS", duration_ms: 12 },
  ],
  result: {
    business_status: "SUCCESS",
    summary: {
      proposal_id: "20d77737-448e-4c36-b4e4-cf8e324fda88",
      client_id: "668a1d7e-b100-4085-9bc6-fb7463aaea71",
      plan_id: "d077da8e-5205-4ac5-aeec-743712e9da66",
      project_id: "d9683452-5407-415e-88a6-fbbf182f482c",
      case_number: 7,
    },
    actions: [
      {
        action: "project.create",
        status: "executed",
        target: "projects",
        entity_id: "d9683452-5407-415e-88a6-fbbf182f482c",
        dry_run: false,
      },
    ],
  },
  error: null,
};

const withResult = (result) => ({ ...COMMERCIAL_RUN, result });

describe("automation run business detail", () => {
  it("leaves a Phase 3 run exactly as it was, with no business blocks", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(RUN);

    assert.doesNotMatch(markup, /automation-detail__section/);
    assert.doesNotMatch(markup, /automation-actions/);
    // What the run always showed is still there.
    assert.match(markup, /load_project/);
    assert.match(markup, /project\.published/);
  });

  it("survives a run whose result is missing or malformed", async () => {
    const { runs } = await loadModules();

    for (const result of [undefined, null, {}, [], "corrupted", { summary: null }, { actions: null }]) {
      const markup = runs.runDetailMarkup(withResult(result));
      assert.match(markup, /automation-detail/);
      assert.doesNotMatch(markup, /undefined|\[object Object\]/);
    }
  });

  it("shows the business entities a commercial run resolved", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(COMMERCIAL_RUN);

    assert.match(markup, /automationRuns\.summaryFields\.proposalId/);
    assert.match(markup, /20d77737-448e-4c36-b4e4-cf8e324fda88/);
    assert.match(markup, /668a1d7e-b100-4085-9bc6-fb7463aaea71/);
    assert.match(markup, /d077da8e-5205-4ac5-aeec-743712e9da66/);
    assert.match(markup, /d9683452-5407-415e-88a6-fbbf182f482c/);
    assert.match(markup, />7</);
  });

  it("renders only the summary fields that are present", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(withResult({ summary: { project_id: "only-this-one" } }));

    assert.match(markup, /only-this-one/);
    assert.doesNotMatch(markup, /summaryFields\.proposalId/);
    assert.doesNotMatch(markup, /summaryFields\.clientId/);
  });

  it("writes the business status as text, not only as a colour", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(withResult({ business_status: "ATTENTION" }));

    assert.match(markup, /badge--warning/);
    assert.match(markup, /automationRuns\.businessStatus"/);
    const badgeText = markup.match(/<span class="badge badge--warning">([^<]+)</);
    assert.ok(badgeText && badgeText[1].trim().length > 0, "the status must carry a label");
  });

  it("does not render an unknown business status as a raw translation key", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(withResult({ business_status: "WARP_SPEED" }));

    assert.match(markup, /WARP_SPEED/);
    assert.doesNotMatch(markup, /businessStatusValue\.WARP_SPEED/);
  });

  it("distinguishes a planned action from an executed one", async () => {
    const { runs } = await loadModules();

    const planned = runs.runDetailMarkup(
      withResult({ actions: [{ action: "project.create", status: "planned", entity_id: null }] }),
    );
    assert.match(planned, /health-check--warning/);
    assert.match(planned, /PROJECT\.CREATE/);
    assert.doesNotMatch(planned, /actionStatus\.PLANNED/);

    const executed = runs.runDetailMarkup(COMMERCIAL_RUN);
    assert.match(executed, /health-check--ok/);
    // Shortened for the row, since the full id is already in the summary.
    assert.match(executed, /d9683452…/);
  });

  it("explains why an action was skipped", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(
      withResult({
        actions: [
          {
            action: "project.create",
            status: "skipped",
            reason: "A project already exists for this proposal.",
            entity_id: "d9683452-5407-415e-88a6-fbbf182f482c",
          },
        ],
      }),
    );

    assert.match(markup, /A project already exists for this proposal\./);
    assert.match(markup, /health-check--warning/);
  });

  it("marks a failed action as failed", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(
      withResult({ actions: [{ action: "project.create", status: "failed", message: "Category is missing." }] }),
    );

    assert.match(markup, /health-check--required/);
    assert.match(markup, /Category is missing\./);
  });

  it("omits the actions block when the run took none", async () => {
    const { runs } = await loadModules();

    for (const actions of [[], undefined]) {
      const markup = runs.runDetailMarkup(withResult({ business_status: "ATTENTION", actions }));
      assert.doesNotMatch(markup, /automation-actions/);
      assert.doesNotMatch(markup, /automationRuns\.actions"/);
    }
  });

  it("never lets a secret in the result reach the markup", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(
      withResult({
        business_status: "SUCCESS",
        // Each of these sits outside the whitelist, at a different depth.
        token: "sb_secret_top_level",
        authorization: "Bearer eyJhbGciOiJIUzI1NiSHOULDNEVERRENDER",
        summary: {
          project_id: "d9683452-5407-415e-88a6-fbbf182f482c",
          service_role_key: "sb_secret_in_summary",
          apikey: "sb_secret_apikey",
          // A whitelisted key holding a structure is dropped, not flattened.
          client_id: { value: "sb_secret_nested_under_whitelist" },
        },
        actions: [
          {
            action: "project.create",
            status: "executed",
            entity_id: "d9683452-5407-415e-88a6-fbbf182f482c",
            fields: { apikey: "sb_secret_in_action_fields" },
            headers: { authorization: "sb_secret_in_action_headers" },
          },
        ],
      }),
    );

    for (const secret of [
      "sb_secret_top_level",
      "SHOULDNEVERRENDER",
      "sb_secret_in_summary",
      "sb_secret_apikey",
      "sb_secret_nested_under_whitelist",
      "sb_secret_in_action_fields",
      "sb_secret_in_action_headers",
    ]) {
      assert.doesNotMatch(markup, new RegExp(secret), secret + " must never render");
    }

    // The whitelisted value standing beside them still renders.
    assert.match(markup, /d9683452-5407-415e-88a6-fbbf182f482c/);
    assert.doesNotMatch(markup, /\[object Object\]/);
  });

  it("escapes a hostile business value instead of rendering it", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup(
      withResult({
        summary: { project_id: '<img src=x onerror="alert(1)">' },
        actions: [{ action: "<script>alert(1)</script>", status: "executed", reason: "<b>no</b>" }],
      }),
    );

    assert.doesNotMatch(markup, /<img|<script|<b>/);
    assert.match(markup, /&lt;img/);
  });

  it("keeps the retry lineage and the error next to the business blocks", async () => {
    const { runs } = await loadModules();
    const markup = runs.runDetailMarkup({
      ...FAILED_RUN,
      retry_of: "abcdef12-3456-4789-abcd-000000000001",
      result: { business_status: "ATTENTION" },
    });

    assert.match(markup, /abcdef12/);
    assert.match(markup, /Preview URL is not reachable \(timeout\)\./);
    assert.match(markup, /automation-detail__section/);
    assert.equal(typeof runs.openRunDetail, "function");
  });
});

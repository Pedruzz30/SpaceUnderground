import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Behaviour of the automation layer as the pages consume it: the request state
// machine, the caching and dedupe rules, and the presentation helpers.
//
// Asserted through state and calls rather than rendered markup, so a design
// change does not break the suite. The one thing worth asserting about the
// markup is that each status is also carried as text, because that is an
// accessibility guarantee rather than a styling detail.

async function loadModules({ url = "", token = "" } = {}) {
  globalThis.__SPACE_ADMIN_ENV__ = {
    VITE_ADMIN_DATA_SOURCE: "mock",
    VITE_AUTOMATION_API_URL: url,
    VITE_AUTOMATION_API_TOKEN: token,
  };

  const suffix = `?case=${encodeURIComponent(`${url}|${token}|${Math.random()}`)}`;
  const state = await import(`../src/utils/automation-state.js${suffix}`);
  const client = await import(`../src/services/automation-api.js${suffix}`);
  return { state, client };
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

const OVERVIEW = {
  generated_at: "2026-09-13T17:00:00Z",
  projects: { total: 6, published: 4, draft: 2, archived: 0, visible: 4, featured: 3 },
  content: { with_poster: 6, with_description: 6, with_project_url: 3, with_preview_url: 3, with_live_preview: 3 },
  translations: { with_english: 5, without_english: 1 },
  freshness: { updated_last_30_days: 6, stale_over_180_days: 0 },
};

describe("automation request state", () => {
  it("reports not-configured without issuing a request", async () => {
    // The property the whole phase rests on: with no URL the Admin asks nothing
    // and still has something coherent to render.
    const { state } = await loadModules();
    const fetchStub = stubFetch(() => jsonResponse(OVERVIEW));

    try {
      let loaderCalls = 0;
      const resource = state.createAutomationResource(async () => {
        loaderCalls += 1;
        return OVERVIEW;
      });

      const result = await resource.read();

      assert.equal(result.status, state.NOT_CONFIGURED);
      assert.equal(result.data, null);
      assert.equal(loaderCalls, 0);
      assert.equal(fetchStub.calls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });

  it("reports success and caches inside the TTL", async () => {
    const { state } = await loadModules({ url: "http://127.0.0.1:8000" });

    let loaderCalls = 0;
    const resource = state.createAutomationResource(async () => {
      loaderCalls += 1;
      return OVERVIEW;
    });

    const first = await resource.read();
    const second = await resource.read();

    assert.equal(first.status, state.SUCCESS);
    assert.equal(first.data.projects.total, 6);
    assert.equal(second.cached, true);
    assert.equal(loaderCalls, 1, "a second read inside the TTL must not re-query");
  });

  it("re-queries once the TTL has passed", async () => {
    const { state } = await loadModules({ url: "http://127.0.0.1:8000" });

    let loaderCalls = 0;
    const resource = state.createAutomationResource(
      async () => {
        loaderCalls += 1;
        return OVERVIEW;
      },
      { ttl: 1000 },
    );

    await resource.read({ now: 0 });
    await resource.read({ now: 5000 });

    assert.equal(loaderCalls, 2);
  });

  it("collapses concurrent reads into one request", async () => {
    const { state } = await loadModules({ url: "http://127.0.0.1:8000" });

    let loaderCalls = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const resource = state.createAutomationResource(async () => {
      loaderCalls += 1;
      await gate;
      return OVERVIEW;
    });

    const both = Promise.all([resource.read(), resource.read()]);
    release();
    const [first, second] = await both;

    assert.equal(loaderCalls, 1, "two simultaneous reads must share one request");
    assert.equal(first.status, state.SUCCESS);
    assert.equal(second.status, state.SUCCESS);
  });

  it("reports error and keeps no stale data behind it", async () => {
    const { state } = await loadModules({ url: "http://127.0.0.1:8000" });

    let shouldFail = false;
    const resource = state.createAutomationResource(async () => {
      if (shouldFail) throw new Error("offline");
      return OVERVIEW;
    });

    await resource.read();
    shouldFail = true;
    const failed = await resource.read({ force: true });

    assert.equal(failed.status, state.ERROR);
    // Numbers beside an OFFLINE badge would contradict each other.
    assert.equal(failed.data, null);
  });

  it("lets a forced read retry after a failure", async () => {
    const { state } = await loadModules({ url: "http://127.0.0.1:8000" });

    let attempt = 0;
    const resource = state.createAutomationResource(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("offline");
      return OVERVIEW;
    });

    assert.equal((await resource.read()).status, state.ERROR);
    assert.equal((await resource.read({ force: true })).status, state.SUCCESS);
  });

  it("maps each state onto its own vocabulary", async () => {
    const { state } = await loadModules();

    assert.equal(state.serviceStatusKey(state.SUCCESS), "automation.online");
    assert.equal(state.serviceStatusKey(state.ERROR), "automation.offline");
    assert.equal(state.serviceStatusKey(state.NOT_CONFIGURED), "automation.notConfigured");
    assert.equal(state.serviceStatusKey(state.LOADING), "automation.checking");

    // Offline and not-configured must never collapse into one message.
    assert.notEqual(
      state.serviceStatusKey(state.ERROR),
      state.serviceStatusKey(state.NOT_CONFIGURED),
    );
  });
});

describe("automation presentation", () => {
  it("writes the status as text, not only as a colour", async () => {
    const { state } = await loadModules();
    const { serviceStatusMarkup } = await import("../src/components/automation-panel.js");

    for (const status of [state.SUCCESS, state.ERROR, state.NOT_CONFIGURED, state.LOADING]) {
      const markup = serviceStatusMarkup(status);
      assert.match(markup, /<strong/, `${status} must carry text`);
      assert.match(markup, /aria-hidden="true"/, `${status} dot must be decorative`);
    }
  });

  it("omits a metric the service did not return instead of printing zero", async () => {
    await loadModules();
    const { overviewFiguresMarkup } = await import("../src/components/automation-panel.js");

    const partial = overviewFiguresMarkup({ projects: { total: 6 }, content: {} });

    assert.match(partial, /operations\.projects/);
    // A missing live-preview count must not render as "0".
    assert.doesNotMatch(partial, /operations\.livePreviews/);
  });

  it("falls back to a message when nothing can be counted", async () => {
    await loadModules();
    const { overviewFiguresMarkup } = await import("../src/components/automation-panel.js");

    assert.match(overviewFiguresMarkup({}), /operations\.noMetrics/);
  });
});

describe("automation client transport", () => {
  it("aborts a request that exceeds the timeout", async () => {
    const { client } = await loadModules({ url: "http://127.0.0.1:8000" });

    const fetchStub = stubFetch((_url, init) =>
      new Promise((_resolve, reject) => {
        // Mirrors what fetch does when the AbortController fires.
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    );

    try {
      const started = Date.now();
      await assert.rejects(() => client.getOperationsOverview(), (error) => {
        assert.equal(error.code, "timeout");
        return true;
      });
      // The point is that it resolves at all rather than hanging forever.
      assert.ok(Date.now() - started < 20000);
    } finally {
      fetchStub.restore();
    }
  });

  it("treats a non-200 without a JSON body as an automation error", async () => {
    const { client } = await loadModules({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }));

    try {
      await assert.rejects(() => client.getOperationsOverview(), (error) => {
        assert.equal(error.code, "automation_error");
        assert.match(error.message, /502/);
        return true;
      });
    } finally {
      fetchStub.restore();
    }
  });

  it("maps a 404 without a body onto not_found", async () => {
    const { client } = await loadModules({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() => ({
      ok: false,
      status: 404,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }));

    try {
      await assert.rejects(() => client.analyzeProject("999"), (error) => {
        assert.equal(error.code, "not_found");
        return true;
      });
    } finally {
      fetchStub.restore();
    }
  });

  it("dispatches the published event with the identifier it was given", async () => {
    const { client } = await loadModules({ url: "http://127.0.0.1:8000" });
    const fetchStub = stubFetch(() => jsonResponse({ event: "project.published", handled: true, results: [] }));

    try {
      await client.dispatchAutomation("project.published", { project_id: "001" });

      assert.deepEqual(JSON.parse(fetchStub.calls[0].init.body), {
        event: "project.published",
        payload: { project_id: "001" },
      });
    } finally {
      fetchStub.restore();
    }
  });

  it("makes no call at all when the API is not configured", async () => {
    // Covers the publish path: with Python off, publishing must not even try.
    const { client } = await loadModules();
    const fetchStub = stubFetch(() => jsonResponse({}));

    try {
      assert.equal(client.isAutomationApiAvailable(), false);
      await assert.rejects(() => client.dispatchAutomation("project.published", { project_id: "1" }));
      assert.equal(fetchStub.calls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });
});

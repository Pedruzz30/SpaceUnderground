// How the Admin uses the automation service: run presentation, and the rule
// that every business event is dispatched only after Supabase confirmed the
// change it describes -- never before, never awaited by the save.
//
//   npm test

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, before, describe, it } from "node:test";

import { setLocale } from "../src/i18n/index.js";

const runs = await import("../src/components/automation-runs.js");
const events = await import("../src/services/automation-events.js");

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (path) => readFileSync(join(SRC, path), "utf8");

before(() => setLocale("pt-BR", { persist: false }));

describe("run presentation", () => {
  const run = {
    run_id: "00000000-0000-4000-8000-000000000001",
    event: "commercial.opportunity.won",
    status: "SUCCESS",
    source: "admin",
    entity_type: "opportunity",
    entity_id: "cccccccc-3333-4333-8333-000000000001",
    duration_ms: 1234,
    created_at: "2026-10-02T12:00:00Z",
    requested_by: "u-1",
    result: {
      business_status: "ATTENTION",
      summary: {
        case_number: 7,
        project_id: "22222222-2222-4222-8222-000000000001",
        warnings: ["Nenhum recebível registrado para esta oportunidade."],
        injected: "<img src=x onerror=alert(1)>",
        nested: { deep: "<b>no</b>" },
      },
      actions: [{ action: "project.create", status: "executed", entity_id: "22222222-2222-4222-8222-000000000001" }],
    },
    steps: [
      { name: "open_project", status: "SUCCESS", duration_ms: 40 },
      { name: "review_financial", status: "SKIPPED", duration_ms: 1 },
    ],
  };

  it("labels known events and steps, and echoes unknown ones", () => {
    assert.equal(runs.eventLabel("project.published"), "Projeto publicado");
    assert.equal(runs.eventLabel("job.financial.overdue_check"), "Job · recebíveis vencidos");
    assert.equal(runs.eventLabel("something.new"), "something.new");
    assert.equal(runs.stepLabel("open_project"), "Abrir o projeto");
  });

  it("reports an abandoned RUNNING run as interrupted", () => {
    assert.equal(runs.displayStatus({ status: "RUNNING", stale: true }), "STALE");
    assert.match(runs.runStatusBadge({ status: "RUNNING", stale: true }), /Interrompida/);
    assert.equal(runs.displayStatus({ status: "FAILED" }), "FAILED");
  });

  it("never claims a missing duration took no time", () => {
    assert.equal(runs.formatDuration(null), "");
    assert.equal(runs.formatDuration(undefined), "");
    assert.equal(runs.formatDuration(250), "250 ms");
    assert.equal(runs.formatDuration(1234), "1.23 s");
  });

  it("renders only whitelisted fields, escaped", () => {
    const html = runs.runDetailMarkup(run, { currentUserId: "u-1" });

    assert.match(html, /Pontuação|Case/);
    assert.match(html, /Nenhum recebível registrado/);
    assert.match(html, /Você/);
    assert.match(html, /Atenção/);
    assert.doesNotMatch(html, /onerror/);
    assert.doesNotMatch(html, /<b>no<\/b>/);
    assert.doesNotMatch(html, /injected|nested/);
  });

  it("says when part of a result is withheld, stored nowhere, or a retry", () => {
    const html = runs.runDetailMarkup({ ...run, redacted: true, persisted: false, retry_of: "abcdef0123456789" });
    assert.match(html, /oculta/);
    assert.match(html, /não pôde ser gravada/);
    assert.match(html, /abcdef01/);
  });

  it("escapes whatever the service sends in the table", () => {
    const html = runs.runTableMarkup([{ ...run, event: "<script>x</script>", entity_id: "<i>id</i>", source: "<u>s</u>" }]);
    assert.doesNotMatch(html, /<script>|<i>id<\/i>|<u>s<\/u>/);
    assert.match(html, /data-run-open="00000000-0000-4000-8000-000000000001"/);
  });
});

describe("events after commit", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__SPACE_ADMIN_ENV__;
  });

  it("dispatches nothing in mock mode: the service reads the real database", async () => {
    globalThis.__SPACE_ADMIN_ENV__ = { VITE_AUTOMATION_API_URL: "http://127.0.0.1:8000" };
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const outcome = await events.dispatchAfterCommit("project.published", { entityType: "project", entityId: "p1" });

    assert.equal(outcome.skipped, true);
    assert.equal(fetched, false);
  });

  it("never rejects, whatever the service does", async () => {
    globalThis.__SPACE_ADMIN_ENV__ = {};
    const outcome = await events.dispatchAfterCommit("project.published", { entityId: "" });
    assert.equal(outcome.skipped, true);
  });

  // The order is the contract: commit, then dispatch, unawaited.
  const after = (source, commit, dispatch) => {
    const commitAt = source.indexOf(commit);
    const dispatchAt = source.indexOf(dispatch, commitAt);
    assert.ok(commitAt > -1, `missing ${commit}`);
    assert.ok(dispatchAt > commitAt, `${dispatch} must come after ${commit}`);
    return source.slice(commitAt, dispatchAt + dispatch.length + 80);
  };

  it("publishes first and checks the publication afterwards, without waiting", () => {
    const editor = read("pages/project-editor.js");
    const handlePublish = editor.slice(editor.indexOf("async function handlePublish()"), editor.indexOf("async function handleArchive()"));
    const between = after(handlePublish, "await updateProject(id, values)", 'notifyProjectEvent("project.published", updated)');
    assert.doesNotMatch(between, /await notifyProjectEvent/);
    // Only when the stored row came back published.
    assert.match(handlePublish, /updated\.editorialStatus === "PUBLISHED"/);
  });

  it("dispatches project.completed from the persisted status moving into Live", () => {
    const editor = read("pages/project-editor.js");
    assert.match(editor, /const COMPLETED_STATUS = "Live";/);
    assert.match(editor, /before\?\.status === COMPLETED_STATUS \|\| updated\?\.status !== COMPLETED_STATUS/);
    for (const handler of ["handleSave", "handlePublish"]) {
      const start = editor.indexOf(`async function ${handler}()`);
      after(editor.slice(start, start + 2500), "await updateProject(id, values)", "notifyCompletion(project, updated)");
    }
  });

  it("checks a publication approved through review after the database applied it", () => {
    const review = read("pages/approval-review.js");
    const between = after(review, "await withStepUp(() => approveRequest(request.id", 'dispatchAfterCommit("project.published"');
    assert.match(between, /void dispatchAfterCommit/);
    assert.match(review, /operationId: `approval:\$\{request\.id\}`/);
  });

  it("checks completion when an approval moves the stored status into Live", () => {
    const review = read("pages/approval-review.js");
    const between = after(review, "await withStepUp(() => approveRequest(request.id", 'dispatchAfterCommit("project.completed"');
    assert.match(between, /statusChange\?\.old !== "Live" && statusChange\?\.new === "Live"/);
    assert.match(review, /operationId: `approval:\$\{request\.id\}:completed`/);
  });

  it("opens a won deal's project only after the win is saved", () => {
    const commercial = read("pages/commercial.js");
    const between = after(commercial, "await winOpportunity(deal.id", "openWonProject(deal");
    assert.match(between, /void openWonProject/);
  });

  it("keeps every request to the service in its one client", () => {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".js")) files.push(path);
      }
    };
    walk(SRC);
    const relative = (path) => path.slice(SRC.length).replaceAll("\\", "/");
    // Only the client knows the service's routes; pages call its functions.
    const routes = files.filter((path) => readFileSync(path, "utf8").includes("/api/v1/")).map(relative);
    assert.deepEqual(routes, ["services/automation-api.js"]);
    assert.ok(files.every((path) => !/X-Scheduler-Token/i.test(readFileSync(path, "utf8"))), "the browser never holds the scheduler token");
  });
});

// End-to-end coverage of the automation integration in the Admin: the
// Dashboard panel, Logs › Automações (table, detail, retry) and Settings ›
// Sistema, against the service's real response shapes -- and the four states
// an operator must be able to tell apart: online, unavailable, not configured,
// no access.
//
// The service is stood in for at the network layer (page.route), so this runs
// with no Python process and no database. Mock mode, like the other suites.
//
//   VITE_ADMIN_DATA_SOURCE=mock VITE_AUTOMATION_API_URL=http://127.0.0.1:8999 npm run dev:mock   # terminal 1
//   BASE_URL=http://127.0.0.1:5173 AUTOMATION_URL=http://127.0.0.1:8999 npm run test:e2e:automation
//
// UNCONFIGURED_URL=<a dev server without VITE_AUTOMATION_API_URL> adds the
// "not configured" check.

import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const AUTOMATION_URL = (process.env.AUTOMATION_URL ?? "http://127.0.0.1:8999").replace(/\/+$/, "");

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
page.on("console", (message) => {
  // A refused request to the stand-in service is the scenario under test.
  if (message.type() === "error" && !message.text().includes("Failed to load resource") && !message.text().includes("net::ERR")) {
    errors.push(`console: ${message.text()}`);
  }
});

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
const CORS = {
  "access-control-allow-origin": new URL(BASE_URL).origin,
  "access-control-allow-headers": "Content-Type, Authorization, X-Request-ID",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const FAILED_RUN = {
  run_id: "00000000-0000-4000-8000-000000000001",
  event: "project.published",
  status: "FAILED",
  source: "admin",
  entity_type: "project",
  entity_id: "11111111-2222-3333-4444-555555555555",
  steps: [
    { name: "load_project", status: "SUCCESS", duration_ms: 12 },
    { name: "analyze_project", status: "SUCCESS", duration_ms: 3 },
    { name: "check_live_preview", status: "FAILED", duration_ms: 8000, error: "A URL de preview não respondeu (timeout)." },
  ],
  result: { steps_total: 4, steps_run: 3, summary: null, actions: [] },
  error: "A URL de preview não respondeu (timeout).",
  started_at: iso(30),
  finished_at: iso(30),
  duration_ms: 8015,
  created_at: iso(30),
  persisted: true,
  retryable: true,
};

const WON_RUN = {
  run_id: "00000000-0000-4000-8000-000000000002",
  event: "commercial.opportunity.won",
  status: "SUCCESS",
  source: "admin",
  entity_type: "opportunity",
  entity_id: "cccccccc-3333-4333-8333-000000000001",
  steps: [{ name: "open_project", status: "SUCCESS", duration_ms: 40 }],
  result: {
    business_status: "SUCCESS",
    summary: { case_number: 7, project_id: "22222222-2222-4222-8222-000000000001", warnings: [] },
    actions: [{ action: "project.create", status: "executed", entity_id: "22222222-2222-4222-8222-000000000001" }],
  },
  duration_ms: 64,
  created_at: iso(5),
  persisted: true,
  retryable: false,
};

// One stand-in service per scenario. `mode` decides how it answers.
let mode = "online";
let runs = [WON_RUN, FAILED_RUN];
const requests = [];

function body(path) {
  if (path === "/api/v1/health") {
    return {
      status: "ok",
      service: "space-underground-automation",
      version: "0.2.0",
      environment: "production",
      dependencies: [{ name: "supabase", configured: true }, { name: "authentication", configured: true }, { name: "automation_storage", configured: true }],
      auth_modes: ["member"],
    };
  }
  if (path === "/api/v1/ready") {
    return {
      ready: true,
      environment: "production",
      checks: [
        { name: "configuration", configured: true },
        { name: "automation_storage", configured: true },
        { name: "automation_schema", configured: true },
      ],
    };
  }
  if (path === "/api/v1/auth/me") return { kind: "member", user_id: "u-1", permissions: ["logs.read", "projects.read", "settings.edit"] };
  if (path === "/api/v1/automations/runs/stats") {
    const failed = runs.filter((run) => run.status === "FAILED" && !runs.some((other) => other.retry_of === run.run_id && other.status === "SUCCESS"));
    return {
      total: 6 + runs.length - 2,
      success: 5 + runs.length - 2,
      failed: 1,
      running_stale: 0,
      success_rate: 83.3,
      last_run: { run_id: runs[0].run_id, event: runs[0].event, status: runs[0].status, created_at: runs[0].created_at },
      attention: failed.map((run) => ({ ...run, reason: "failed" })),
      window: 100,
      storage_available: true,
    };
  }
  if (path === "/api/v1/automations/runs") return { runs, count: runs.length, limit: 100, storage_available: true };
  return null;
}

await page.route(`${AUTOMATION_URL}/**`, async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  requests.push(`${request.method()} ${url.pathname}`);

  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  if (mode === "offline") return route.abort("connectionrefused");
  if (mode === "not-configured") {
    return route.fulfill({ status: 503, headers: CORS, contentType: "application/json", body: JSON.stringify({ code: "not_configured", message: "Supabase is not configured." }) });
  }
  if (mode === "forbidden" && url.pathname !== "/api/v1/health") {
    return route.fulfill({ status: 403, headers: CORS, contentType: "application/json", body: JSON.stringify({ code: "forbidden", message: "no" }) });
  }

  const retry = url.pathname.match(/^\/api\/v1\/automations\/runs\/([^/]+)\/retry$/);
  if (retry && request.method() === "POST") {
    const operation = JSON.parse(request.postData() || "{}").operation_id;
    assert.ok(operation, "a retry carries its operation id");
    const created = { ...FAILED_RUN, run_id: "00000000-0000-4000-8000-000000000003", status: "SUCCESS", source: "retry", retry_of: retry[1], error: null, retryable: false, created_at: iso(0) };
    runs = [created, ...runs];
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(created) });
  }

  const answer = body(url.pathname);
  if (!answer) return route.fulfill({ status: 404, headers: CORS, contentType: "application/json", body: JSON.stringify({ code: "not_found", message: "Not Found" }) });
  return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(answer) });
});

async function signIn() {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForFunction(() => window.__spaceAdminDataSource !== undefined, null, { timeout: 20000 });
  const dataSource = await page.evaluate(() => window.__spaceAdminDataSource);
  if (dataSource !== "mock") throw new Error(`Refusing to run: the admin is in "${dataSource}" mode.`);
  await page.fill("#login-email", "admin@spaceunderground.local");
  await page.fill("#login-password", "mock-password");
  await page.click("[data-login-submit]");
  await page.waitForSelector(".admin-shell");
}

async function dashboardAutomation(expected) {
  await page.goto(`${BASE_URL}/#/dashboard`);
  await page.reload();
  await page.waitForSelector(`[data-dash-automation]:not([aria-busy]) [data-automation-status="${expected}"]`, { timeout: 15000 });
  return page.locator("[data-dash-automation]");
}

const checks = [];
const check = (label, fn) => checks.push([label, fn]);

check("the Admin is built with the automation URL", async () => {
  await page.goto(`${BASE_URL}/#/settings`);
  await page.click("#settings-tab-system");
  await page.waitForSelector("[data-automation-grid] div");
  const configured = await page.locator("[data-automation-grid] div").first().innerText();
  assert.match(configured, /Configurado/, `start the dev server with VITE_AUTOMATION_API_URL=${AUTOMATION_URL}`);
});

check("Dashboard: online, counts, rate and the run that needs attention", async () => {
  mode = "online";
  runs = [WON_RUN, FAILED_RUN];
  const panel = await dashboardAutomation("success");
  const text = await panel.innerText();
  assert.match(text, /Online/i);
  assert.match(text, /83.3%/);
  assert.match(text, /Projeto publicado/);
  assert.match(text, /Falhou/);
  assert.equal(await page.locator("[data-automation-attention] a").first().getAttribute("href"), "#/logs/automation");
  assert.equal(await page.locator(".dash-panel:has([data-dash-automation])").getAttribute("data-emphasis"), "danger");
});

check("Logs › Automações: the runs, the detail, and a retry that adds a run", async () => {
  mode = "online";
  runs = [WON_RUN, FAILED_RUN];
  await page.goto(`${BASE_URL}/#/logs/automation`);
  await page.waitForSelector("[data-runs-body] tbody tr");
  assert.equal(await page.locator("[data-runs-body] tbody tr").count(), 2);
  assert.equal(await page.locator("#logs-tab-automation").getAttribute("aria-selected"), "true", "the route opens the automation tab");

  await page.selectOption("[data-runs-status]", "FAILED");
  assert.equal(await page.locator("[data-runs-body] tbody tr").count(), 1, "status filter");
  await page.selectOption("[data-runs-status]", "");

  await page.click(`[data-run-open="${FAILED_RUN.run_id}"]`);
  await page.waitForSelector(".modal .automation-detail");
  const detail = await page.locator(".modal").innerText();
  assert.match(detail, /Verificar a demonstração ao vivo/);
  assert.match(detail, /não respondeu/);
  await page.click(".modal [data-modal-confirm]");
  await page.waitForFunction(() => document.querySelectorAll("[data-runs-body] tbody tr").length === 3);
  assert.ok(requests.includes(`POST /api/v1/automations/runs/${FAILED_RUN.run_id}/retry`));
  // The original stays in the history, untouched.
  assert.equal(await page.locator(`[data-run-open="${FAILED_RUN.run_id}"]`).count(), 1);
});

check("Settings › Sistema: version, readiness and the session, never a secret", async () => {
  mode = "online";
  await page.goto(`${BASE_URL}/#/settings`);
  await page.reload();
  await page.click("#settings-tab-system");
  await page.waitForSelector('[data-automation-settings] [data-automation-status="success"]');
  const text = await page.locator("[data-automation-settings]").innerText();
  assert.match(text, /0\.2\.0/);
  assert.match(text, /Pronto/);
  assert.match(text, /Membro verificado/);
  assert.equal(await page.locator("[data-automation-checks] li").count(), 3);
  assert.doesNotMatch(text, /sb_secret|service_role|eyJ/);
});

check("unavailable is said as unavailable, and the Dashboard still renders", async () => {
  mode = "offline";
  const panel = await dashboardAutomation("error");
  assert.match(await panel.innerText(), /Indisponível/i);
  // One optional service failing never blanks the rest.
  await page.waitForSelector("[data-pulse-row]");

  await page.goto(`${BASE_URL}/#/logs/automation`);
  await page.waitForSelector('[data-runs-service] [data-automation-status="error"]');
  assert.match(await page.locator("[data-runs-body]").innerText(), /não respondeu/);
});

check("a service missing its own configuration is 'not configured', not an outage", async () => {
  mode = "not-configured";
  const panel = await dashboardAutomation("not-configured");
  assert.match(await panel.innerText(), /Não configurado/i);
});

check("a member without access is told so, not shown an outage", async () => {
  mode = "forbidden";
  const panel = await dashboardAutomation("forbidden");
  assert.match(await panel.innerText(), /Sem acesso/i);
});

check("the editor's analysis says it does not apply in mock mode", async () => {
  mode = "online";
  // Seeded mock projects are addressed by padded case number.
  await page.goto(`${BASE_URL}/#/projects/001`);
  await page.waitForSelector("[data-project-analysis]");
  assert.match(await page.locator("[data-project-analysis]").innerText(), /modo mock/);
});

// Optional: a second dev server built without VITE_AUTOMATION_API_URL. The
// panels say "not configured" and the service is never called.
const UNCONFIGURED_URL = process.env.UNCONFIGURED_URL;
if (UNCONFIGURED_URL) {
  check("an Admin without the service says 'not configured' and never calls it", async () => {
    const before = requests.length;
    await page.goto(`${UNCONFIGURED_URL}/#/login`);
    await page.fill("#login-email", "admin@spaceunderground.local");
    await page.fill("#login-password", "mock-password");
    await page.click("[data-login-submit]");
    await page.waitForSelector('[data-dash-automation] [data-automation-status="not-configured"]', { timeout: 15000 });
    assert.match(await page.locator("[data-dash-automation]").innerText(), /VITE_AUTOMATION_API_URL/);
    await page.goto(`${UNCONFIGURED_URL}/#/logs/automation`);
    await page.waitForSelector('[data-runs-service] [data-automation-status="not-configured"]');
    assert.equal(requests.length, before, "no request reached the service");
  });
}

let failed = 0;
try {
  await signIn();
  for (const [label, fn] of checks) {
    try {
      await fn();
      console.log(`PASS  ${label}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${label}\n      ${error.message}`);
    }
  }
  if (errors.length) {
    failed += 1;
    console.log(`FAIL  page errors\n      ${errors.join("\n      ")}`);
  }
} finally {
  await browser.close();
}

console.log(failed ? `\n${failed} check(s) failed` : `\nadmin automation: ${checks.length}/${checks.length} checks passed`);
process.exitCode = failed ? 1 : 0;

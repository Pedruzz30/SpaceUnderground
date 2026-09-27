// End-to-end validation of Clients V2 against a REAL Supabase project.
//
// Requires the clients foundation migration to be applied to that project first; without
// them the Client Hub reports the missing schema and this run fails at the
// first check, which is the point.
//
//   npm run dev                                  # terminal 1, with admin/.env
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... BASE_URL=http://127.0.0.1:5173 \
//     npm run test:e2e:clients
//
// Safe against a live project: it only touches clients it creates, names them
// "E2E Client <timestamp>", never links or edits real projects, and deletes its
// own rows at the end. The Admin has no hard delete for clients, so cleanup
// signs in as the same admin through the anon key and removes the rows through
// RLS, exactly like the seed scripts. Activity log entries stay: the log is an
// append-only audit trail with no delete policy.

import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!EMAIL || !PASSWORD || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ADMIN_EMAIL, ADMIN_PASSWORD, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.");
  process.exit(2);
}

const stamp = Date.now();
const NAME = `E2E Client ${stamp}`;

const checks = [];
function check(ok, label, extra = "") {
  checks.push({ ok, label, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const appErrors = [];
page.on("pageerror", (error) => appErrors.push(`pageerror: ${error.message}`));

const hash = () => page.evaluate(() => window.location.hash);
const created = [];

async function login() {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForSelector("[data-login-form]");
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.click("[data-login-submit]");
  await page.waitForSelector(".admin-shell", { timeout: 20000 });
}

async function openHub() {
  await page.goto(`${BASE_URL}/#/clients`);
  await page.waitForFunction(() => !document.querySelector("[data-client-list]")?.hasAttribute("aria-busy"), null, {
    timeout: 20000,
  });
}

async function confirmModal() {
  await page.waitForSelector("[data-modal-confirm]");
  await page.click("[data-modal-confirm]");
}

try {
  await login();
  const dataSource = await page.evaluate(() => window.__spaceAdminDataSource);
  assert.equal(dataSource, "supabase", `refusing to run: the admin is in "${dataSource}" mode`);

  // --- Hub ------------------------------------------------------------------
  await openHub();
  const loadedRows = await page.locator("[data-client-row]").count();
  const hubError = loadedRows ? "" : await page.locator("[data-client-list] .empty-inline").innerText();
  const hubReady = (await page.locator("[data-search-clients]:not([disabled])").count()) > 0;
  check(hubReady, "client hub loads from Supabase", hubError || `${loadedRows} rows`);

  // --- Create ---------------------------------------------------------------
  await page.goto(`${BASE_URL}/#/clients/new`);
  await page.waitForSelector('[data-client-editor][data-mode="create"]', { timeout: 20000 });
  await page.fill("#field-name", NAME);
  await page.fill("#field-email", `e2e-${stamp}@example.com`);
  await page.selectOption("#field-status", "LEAD");
  await page.click("[data-client-save]");
  await page.waitForSelector('[data-client-editor][data-mode="edit"]', { timeout: 20000 });
  const id = decodeURIComponent((await hash()).split("/").pop());
  created.push(id);
  check(/^[0-9a-f-]{36}$/.test(id), "client created in Supabase with a uuid", id);

  const identity = await page.locator("[data-client-identity]").innerText();
  check(/CLIENT-\d{3,}/.test(identity), "the database assigned a CLIENT code", identity);

  // --- Locate ---------------------------------------------------------------
  await openHub();
  await page.fill("[data-search-clients]", String(stamp));
  await page.waitForTimeout(300);
  check((await page.locator("[data-client-row]").count()) === 1, "search finds the new client");

  // --- Edit -----------------------------------------------------------------
  await page.goto(`${BASE_URL}/#/clients/${id}`);
  await page.waitForSelector("[data-client-editor]", { timeout: 20000 });
  await page.click('[data-tab="general"]');
  await page.fill("#field-company", "E2E Holdings");
  await page.selectOption("#field-status", "ACTIVE");
  await page.click("[data-client-save]");
  await page.waitForSelector("[data-save-state].is-saved", { timeout: 20000 });
  await page.reload();
  await page.waitForSelector("[data-client-editor]", { timeout: 20000 });
  await page.click('[data-tab="general"]');
  check((await page.inputValue("#field-company")) === "E2E Holdings", "edit persisted in Supabase");

  // --- Archive / restore ----------------------------------------------------
  await page.click('[data-tab="overview"]');
  await page.click('[data-client-lifecycle="archive"]');
  await confirmModal();
  await page.waitForSelector('[data-client-lifecycle="unarchive"]', { timeout: 20000 });
  check(true, "client archived");

  await openHub();
  await page.click('[data-client-filter="ARCHIVED"]');
  await page.fill("[data-search-clients]", String(stamp));
  await page.waitForTimeout(300);
  check((await page.locator("[data-client-row]").count()) === 1, "archived filter finds the client");

  await page.locator("[data-client-row] [data-row-menu-toggle]").first().click();
  await page.locator("[data-client-row] [data-client-unarchive]").first().click();
  await confirmModal();
  await page.waitForFunction(() => document.querySelectorAll("[data-client-row]").length === 0, null, { timeout: 20000 });
  await page.click('[data-client-filter="INACTIVE"]');
  await page.waitForTimeout(300);
  check((await page.locator("[data-client-row]").count()) === 1, "restored client returns as inactive");

  // --- Activity -------------------------------------------------------------
  await page.goto(`${BASE_URL}/#/clients/${id}`);
  await page.waitForSelector("[data-client-editor]", { timeout: 20000 });
  await page.click('[data-tab="activity"]');
  const activity = await page.locator("[data-client-activity]").innerText();
  check(/Client created/.test(activity) && /Client archived/.test(activity), "lifecycle is recorded in the activity log");

  check(appErrors.length === 0, "no uncaught application errors", appErrors.join(" | ") || "none");
} finally {
  await browser.close();

  if (created.length) {
    console.log(`\nCleaning up ${created.length} test client(s)...`);
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
      if (signInError) throw signInError;
      // Scoped by id and by the E2E name, so a wrong id can never match a real client.
      const { error } = await supabase.from("clients").delete().in("id", created).like("name", "E2E Client %");
      if (error) throw error;
      console.log("  removed");
      await supabase.auth.signOut();
    } catch (error) {
      console.log(`  could not remove ${created.join(", ")}: ${error.message}`);
    }
  }
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((entry) => console.log(` - ${entry.label} ${entry.extra}`));
  process.exit(1);
}

// End-to-end validation of Clients V2 against a REAL Supabase project.
//
// Requires the clients foundation migration to be applied to that project.
//
//   npm run dev                                  # terminal 1, with admin/.env
//   BASE_URL=http://127.0.0.1:5173 npm run test:e2e:clients
//   (ADMIN_EMAIL / ADMIN_PASSWORD from admin/.env.local)
//
// What it touches, all tagged with one run stamp:
//   - creates client A "E2E Client <stamp>" through the UI and client B
//     "E2E Client <stamp> B" through the API as the admin;
//   - creates one hidden DRAFT project "E2E Project <stamp>"
//     (slug e2e-clients-<stamp>) to link, so no real project is ever linked or
//     has its updated_at bumped;
//   - edits, links, unlinks, archives and restores only those rows.
// Cleanup deletes both clients and the project through the same admin RLS
// path, then queries the database and fails unless nothing is left. It never
// touches plans, site content, settings, translations or automation data.
// Activity log entries stay (append-only by design), and CLIENT-### numbers
// the run consumed are not reused: the sequence only moves forward.

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
const NAME_A = `E2E Client ${stamp}`;
const NAME_B = `E2E Client ${stamp} B`;
const PROJECT_SLUG = `e2e-clients-${stamp}`;

const checks = [];
function check(ok, label, extra = "") {
  checks.push({ ok, label, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
}

const codeNumber = (code) => Number(String(code).replace(/^CLIENT-/, ""));

// Admin session through the anon key: the same RLS path as the Admin itself.
const api = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: signInError } = await api.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInError) {
  console.error(`admin sign-in failed: ${signInError.message}`);
  process.exit(2);
}

async function clientRow(id) {
  const { data, error } = await api.from("clients").select("id,code,name,company,phone,notes,status,archived_at").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function projectClientId(projectId) {
  const { data, error } = await api.from("projects").select("client_id").eq("id", projectId).single();
  if (error) throw error;
  return data.client_id;
}

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const appErrors = [];
const authFailures = [];

function watch(target) {
  target.on("pageerror", (error) => appErrors.push(`pageerror: ${error.message}`));
  target.on("response", (response) => {
    if (response.url().startsWith(SUPABASE_URL) && [401, 403].includes(response.status())) {
      authFailures.push(`${response.status()} ${response.request().method()} ${response.url().split("?")[0]}`);
    }
  });
}
watch(page);

const hash = (target = page) => target.evaluate(() => window.location.hash);

async function openHub() {
  await page.goto(`${BASE_URL}/#/clients`);
  await page.waitForFunction(() => !document.querySelector("[data-client-list]")?.hasAttribute("aria-busy"), null, {
    timeout: 20000,
  });
}

async function openClient(target, id, tab) {
  await target.goto(`${BASE_URL}/#/clients/${id}`);
  await target.waitForSelector("[data-client-editor]", { timeout: 20000 });
  if (tab) await target.click(`[data-tab="${tab}"]`);
}

async function confirmModal(target = page) {
  await target.waitForSelector("[data-modal-confirm]");
  await target.click("[data-modal-confirm]");
}

async function search(term) {
  await page.fill("[data-search-clients]", term);
  await page.waitForTimeout(300);
  return page.locator("[data-client-row]").count();
}

let projectId = null;
let projectCase = null;
let clientA = null;
let clientB = null;

try {
  // --- Setup: a disposable, hidden draft project ---------------------------
  const { data: highest } = await api.from("projects").select("case_number").order("case_number", { ascending: false }).limit(1).single();
  const { data: project, error: projectError } = await api
    .from("projects")
    .insert({
      case_number: highest.case_number + 1,
      name: `E2E Project ${stamp}`,
      slug: PROJECT_SLUG,
      category: "Other",
      status: "In Development",
      editorial_status: "DRAFT",
      visible: false,
    })
    .select("id,case_number")
    .single();
  if (projectError) throw projectError;
  projectId = project.id;
  projectCase = String(project.case_number).padStart(3, "0");
  check(true, "created a hidden draft project to link", `CASE ${projectCase}`);

  // --- Sign in and hub ------------------------------------------------------
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForSelector("[data-login-form]");
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.click("[data-login-submit]");
  await page.waitForSelector(".admin-shell", { timeout: 20000 });
  const dataSource = await page.evaluate(() => window.__spaceAdminDataSource);
  if (dataSource !== "supabase") throw new Error(`refusing to run: the admin is in "${dataSource}" mode`);

  await openHub();
  check((await page.locator("[data-search-clients]:not([disabled])").count()) > 0, "client hub loads from Supabase");

  // --- Create client A through the UI ---------------------------------------
  await page.goto(`${BASE_URL}/#/clients/new`);
  await page.waitForSelector('[data-client-editor][data-mode="create"]', { timeout: 20000 });
  await page.fill("#field-name", NAME_A);
  await page.fill("#field-email", `e2e-${stamp}@example.com`);
  await page.selectOption("#field-status", "LEAD");
  await page.click('[data-tab="notes"]');
  await page.fill("#field-notes", "Created by the Clients E2E run.");
  await page.click("[data-client-save]");
  await page.waitForSelector('[data-client-editor][data-mode="edit"]', { timeout: 20000 });
  clientA = decodeURIComponent((await hash()).split("/").pop());
  const rowA = await clientRow(clientA);
  check(/^CLIENT-\d{3,}$/.test(rowA.code), "the database assigned a CLIENT code", rowA.code);
  check(rowA.notes === "Created by the Clients E2E run.", "notes were saved on create");

  // --- Nobody but an admin can draw a code ----------------------------------
  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/next_client_code`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: "{}",
  });
  const rpcBody = await rpc.json().catch(() => ({}));
  check(!rpc.ok, "an anonymous visitor cannot call next_client_code", `${rpc.status} ${rpcBody.code ?? ""}`);

  const { data: insertedB, error: errorB } = await api.from("clients").insert({ name: NAME_B, status: "LEAD" }).select("id,code").single();
  if (errorB) throw errorB;
  clientB = insertedB.id;
  check(
    codeNumber(insertedB.code) === codeNumber(rowA.code) + 1,
    "the refused call consumed no number (next admin code is the very next one)",
    `${rowA.code} -> ${insertedB.code}`,
  );

  // --- List and search ------------------------------------------------------
  await openHub();
  check((await search(String(stamp))) === 2, "search by name finds both E2E clients");
  check((await search(rowA.code)) === 1, "search by code finds client A", rowA.code);

  // --- Edit -----------------------------------------------------------------
  await openClient(page, clientA, "general");
  await page.fill("#field-company", "E2E Holdings");
  await page.fill("#field-phone", "+55 21 90000-0000");
  await page.selectOption("#field-status", "ACTIVE");
  await page.click('[data-tab="notes"]');
  await page.fill("#field-notes", "Edited by the Clients E2E run.");
  await page.click("[data-client-save]");
  await page.waitForSelector("[data-save-state].is-saved", { timeout: 20000 });
  const edited = await clientRow(clientA);
  check(
    edited.company === "E2E Holdings" && edited.phone === "+55 21 90000-0000" && edited.status === "ACTIVE",
    "edits persisted in Supabase",
  );
  check(edited.notes === "Edited by the Clients E2E run.", "notes edit persisted");

  // --- Link, stale relink, unlink -------------------------------------------
  // A second tab opens client B while the project is still free.
  const tabB = await context.newPage();
  watch(tabB);
  await openClient(tabB, clientB, "projects");
  check(
    (await tabB.locator(`[data-link-project-select] option[value="${projectCase}"]`).count()) === 1,
    "the free project is offered in the second tab",
  );

  await openClient(page, clientA, "projects");
  await page.selectOption("[data-link-project-select]", projectCase);
  await page.click("[data-link-project]");
  await page.waitForSelector(`[data-client-project="${projectCase}"]`, { timeout: 20000 });
  check((await projectClientId(projectId)) === clientA, "linked the free project to client A");

  // The second tab still thinks the project is free.
  await tabB.selectOption("[data-link-project-select]", projectCase);
  await tabB.click("[data-link-project]");
  await tabB.waitForFunction(
    (value) => !document.querySelector(`[data-link-project-select] option[value="${value}"]`),
    projectCase,
    { timeout: 20000 },
  );
  check((await projectClientId(projectId)) === clientA, "a stale link from another tab did not move the project");
  check((await tabB.locator(`[data-client-project="${projectCase}"]`).count()) === 0, "the stale tab refreshed to the real link");
  await tabB.close();

  await page.click(`[data-unlink-project="${projectCase}"]`);
  await page.waitForSelector(`[data-link-project-select] option[value="${projectCase}"]`, { state: "attached", timeout: 20000 });
  check((await projectClientId(projectId)) === null, "unlinked the project");

  // --- Archive and restore ----------------------------------------------------
  await page.click('[data-tab="overview"]');
  await page.click('[data-client-lifecycle="archive"]');
  await confirmModal();
  await page.waitForSelector('[data-client-lifecycle="unarchive"]', { timeout: 20000 });
  const archived = await clientRow(clientA);
  check(archived.status === "ARCHIVED" && Boolean(archived.archived_at), "archive set ARCHIVED and archived_at", archived.archived_at);

  await openHub();
  await page.click('[data-client-filter="ARCHIVED"]');
  check((await search(String(stamp))) === 1, "archived filter finds client A");
  await page.locator("[data-client-row] [data-row-menu-toggle]").first().click();
  await page.locator("[data-client-row] [data-client-unarchive]").first().click();
  await confirmModal();
  await page.waitForFunction(() => document.querySelectorAll("[data-client-row]").length === 0, null, { timeout: 20000 });
  const restored = await clientRow(clientA);
  check(restored.status === "INACTIVE" && restored.archived_at === null, "restore set INACTIVE and cleared archived_at");

  // --- Activity -------------------------------------------------------------
  await openClient(page, clientA, "activity");
  const activity = await page.locator("[data-client-activity]").innerText();
  const expected = ["Client created", "Client updated", "Project linked to client", "Project unlinked from client", "Client archived", "Client unarchived"];
  const missing = expected.filter((title) => !activity.includes(title));
  check(missing.length === 0, "the activity log recorded every step", missing.join(", ") || "all present");

  check(appErrors.length === 0, "no uncaught application errors", appErrors.join(" | ") || "none");
  check(authFailures.length === 0, "no unexpected 401/403 for the admin", authFailures.join(" | ") || "none");
} catch (error) {
  check(false, "run aborted", error.message);
} finally {
  await browser.close();

  console.log("\nCleaning up...");
  try {
    if (projectId) {
      await api.from("projects").update({ client_id: null }).eq("id", projectId);
      const { error } = await api.from("projects").delete().eq("id", projectId).eq("slug", PROJECT_SLUG);
      if (error) throw error;
    }
    // By run stamp, so a client whose id was never captured is still removed.
    const { error: clientsError } = await api.from("clients").delete().like("name", `E2E Client ${stamp}%`);
    if (clientsError) throw clientsError;

    // A blocked delete returns no error, so the result is read back.
    const { count: leftClients } = await api.from("clients").select("id", { count: "exact", head: true }).like("name", "E2E Client %");
    const { count: leftProjects } = await api.from("projects").select("id", { count: "exact", head: true }).like("slug", "e2e-clients-%");
    const { count: linked } = await api.from("projects").select("id", { count: "exact", head: true }).not("client_id", "is", null);
    check(leftClients === 0, "cleanup: no E2E client left", String(leftClients));
    check(leftProjects === 0, "cleanup: no E2E project left", String(leftProjects));
    check(linked === 0, "cleanup: no project left linked to a client", String(linked));
  } catch (error) {
    check(false, "cleanup failed", error.message);
  }
  await api.auth.signOut();
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((entry) => console.log(` - ${entry.label} ${entry.extra}`));
  process.exit(1);
}

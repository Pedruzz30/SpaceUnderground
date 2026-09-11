// End-to-end validation of the admin against a REAL Supabase project.
//
//   npm run dev                                  # terminal 1, with admin/.env
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... BASE_URL=http://127.0.0.1:5173 \
//     npm run test:e2e:supabase
//
// Unlike admin-flow.mjs (mock mode) this makes no assumption about seeded data
// and cleans up every project it creates, so it is safe to run against a live
// project. It never writes credentials anywhere.

import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  process.exit(2);
}

const stamp = Date.now();
const SLUG_A = `e2e-alpha-${stamp}`;
const SLUG_B = `e2e-beta-${stamp}`;

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
const ROW = "[data-project-list] [data-project-id]";
const created = [];

async function login() {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForSelector("[data-login-form]");
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.click("[data-login-submit]");
  await page.waitForSelector(".admin-shell", { timeout: 20000 });
}

async function openNewProject() {
  await page.goto(`${BASE_URL}/#/projects/new`);
  await page.waitForSelector("[data-action-create]", { timeout: 20000 });
}

async function fillProject({ name, slug }) {
  await page.fill("#field-name", name);
  await page.fill("#field-slug", slug);
  await page.selectOption("#field-category", "System");
  await page.selectOption("#field-status", "MVP");
}

async function publishedMetaValue() {
  await page.click("#tab-publishing");
  return page.locator(".meta-grid div:last-child strong").innerText();
}

try {
  // --- Authentication -------------------------------------------------------
  await login();
  check((await hash()) === "#/dashboard", "real Supabase login reaches the dashboard", await hash());

  await page.waitForSelector('[data-health-metric="published"]');
  check(
    /^\d+$/.test((await page.locator('[data-health-metric="published"]').innerText()).trim()),
    "dashboard derives publication counts from Supabase",
  );

  // Session must survive a reload without bouncing to login.
  await page.reload();
  await page.waitForSelector(".admin-shell", { timeout: 20000 });
  check((await hash()) === "#/dashboard", "session persists across a reload", await hash());

  // --- Project list ---------------------------------------------------------
  await page.click('a[href="#/projects"]');
  await page.waitForSelector("[data-project-list]");
  await page.waitForFunction(() => !document.querySelector("[data-project-list]")?.hasAttribute("aria-busy"), null, {
    timeout: 20000,
  });
  const initialRows = await page.locator(ROW).count();
  check(true, "projects list loads from Supabase", `${initialRows} existing rows`);

  // --- Create ---------------------------------------------------------------
  await openNewProject();
  const suggestedCase = await page.inputValue("#field-caseNumber");
  check(/^\d{3}$/.test(suggestedCase), "next case number comes from the database", suggestedCase);

  await fillProject({ name: `E2E Alpha ${stamp}`, slug: SLUG_A });
  await page.click("[data-action-create]");
  await page.waitForSelector("[data-action-save]", { timeout: 20000 });
  const alphaId = (await hash()).split("/").pop();
  created.push(alphaId);
  check(Boolean(alphaId), "project created in Supabase and editor opened", `#/projects/${alphaId}`);

  // --- Edit -----------------------------------------------------------------
  await page.fill("#field-client", "Orbital Industries");
  await page.waitForTimeout(200);
  check((await page.locator("[data-save-state]").innerText()) === "UNSAVED CHANGES", "editing marks the record dirty");

  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved", { timeout: 20000 });
  check(true, "save changes persists to Supabase");

  await page.reload();
  await page.waitForSelector("#field-client", { timeout: 20000 });
  check((await page.inputValue("#field-client")) === "Orbital Industries", "edit survives a reload");

  // --- Duplicate slug -------------------------------------------------------
  await openNewProject();
  await fillProject({ name: `E2E Beta ${stamp}`, slug: SLUG_A });
  await page.click("[data-action-create]");
  await page.waitForTimeout(2500);

  const slugError = await page.locator("#field-slug-error:not([hidden])").innerText().catch(() => "");
  check(/already in use/i.test(slugError), "duplicate slug surfaces as an inline field error", slugError || "no inline error");
  check((await hash()) === "#/projects/new", "duplicate slug keeps the user in the form", await hash());
  check(
    (await page.getAttribute("#field-slug", "aria-invalid")) === "true",
    "the offending field is marked aria-invalid",
  );

  // Recover with a unique slug.
  await page.fill("#field-slug", SLUG_B);
  await page.click("[data-action-create]");
  await page.waitForSelector("[data-action-save]", { timeout: 20000 });
  const betaId = (await hash()).split("/").pop();
  created.push(betaId);
  check(Boolean(betaId) && betaId !== alphaId, "recovering from the conflict creates the project", `#/projects/${betaId}`);

  // --- Publish --------------------------------------------------------------
  check((await publishedMetaValue()) === "—", "a fresh project has no published_at");

  await page.click("[data-action-publish]");
  await page.waitForTimeout(2500);
  check(
    (await page.locator(".editor-identity .badge").innerText()) === "PUBLISHED",
    "publish updates the editorial status",
  );

  const firstPublishedAt = await publishedMetaValue();
  check(firstPublishedAt !== "—", "publishing stamps published_at", firstPublishedAt);

  // --- Unpublish ------------------------------------------------------------
  await page.click("#tab-publishing");
  await page.check('input[name="editorialStatus"][value="DRAFT"]');
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved", { timeout: 20000 });
  check(
    (await page.locator(".editor-identity .badge").innerText()) === "DRAFT",
    "unpublishing returns the record to draft",
  );
  check(
    (await publishedMetaValue()) === firstPublishedAt,
    "published_at survives unpublishing",
    await publishedMetaValue(),
  );

  // --- Archive --------------------------------------------------------------
  await page.click("[data-action-archive]");
  await page.waitForSelector(".modal");
  await page.click(".modal__actions >> text=Archive Project");
  await page.waitForTimeout(2500);
  check(
    (await page.locator(".editor-identity .badge").innerText()) === "ARCHIVED",
    "archive updates the editorial status",
  );

  await page.click('a[href="#/projects"]');
  await page.waitForFunction(() => !document.querySelector("[data-project-list]")?.hasAttribute("aria-busy"), null, {
    timeout: 20000,
  });
  await page.click('[data-editorial-filter="ARCHIVED"]');
  await page.waitForTimeout(400);
  check((await page.locator(`${ROW}[data-project-id="${betaId}"]`).count()) === 1, "archived project appears under the Archived filter");

  // --- Delete ---------------------------------------------------------------
  for (const id of [...created]) {
    await page.goto(`${BASE_URL}/#/projects/${id}`);
    await page.waitForSelector("[data-action-delete]", { timeout: 20000 });
    await page.click("[data-action-delete]");
    await page.waitForSelector(".modal");
    await page.click(".modal__actions >> text=Delete Project");
    await page.waitForTimeout(2000);
    created.splice(created.indexOf(id), 1);
  }
  check((await hash()) === "#/projects", "delete returns to the project list", await hash());

  await page.waitForFunction(() => !document.querySelector("[data-project-list]")?.hasAttribute("aria-busy"), null, {
    timeout: 20000,
  });
  const finalRows = await page.locator(ROW).count();
  check(finalRows === initialRows, "the database is back to its original contents", `${finalRows} rows`);

  // --- Logout and route protection -----------------------------------------
  await page.click("[data-logout]");
  await page.waitForSelector("[data-login-form]", { timeout: 20000 });
  check((await hash()) === "#/login", "logout returns to the login screen");

  await page.goto(`${BASE_URL}/#/dashboard`);
  await page.waitForTimeout(2500);
  check((await hash()) === "#/login", "a signed-out user cannot reach the dashboard", await hash());

  await page.goto(`${BASE_URL}/#/projects/001`);
  await page.waitForTimeout(2000);
  check((await hash()) === "#/login", "a signed-out user cannot deep link into the editor", await hash());

  check(appErrors.length === 0, "no uncaught application errors", appErrors.join(" | ") || "none");
} finally {
  // Never leave test rows behind, even if an assertion failed midway.
  if (created.length) {
    console.log(`\nCleaning up ${created.length} leftover project(s)...`);
    for (const id of created) {
      try {
        await page.goto(`${BASE_URL}/#/projects/${id}`);
        await page.waitForSelector("[data-action-delete]", { timeout: 10000 });
        await page.click("[data-action-delete]");
        await page.waitForSelector(".modal");
        await page.click(".modal__actions >> text=Delete Project");
        await page.waitForTimeout(1500);
        console.log(`  removed ${id}`);
      } catch (error) {
        console.log(`  could not remove ${id}: ${error.message}`);
      }
    }
  }
  await browser.close();
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((entry) => console.log(` - ${entry.label} ${entry.extra}`));
  process.exit(1);
}

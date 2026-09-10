// Media end-to-end against a REAL Supabase project: uploads, persistence
// across sessions, replacement, removal, validation and cleanup on delete.
//
//   npm run dev                                  # terminal 1, with admin/.env
//   BASE_URL=http://127.0.0.1:5173 npm run test:e2e:media
//
// Requires admin/.env.local with ADMIN_EMAIL and ADMIN_PASSWORD. Every project
// it creates is deleted at the end, which also removes its files.

import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  process.exit(2);
}

// Smallest valid PNGs, so uploads stay fast and deterministic.
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const BLUE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const imageFile = (name, buffer) => ({ name, mimeType: "image/png", buffer });

const checks = [];
function check(ok, label, extra = "") {
  checks.push({ ok, label, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const appErrors = [];
page.on("pageerror", (error) => appErrors.push(error.message));

const hash = () => page.evaluate(() => window.location.hash);
const posterSrc = () => page.getAttribute("[data-poster-preview]", "src");
const created = [];

async function login() {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForSelector("[data-login-form]");
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.click("[data-login-submit]");
  await page.waitForSelector(".admin-shell", { timeout: 20000 });
}

async function saveChanges() {
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved", { timeout: 30000 });
}

async function openMediaTab() {
  await page.click("#tab-media");
  await page.waitForSelector("[data-replace-poster]");
}

try {
  await login();

  // --- Create the project the images will belong to -------------------------
  const stamp = Date.now();
  await page.goto(`${BASE_URL}/#/projects/new`);
  await page.waitForSelector("[data-action-create]", { timeout: 20000 });

  // Uploads are impossible before the project exists, so the controls are off.
  await openMediaTab();
  check(await page.isDisabled("[data-replace-poster]"), "poster upload is disabled while creating");
  check(await page.isDisabled("[data-gallery-add]"), "gallery upload is disabled while creating");

  await page.click("#tab-general");
  await page.fill("#field-name", `E2E Media ${stamp}`);
  await page.fill("#field-slug", `e2e-media-${stamp}`);
  await page.click("[data-action-create]");
  await page.waitForSelector("[data-action-save]", { timeout: 20000 });
  const projectId = (await hash()).split("/").pop();
  created.push(projectId);
  check(Boolean(projectId), "project created", `#/projects/${projectId}`);

  // --- Rejected files -------------------------------------------------------
  await openMediaTab();
  await page.setInputFiles("[data-poster-file]", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await page.waitForTimeout(1200);
  check(/unsupported image type/i.test(await page.locator("[data-toast-region]").innerText()), "non-image file is rejected");
  check(!(await posterSrc()), "rejected file does not become the poster");

  await page.setInputFiles("[data-poster-file]", {
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(6 * 1024 * 1024, 1),
  });
  await page.waitForTimeout(1200);
  check(/too large/i.test(await page.locator("[data-toast-region]").innerText()), "oversized file is rejected");

  // --- Poster upload --------------------------------------------------------
  await page.setInputFiles("[data-poster-file]", imageFile("poster.png", RED_PNG));
  await page.waitForFunction(() => {
    const img = document.querySelector("[data-poster-preview]");
    return img && !img.hidden && img.getAttribute("src");
  }, null, { timeout: 30000 });

  const uploadedSrc = await posterSrc();
  check(uploadedSrc.includes("/storage/v1/"), "poster is served from Supabase Storage", uploadedSrc.split("?")[0].slice(-40));
  check(!uploadedSrc.startsWith("blob:"), "poster is not a blob url");

  await saveChanges();

  // --- Survives a reload ----------------------------------------------------
  await page.reload();
  await page.waitForSelector("#field-name", { timeout: 20000 });
  await openMediaTab();
  await page.waitForSelector("[data-poster-preview]:not([hidden])", { timeout: 20000 });
  check(Boolean(await posterSrc()), "poster survives a reload");

  // --- Survives a brand new session ----------------------------------------
  await page.click("[data-logout]");
  await page.waitForSelector("[data-login-form]", { timeout: 20000 });
  await page.context().clearCookies();
  await login();
  await page.goto(`${BASE_URL}/#/projects/${projectId}`);
  await page.waitForSelector("#field-name", { timeout: 20000 });
  await openMediaTab();
  await page.waitForSelector("[data-poster-preview]:not([hidden])", { timeout: 20000 });
  check(Boolean(await posterSrc()), "poster survives logout and a new session");

  // --- Gallery --------------------------------------------------------------
  await page.setInputFiles("[data-gallery-file]", imageFile("one.png", RED_PNG));
  await page.waitForSelector(".gallery-item", { timeout: 30000 });
  await page.setInputFiles("[data-gallery-file]", imageFile("two.png", BLUE_PNG));
  await page.waitForFunction(() => document.querySelectorAll(".gallery-item").length === 2, null, { timeout: 30000 });
  await saveChanges();

  await page.reload();
  await page.waitForSelector("#field-name", { timeout: 20000 });
  await openMediaTab();
  await page.waitForSelector(".gallery-item", { timeout: 20000 });
  check((await page.locator(".gallery-item").count()) === 2, "gallery images persist across a reload");
  check(
    (await page.getAttribute(".gallery-item img", "src")).includes("/storage/v1/"),
    "gallery images are served from Supabase Storage",
  );

  // --- Remove one gallery image --------------------------------------------
  await page.click(".gallery-item button");
  await page.waitForFunction(() => document.querySelectorAll(".gallery-item").length === 1, null, { timeout: 10000 });
  await saveChanges();
  await page.reload();
  await page.waitForSelector("#field-name", { timeout: 20000 });
  await openMediaTab();
  await page.waitForSelector(".gallery-item", { timeout: 20000 });
  check((await page.locator(".gallery-item").count()) === 1, "removing a gallery image persists");

  // --- Replace the poster ---------------------------------------------------
  const beforeReplace = (await posterSrc()).split("?")[0];
  await page.setInputFiles("[data-poster-file]", imageFile("poster-2.png", BLUE_PNG));
  await page.waitForFunction(
    (previous) => {
      const img = document.querySelector("[data-poster-preview]");
      return img && img.getAttribute("src") && !img.getAttribute("src").startsWith(previous);
    },
    beforeReplace,
    { timeout: 30000 },
  );
  await saveChanges();
  check((await posterSrc()).split("?")[0] !== beforeReplace, "replacing the poster stores a new object");

  // --- Remove the poster ----------------------------------------------------
  await page.click("[data-remove-poster]");
  await page.waitForSelector("[data-poster-preview]", { state: "hidden", timeout: 10000 });
  await saveChanges();
  await page.reload();
  await page.waitForSelector("#field-name", { timeout: 20000 });
  await openMediaTab();
  check(await page.isHidden("[data-poster-preview]"), "removing the poster persists");

  // Put one back so the delete step has files to clean up.
  await page.setInputFiles("[data-poster-file]", imageFile("final.png", RED_PNG));
  await page.waitForSelector("[data-poster-preview]:not([hidden])", { timeout: 30000 });
  await saveChanges();

  // --- Delete the project ---------------------------------------------------
  await page.click("[data-action-delete]");
  await page.waitForSelector(".modal");
  await page.click(".modal__actions >> text=Delete Project");
  await page.waitForSelector("[data-project-list]", { timeout: 20000 });
  created.splice(created.indexOf(projectId), 1);
  check((await hash()) === "#/projects", "project deleted");

  check(appErrors.length === 0, "no uncaught application errors", appErrors.join(" | ") || "none");
} finally {
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

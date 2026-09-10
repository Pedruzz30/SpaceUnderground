// End-to-end coverage of the full admin flow, driven against a running dev
// server. Kept out of `npm test` on purpose: it needs Playwright and a browser,
// which CI does not have to install just to typecheck the data layer.
//
//   npm run dev                       # terminal 1
//   npx playwright install chromium   # once
//   BASE_URL=http://127.0.0.1:5173 npm run test:e2e
//
// Always run it with VITE_ADMIN_DATA_SOURCE=mock (the default): it resets the
// mock store between runs and never touches a real backend.

import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

const hash = () => page.evaluate(() => window.location.hash);
const settle = () => page.waitForTimeout(250);

// Scoped to the list on purpose: the editor form also carries a
// data-project-id attribute, so an unscoped selector would match it.
const ROW = "[data-project-list] [data-project-id]";
const rows = () => page.locator(ROW);
const waitForRows = () => page.waitForSelector(ROW);

// This test resets the store and creates/deletes projects. Running it against
// a real backend would touch production data, so refuse unless the app really
// is in mock mode.
async function assertMockMode() {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForFunction(() => window.__spaceAdminDataSource !== undefined, null, { timeout: 20000 });
  const dataSource = await page.evaluate(() => window.__spaceAdminDataSource);
  if (dataSource !== "mock") {
    throw new Error(`Refusing to run: the admin is in "${dataSource}" mode. Start it with npm run dev:mock.`);
  }
}

async function signIn() {
  await page.goto(`${BASE_URL}/#/login`);
  await page.fill("#login-email", "admin@spaceunderground.local");
  await page.fill("#login-password", "mock-password");
  await page.click("[data-login-submit]");
  await page.waitForSelector(".admin-shell");
}

try {
  await assertMockMode();
  await signIn();
  await page.evaluate(() => window.__resetSpaceAdminMocks());

  // Dashboard reflects the seeded store.
  await page.goto(`${BASE_URL}/#/dashboard`);
  await page.waitForSelector(".stat-card");
  assert.deepEqual(await page.locator(".stat-card strong").allInnerTexts(), ["2", "2", "0"], "seeded dashboard stats");

  // Projects list.
  await page.click('a[href="#/projects"]');
  await waitForRows();
  assert.equal(await rows().count(), 2, "seeded project rows");

  // New Project opens the editor in create mode.
  await page.click("[data-new-project]");
  await page.waitForSelector("[data-action-create]");
  assert.equal(await hash(), "#/projects/new", "new project route");

  // Validation blocks an empty submit.
  await page.click("[data-action-create]");
  await settle();
  assert.ok((await page.locator(".field-error:not([hidden])").count()) >= 2, "required field errors");

  // Slug is generated from the name until edited by hand.
  await page.fill("#field-name", "Nebula Client Portal");
  await settle();
  assert.equal(await page.inputValue("#field-slug"), "nebula-client-portal", "auto slug");

  // Tech stack chips.
  await page.fill("[data-tech-input]", "React");
  await page.click("[data-tech-add]");
  await page.fill("[data-tech-input]", "Node");
  await page.press("[data-tech-input]", "Enter");
  assert.equal(await page.locator(".chip").count(), 2, "tech stack chips");

  // Tabs are keyboard navigable. The editor has four: General, Presentation,
  // Media and Publishing.
  await page.focus("#tab-general");
  await page.keyboard.press("ArrowRight");
  await settle();
  assert.equal(await page.getAttribute("#tab-presentation", "aria-selected"), "true", "presentation tab via keyboard");

  await page.fill("#field-presentationSystem", "SISTEMA DE INTELIGÊNCIA / 03");
  await page.fill("#field-presentationLabel", "IA / AUTOMAÇÃO");
  await page.fill("#field-presentationAddress", "NEBULA / PROTÓTIPO");
  await page.fill("#field-presentationType", "APLICAÇÃO WEB COM IA");
  await page.fill("#field-presentationOrigin", "RJ / BR");
  await page.fill("#field-presentationLatitude", "22°54'S");
  await page.fill("#field-presentationLongitude", "43°12'W");

  for (const [code, title, description] of [
    ["01", "INTELIGÊNCIA", "IA + CAMADA REFLEX"],
    ["02", "AUTOMAÇÃO", "TOOLS + SISTEMA"],
    ["03", "SEGURANÇA", "PERMISSÕES + AUTOPILOT"],
  ]) {
    await page.click("[data-module-add]");
    const index = (await page.locator(".module-card").count()) - 1;
    await page.fill(`#field-module-code-${index}`, code);
    await page.fill(`#field-module-title-${index}`, title);
    await page.fill(`#field-module-description-${index}`, description);
  }
  assert.equal(await page.locator(".module-card").count(), 3, "presentation modules added");

  await page.focus("#tab-presentation");
  await page.keyboard.press("ArrowRight");
  await settle();
  assert.equal(await page.getAttribute("#tab-media", "aria-selected"), "true", "media tab via keyboard");

  // Invalid URL blocks creation, valid URL lets it through.
  await page.fill("#field-projectUrl", "not-a-url");
  await page.click("[data-action-create]");
  await settle();
  assert.equal(await hash(), "#/projects/new", "invalid url blocks create");

  await page.fill("#field-projectUrl", "https://example.com");
  await page.click("[data-action-create]");
  await page.waitForSelector("[data-action-save]");
  assert.equal(await hash(), "#/projects/003", "created project opens");

  // Editing marks the editor dirty.
  await page.fill("#field-name", "Nebula Client Portal v2");
  await settle();
  assert.equal(await page.locator("[data-save-state]").innerText(), "UNSAVED CHANGES", "dirty state");

  // Navigating away while dirty is blocked until confirmed.
  await page.click('a[href="#/dashboard"]');
  await page.waitForSelector(".modal");
  assert.equal(await hash(), "#/projects/003", "navigation blocked while dirty");
  await page.click(".modal__actions >> text=Stay");
  await settle();
  assert.equal(await hash(), "#/projects/003", "stay keeps the editor open");

  // Save, publish.
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  assert.equal(await page.locator("[data-save-state]").innerText(), "SAVED", "saved state");

  await page.click("[data-action-publish]");
  await settle();
  assert.equal(await page.locator(".editor-identity .badge").innerText(), "PUBLISHED", "published badge");

  // Changes survive a reload.
  await page.reload();
  await page.waitForSelector("#field-name");
  assert.equal(await page.inputValue("#field-name"), "Nebula Client Portal v2", "persisted after reload");

  await page.click("#tab-presentation");
  assert.equal(await page.inputValue("#field-presentationSystem"), "SISTEMA DE INTELIGÊNCIA / 03", "presentation persisted");
  assert.equal(await page.locator(".module-card").count(), 3, "modules persisted");
  await page.fill("#field-module-title-1", "ORQUESTRAÇÃO");
  await page.click('[data-module-down="1"]');
  await page.click('[data-module-remove="0"]');
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.click("#tab-presentation");
  assert.equal(await page.locator(".module-card").count(), 2, "module removal persisted");
  assert.equal(await page.inputValue("#field-module-title-1"), "ORQUESTRAÇÃO", "module reorder/edit persisted");

  // Archive, then confirm the Archived filter shows it.
  await page.click("[data-action-archive]");
  await page.waitForSelector(".modal");
  await page.click(".modal__actions >> text=Archive Project");
  await settle();
  assert.equal(await page.locator(".editor-identity .badge").innerText(), "ARCHIVED", "archived badge");

  await page.click('a[href="#/projects"]');
  await waitForRows();
  await page.click('[data-editorial-filter="ARCHIVED"]');
  await settle();
  assert.equal(await rows().count(), 1, "archived filter");

  // Delete returns to the list.
  await page.click(`${ROW}[data-project-id="003"]`);
  await page.waitForSelector("[data-action-delete]");
  await page.click("[data-action-delete]");
  await page.waitForSelector(".modal");
  await page.click(".modal__actions >> text=Delete Project");
  await waitForRows();
  assert.equal(await hash(), "#/projects", "delete returns to the list");
  assert.equal(await rows().count(), 2, "back to the seeded rows");

  // Dashboard reflects the final state.
  await page.click('a[href="#/dashboard"]');
  await page.waitForSelector(".stat-card");
  assert.deepEqual(await page.locator(".stat-card strong").allInnerTexts(), ["2", "2", "0"], "final dashboard stats");
  assert.ok((await page.locator(".activity-list > div").count()) > 0, "activity log populated");

  assert.deepEqual(errors, [], "no console or page errors");
  console.log("admin flow: all checks passed");
} finally {
  await browser.close();
}

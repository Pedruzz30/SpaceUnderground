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
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
// Explicit locale: this test asserts Portuguese copy, so it must not inherit
// whatever language Playwright's default context happens to use.
const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
// The live demo steps frame third-party URLs such as https://example.com/embed,
// whose availability is not the Admin's to guarantee. A resource that fails to
// load from another origin is that site's problem, not an Admin error; every
// other console error still fails the run.
const ADMIN_ORIGIN = new URL(BASE_URL).origin;
function isThirdPartyLoadFailure(message) {
  const url = message.location()?.url ?? "";
  return message.text().startsWith("Failed to load resource") && Boolean(url) && !url.startsWith(ADMIN_ORIGIN);
}
page.on("console", (message) => {
  if (message.type() === "error" && !isThirdPartyLoadFailure(message)) errors.push(`console: ${message.text()}`);
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

  await page.goto(`${BASE_URL}/#/dashboard`);
  await page.waitForSelector(".admin-shell");
  assert.equal(await page.locator("html").getAttribute("lang"), "pt-BR", "admin starts in pt-BR");
  assert.equal(await page.locator(".page-heading > div > span").innerText(), "CENTRAL DE CONTROLE", "dashboard starts in Portuguese");
  await page.click('[data-locale-switch="en"]');
  await settle();
  assert.equal(await hash(), "#/dashboard", "locale switch keeps the current route");
  assert.equal(await page.locator("html").getAttribute("lang"), "en", "admin switches html lang to English");
  assert.equal(await page.locator('a[href="#/settings"]').innerText(), "Settings", "sidebar switches to English");
  assert.equal(await page.locator(".page-heading > div > span").innerText(), "COMMAND CENTER", "dashboard switches to English");
  await page.goto(`${BASE_URL}/#/financial`);
  await page.waitForSelector("[data-financial]");
  assert.equal(await page.locator(".page-heading h2").innerText(), "Financial control.", "financial switches to English");
  await page.goto(`${BASE_URL}/#/settings`);
  await page.waitForSelector("[data-settings-form]:not([aria-busy])");
  assert.equal(await page.locator(".page-heading h2").innerText(), "Settings.", "settings switches to English");
  // Everything after this point asserts behaviour, not copy, and runs in the
  // context's pt-BR locale.
  await page.reload();
  await page.waitForSelector("[data-settings-form]:not([aria-busy])");
  assert.equal(await page.locator("html").getAttribute("lang"), "en", "admin reload preserves EN preference");
  await page.click('[data-locale-switch="pt-BR"]');
  await settle();

  await page.evaluate(() => window.__resetSpaceAdminMocks());

  // Dashboard reflects the seeded store.
  await page.goto(`${BASE_URL}/#/dashboard`);
  await page.waitForSelector("[data-pulse-row]");
  assert.equal(await page.locator(".stat-card").count(), 4, "command center KPI strip");
  assert.equal(await page.locator("[data-pulse-row]").count(), 2, "seeded project pulse");
  assert.equal(await page.locator('[data-health-metric="published"]').innerText(), "2", "seeded published cases");
  assert.equal(await page.locator('[data-health-metric="drafts"]').innerText(), "0", "seeded draft cases");

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
  await page.click("#tab-general");
  await page.fill("#field-projectUrl", "not-a-url");
  await page.click("[data-action-create]");
  await settle();
  assert.equal(await hash(), "#/projects/new", "invalid url blocks create");

  await page.fill("#field-projectUrl", "https://example.com");
  await page.click("[data-action-create]");
  await page.waitForSelector("[data-action-save]");
  assert.equal(await hash(), "#/projects/003", "created project opens");
  assert.equal(await page.getAttribute("#tab-overview", "aria-selected"), "true", "existing project opens on overview");
  await page.click("#tab-general");

  // Editing marks the editor dirty.
  await page.fill("#field-name", "Nebula Client Portal v2");
  await settle();
  assert.ok(await page.locator("[data-save-state].is-unsaved").count(), "dirty state");

  // Navigating away while dirty is blocked until confirmed.
  await page.click('a[href="#/dashboard"]');
  await page.waitForSelector(".modal");
  assert.equal(await hash(), "#/projects/003", "navigation blocked while dirty");
  await page.click("[data-modal-cancel]");
  await settle();
  assert.equal(await hash(), "#/projects/003", "stay keeps the editor open");

  // Save, publish.
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  assert.ok(await page.locator("[data-save-state].is-saved").count(), "saved state");

  await page.click("[data-action-publish]");
  await settle();
  await page.waitForSelector(".modal");
  assert.match(await page.locator(".modal").innerText(), /Poster/, "readiness blocks publishing without a poster");
  await page.click("[data-modal-action='0']");
  await settle();
  assert.equal(await page.locator(".editor-identity .badge").getAttribute("data-status-label"), "DRAFT", "publish stays draft when readiness blocks");

  // Changes survive a reload.
  await page.reload();
  await page.waitForSelector("#tab-general");
  assert.equal(await page.getAttribute("#tab-overview", "aria-selected"), "true", "reload opens overview");
  await page.click("#tab-general");
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
  await page.waitForSelector("#tab-presentation");
  await page.click("#tab-presentation");
  assert.equal(await page.locator(".module-card").count(), 2, "module removal persisted");
  assert.equal(await page.inputValue("#field-module-title-1"), "ORQUESTRAÇÃO", "module reorder/edit persisted");

  // Archive, then confirm the Archived filter shows it.
  await page.click("[data-action-archive]");
  await page.waitForSelector(".modal");
  await page.click("[data-modal-confirm]");
  await settle();
  assert.equal(await page.locator(".editor-identity .badge").getAttribute("data-status-label"), "ARCHIVED", "archived badge");

  await page.click('a[href="#/projects"]');
  await waitForRows();
  await page.selectOption('[data-project-filter="editorial"]', "ARCHIVED");
  await settle();
  assert.equal(await rows().count(), 1, "archived filter");

  // Delete returns to the list.
  await page.click('[data-project-open="003"]');
  await page.waitForSelector("[data-action-delete]");
  await page.click("[data-action-delete]");
  await page.waitForSelector(".modal");
  await page.click("[data-modal-confirm]");
  await waitForRows();
  assert.equal(await hash(), "#/projects", "delete returns to the list");
  assert.equal(await rows().count(), 2, "back to the seeded rows");

  // Dashboard reflects the final state.
  await page.click('a[href="#/dashboard"]');
  await page.waitForSelector("[data-pulse-row]");
  assert.equal(await page.locator("[data-pulse-row]").count(), 2, "final project pulse");
  assert.equal(await page.locator('[data-health-metric="published"]').innerText(), "2", "final published cases");
  assert.equal(await page.locator('[data-health-metric="drafts"]').innerText(), "0", "final draft cases");
  assert.ok((await page.locator(".activity-list > div").count()) > 0, "activity log populated");


  /* ------------------------------------------------ projects hub: metrics */

  // A fixture with genuinely different states, so the KPIs and the combined
  // filters are counting something rather than agreeing with a uniform seed.
  const HUB_FIXTURE = [
    {
      id: "101", caseNumber: "101", name: "Alpha Site", slug: "alpha-site", client: "Alpha",
      category: "Website", description: "Descrição alpha.", status: "Live",
      editorialStatus: "PUBLISHED", visible: true, featured: false, year: "2026", accent: "#c6ff00",
      techStack: [], presentation: { system: "s", label: "l", address: "a", type: "t", coordinates: [] },
      modules: [
        { id: null, position: 0, code: "01", title: "t", description: "d", translations: { en: { title: "T", description: "D" } } },
      ],
      poster: "posters/alpha.png", gallery: [], projectUrl: "https://alpha.example.com",
      previewUrl: "https://alpha.example.com/embed", livePreviewEnabled: true,
      // Fully translated, so this one is genuinely healthy and the attention
      // count is measuring the other two rather than a missing translation.
      translations: {
        en: {
          description: "Alpha description.",
          presentation_system: "s",
          presentation_label: "l",
          presentation_address: "a",
          presentation_type: "t",
        },
      },
      createdAt: null, updatedAt: new Date().toISOString(), publishedAt: null,
    },
    {
      id: "102", caseNumber: "102", name: "Beta System", slug: "beta-system", client: "Beta",
      category: "System", description: "Descrição beta.", status: "MVP",
      editorialStatus: "PUBLISHED", visible: false, featured: false, year: "2026", accent: "#c6ff00",
      techStack: [], presentation: { system: "s", label: "l", address: "a", type: "t", coordinates: [] },
      modules: [{ id: null, position: 0, code: "01", title: "t", description: "d", translations: {} }],
      poster: "posters/beta.png", gallery: [], projectUrl: "", previewUrl: "",
      livePreviewEnabled: false, translations: {},
      createdAt: null, updatedAt: new Date().toISOString(), publishedAt: null,
    },
    {
      id: "103", caseNumber: "103", name: "Gamma Draft", slug: "gamma-draft", client: "Gamma",
      category: "Website", description: "", status: "In Development",
      editorialStatus: "DRAFT", visible: false, featured: false, year: "2026", accent: "#c6ff00",
      techStack: [], presentation: { system: "", label: "", address: "", type: "", coordinates: [] },
      modules: [], poster: "", gallery: [], projectUrl: "", previewUrl: "",
      livePreviewEnabled: false, translations: {},
      createdAt: null, updatedAt: new Date().toISOString(), publishedAt: null,
    },
  ];

  await page.evaluate((fixture) => {
    localStorage.setItem("space-admin:projects:v2", JSON.stringify(fixture));
  }, HUB_FIXTURE);
  await page.goto(`${BASE_URL}/#/projects`);
  await waitForRows();

  const metricValues = await page.evaluate(() =>
    [...document.querySelectorAll("[data-project-metrics] .project-metric")].map((card) => ({
      value: card.querySelector("strong")?.textContent.trim(),
      label: card.querySelector("span")?.textContent.trim(),
    })),
  );

  assert.equal(metricValues.length, 6, "six KPI cards");
  // total / published / draft / hidden / with demo / attention.
  // Alpha is healthy; Beta is published-but-hidden and Gamma is an empty draft.
  assert.deepEqual(
    metricValues.map((entry) => entry.value),
    ["3", "2", "1", "2", "1", "2"],
    `KPIs read total/published/draft/hidden/withDemo/attention — got ${JSON.stringify(metricValues)}`,
  );

  /* ----------------------------------------------- projects hub: filters */

  const setFilter = async (name, value) => {
    await page.selectOption(`[data-project-filter="${name}"]`, value);
    await settle();
  };
  const resetFilters = async () => {
    for (const name of ["category", "editorial", "visibility", "demo", "health"]) {
      await setFilter(name, "ALL");
    }
    await page.fill("[data-search-projects]", "");
    await settle();
  };

  // Editorial + visibility: only Alpha is published and visible.
  await setFilter("editorial", "PUBLISHED");
  await setFilter("visibility", "VISIBLE");
  assert.equal(await rows().count(), 1, "published + visible narrows to one row");
  assert.ok(await page.locator('[data-project-id="101"]').count(), "published + visible keeps Alpha");

  // Demo + health: Alpha is the only one with a live demo.
  await resetFilters();
  await setFilter("demo", "LIVE");
  assert.equal(await rows().count(), 1, "demo=live narrows to one row");
  await setFilter("health", "INCOMPLETE");
  assert.equal(await rows().count(), 0, "a live demo project is not incomplete");

  // Search + category.
  await resetFilters();
  await page.fill("[data-search-projects]", "a");
  await setFilter("category", "System");
  assert.equal(await rows().count(), 1, "search + category narrows to Beta");
  assert.ok(await page.locator('[data-project-id="102"]').count(), "search + category keeps Beta");

  // Draft with nothing filled reads as incomplete, not as an error state.
  await resetFilters();
  await setFilter("health", "INCOMPLETE");
  assert.equal(await rows().count(), 1, "the empty draft is the only incomplete row");
  await resetFilters();

  /* ------------------------------------------- view public leaves the admin */

  const publicHref = await page.evaluate(() => {
    const row = document.querySelector('[data-project-id="101"]');
    return [...row.querySelectorAll(".row-menu__panel a")][0]?.href ?? "";
  });
  assert.ok(publicHref.startsWith("http"), `view public is absolute — got ${publicHref}`);
  assert.notEqual(
    new URL(publicHref).host,
    new URL(BASE_URL).host,
    `view public must not point at the admin host — got ${publicHref}`,
  );
  assert.ok(publicHref.includes("#work"), "view public deep-links to the work section");

  /* ------------------------------------------------- live demo reactivity */

  await page.click('[data-project-open="103"]');
  await page.waitForSelector("[data-action-save]");
  await page.click('[role="tab"][data-tab="live-demo"]');
  await settle();

  const demoStatus = () => page.locator("[data-demo-status]").innerText();
  const testDisabled = () => page.locator("[data-action-test-demo]").isDisabled();

  assert.match(await demoStatus(), /NENHUM|NONE/i, "starts with no demo");
  assert.equal(await testDisabled(), true, "test demo starts disabled");

  // Enabling with no URL is still no demo.
  await page.check('[name="livePreviewEnabled"]');
  await settle();
  assert.match(await demoStatus(), /NENHUM|NONE/i, "enabled with no URL is still none");
  assert.equal(await testDisabled(), true, "test demo stays disabled without a URL");

  // An entered URL that cannot be framed is flagged.
  await page.fill("#field-previewUrl", "javascript:alert(1)");
  await settle();
  assert.match(await demoStatus(), /INVÁLID|INVALID/i, "an unusable URL reads as invalid");
  assert.equal(await testDisabled(), true, "test demo stays disabled for an invalid URL");

  // A valid URL flips it live, with no save in between.
  await page.fill("#field-previewUrl", "https://example.com/embed");
  await settle();
  assert.match(await demoStatus(), /LIVE/i, "a valid URL reads as live without saving");
  assert.equal(await testDisabled(), false, "test demo is enabled without saving");

  await page.click("[data-action-test-demo]");
  await page.waitForSelector(".modal iframe");
  assert.equal(
    await page.locator(".modal iframe").getAttribute("src"),
    "https://example.com/embed",
    "test demo frames the preview URL",
  );
  await page.click("[data-modal-action]");
  await settle();

  // Unchecking takes it straight back.
  await page.uncheck('[name="livePreviewEnabled"]');
  await settle();
  assert.match(await demoStatus(), /NENHUM|NONE/i, "unchecking returns to none immediately");
  assert.equal(await testDisabled(), true, "test demo disables again immediately");

  /* --------------------------------------------------- live demo persists */

  await page.check('[name="livePreviewEnabled"]');
  await page.fill("#field-previewUrl", "https://example.com/embed");
  await settle();
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.waitForSelector("[data-action-save]");
  await page.click('[role="tab"][data-tab="live-demo"]');
  await settle();

  assert.equal(await page.isChecked('[name="livePreviewEnabled"]'), true, "the demo flag survived the save");
  assert.equal(
    await page.inputValue("#field-previewUrl"),
    "https://example.com/embed",
    "the preview URL survived the save",
  );
  assert.match(await demoStatus(), /LIVE/i, "status is live after reload");
  assert.equal(await testDisabled(), false, "test demo is enabled after reload");

  // And disabling persists too.
  await page.uncheck('[name="livePreviewEnabled"]');
  await settle();
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.waitForSelector("[data-action-save]");
  await page.click('[role="tab"][data-tab="live-demo"]');
  await settle();
  assert.equal(await page.isChecked('[name="livePreviewEnabled"]'), false, "disabling the demo persisted");

  /* --------------------------------------------- overview follows the form */

  await page.click('[role="tab"][data-tab="overview"]');
  await settle();
  const overviewText = () => page.locator("[data-overview-badges]").innerText();
  const before = await overviewText();

  // This project is a hidden draft, so making it visible is the change that
  // actually moves the badge.
  assert.match(before, /OCULTO|HIDDEN/i, "starts hidden");

  await page.click('[role="tab"][data-tab="publishing"]');
  await page.check('[name="visible"]');
  await settle();
  await page.click('[role="tab"][data-tab="overview"]');
  await settle();

  const after = await overviewText();
  assert.notEqual(after, before, "overview reflects an unsaved visibility change");
  assert.match(after, /VISÍVEL|VISIBLE/i, "overview shows the new visibility without a save");

  await page.evaluate(() => {
    window.onbeforeunload = null;
  });
  await page.goto(`${BASE_URL}/#/projects`);
  const leaving = page.locator("[data-modal-confirm]");
  if (await leaving.count()) await leaving.click();
  await waitForRows();
  await page.evaluate(() => window.__resetSpaceAdminMocks());

  /* ------------------------------------------------ services v2 foundation */

  const SERVICE_FIXTURE = [
    {
      id: "service-alpha", slug: "alpha", name: "Alpha", range: "R$ 800", timeline: "1 semana",
      scope: "Landing page", scopeShort: "Landing", description: "Oferta alpha.", status: "AVAILABLE",
      visible: true, position: 0, accent: "#c6ff00",
      features: [{ id: "service-alpha-1", position: 0, text: "Design", translations: { en: { text: "Design" } } }],
      translations: { en: { timeline: "1 week", scope: "Landing page", scopeShort: "Landing", description: "Alpha offer." } },
      createdAt: null, updatedAt: new Date().toISOString(),
    },
    {
      id: "service-beta", slug: "beta", name: "Beta", range: "R$ 2.500", timeline: "3 semanas",
      scope: "Sistema", scopeShort: "Sistema", description: "Oferta beta.", status: "AVAILABLE",
      visible: false, position: 1, accent: "#22c55e", features: [{ id: "service-beta-1", position: 0, text: "Portal", translations: {} }],
      translations: {}, createdAt: null, updatedAt: new Date().toISOString(),
    },
    {
      id: "service-gamma", slug: "gamma", name: "Gamma", range: "", timeline: "",
      scope: "", scopeShort: "", description: "", status: "ARCHIVED",
      visible: false, position: 2, accent: "#f59e0b", features: [], translations: {}, createdAt: null, updatedAt: new Date().toISOString(),
    },
  ];

  await page.evaluate((fixture) => {
    localStorage.setItem("space-admin:plans:v1", JSON.stringify(fixture));
  }, SERVICE_FIXTURE);

  await page.goto(`${BASE_URL}/#/services`);
  await page.waitForSelector("[data-service-id]");
  const serviceRows = () => page.locator("[data-service-id]");
  assert.equal(await serviceRows().count(), 3, "seeded service rows");
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll("[data-service-metrics] .project-metric strong")].map((node) => node.textContent.trim())),
    ["3", "1", "2", "2", "1", "2"],
    "service KPIs read total/visible/hidden/available/archived/attention",
  );

  await page.fill("[data-search-services]", "beta");
  await settle();
  assert.equal(await serviceRows().count(), 1, "service search narrows to beta");
  await page.selectOption('[data-service-filter="visibility"]', "HIDDEN");
  assert.equal(await serviceRows().count(), 1, "service visibility combines with search");
  await page.selectOption('[data-service-filter="health"]', "INCOMPLETE");
  assert.equal(await serviceRows().count(), 0, "beta is attention, not incomplete");
  await page.fill("[data-search-services]", "");
  await page.selectOption('[data-service-filter="visibility"]', "ALL");
  await page.selectOption('[data-service-filter="health"]', "INCOMPLETE");
  await settle();
  assert.equal(await serviceRows().count(), 1, "incomplete filter keeps gamma");
  await page.selectOption('[data-service-filter="status"]', "ALL");
  await page.selectOption('[data-service-filter="visibility"]', "ALL");
  await page.selectOption('[data-service-filter="health"]', "ALL");
  await settle();

  const serviceHref = await page.evaluate(() => document.querySelector('[data-service-id="service-alpha"] .row-menu__panel a')?.href ?? "");
  assert.ok(serviceHref.startsWith("http"), `service public link is absolute — got ${serviceHref}`);
  assert.ok(serviceHref.includes("#plans"), "service public link targets public plans section");

  await page.click('[data-service-open="service-alpha"]');
  await page.waitForSelector("[data-service-editor]");
  await page.click("#tab-commercial");
  await page.fill("#field-name", "Alpha Prime");
  await page.click("#tab-content");
  assert.equal(await page.inputValue("#field-description"), "Oferta alpha.", "service editor opens PT copy");
  await page.click("#tab-features");
  assert.equal(await page.locator("#panel-features [data-locale-edit].is-active").getAttribute("data-locale-edit"), "pt-BR", "features exposes the shared PT locale control");
  assert.equal(await page.locator("[data-feature-text]").first().inputValue(), "Design", "feature editor starts in PT");
  await page.locator("#panel-features [data-locale-edit='en']").click();
  await settle();
  assert.equal(await page.locator("#panel-features [data-locale-edit].is-active").getAttribute("data-locale-edit"), "en", "features switches directly to EN");
  await page.locator("[data-feature-text]").first().fill("Custom design");
  await page.click("[data-feature-duplicate]");
  await settle();
  assert.equal(await page.locator("[data-feature-text]").nth(1).inputValue(), "Custom design", "duplicated feature copies EN text");
  await page.click("#tab-content");
  assert.equal(await page.locator("#panel-content [data-locale-edit].is-active").getAttribute("data-locale-edit"), "en", "content shares the locale selected in features");
  assert.equal(await page.inputValue("#field-description"), "Alpha offer.", "content fields follow the feature locale switch");
  await page.locator("#panel-content [data-locale-edit='pt-BR']").click();
  await settle();
  await page.click("#tab-features");
  assert.equal(await page.locator("#panel-features [data-locale-edit].is-active").getAttribute("data-locale-edit"), "pt-BR", "features follows the locale selected in content");
  assert.equal(await page.locator("[data-feature-text]").first().inputValue(), "Design", "switching back restores PT feature text");
  await page.locator("[data-feature-text]").first().fill("Design sob medida");
  assert.equal(await page.locator("[data-feature-text]").nth(1).inputValue(), "Design", "duplicated feature also kept PT text");
  await page.click("[data-feature-add]");
  await page.locator("[data-feature-text]").last().fill("Entrega A");
  await page.click("[data-feature-add]");
  await page.locator("[data-feature-text]").last().fill("Entrega B");
  await page.locator("[data-feature-remove]").nth(2).click();
  await page.click("[data-feature-add]");
  await page.locator("[data-feature-text]").last().fill("Entrega C");
  await settle();
  assert.deepEqual(
    await page.locator("[data-feature-text]").evaluateAll((inputs) => inputs.map((input) => input.value)),
    ["Design sob medida", "Design", "Entrega B", "Entrega C"],
    "feature add/remove/add keeps stable ordering",
  );
  await page.click("#tab-content");
  await page.fill("#field-description", "Oferta alpha prime.");
  await page.fill("#field-timeline", "2 semanas");
  await settle();
  assert.match(await page.locator("[data-service-preview]").innerText(), /Alpha Prime/, "service preview follows unsaved name");
  assert.match(await page.locator("[data-service-preview]").innerText(), /Oferta alpha prime/, "service preview follows unsaved description");
  assert.match(await page.locator("[data-service-preview]").innerText(), /2 semanas/i, "service preview follows unsaved timeline");
  await page.click("#tab-features");
  await page.locator("[data-feature-text]").last().fill("Nova entrega");
  await settle();
  assert.match(await page.locator("[data-service-preview]").innerText(), /Nova entrega/, "service preview follows unsaved feature");
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.waitForSelector("[data-service-editor]");
  await page.click("#tab-commercial");
  assert.equal(await page.inputValue("#field-name"), "Alpha Prime", "service edit persisted");
  await page.click("#tab-features");
  assert.equal(await page.locator("[data-feature-text]").first().inputValue(), "Design sob medida", "PT feature text persisted");
  await page.click("#tab-content");
  await page.click('[data-locale-edit="en"]');
  await settle();
  await page.click("#tab-features");
  assert.equal(await page.locator("[data-feature-text]").first().inputValue(), "Custom design", "EN feature text persisted");

  await page.goto(`${BASE_URL}/#/services/new`);
  await page.waitForSelector("[data-service-editor]");
  await page.click("#tab-commercial");
  await page.fill("#field-name", "Delta Offer");
  await settle();
  assert.equal(await page.inputValue("#field-slug"), "delta-offer", "service auto slug");
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-service-id]");
  assert.equal(await hash(), "#/services/mock-plan-delta-offer", "created service opens route");

  await page.goto(`${BASE_URL}/#/services`);
  await page.waitForSelector("[data-service-id]");
  await page.locator('[data-service-id="service-alpha"] [data-row-menu-toggle]').click();
  await page.click('[data-service-duplicate="service-alpha"]');
  await settle();
  await page.selectOption('[data-service-filter="status"]', "UNAVAILABLE");
  await page.selectOption('[data-service-filter="health"]', "ALL");
  await settle();
  assert.ok(await page.locator('[data-service-id^="mock-plan-alpha-prime-copy"]').count(), "duplicate is hidden and unavailable");
  await page.selectOption('[data-service-filter="status"]', "ALL");
  await settle();

  await page.locator('[data-service-id="service-beta"] [data-row-menu-toggle]').click();
  await page.click('[data-service-archive="service-beta"]');
  await settle();
  await page.selectOption('[data-service-filter="status"]', "ARCHIVED");
  await settle();
  assert.ok(await page.locator('[data-service-id="service-beta"]').count(), "archived service appears in archived filter");

  /* ------------------------------------------------- clients v2 foundation */

  await page.evaluate(() => window.__resetSpaceAdminMocks());
  const clientRows = () => page.locator("[data-client-row]");
  const clientMetric = (index) =>
    page.locator("[data-client-metrics] .project-metric strong").nth(index).innerText();

  await page.goto(`${BASE_URL}/#/clients`);
  await page.waitForSelector("[data-client-row]");
  assert.equal(await clientRows().count(), 4, "seeded clients listed");
  assert.equal(await clientMetric(0), "4", "total clients derives from records");
  assert.equal(await clientMetric(2), "1", "leads derives from records");

  // Create.
  await page.click("[data-new-client]");
  await page.waitForSelector('[data-client-editor][data-mode="create"]');
  assert.equal(await hash(), "#/clients/new", "new client opens the create route");
  await page.click("[data-client-save]");
  assert.ok(await page.locator('[data-field="name"] .field-error:not([hidden])').count(), "name is required");
  await page.fill("#field-name", "Orbital Foods");
  await page.fill("#field-company", "Orbital Foods Ltda");
  await page.fill("#field-email", "ops@orbital.example.com");
  await page.selectOption("#field-status", "ACTIVE");
  await page.click('[data-tab="notes"]');
  await page.fill("#field-notes", "Met at the E2E fair.");
  await page.click("[data-client-save]");
  await page.waitForSelector('[data-client-editor][data-mode="edit"]');
  const clientHash = await hash();
  assert.match(clientHash, /^#\/clients\/mock-client-/, "created client opens its record");
  assert.match(await page.locator("[data-client-identity]").innerText(), /CLIENT-005/, "code assigned from the sequence");

  // Locate in the list.
  await page.goto(`${BASE_URL}/#/clients`);
  await page.waitForSelector("[data-client-row]");
  await page.fill("[data-search-clients]", "orbital");
  await settle();
  assert.equal(await clientRows().count(), 1, "search finds the new client");
  await page.fill("[data-search-clients]", "client-005");
  await settle();
  assert.equal(await clientRows().count(), 1, "search matches the client code");

  // Open and edit.
  await page.locator("[data-client-row] .clients-row__name").first().click();
  await page.waitForSelector('[data-client-editor][data-mode="edit"]');
  assert.equal(await hash(), clientHash, "row opens the same record");
  await page.click('[data-tab="general"]');
  await page.fill("#field-phone", "+55 21 90000-0500");
  await settle();
  assert.ok(await page.locator("[data-save-state].is-unsaved").count(), "editing marks the record dirty");

  // Leaving with unsaved changes asks first; staying keeps the edit.
  await page.evaluate(() => {
    window.location.hash = "#/clients";
  });
  await page.waitForSelector("[data-modal-cancel]");
  await page.click("[data-modal-cancel]");
  assert.equal(await hash(), clientHash, "staying keeps the editor open");
  assert.equal(await page.inputValue("#field-phone"), "+55 21 90000-0500", "staying keeps the typed value");

  // A duplicate code is reported on the field, not as a raw database error.
  await page.fill("#field-code", "CLIENT-001");
  await page.click("[data-client-save]");
  await page.waitForSelector('[data-field="code"] .field-error:not([hidden])');
  assert.ok(await page.locator("[data-save-state].is-error").count(), "a failed save shows the error state");
  await page.fill("#field-code", "CLIENT-005");
  await page.click("[data-client-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.waitForSelector("[data-client-editor]");
  await page.click('[data-tab="general"]');
  assert.equal(await page.inputValue("#field-phone"), "+55 21 90000-0500", "client edit persisted");

  // Last contact is set by hand, survives a reload and can be cleared.
  assert.equal(await page.inputValue("#field-lastContactAt"), "", "a new client has no recorded contact");
  await page.fill("#field-lastContactAt", "2026-09-01");
  await page.click("[data-client-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.waitForSelector("[data-client-editor]");
  await page.click('[data-tab="general"]');
  assert.equal(await page.inputValue("#field-lastContactAt"), "2026-09-01", "last contact persisted");
  const storedContact = await page.evaluate((id) => {
    const clients = JSON.parse(localStorage.getItem("space-admin:clients:v1"));
    return clients.find((client) => client.id === id)?.lastContactAt;
  }, decodeURIComponent(clientHash.split("/").pop()));
  assert.equal(storedContact, "2026-09-01T12:00:00.000Z", "stored as an ISO UTC timestamp");
  await page.click("[data-clear-last-contact]");
  await page.click("[data-client-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.waitForSelector("[data-client-editor]");
  await page.click('[data-tab="general"]');
  assert.equal(await page.inputValue("#field-lastContactAt"), "", "clearing the last contact persisted");

  // Link a project: unlink CASE 002 from its seed owner first so it is free.
  await page.goto(`${BASE_URL}/#/clients/mock-client-002`);
  await page.waitForSelector("[data-client-editor]");
  await page.click('[data-tab="projects"]');
  await page.click('[data-unlink-project="002"]');
  await page.waitForSelector("[data-client-projects] [data-link-project-select]");
  await page.goto(`${BASE_URL}/${clientHash}`);
  await page.waitForSelector("[data-client-editor]");
  await page.click('[data-tab="projects"]');
  await page.selectOption("[data-link-project-select]", "002");
  await page.click("[data-link-project]");
  await page.waitForSelector('[data-client-project="002"]');
  await page.click('[data-tab="activity"]');
  // The activity tab reads known events in the active locale (pt-BR here).
  assert.match(await page.locator("[data-client-activity]").innerText(), /Projeto vinculado ao cliente/, "link is logged on the client");

  // Archive, filter, restore.
  await page.goto(`${BASE_URL}/#/clients`);
  await page.waitForSelector("[data-client-row]");
  const orbitalRow = page.locator("[data-client-row]", { hasText: "Orbital Foods" });
  await orbitalRow.locator("[data-row-menu-toggle]").click();
  await orbitalRow.locator("[data-client-archive]").click();
  await page.click("[data-modal-confirm]");
  await page.waitForSelector("[data-client-row] [data-client-unarchive]", { state: "attached" });
  await page.click('[data-client-filter="ARCHIVED"]');
  await settle();
  assert.equal(await clientRows().count(), 1, "archived filter shows the archived client");
  assert.match(await clientRows().first().innerText(), /Orbital Foods/);
  await clientRows().first().locator("[data-row-menu-toggle]").click();
  await clientRows().first().locator("[data-client-unarchive]").click();
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => document.querySelectorAll("[data-client-row]").length === 0);
  await page.click('[data-client-filter="INACTIVE"]');
  await settle();
  assert.ok(await page.locator("[data-client-row]", { hasText: "Orbital Foods" }).count(), "restored client returns as inactive");
  assert.equal(await clientRows().count(), 2, "nothing was deleted along the way");

  /* ------------------------------------------- clients: the relationship */

  await page.evaluate(() => window.__resetSpaceAdminMocks());
  const localToday = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });

  // The hub reaches people directly and reads as a call sheet. Reloaded so the
  // filter left by the step above does not carry over.
  await page.goto(`${BASE_URL}/#/clients`);
  await page.reload();
  await page.waitForSelector('[data-client-id="mock-client-002"]');
  assert.equal(
    await page.getAttribute('[data-client-id="mock-client-002"] .contact-link--whatsapp', "href"),
    "https://wa.me/5521900000004",
    "WhatsApp link from the stored phone",
  );
  await page.selectOption("[data-client-focus]", "stale");
  await settle();
  const quiet = await clientRows().count();
  assert.ok(quiet >= 1, "clients with no recent contact are listed");
  await page.selectOption("[data-client-focus]", "all");
  await page.selectOption("[data-client-sort]", "name");
  await settle();
  const sortedNames = await page.$$eval("[data-client-row] .clients-row__name strong", (nodes) => nodes.map((node) => node.textContent));
  assert.deepEqual(sortedNames, [...sortedNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), "name sort");

  // The record shows the money and deals around the client.
  await page.goto(`${BASE_URL}/#/clients/mock-client-002`);
  await page.waitForSelector("[data-client-editor]");
  assert.equal(await page.locator(".page-heading h2").innerText(), "Lucas Souza", "the record is titled with the client");
  assert.ok(await page.locator('[data-signal="neverContacted"]').count(), "a client never contacted is flagged");

  // Recording a contact is refused over unsaved edits.
  await page.click('[data-tab="general"]');
  const phone = await page.inputValue("#field-phone");
  await page.fill("#field-phone", "+55 21 90000-9999");
  await page.click("[data-record-contact]");
  await settle();
  assert.equal(await page.locator("[data-contact-form]").count(), 0, "no contact dialog over unsaved edits");
  await page.fill("#field-phone", phone);
  await settle();

  await page.click("[data-record-contact]");
  await page.waitForSelector("[data-contact-form]");
  await page.check('[data-contact-form] [name="channel"][value="WHATSAPP"]');
  await page.fill("[data-contact-form] [name=note]", "Approved the E2E scope.");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => !document.querySelector("[data-contact-form]"));
  await page.waitForSelector("[data-client-editor]");
  assert.equal(await page.locator('[data-signal="neverContacted"]').count(), 0, "the contact clears the signal");
  await page.click('[data-tab="general"]');
  assert.equal(await page.inputValue("#field-lastContactAt"), localToday, "the contact moved the last contact date to today");
  await page.click('[data-tab="activity"]');
  assert.match(await page.locator("[data-client-activity]").innerText(), /Contato registrado[\s\S]*WHATSAPP: Approved the E2E scope\./, "the conversation is in the history");

  // A deal started from the client lands in the pipeline pointed at them.
  await page.click('[data-tab="commercial"]');
  const dealsBefore = await page.locator("[data-client-deal]").count();
  await page.click("[data-new-deal]");
  await page.waitForSelector("[data-client-deal-form]");
  await page.click("[data-modal-confirm]");
  await settle();
  assert.ok(await page.locator('[data-client-deal-form] [data-error-for="title"]:not([hidden])').count(), "a deal needs a title");
  await page.fill("[data-client-deal-form] [name=title]", "E2E upsell");
  await page.fill("[data-client-deal-form] [name=estimatedValue]", "1.200");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction((count) => document.querySelectorAll("[data-client-deal]").length === count + 1, dealsBefore);
  const storedDeal = await page.evaluate(() => JSON.parse(localStorage.getItem("space-admin:commercial:v1")).find((deal) => deal.title === "E2E upsell"));
  assert.equal(storedDeal.clientId, "mock-client-002", "the deal points at the client");
  assert.equal(storedDeal.estimatedValue, 1200);

  // An entry started from the client, then settled from the same tab.
  await page.click('[data-tab="financial"]');
  const entriesBefore = await page.locator("[data-client-entry]").count();
  await page.click("[data-new-entry]");
  await page.waitForSelector("[data-client-entry-form]");
  await page.fill("[data-client-entry-form] [name=description]", "E2E retainer fee");
  await page.fill("[data-client-entry-form] [name=amount]", "800");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction((count) => document.querySelectorAll("[data-client-entry]").length === count + 1, entriesBefore);
  const fee = page.locator("[data-client-entry]", { hasText: "E2E retainer fee" });
  await fee.locator("[data-settle-entry]").click();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll("[data-client-entry]")].find((node) => node.textContent.includes("E2E retainer fee"));
    return row && !row.querySelector("[data-settle-entry]");
  });

  // A new record that matches an existing one says so before it is saved.
  await page.goto(`${BASE_URL}/#/clients/new`);
  await page.waitForSelector('[data-client-editor][data-mode="create"]');
  await page.fill("#field-email", "LUCAS@example.com");
  await settle();
  assert.match(await page.locator("[data-duplicate-warning]").innerText(), /Lucas Souza/, "duplicate email is flagged");
  await page.evaluate(() => {
    window.location.hash = "#/clients";
  });
  await page.waitForSelector("[data-modal-confirm]");
  await page.click("[data-modal-confirm]");
  await page.waitForSelector("[data-client-row]");

  /* ---------------------------------------------- financial v2 foundation */

  await page.evaluate(() => window.__resetSpaceAdminMocks());
  // A small ledger with a known shape: one late receivable, one paid income,
  // one pending bill.
  const isoDay = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const FIN_FIXTURE = [
    { id: "fin-late", type: "INCOME", status: "PENDING", description: "Late invoice", category: "PROJECT", amount: 1000, currency: "BRL", dueDate: isoDay(-5), paidAt: null, clientId: "mock-client-002", projectId: null, notes: "", createdAt: null, updatedAt: null },
    { id: "fin-paid", type: "INCOME", status: "PAID", description: "Paid invoice", category: "PROJECT", amount: 2500, currency: "BRL", dueDate: isoDay(0), paidAt: isoDay(0), clientId: null, projectId: null, notes: "", createdAt: null, updatedAt: null },
    { id: "fin-bill", type: "EXPENSE", status: "PENDING", description: "Hosting bill", category: "INFRASTRUCTURE", amount: 90, currency: "BRL", dueDate: isoDay(3), paidAt: null, clientId: null, projectId: null, notes: "", createdAt: null, updatedAt: null },
  ];
  await page.evaluate((fixture) => localStorage.setItem("space-admin:financial:v1", JSON.stringify(fixture)), FIN_FIXTURE);
  await page.goto(`${BASE_URL}/#/financial`);
  await page.waitForSelector("[data-fin-list]:not([aria-busy]) [data-transaction-id]");

  const finRows = () => page.locator("[data-fin-list] [data-transaction-id]");
  // Intl puts a no-break space after "R$"; the assertions compare plain text.
  const finMetric = async (index) =>
    (await page.locator("[data-fin-metrics] .project-metric strong").nth(index).innerText()).replace(/ /g, " ");
  await page.selectOption("[data-fin-period]", "all");
  await settle();
  assert.equal(await finRows().count(), 3, "seeded ledger entries");
  assert.equal(await finMetric(3), "R$ 1.000", "to receive is the pending income only");
  assert.equal(await finMetric(4), "R$ 90", "to pay is the pending bill");

  await page.click('[data-fin-view="overdue"]');
  await settle();
  assert.equal(await finRows().count(), 1, "overdue view keeps the late receivable");
  assert.ok(await page.locator('[data-transaction-id="fin-late"]').count(), "the late invoice is overdue");
  await page.click('[data-fin-view="all"]');

  // The form refuses an empty entry and stays open.
  await page.click("[data-fin-new]");
  await page.waitForSelector("[data-fin-form]");
  await page.click("[data-modal-confirm]");
  await settle();
  assert.ok(await page.locator("[data-fin-form]").count(), "an invalid entry keeps the form open");
  assert.ok(await page.locator('[data-error-for="description"]:not([hidden])').count(), "missing description is flagged");
  assert.ok(await page.locator('[data-error-for="amount"]:not([hidden])').count(), "missing amount is flagged");

  // Three installments of a pt-BR amount.
  await page.fill("[data-fin-form] [name=description]", "E2E retainer");
  await page.fill("[data-fin-form] [name=amount]", "1.500,00");
  await page.fill("[data-fin-form] [name=installments]", "3");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => !document.querySelector("[data-fin-form]"));
  await page.waitForFunction(() => document.querySelectorAll("[data-fin-list] [data-transaction-id]").length === 6);
  assert.equal(await page.locator("[data-fin-list] [data-transaction-id]", { hasText: "E2E retainer" }).count(), 3, "three installments created");
  assert.equal(await finMetric(3), "R$ 2.500", "installments join what is to receive");

  // Settling the late invoice moves it into revenue.
  await page.locator('[data-transaction-id="fin-late"] [data-fin-action="pay"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-transaction-id="fin-late"] [data-fin-action="pay"]'));
  assert.equal(await finMetric(0), "R$ 3.500", "revenue includes the settled invoice");
  assert.equal(await finMetric(5), "R$ 0", "nothing is overdue any more");

  // Cancelling keeps the entry but drops it from the totals.
  await page.locator('[data-transaction-id="fin-bill"] [data-row-menu-toggle]').click();
  await page.locator('[data-transaction-id="fin-bill"] [data-fin-action="cancel"]').click();
  await page.waitForFunction(() => document.querySelector('[data-transaction-id="fin-bill"]')?.classList.contains("fin-entry--cancelled"));
  assert.equal(await finMetric(4), "R$ 0", "a cancelled bill is not to pay");

  // Deleting asks first and then removes it for good.
  await page.locator('[data-transaction-id="fin-bill"] [data-row-menu-toggle]').click();
  await page.locator('[data-transaction-id="fin-bill"] [data-fin-action="delete"]').click();
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => !document.querySelector('[data-transaction-id="fin-bill"]'));

  // The reports tab renders a chart with a table fallback.
  await page.click("#financial-tab-reports");
  await settle();
  assert.equal(await page.locator(".fin-chart__bar--income").count(), 6, "six months of income columns");
  assert.ok(await page.locator(".fin-table table").count(), "the chart has a table view");

  // Every step reached the activity log under the financial domain.
  const finLog = await page.evaluate(() => JSON.parse(localStorage.getItem("space-admin:activity:v1") || "[]").map((entry) => entry.action));
  for (const action of ["financial.installments_created", "financial.paid", "financial.cancelled", "financial.deleted"]) {
    assert.ok(finLog.includes(action), `${action} is logged`);
  }

  /* --------------------------------------------- commercial v2 foundation */

  await page.evaluate(() => window.__resetSpaceAdminMocks());
  await page.evaluate(() => localStorage.setItem("space-admin:financial:v1", "[]"));
  const COM_FIXTURE = [
    { id: "deal-lead", title: "E2E website", stage: "NEW", priority: "HIGH", source: "WEBSITE", clientId: null, planId: null, contactName: "Nina Prado", company: "Prado Studio", email: "nina@example.com", phone: "", estimatedValue: 3000, expectedCloseDate: null, nextAction: "Call back", nextActionAt: isoDay(-1), lastContactAt: null, lostReason: null, position: 0, notes: "", stageChangedAt: new Date().toISOString(), closedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "deal-cold", title: "E2E landing", stage: "PROPOSAL", priority: "LOW", source: "REFERRAL", clientId: "mock-client-001", planId: "mock-plan-plus", contactName: "", company: "", email: "", phone: "", estimatedValue: 1500, expectedCloseDate: null, nextAction: "", nextActionAt: null, lastContactAt: null, lostReason: null, position: 0, notes: "", stageChangedAt: new Date().toISOString(), closedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];
  await page.evaluate((fixture) => localStorage.setItem("space-admin:commercial:v1", JSON.stringify(fixture)), COM_FIXTURE);
  await page.goto(`${BASE_URL}/#/commercial`);
  await page.waitForSelector("[data-com-board]:not([aria-busy]) [data-opportunity-id]");

  const comMetric = async (index) =>
    (await page.locator("[data-com-metrics] .project-metric strong").nth(index).innerText()).replace(/ /g, " ");
  const dealStage = (id) => page.getAttribute(`[data-opportunity-id="${id}"]`, "data-stage");
  const openDealMenu = (id) => page.locator(`[data-opportunity-id="${id}"] [data-row-menu-toggle]`).click();

  assert.equal(await comMetric(0), "R$ 4.500", "open pipeline is the sum of open deals");
  assert.equal(await comMetric(5), "1", "the missed next action is counted");
  assert.equal(await page.locator('[data-opportunity-id="deal-lead"].is-overdue').count(), 1, "the overdue card is flagged");

  // Moving through the menu, the path keyboard and touch users take.
  await openDealMenu("deal-lead");
  await page.click('[data-opportunity-id="deal-lead"] [data-com-action="move"][data-stage="CONTACTED"]');
  await page.waitForFunction(() => document.querySelector('[data-opportunity-id="deal-lead"]')?.dataset.stage === "CONTACTED");

  // Winning a lead creates the client and the receivable.
  await openDealMenu("deal-lead");
  await page.click('[data-opportunity-id="deal-lead"] [data-com-action="win"]');
  await page.waitForSelector("[data-win-form]");
  await page.fill("[data-win-form] [name=installments]", "3");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => document.querySelector('[data-opportunity-id="deal-lead"]')?.dataset.stage === "WON");
  const afterWin = await page.evaluate(() => ({
    clients: JSON.parse(localStorage.getItem("space-admin:clients:v1") || "[]").map((client) => client.name),
    ledger: JSON.parse(localStorage.getItem("space-admin:financial:v1") || "[]").map((entry) => [entry.type, entry.status, entry.amount]),
  }));
  assert.ok(afterWin.clients.includes("Nina Prado"), "the lead became a client");
  assert.deepEqual(afterWin.ledger, [["INCOME", "PENDING", 1000], ["INCOME", "PENDING", 1000], ["INCOME", "PENDING", 1000]], "the value is to receive in three parts");
  assert.equal(await comMetric(3), "R$ 3.000", "the win counts in the period");

  // Losing needs a reason.
  await openDealMenu("deal-cold");
  await page.click('[data-opportunity-id="deal-cold"] [data-com-action="lose"]');
  await page.waitForSelector("[data-lost-form]");
  await page.click("[data-modal-confirm]");
  await settle();
  assert.ok(await page.locator('[data-lost-form] [data-error-for="lostReason"]:not([hidden])').count(), "a loss without a reason is refused");
  await page.selectOption("[data-lost-form] [name=lostReason]", "PRICE");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => document.querySelector('[data-opportunity-id="deal-cold"]')?.dataset.stage === "LOST");
  assert.equal(await comMetric(4), "50%", "one won and one lost is half converted");

  // Reopening brings it back to negotiation.
  await openDealMenu("deal-cold");
  await page.click('[data-opportunity-id="deal-cold"] [data-com-action="reopen"]');
  await page.waitForFunction(() => document.querySelector('[data-opportunity-id="deal-cold"]')?.dataset.stage === "NEGOTIATION");

  // A new deal needs a title and somebody on the other side.
  await page.click("[data-com-new]");
  await page.waitForSelector("[data-com-form]");
  await page.click("[data-modal-confirm]");
  await settle();
  assert.ok(await page.locator('[data-com-form] [data-error-for="title"]:not([hidden])').count(), "missing title is flagged");
  assert.ok(await page.locator('[data-com-form] [data-error-for="contactName"]:not([hidden])').count(), "missing contact is flagged");
  await page.fill("[data-com-form] [name=title]", "E2E automation");
  await page.fill("[data-com-form] [name=company]", "Robo Ltda");
  await page.fill("[data-com-form] [name=estimatedValue]", "2.500,00");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => !document.querySelector("[data-com-form]"));
  const created = page.locator("[data-opportunity-id]", { hasText: "E2E automation" });
  await created.waitFor();
  assert.equal(await created.getAttribute("data-stage"), "NEW", "a new deal starts as new");

  // Deleting asks first.
  const createdId = await created.getAttribute("data-opportunity-id");
  await openDealMenu(createdId);
  await page.click(`[data-opportunity-id="${createdId}"] [data-com-action="delete"]`);
  await page.click("[data-modal-confirm]");
  await page.waitForFunction((id) => !document.querySelector(`[data-opportunity-id="${id}"]`), createdId);

  const comLog = await page.evaluate(() => JSON.parse(localStorage.getItem("space-admin:activity:v1") || "[]").map((entry) => entry.action));
  for (const action of ["commercial.stage_changed", "commercial.won", "commercial.lost", "commercial.reopened", "commercial.created", "commercial.deleted"]) {
    assert.ok(comLog.includes(action), `${action} is logged`);
  }
  assert.ok(comLog.includes("client.created") && comLog.includes("financial.installments_created"), "the win's side effects are logged too");

  /* ---------------------------------------------------------- settings v2 */

  await page.evaluate(() => localStorage.removeItem("space-admin:site-settings:v1"));
  await page.goto(`${BASE_URL}/#/settings`);
  await page.waitForSelector("[data-settings-form]:not([aria-busy])");
  const saveState = () => page.getAttribute("[data-settings-state]", "data-kind");
  const waitForSaved = () => page.waitForFunction(() => document.querySelector("[data-settings-state]")?.dataset.kind === "saved");
  assert.equal(await saveState(), "saved", "settings open with nothing unsaved");

  await page.fill("#settings-seoTitle", "Space Underground · estúdio");
  assert.equal(await saveState(), "unsaved", "an edit is an unsaved change");
  await page.fill("#settings-seoTitle", "Space Underground");
  assert.equal(await saveState(), "saved", "reverting the edit is not a change");
  assert.match(await page.innerText('[data-counter-for="seoTitle"]'), /^17\/60/, "the title counter follows the field");
  assert.deepEqual(
    await page.locator("#settings-locale option").evaluateAll((options) => options.map((option) => option.value)),
    ["", "pt-BR", "en"],
    "the site language is one the public site ships",
  );

  await page.fill("#settings-siteUrl", "spaceunderground");
  await page.click("[data-settings-save]");
  assert.equal(await saveState(), "invalid", "an invalid URL blocks the save");
  assert.equal(await page.locator('[data-error-for="siteUrl"]').isVisible(), true);
  await page.fill("#settings-siteUrl", "https://spaceunderground.dev");
  assert.equal(await page.locator('[data-error-for="siteUrl"]').isHidden(), true, "a fixed field clears its message");

  const svgImage = (width, height) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#222"/></svg>`)}`;
  await page.fill("#settings-ogImagePath", svgImage(400, 400));
  await page.waitForSelector(".settings-og-status.is-warning");
  await page.fill("#settings-ogImagePath", svgImage(1200, 630));
  await page.waitForSelector(".settings-og-status.is-ok");
  assert.equal(await page.locator('[data-check-target="ogImage"]').count(), 0, "a 1200 × 630 image passes the checklist");

  await page.click('[data-locale-edit="en"]');
  await page.fill("#settings-seoDescription", "");
  await page.click('[data-locale-edit="pt-BR"]');
  await page.click('[data-check-target="english"]');
  assert.equal(await page.getAttribute('[data-locale-edit="en"]', "aria-pressed"), "true", "the checklist opens the English copy");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-seoDescription");

  await page.click("[data-settings-discard]");
  await page.click("[data-modal-confirm]");
  await waitForSaved();
  assert.equal(await page.inputValue("#settings-ogImagePath"), "", "discarding restores the saved values");
  assert.equal(await page.getAttribute('[data-locale-edit="pt-BR"]', "aria-pressed"), "true");

  await page.fill("#settings-contactEmail", "ola@spaceunderground.dev");
  await page.click("[data-settings-save]");
  await waitForSaved();
  const storedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem("space-admin:site-settings:v1")));
  assert.equal(storedSettings.contactEmail, "ola@spaceunderground.dev", "the save persists");
  assert.ok(storedSettings.updatedAt, "the save is timestamped");
  assert.equal(storedSettings.translations.en.seo_description, "Digital studio for websites, systems, automation and AI.", "the English copy survives");
  assert.match(await page.innerText("[data-settings-updated]"), /Última alteração/);
  const settingsLog = await page.evaluate(() => JSON.parse(localStorage.getItem("space-admin:activity:v1") || "[]").map((entry) => entry.action));
  assert.ok(settingsLog.includes("settings.updated"), "saving settings is logged");

  await page.click('[data-tab="account"]');
  await page.waitForSelector("[data-password-form]");
  await page.fill("#settings-password", "admin2026lab");
  await page.fill("#settings-passwordConfirm", "admin2026lab");
  await page.click("[data-password-submit]");
  assert.equal(await page.locator('[data-error-for="password"]').isVisible(), true, "a password holding the email is refused");
  await page.fill("#settings-password", "Orbita-2026-lab");
  await page.fill("#settings-passwordConfirm", "Orbita-2026-lab");
  assert.equal(await page.locator("[data-password-rules] li.is-ok").count(), 4, "every password rule ticks");
  await page.click("[data-password-submit]");
  await page.waitForFunction(() => document.querySelector("#settings-password")?.value === "");
  // With the security model, the account tab shows the member's own access
  // (the legacy admins roster only appears before the migration).
  await page.waitForSelector("[data-account-access] .settings-facts");
  await page.waitForSelector("[data-account-mfa] .mfa-status");

  await page.click('[data-tab="system"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-health-status="ok"]').length === 8);
  assert.equal(await page.locator("[data-health-pending]").isHidden(), true, "no pending migration in mock mode");

  await page.click('[data-tab="data"]');
  await page.waitForSelector(".settings-counts__total");
  const [backupDownload] = await Promise.all([page.waitForEvent("download"), page.click("[data-backup-export]")]);
  assert.match(backupDownload.suggestedFilename(), /^space-underground-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const backup = JSON.parse(await readFile(await backupDownload.path(), "utf8"));
  assert.equal(backup.format, "space-underground-admin-backup");
  assert.deepEqual(backup.missing, [], "every module is in the backup");
  assert.equal(backup.data.settings.contactEmail, "ola@spaceunderground.dev", "the backup reads the saved settings");

  await page.click("[data-mock-reset]");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => document.querySelector("[data-toast-region]")?.textContent.includes("Dados de exemplo restaurados."));
  await page.evaluate(() => localStorage.removeItem("space-admin:site-settings:v1"));

  /* ----------------------------------------- one module down at a time */

  // The mock repositories read localStorage on every call, so making one key
  // throw is an outage of exactly that module: the rest keeps working, as it
  // must when one migration is missing in production.
  await page.evaluate(() => window.__resetSpaceAdminMocks());
  const FINANCIAL_KEY = "space-admin:financial:v1";
  const COMMERCIAL_KEY = "space-admin:commercial:v1";
  const CLIENTS_KEY = "space-admin:clients:v1";
  const failStorage = (keys) =>
    page.evaluate((list) => {
      const proto = Storage.prototype;
      if (!proto.__realGetItem) {
        proto.__realGetItem = proto.getItem;
        proto.getItem = function (key) {
          if (window.__failStorageKeys?.has(key)) throw new Error(`simulated outage: ${key}`);
          return proto.__realGetItem.call(this, key);
        };
      }
      window.__failStorageKeys = new Set(list);
    }, keys);
  // Same-document navigation, so the simulated outage survives the route change.
  const routeTo = async (target, selector) => {
    await page.evaluate((next) => {
      window.location.hash = next;
    }, target);
    await page.waitForSelector(selector);
    await settle();
  };
  const clientKpis = () => page.locator(".client-kpis .project-metric strong").allInnerTexts();

  // Client record, ledger down: only the money and the Financial tab go dark.
  await routeTo("#/dashboard", "[data-dash-kpis]");
  await failStorage([FINANCIAL_KEY]);
  await routeTo("#/clients/mock-client-003", "[data-client-record]");
  let kpis = await clientKpis();
  assert.deepEqual(kpis.slice(0, 3), ["—", "—", "—"], "money reads — while the ledger is down");
  assert.notEqual(kpis[3], "—", "the pipeline still reads");
  assert.equal(await page.locator("[data-signals-partial]").count(), 1, "the signals say which module is missing");
  await page.click('[data-tab="financial"]');
  assert.equal(await page.locator('[data-related-error="financial"]').count(), 1, "the Financial tab reports the outage");
  await page.click('[data-tab="commercial"]');
  assert.equal(await page.locator('[data-related-error="commercial"]').count(), 0, "the Commercial tab is unaffected");
  assert.ok(await page.locator(".client-deals .ops-row").count(), "the client's deals still render");

  // The client itself stays editable.
  await page.click('[data-tab="general"]');
  await page.fill("#field-name", "Academia X Centro");
  await page.click("[data-client-save]");
  await page.waitForFunction(() => document.querySelector("[data-save-state]")?.classList.contains("is-saved"));
  const renamed = await page.evaluate((key) => JSON.parse(Storage.prototype.__realGetItem.call(localStorage, key)).find((client) => client.id === "mock-client-003")?.name, CLIENTS_KEY);
  assert.equal(renamed, "Academia X Centro", "saving the client works while the ledger is down");

  // Client record, pipeline down: the other way round.
  await failStorage([COMMERCIAL_KEY]);
  await routeTo("#/dashboard", "[data-dash-kpis]");
  await routeTo("#/clients/mock-client-003", "[data-client-record]");
  kpis = await clientKpis();
  assert.notEqual(kpis[0], "—", "money still reads");
  assert.equal(kpis[3], "—", "the pipeline reads — while it is down");
  await page.click('[data-tab="commercial"]');
  assert.equal(await page.locator('[data-related-error="commercial"]').count(), 1);
  await page.click('[data-tab="financial"]');
  assert.equal(await page.locator('[data-related-error="financial"]').count(), 0);

  // A failed read is never shown as zero on the module pages.
  await failStorage([FINANCIAL_KEY]);
  await routeTo("#/financial", "[data-fin-list] .fin-error");
  assert.deepEqual(
    [...new Set(await page.locator("[data-fin-metrics] .project-metric strong").allInnerTexts())],
    ["—"],
    "every financial figure reads — instead of R$ 0",
  );
  await failStorage([COMMERCIAL_KEY]);
  await routeTo("#/commercial", "[data-com-board] .fin-error");
  assert.deepEqual(
    [...new Set(await page.locator("[data-com-metrics] .project-metric strong").allInnerTexts())],
    ["—"],
    "every commercial figure reads — instead of 0",
  );

  // Dashboard with both down: the two cards read —, the panels say why and
  // the queues do not claim to be clear.
  await failStorage([FINANCIAL_KEY, COMMERCIAL_KEY]);
  await routeTo("#/dashboard", "[data-dash-kpis] .stat-card");
  await page.waitForSelector("[data-checks-partial]");
  const dashCards = await page.locator("[data-dash-kpis] .stat-card strong").allInnerTexts();
  assert.deepEqual(dashCards.slice(2), ["—", "—"], "open deals and to receive read —");
  assert.notEqual(dashCards[0], "—", "projects still read");
  assert.equal(await page.locator('[data-i18n="dashboard.financialUnavailable"]').count(), 1);
  assert.equal(await page.locator('[data-i18n="dashboard.commercialUnavailable"]').count(), 1);
  await failStorage([]);

  // A win whose client step fails: the deal is won, the warning stays on
  // screen, and "Finish closing" completes it without a second receivable.
  await routeTo("#/commercial", "[data-com-board]:not([aria-busy]) [data-opportunity-id]");
  const winDeal = "mock-opp-002";
  await page.locator(`[data-opportunity-id="${winDeal}"] [data-row-menu-toggle]`).click();
  await page.click(`[data-opportunity-id="${winDeal}"] [data-com-action="win"]`);
  await page.waitForSelector("[data-win-form]");
  await failStorage([CLIENTS_KEY]);
  await page.click("[data-modal-confirm]");
  await page.waitForSelector(".com-warnings li");
  assert.match(await page.locator(".modal h2").innerText(), /NEGÓCIO GANHO, COM PENDÊNCIAS/);
  await page.click("[data-modal-confirm]");
  await failStorage([]);
  await page.waitForFunction((id) => document.querySelector(`[data-opportunity-id="${id}"]`)?.dataset.stage === "WON", winDeal);
  const dealEntries = () =>
    page.evaluate(
      ({ key, id }) => JSON.parse(localStorage.getItem(key) || "[]").filter((entry) => entry.opportunityId === id),
      { key: FINANCIAL_KEY, id: winDeal },
    );
  assert.equal((await dealEntries()).length, 1, "the receivable did not wait for the client");

  await page.locator(`[data-opportunity-id="${winDeal}"] [data-row-menu-toggle]`).click();
  await page.click(`[data-opportunity-id="${winDeal}"] [data-com-action="complete"]`);
  await page.waitForSelector("[data-win-form]");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => !document.querySelector("[data-win-form]"));
  await settle();
  const marina = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).filter((client) => client.name === "Marina Costa"), CLIENTS_KEY);
  assert.equal(marina.length, 1, "finishing the win creates the client once");
  const finished = await dealEntries();
  assert.equal(finished.length, 1, "no second receivable");
  assert.equal(finished[0].clientId, marina[0].id, "the receivable now points at the client");
  await page.evaluate(() => window.__resetSpaceAdminMocks());

  assert.deepEqual(errors, [], "no console or page errors");
  console.log("admin flow: all checks passed");
} finally {
  await context.close();
  await browser.close();
}

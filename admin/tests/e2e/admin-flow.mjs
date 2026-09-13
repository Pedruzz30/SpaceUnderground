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
// Explicit locale: this test asserts Portuguese copy, so it must not inherit
// whatever language Playwright's default context happens to use.
const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

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
  assert.equal(await page.locator(".page-heading h2").innerText(), "Public configuration.", "settings switches to English");
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
  await page.fill("#field-description", "Oferta alpha prime.");
  await page.fill("#field-timeline", "2 semanas");
  await settle();
  assert.match(await page.locator("[data-service-preview]").innerText(), /Alpha Prime/, "service preview follows unsaved name");
  assert.match(await page.locator("[data-service-preview]").innerText(), /Oferta alpha prime/, "service preview follows unsaved description");
  assert.match(await page.locator("[data-service-preview]").innerText(), /2 semanas/i, "service preview follows unsaved timeline");
  await page.click("#tab-features");
  await page.click("[data-feature-add]");
  await page.locator("[data-feature-text]").last().fill("Nova entrega");
  await settle();
  assert.match(await page.locator("[data-service-preview]").innerText(), /Nova entrega/, "service preview follows unsaved feature");
  await page.click("[data-action-save]");
  await page.waitForSelector("[data-save-state].is-saved");
  await page.reload();
  await page.waitForSelector("[data-service-editor]");
  await page.click("#tab-commercial");
  assert.equal(await page.inputValue("#field-name"), "Alpha Prime", "service edit persisted");

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

  assert.deepEqual(errors, [], "no console or page errors");
  console.log("admin flow: all checks passed");
} finally {
  await context.close();
  await browser.close();
}

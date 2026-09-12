// Locale behaviour of the Admin, driven against a running mock dev server.
//
//   npm run dev:mock                  # terminal 1
//   npx playwright install chromium   # once
//   BASE_URL=http://127.0.0.1:5173 npm run test:e2e:i18n
//
// Mock mode only: the CMS section writes and reads back site content, so this
// must never point at a real backend.
//
// Actions are driven through stable data attributes rather than translated
// labels. Copy is only asserted where the test is specifically checking a
// translation.

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const checks = [];

function check(ok, label, extra = "") {
  checks.push({ ok, label, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
}

const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

const settle = () => page.waitForTimeout(250);
const lang = () => page.locator("html").getAttribute("lang");
const hash = () => page.evaluate(() => window.location.hash);
const textOf = (selector) => page.locator(selector).first().evaluate((node) => node.textContent.trim());

async function setLocale(locale) {
  await page.click(`[data-locale-switch="${locale}"]`);
  await page.waitForFunction((value) => document.documentElement.lang === value, locale);
  await settle();
}

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

  /* ------------------------------------------------------ screen coverage */

  // Each entry: route, a selector to wait for, and the heading in each locale.
  const SCREENS = [
    ["#/dashboard", ".page-heading > div > span", "CENTRAL DE CONTROLE", "COMMAND CENTER"],
    ["#/projects", ".page-heading h2", "Controle do portfólio.", "Portfolio control."],
    ["#/clients", ".page-heading h2", "Diretório de clientes.", "Client directory."],
    ["#/commercial", ".page-heading h2", "Pipeline de vendas.", "Sales pipeline."],
    ["#/financial", ".page-heading h2", "Controle financeiro.", "Financial control."],
    ["#/services", ".page-heading h2", "Planos comerciais.", "Commercial plans."],
    ["#/cms", ".page-heading h2", "Controle de conteúdo.", "Content control."],
    ["#/content", ".page-heading h2", "Área editorial.", "Editorial workspace."],
    ["#/media", ".page-heading h2", "Arquivos dos projetos.", "Project assets."],
    ["#/logs", ".page-heading h2", "Registro administrativo.", "Administrative log."],
    ["#/settings", ".page-heading h2", "Configuração pública.", "Public configuration."],
  ];

  await setLocale("pt-BR");
  for (const [route, selector, ptText] of SCREENS) {
    await page.goto(`${BASE_URL}/${route}`);
    await page.waitForSelector(selector);
    const actual = await textOf(selector);
    check(actual === ptText, `PT ${route}`, actual);
  }

  await setLocale("en");
  for (const [route, selector, , enText] of SCREENS) {
    await page.goto(`${BASE_URL}/${route}`);
    await page.waitForSelector(selector);
    const actual = await textOf(selector);
    check(actual === enText, `EN ${route}`, actual);
  }

  /* --------------------------------- switching locale while on the screen */

  // Navigating to a route renders it fresh, which would hide an unmarked
  // heading. This switches locale in place, which only works if the copy is
  // marked up (or the page re-labels itself).
  for (const [route, selector, ptText, enText] of SCREENS) {
    await setLocale("pt-BR");
    await page.goto(`${BASE_URL}/${route}`);
    await page.waitForSelector(selector);
    await setLocale("en");
    const afterEn = await textOf(selector);
    check(afterEn === enText, `in-place PT->EN ${route}`, afterEn);

    await setLocale("pt-BR");
    const afterPt = await textOf(selector);
    check(afterPt === ptText, `in-place EN->PT ${route}`, afterPt);
  }

  /* ------------------------------------------------------------- sidebar */

  await page.goto(`${BASE_URL}/#/dashboard`);
  await page.waitForSelector(".admin-shell");
  await setLocale("en");
  check((await textOf('a[href="#/settings"]')) === "Settings", "EN sidebar", await textOf('a[href="#/settings"]'));
  check((await textOf('a[href="#/clients"]')) === "Clients", "EN sidebar clients");
  await setLocale("pt-BR");
  check((await textOf('a[href="#/settings"]')) === "Configurações", "PT sidebar", await textOf('a[href="#/settings"]'));
  check((await textOf('a[href="#/clients"]')) === "Clientes", "PT sidebar clients");

  /* ------------------------------------------ reload keeps the preference */

  await setLocale("en");
  await page.reload();
  await page.waitForSelector(".admin-shell");
  check((await lang()) === "en", "reload preserves the EN preference", await lang());
  await setLocale("pt-BR");
  await page.reload();
  await page.waitForSelector(".admin-shell");
  check((await lang()) === "pt-BR", "reload preserves the PT preference", await lang());

  /* ------------------------------- clients: plurals and preserved filters */

  await page.goto(`${BASE_URL}/#/clients`);
  await page.waitForSelector("[data-client-row]");
  await page.fill("[data-search-clients]", "lucas");
  await settle();
  const ptCount = await textOf("[data-client-count]");
  check(/de \d+ clientes/.test(ptCount), "PT client count agrees with the total", ptCount);

  await setLocale("en");
  check((await page.inputValue("[data-search-clients]")) === "lucas", "locale switch keeps the client search");
  const enCount = await textOf("[data-client-count]");
  check(/of \d+ clients/.test(enCount), "EN client count agrees with the total", enCount);
  check((await hash()) === "#/clients", "locale switch keeps the route", await hash());

  /* ------------------------------------------------ PROJECT EDITOR: state */

  // The main test: an unsaved edit must survive a PT <-> EN switch.
  await setLocale("pt-BR");
  await page.goto(`${BASE_URL}/#/projects`);
  await page.waitForSelector("[data-project-list] [data-project-id]");
  await page.locator("[data-project-list] [data-project-id]").first().click();
  await page.waitForSelector("[data-project-editor]");
  const editorRoute = await hash();

  await page.fill("#field-name", "Nome de teste alterado");
  await page.fill("#field-description", "Descrição ainda não salva.");
  await page.fill("[data-tech-input]", "Playwright");
  await page.click("[data-tech-add]");
  await page.click('[role="tab"][data-tab="presentation"]');
  await page.waitForSelector("[data-module-add]");
  await page.click("[data-module-add]");
  await settle();

  const moduleCountBefore = await page.locator("[data-module-index]").count();
  const modulesInput = page.locator('[data-module-field="title"]').last();
  await modulesInput.fill("Módulo não salvo");
  await settle();

  const dirtyBefore = await textOf("[data-save-state]");
  const chipsBefore = await page.locator("[data-tech-list] [data-tech-remove]").count();

  await setLocale("en");

  check((await hash()) === editorRoute, "editor: locale switch keeps the route", await hash());
  check(
    (await page.inputValue("#field-name")) === "Nome de teste alterado",
    "editor: keeps the typed project name",
    await page.inputValue("#field-name"),
  );
  check(
    (await page.inputValue("#field-description")) === "Descrição ainda não salva.",
    "editor: keeps the typed description",
  );
  check(
    (await page.locator("[data-tech-list] [data-tech-remove]").count()) === chipsBefore,
    "editor: keeps the added tech stack",
  );
  check(
    (await page.locator("[data-module-index]").count()) === moduleCountBefore,
    "editor: keeps the added module",
  );
  check(
    (await page.locator('[data-module-field="title"]').last().inputValue()) === "Módulo não salvo",
    "editor: keeps the typed module title",
  );
  check(
    (await page.locator('[role="tab"][data-tab="presentation"]').getAttribute("aria-selected")) === "true",
    "editor: keeps the active tab",
  );
  const dirtyAfter = await textOf("[data-save-state]");
  check(dirtyAfter !== "" && dirtyAfter !== dirtyBefore, "editor: keeps the dirty state (relabelled)", `${dirtyBefore} -> ${dirtyAfter}`);
  check(
    (await textOf('[role="tab"][data-tab="general"]')) === "General",
    "editor: labels switch to English",
    await textOf('[role="tab"][data-tab="general"]'),
  );

  // And back again, still intact.
  await setLocale("pt-BR");
  check(
    (await page.inputValue("#field-name")) === "Nome de teste alterado",
    "editor: PT round-trip keeps the typed name",
  );
  check(
    (await page.locator('[data-module-field="title"]').last().inputValue()) === "Módulo não salvo",
    "editor: PT round-trip keeps the module",
  );
  check(
    (await textOf('[role="tab"][data-tab="general"]')) === "Geral",
    "editor: labels switch back to Portuguese",
  );

  /* -------------------------------- PROJECT EDITOR: bilingual description */

  // The English tab edits translations.en and leaves the pt-BR text alone.
  await page.click('[role="tab"][data-tab="general"]');
  await settle();
  await page.click('[data-locale-tabs="project-general"] [data-locale-edit="en"]');
  await settle();
  check(
    (await page.inputValue("#field-description")) === "",
    "editor: English description starts empty",
    await page.inputValue("#field-description"),
  );
  check(
    (await page.locator("#field-description").getAttribute("placeholder")) === "Descrição ainda não salva.",
    "editor: English description shows the pt-BR fallback as placeholder",
  );
  await page.fill("#field-description", "Unsaved English description.");
  await page.click('[data-locale-tabs="project-general"] [data-locale-edit="pt-BR"]');
  await settle();
  check(
    (await page.inputValue("#field-description")) === "Descrição ainda não salva.",
    "editor: pt-BR description is untouched by the English edit",
    await page.inputValue("#field-description"),
  );
  await page.click('[data-locale-tabs="project-general"] [data-locale-edit="en"]');
  await settle();
  check(
    (await page.inputValue("#field-description")) === "Unsaved English description.",
    "editor: English draft survives a round-trip",
  );

  // Leave without saving.
  await page.evaluate(() => {
    window.onbeforeunload = null;
  });
  await page.goto(`${BASE_URL}/#/content`);
  const discard = page.locator("[data-modal-confirm]");
  if (await discard.count()) await discard.click();
  await page.waitForSelector("[data-content-form]");

  /* ----------------------------------------------- CMS: bilingual editing */

  await setLocale("pt-BR");
  await page.goto(`${BASE_URL}/#/content`);
  await page.waitForSelector("[data-content-form]");

  const heroHeadline = "Manchete em português";
  await page.fill("#content-headline", heroHeadline);
  await settle();

  await page.click('[data-locale-tabs="site-content"] [data-locale-edit="en"]');
  await settle();
  check(
    (await page.inputValue("#content-headline")) === "",
    "cms: English headline starts empty",
    await page.inputValue("#content-headline"),
  );
  check(
    (await page.locator("#content-headline").getAttribute("placeholder")) === heroHeadline,
    "cms: English field shows the pt-BR fallback as placeholder",
  );
  check(
    (await page.locator('[data-locale-hint="site-content"]').isVisible()),
    "cms: fallback note is visible on the English tab",
  );

  // A technical field stays shared and read-only while editing English.
  const ctaReadOnly = await page.locator("#content-primaryCtaUrl").getAttribute("readonly");
  check(ctaReadOnly !== null, "cms: CTA URL is read-only on the English tab");

  await page.fill("#content-headline", "English headline");
  await page.click("[data-action-save]");
  await page.waitForFunction(() => !document.querySelector("[data-content-state]")?.textContent.includes("..."));
  await settle();

  await page.reload();
  await page.waitForSelector("[data-content-form]");
  check(
    (await page.inputValue("#content-headline")) === heroHeadline,
    "cms: pt-BR content survived the save",
    await page.inputValue("#content-headline"),
  );
  await page.click('[data-locale-tabs="site-content"] [data-locale-edit="en"]');
  await settle();
  check(
    (await page.inputValue("#content-headline")) === "English headline",
    "cms: English translation persisted",
    await page.inputValue("#content-headline"),
  );

  // A field with no English value still falls back to pt-BR in the preview.
  const previewText = await page.locator(".cms-preview").first().evaluate((node) => node.textContent);
  check(previewText.includes("English headline"), "cms: preview shows the English value");

  await setLocale("en");
  check((await hash()) === "#/content", "cms: locale switch keeps the route");
  check(
    (await page.inputValue("#content-headline")) === "English headline",
    "cms: locale switch keeps the English draft",
  );

  check(pageErrors.length === 0, "no page errors", pageErrors.join(" | "));
} finally {
  await context.close();
  await browser.close();
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("\nFailures:");
  failed.forEach((entry) => console.log(`  ${entry.label}${entry.extra ? ` — ${entry.extra}` : ""}`));
  process.exit(1);
}

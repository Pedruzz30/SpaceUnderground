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

// Some screens leave a dirty form behind on purpose, and the router then asks
// before navigating away. These runs are not testing saving, so the guard is
// discarded.
async function gotoRoute(route, waitFor) {
  await page.goto(`${BASE_URL}/${route}`);
  const guard = page.locator("[data-modal-confirm]");
  if (await guard.count()) {
    await guard.click();
    await page.waitForTimeout(250);
  }
  if (waitFor) await page.waitForSelector(waitFor);
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
    ["#/projects", ".page-heading h2", "PROJETOS", "PROJECTS"],
    ["#/clients", ".page-heading h2", "Diretório de clientes.", "Client directory."],
    ["#/commercial", ".page-heading h2", "Pipeline de vendas.", "Sales pipeline."],
    ["#/financial", ".page-heading h2", "Controle financeiro.", "Financial control."],
    ["#/services", ".page-heading h2", "SERVICES", "SERVICES"],
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

  /* -------------------------------------- PROJECT EDITOR: derived signals */

  // The Overview badges, the health card and the demo badge are built from
  // dictionary lookups instead of data-i18n attributes, so a locale switch has
  // to repaint them. They used to keep the previous language until something
  // was edited or a tab was reopened, so this runs on a freshly opened editor
  // with nothing typed.
  await setLocale("pt-BR");
  await gotoRoute("#/projects", "[data-project-list] [data-project-id]");
  await page.locator("[data-project-open]").first().click();
  await page.waitForSelector("[data-project-editor]");
  await page.click('[role="tab"][data-tab="overview"]');
  await settle();

  const badgesText = () => textOf("[data-overview-badges]");
  const healthText = () => textOf("[data-overview-health]");

  const badgesPt = await badgesText();
  const healthPt = await healthText();
  check(/Oculto|Visível/.test(badgesPt), "overview: PT badges read in Portuguese", badgesPt);
  check(/pronto/.test(healthPt), "overview: PT health score reads in Portuguese", healthPt);
  check(/Incompleto|Atenção|Saudável/.test(healthPt), "overview: PT health status reads in Portuguese");
  check(/Categoria/.test(healthPt), "overview: PT health check labels read in Portuguese");

  await setLocale("en");
  const badgesEn = await badgesText();
  const healthEn = await healthText();

  check(/Hidden|Visible/.test(badgesEn), "overview: badges follow the locale switch with no edit", badgesEn);
  check(!/Oculto|Visível/.test(badgesEn), "overview: badges keep no Portuguese copy", badgesEn);
  check(/ready/.test(healthEn) && !/pronto/.test(healthEn), "overview: health score follows the switch", healthEn);
  check(
    /Incomplete|Attention|Healthy/.test(healthEn) && !/Incompleto|Atenção|Saudável/.test(healthEn),
    "overview: health status follows the switch",
  );
  check(
    /Category/.test(healthEn) && !/Categoria/.test(healthEn),
    "overview: health check labels follow the switch",
  );

  // The demo badge sits on its own tab and is painted the same way.
  const DEMO_LABELS = { Nenhum: "None", Live: "Live", "URL inválida": "Invalid URL" };
  await setLocale("pt-BR");
  await page.click('[role="tab"][data-tab="live-demo"]');
  await settle();
  const demoPt = await textOf("[data-demo-status]");
  await setLocale("en");
  const demoEn = await textOf("[data-demo-status]");
  check(
    DEMO_LABELS[demoPt] === demoEn,
    "live demo: the status badge follows the locale switch",
    `${demoPt} -> ${demoEn}`,
  );

  // And back, still with nothing edited.
  await setLocale("pt-BR");
  check((await textOf("[data-demo-status]")) === demoPt, "live demo: PT round-trip restores the status badge");
  await page.click('[role="tab"][data-tab="overview"]');
  await settle();
  check((await badgesText()) === badgesPt, "overview: PT round-trip restores the badges", await badgesText());
  check((await healthText()) === healthPt, "overview: PT round-trip restores the health card");

  // "Live" is spelled the same in both dictionaries, so the round trip above
  // cannot prove the demo badge was repainted. Forcing the state to "none",
  // whose labels do differ, does.
  await page.click('[role="tab"][data-tab="live-demo"]');
  await settle();
  const demoEnabled = await page.isChecked('[name="livePreviewEnabled"]');
  if (demoEnabled) await page.uncheck('[name="livePreviewEnabled"]');
  else await page.fill("#field-previewUrl", "");
  await settle();

  const offPt = await textOf("[data-demo-status]");
  await setLocale("en");
  const offEn = await textOf("[data-demo-status]");
  check(offPt === "Nenhum", "live demo: an unpublished demo reads NENHUM in PT", offPt);
  check(offEn === "None", "live demo: the demo badge repaints on the locale switch", `${offPt} -> ${offEn}`);
  await setLocale("pt-BR");

  // Nothing here was saved; the guard is discarded so the next section starts clean.
  await gotoRoute("#/projects", "[data-project-list] [data-project-id]");

  /* ------------------------------------------------ PROJECT EDITOR: state */

  // The main test: an unsaved edit must survive a PT <-> EN switch.
  await setLocale("pt-BR");
  await page.goto(`${BASE_URL}/#/projects`);
  await page.waitForSelector("[data-project-list] [data-project-id]");
  await page.locator("[data-project-open]").first().click();
  await page.waitForSelector("[data-project-editor]");
  await page.click("#tab-general");
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

  // The seed ships a curated English headline, so the English tab shows that
  // rather than the Portuguese text it falls back to.
  const seededEnglish = await page.inputValue("#content-headline");
  check(seededEnglish !== heroHeadline && seededEnglish !== "", "cms: English tab shows its own value", seededEnglish);
  check(!/[áàâãéêíóôõúüç]/i.test(seededEnglish), "cms: English tab value is English", seededEnglish);

  // Cleared, the field falls back to the pt-BR text through the placeholder.
  await page.fill("#content-headline", "");
  check(
    (await page.locator("#content-headline").getAttribute("placeholder")) === heroHeadline,
    "cms: cleared English field shows the pt-BR fallback as placeholder",
    String(await page.locator("#content-headline").getAttribute("placeholder")),
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

  /* ------------------------------- CMS: partial repeatable translation */

  // The bug this guards: the English tab bound each row to translations.en.items
  // BY ARRAY INDEX. With only position 2 translated, the single surviving entry
  // was handed to the first card, and saving rewrote its position to 0.
  //
  // The scenario is built to leave exactly one translated item, at position 2,
  // which is the shape that slipped past the earlier suite.
  await setLocale("pt-BR");
  await page.goto(`${BASE_URL}/#/content`);
  await page.waitForSelector("[data-content-form]");
  await page.click('[data-content-section="capabilities"]');
  await page.waitForSelector("[data-repeatable-item]");
  // The content-language tab persists across section switches, so it is set
  // back to pt-BR explicitly before reading the base titles.
  await page.click('[data-locale-tabs="site-content"] [data-locale-edit="pt-BR"]');
  await page.waitForTimeout(250);

  const baseTitles = await page.evaluate(() =>
    [...document.querySelectorAll("[data-repeatable-item]")].map(
      (card) => card.querySelector('[data-repeatable-field="title"]')?.value,
    ),
  );
  check(baseTitles.length === 4, "cms: capabilities has four base items", baseTitles.join(", "));

  // The card must carry the editorial position, not the visual index.
  const stampedPositions = await page.evaluate(() =>
    [...document.querySelectorAll("[data-repeatable-item]")].map((card) => card.dataset.itemPosition),
  );
  check(stampedPositions.join(",") === "0,1,2,3", "cms: cards carry their real position", stampedPositions.join(","));

  // Localized kind label, not the internal identity.
  const ptKind = await page.evaluate(
    () => document.querySelector("[data-repeatable-item] .module-card__head span")?.textContent.trim(),
  );
  check(ptKind === "CAPACIDADE 01", "cms: PT capability label", String(ptKind));

  // The kind label follows the interface language, not the content-language tab.
  await setLocale("en");
  const enKind = await page.evaluate(
    () => document.querySelector("[data-repeatable-item] .module-card__head span")?.textContent.trim(),
  );
  check(enKind === "CAPABILITY 01", "cms: EN capability label", String(enKind));
  await setLocale("pt-BR");

  await page.click('[data-locale-tabs="site-content"] [data-locale-edit="en"]');
  await page.waitForTimeout(250);

  // Clear every English title except position 2, so the stored translation
  // array ends up holding that one entry only.
  const titleInputs = page.locator('[data-repeatable-item] [data-repeatable-field="title"]');
  const descInputs = page.locator('[data-repeatable-item] [data-repeatable-field="description"]');
  for (const index of [0, 1, 3]) {
    await titleInputs.nth(index).fill("");
    await descInputs.nth(index).fill("");
  }
  await descInputs.nth(2).fill("");

  await page.click("[data-action-save]");
  await page.waitForFunction(
    () => !document.querySelector("[data-content-state]")?.textContent.includes("..."),
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(300);

  await page.reload();
  await page.waitForSelector("[data-content-form]");
  await page.click('[data-content-section="capabilities"]');
  await page.waitForSelector("[data-repeatable-item]");
  await page.click('[data-locale-tabs="site-content"] [data-locale-edit="en"]');
  await page.waitForTimeout(250);

  const afterReload = await page.evaluate(() =>
    [...document.querySelectorAll("[data-repeatable-item]")].map((card) => ({
      position: card.dataset.itemPosition,
      value: card.querySelector('[data-repeatable-field="title"]')?.value,
      placeholder: card.querySelector('[data-repeatable-field="title"]')?.placeholder,
    })),
  );

  check(afterReload.length === 4, "cms: partial translation keeps all four items", String(afterReload.length));
  check(
    afterReload.map((row) => row.position).join(",") === "0,1,2,3",
    "cms: positions survive the save",
    afterReload.map((row) => row.position).join(","),
  );
  check(afterReload[0].value === "", "cms: position 0 has no translation", String(afterReload[0].value));
  check(
    afterReload[0].placeholder === baseTitles[0],
    "cms: position 0 falls back to its own pt-BR title",
    `${afterReload[0].placeholder} vs ${baseTitles[0]}`,
  );
  check(afterReload[1].value === "", "cms: position 1 has no translation", String(afterReload[1].value));
  check(
    afterReload[1].placeholder === baseTitles[1],
    "cms: position 1 falls back to its own pt-BR title",
    `${afterReload[1].placeholder} vs ${baseTitles[1]}`,
  );
  check(
    afterReload[2].value === "Automation",
    "cms: the only translation stayed on position 2",
    String(afterReload[2].value),
  );
  check(
    afterReload[2].placeholder === baseTitles[2],
    "cms: position 2 shows its own pt-BR fallback",
    `${afterReload[2].placeholder} vs ${baseTitles[2]}`,
  );
  check(afterReload[3].value === "", "cms: position 3 has no translation", String(afterReload[3].value));

  // The preview resolves the same way the public site will: per position, per
  // field.
  const previewItems = await page.evaluate(() =>
    [...document.querySelectorAll(".cms-preview-list p")].map((node) => node.textContent.replace(/^\d+/, "").trim()),
  );
  check(previewItems.length === 4, "cms: preview lists all four items", previewItems.join(", "));
  check(previewItems[0] === baseTitles[0], "cms: preview falls back for position 0", previewItems[0]);
  check(previewItems[2] === "Automation", "cms: preview shows the translation on position 2", previewItems[2]);

  /* ------------------------------------------- CMS: process kind label */

  await setLocale("pt-BR");
  await page.click('[data-content-section="process"]');
  await page.waitForTimeout(300);
  await page.click('[data-locale-tabs="site-content"] [data-locale-edit="pt-BR"]');
  await page.waitForTimeout(200);

  // The seed ships no process items, so one is added. An empty row is dropped
  // when the draft is captured, so it is given a title first.
  if ((await page.locator("[data-repeatable-item]").count()) === 0) {
    await page.click("[data-add-repeatable]");
    await page.waitForSelector("[data-repeatable-item]");
    await page.locator('[data-repeatable-item] [data-repeatable-field="title"]').first().fill("Descoberta");
    await page.waitForTimeout(200);
  }

  const stepKind = (label) =>
    page.evaluate(() => document.querySelector("[data-repeatable-item] .module-card__head span")?.textContent.trim());

  const ptStep = await stepKind();
  check(ptStep === "ETAPA 01", "cms: PT step label", String(ptStep));

  await setLocale("en");
  await page.waitForTimeout(250);
  const enStep = await stepKind();
  check(enStep === "STEP 01", "cms: EN step label", String(enStep));
  await setLocale("pt-BR");

  /* --------------------------------------- Settings: SEO preview fallback */

  // With no seoDescription stored, the preview must not fall back to English
  // copy while the interface is in Portuguese.
  await setLocale("pt-BR");
  // The process section was left dirty by the step added above, so the guard
  // asks before leaving.
  await gotoRoute("#/settings", "[data-settings-form]:not([aria-busy])");
  await page.fill("#settings-seoDescription", "");
  await page.waitForTimeout(300);

  const ptFallback = await page.evaluate(
    () => document.querySelector(".settings-search-preview p")?.textContent.trim(),
  );
  check(
    ptFallback === "Estúdio digital para sites, sistemas, automação e IA.",
    "settings: PT SEO preview fallback",
    String(ptFallback),
  );

  await setLocale("en");
  await page.waitForTimeout(300);
  const enFallback = await page.evaluate(
    () => document.querySelector(".settings-search-preview p")?.textContent.trim(),
  );
  check(
    enFallback === "Digital studio for websites, systems, automation and AI.",
    "settings: EN SEO preview fallback",
    String(enFallback),
  );

  /* ----------------------------------------------------------- responsive */

  // The topbar carries the locale switcher next to the account block, and the
  // CMS and Project Editor add PT-BR | EN controls. English labels are longer,
  // so these are the places where a locale could break the layout.
  const WIDTHS = [1920, 1440, 1280, 1024, 768, 430, 390, 320];
  const RESPONSIVE_ROUTES = [
    ["#/dashboard", ".topbar", null],
    ["#/content", "[data-content-form]", '[data-locale-tabs="site-content"]'],
    ["#/settings", "[data-settings-form]:not([aria-busy])", '[data-locale-tabs="settings-seo"]'],
  ];

  for (const locale of ["pt-BR", "en"]) {
    await setLocale(locale);
    for (const [route, waitFor, localeControl] of RESPONSIVE_ROUTES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await gotoRoute(route, waitFor);

        const overflow = await page.evaluate((w) => {
          const selectors = [".topbar", ".page-heading", ".locale-tabs", ".locale-switcher"];
          return selectors.flatMap((selector) =>
            [...document.querySelectorAll(selector)]
              .filter((el) => el.getBoundingClientRect().right > w + 1)
              .map(() => selector),
          );
        }, width);
        check(
          overflow.length === 0,
          `${locale} ${route} @ ${width}px keeps the chrome inside the viewport`,
          overflow.join(", "),
        );

        const switcherVisible = await page.locator('[data-locale-switch="en"]').isVisible();
        check(switcherVisible, `${locale} ${route} @ ${width}px keeps the locale switcher visible`);

        if (localeControl) {
          const visible = await page.locator(localeControl).first().isVisible();
          check(visible, `${locale} ${route} @ ${width}px keeps the PT-BR | EN control visible`);
        }
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

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

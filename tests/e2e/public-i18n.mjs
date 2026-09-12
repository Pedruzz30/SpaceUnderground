// Locale behaviour of the public site, driven against a running dev server.
//
//   npm run dev                       # terminal 1
//   npx playwright install chromium   # once
//   BASE_URL=http://127.0.0.1:5173 npm run test:e2e:i18n
//
// Every case opens its own BrowserContext with an explicit `locale`, so the
// result never depends on whatever language the machine running the test
// happens to be set to.

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const checks = [];

function check(ok, label, extra = "") {
  checks.push({ ok, label, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
}

async function withLocale(locale, run, { storage } = {}) {
  const context = await browser.newContext({
    locale,
    viewport: { width: 1440, height: 1000 },
    storageState: storage,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hero-title");
    const result = await run(page, context);
    check(errors.length === 0, `${locale}: no page errors`, errors.join(" | "));
    return result;
  } finally {
    await context.close();
  }
}

const lang = (page) => page.locator("html").getAttribute("lang");

/* ------------------------------------------------ browser locale resolution */

// No saved preference: the browser language decides, falling back to pt-BR for
// anything that is neither Portuguese nor English.
for (const [locale, expected] of [
  ["pt-BR", "pt-BR"],
  ["pt-PT", "pt-BR"],
  ["en-US", "en"],
  ["en-GB", "en"],
  ["fr-FR", "pt-BR"],
]) {
  await withLocale(locale, async (page) => {
    check((await lang(page)) === expected, `browser ${locale} resolves to ${expected}`, await lang(page));
  });
}

/* ------------------------------------------------------- manual preference */

// An explicit choice outlives a reload and beats the browser language.
await withLocale("en-US", async (page, context) => {
  await page.click('[data-locale-switch="pt-BR"]');
  await page.waitForFunction(() => document.documentElement.lang === "pt-BR");
  await page.reload({ waitUntil: "domcontentloaded" });
  check((await lang(page)) === "pt-BR", "en-US browser + manual PT survives reload", await lang(page));
  void context;
});

await withLocale("pt-BR", async (page) => {
  await page.click('[data-locale-switch="en"]');
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.reload({ waitUntil: "domcontentloaded" });
  check((await lang(page)) === "en", "pt-BR browser + manual EN survives reload", await lang(page));
});

/* --------------------------------------------------------- section coverage */

const SECTIONS = [
  ["nav", '[data-nav] [href="#contact"]', "Contato", "Contact"],
  ["hero eyebrow", ".hero__copy .eyebrow span:nth-child(2)", "Estúdio digital independente", "Independent digital studio"],
  ["services heading", "#services-title", "O que construímos.", "What we build."],
  ["capabilities heading", "#capabilities-title", "Do site ao sistema inteligente.", "From website to intelligent system."],
  ["selected work heading", "#work-title", "Projetos ao vivo.", "Live projects."],
  ["labs heading", "#labs-title", "Produtos criados no subterrâneo.", "Products built underground."],
  ["point of view", ".statement__title .statement-line:first-child span", "Não criamos sites", "We don't build websites"],
  ["process heading", "#process-title", "Da ideia ao lançamento.", "From idea to launch."],
  ["plans heading", "#plans-title", "Três formas de começar.", "Three ways to start."],
  ["difference heading", "#why-title", "Feito sem o de sempre.", "Built without the usual."],
  ["about heading", "#about-title", "Independente por escolha.", "Independent by design."],
  ["contact heading", ".contact__title .contact-line:first-child span", "Tem algo", "Got something"],
  ["project request label", 'label[for="project-name"]', "Nome", "Name"],
  ["footer", ".footer__bottom p:nth-child(2)", "Criado abaixo da superfície.", "Built below the surface."],
];

// innerText reflects CSS text-transform, which uppercases several of these
// elements. textContent is what the dictionary actually put there.
const normalise = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const textOf = (page, selector) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
      return clone.textContent;
    });

await withLocale("pt-BR", async (page) => {
  for (const [label, selector, ptText] of SECTIONS) {
    const actual = normalise(await textOf(page, selector));
    check(actual === ptText, `PT ${label}`, actual);
  }
});

await withLocale("en-US", async (page) => {
  for (const [label, selector, , enText] of SECTIONS) {
    const actual = normalise(await textOf(page, selector));
    check(actual === enText, `EN ${label}`, actual);
  }
});

/* ----------------------------------------------- accessibility and messages */

await withLocale("pt-BR", async (page) => {
  check(
    (await page.locator("#hero-title").getAttribute("aria-label")) === "Crie o que ainda não deveria existir.",
    "PT hero aria-label",
  );
  const ptBudget = await page.locator("#project-budget").getAttribute("placeholder");
  check(ptBudget === "Exemplo: R$ 6.000 – R$ 12.000", "PT budget placeholder", String(ptBudget));
  check(
    (await page.locator('[data-nav]').getAttribute("aria-label")) === "Navegação principal",
    "PT navigation aria-label",
  );

  // Submitting empty surfaces the localized validation copy.
  await page.locator(".project-form__submit").click();
  const status = normalise(await textOf(page, "[data-form-status]"));
  check(status === "Confira os campos destacados antes de enviar.", "PT validation message", status);
});

await withLocale("en-US", async (page) => {
  check(
    (await page.locator("#hero-title").getAttribute("aria-label")) === "Build what shouldn't exist yet.",
    "EN hero aria-label",
  );
  const enBudget = await page.locator("#project-budget").getAttribute("placeholder");
  check(enBudget === "Example: R$ 6,000 – R$ 12,000", "EN budget placeholder", String(enBudget));
  check(
    (await page.locator('[data-nav]').getAttribute("aria-label")) === "Primary navigation",
    "EN navigation aria-label",
  );

  await page.locator(".project-form__submit").click();
  const status = normalise(await textOf(page, "[data-form-status]"));
  check(status === "Check the highlighted fields before sending.", "EN validation message", status);
});

/* -------------------------------------------------------- state preservation */

// Switching language must not behave like a reload: typed values, the chosen
// project type, the open dialog and the scroll position all stay put.
await withLocale("pt-BR", async (page) => {
  await page.fill("#project-name", "Luciano Pimenta");
  await page.fill("#project-email", "luciano@example.com");
  await page.fill("#project-message", "Preciso de um sistema interno.");
  await page.click('[data-product-option][data-value="web-system"]');
  await page.locator("#contact").scrollIntoViewIfNeeded();

  const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));
  const budgetBefore = await page.inputValue("#project-budget");

  await page.click('[data-locale-switch="en"]');
  await page.waitForFunction(() => document.documentElement.lang === "en");

  check((await page.inputValue("#project-name")) === "Luciano Pimenta", "locale switch keeps typed name");
  check((await page.inputValue("#project-email")) === "luciano@example.com", "locale switch keeps typed email");
  check(
    (await page.inputValue("#project-message")) === "Preciso de um sistema interno.",
    "locale switch keeps typed message",
  );
  check(
    (await page.locator('[data-product-option][data-value="web-system"]').getAttribute("aria-pressed")) === "true",
    "locale switch keeps the selected project type",
  );
  check((await page.inputValue("#project-budget")) === budgetBefore, "locale switch keeps the budget field");

  const scrollAfter = await page.evaluate(() => Math.round(window.scrollY));
  const contactStillInView = await page.evaluate(() => {
    const box = document.querySelector("#contact")?.getBoundingClientRect();
    return Boolean(box) && box.top < window.innerHeight && box.bottom > 0;
  });
  check(contactStillInView, "locale switch keeps the reader on the same section", `${scrollBefore} -> ${scrollAfter}`);

  // Labels did change, which is the whole point of the switch.
  const label = normalise(await textOf(page, 'label[for="project-name"]'));
  check(label === "Name", "locale switch still relabels the form", label);
});

// The plan dialog stays open, and its copy follows the locale.
await withLocale("pt-BR", async (page) => {
  await page.click('[data-project="plan-pro"]');
  await page.waitForFunction(() => document.querySelector("[data-project-dialog]")?.open === true);

  // The open dialog covers the header, so the switcher is driven directly.
  await page.evaluate(() => document.querySelector('[data-locale-switch="en"]')?.click());
  await page.waitForFunction(() => document.documentElement.lang === "en");

  const open = await page.evaluate(() => document.querySelector("[data-project-dialog]")?.open === true);
  check(open, "locale switch keeps the plan dialog open");

  // The plan's own name is not copy and must not be translated.
  const title = normalise(await textOf(page, "[data-dialog-title]"));
  check(title === "Pro", "plan name stays untranslated in the dialog", title);
});

/* ------------------------------------------------------------- SEO in runtime */

await withLocale("pt-BR", async (page) => {
  const canonicalBefore = await page.locator('link[rel="canonical"]').getAttribute("href").catch(() => null);
  const titleBefore = await page.title();

  await page.click('[data-locale-switch="en"]');
  await page.waitForFunction(() => document.documentElement.lang === "en");

  const titleAfter = await page.title();
  const canonicalAfter = await page.locator('link[rel="canonical"]').getAttribute("href").catch(() => null);
  const description = await page.locator('meta[name="description"]').getAttribute("content");

  check(titleAfter !== titleBefore, "locale switch updates document.title", `${titleBefore} -> ${titleAfter}`);
  check(/Independent Digital Studio/i.test(titleAfter), "EN title comes from the dictionary", titleAfter);
  check(!/estúdio/i.test(String(description)), "EN meta description is English", String(description));
  check(canonicalAfter === canonicalBefore, "locale switch leaves canonical untouched", String(canonicalAfter));
});

/* ------------------------------------------- project viewer mode and iframe */

// The viewer's display mode is part of the state a locale change must not
// touch: re-applying the same project used to force it back to overview, which
// also tore down a preview iframe that was already loaded.
//
// Supabase is not reachable from here, so the projects read is served from a
// fixture. That is deliberate -- it exercises the real
// cache -> renderFromRows -> showProject path, which is exactly the code being
// tested, without going anywhere near a real backend.
const PROJECT_FIXTURE = [
  {
    case_number: 1,
    name: "INK Tattoo",
    slug: "ink-tattoo",
    client: "INK TATTOO",
    category: "Website",
    description: "Uma experiência editorial escura.",
    status: "Live",
    year: 2026,
    accent: "#c6ff00",
    tech_stack: ["HTML", "CSS"],
    presentation_system: "SISTEMA DE EXPERIÊNCIA / 01",
    presentation_label: "PORTFÓLIO",
    presentation_address: "INK TATTOO / PRODUÇÃO",
    presentation_type: "SITE DE PORTFÓLIO",
    origin: "RJ / BR",
    coordinates: ["22S", "43W"],
    poster_url: "",
    project_url: "/",
    preview_url: "/?embed=fixture-one",
    translations: {
      en: { description: "A dark editorial experience.", presentation_type: "PORTFOLIO WEBSITE" },
    },
    project_gallery: [],
    project_modules: [
      {
        code: "01",
        title: "DIREÇÃO DE ARTE",
        description: "PROFUNDIDADE MONOCROMÁTICA",
        position: 0,
        translations: { en: { title: "ART DIRECTION", description: "MONOCHROME DEPTH" } },
      },
      { code: "02", title: "INTERAÇÃO", description: "MOVIMENTO FLUIDO", position: 1, translations: {} },
    ],
  },
  {
    case_number: 2,
    name: "Lucas Souza",
    slug: "lucas-souza",
    client: "LUCAS SOUZA",
    category: "Website",
    description: "Presença digital estratégica.",
    status: "Live",
    year: 2026,
    accent: "#ff9d00",
    tech_stack: ["HTML"],
    presentation_system: "SISTEMA DE PERFORMANCE / 02",
    presentation_label: "PERFORMANCE",
    presentation_address: "LUCAS SOUZA / PRODUÇÃO",
    presentation_type: "SITE DE NUTRIÇÃO ESPORTIVA",
    origin: "RJ / BR",
    coordinates: ["22S", "43W"],
    poster_url: "",
    project_url: "/",
    preview_url: "/?embed=fixture-two",
    translations: { en: { description: "A strategic digital presence." } },
    project_gallery: [],
    project_modules: [],
  },
];

async function withProjectFixture(locale, run) {
  const context = await browser.newContext({ locale, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  // Only the projects read is stubbed; everything else behaves as it would.
  await context.route("**/rest/v1/projects*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROJECT_FIXTURE) }),
  );

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hero-title");
    await page.waitForFunction(
      () => document.querySelector("#work")?.getAttribute("data-projects-source") === "supabase",
      null,
      { timeout: 15000 },
    );
    await run(page);
    check(errors.length === 0, `${locale}: no page errors (viewer fixture)`, errors.join(" | "));
  } finally {
    await context.close();
  }
}

const viewerMode = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector("[data-project-viewer]");
    if (!frame) return "none";
    if (frame.classList.contains("is-view-site")) return "site";
    if (frame.classList.contains("is-view-detail")) return "detail";
    if (frame.classList.contains("is-view-origin")) return "origin";
    return "overview";
  });

const iframeState = (page) =>
  page.evaluate(() => {
    const iframe = document.querySelector("[data-project-viewer] iframe");
    return { src: iframe?.getAttribute("src") ?? null, dataSrc: iframe?.dataset.src ?? null };
  });

const activeSlot = (page) =>
  page.evaluate(() => document.querySelector("[data-project-slot].is-active")?.dataset.projectSlot ?? null);

await withProjectFixture("pt-BR", async (page) => {
  // Confirm the fixture really did drive the viewer, so the checks below are
  // exercising the data path rather than an empty shell.
  // Each project has two slot elements: the rail button and the case-index row.
  const slotKeys = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll("[data-project-slot]:not([data-slot-reserved])")].map(
        (slot) => slot.dataset.projectSlot,
      ),
    ),
  ]);
  check(slotKeys.length === 2, "viewer rendered the fixture projects", slotKeys.join(", "));
  check((await activeSlot(page)) === "case-001", "viewer opens the first project", String(await activeSlot(page)));

  await page.locator("#work").scrollIntoViewIfNeeded();
  await page.click('[data-project-viewer] [data-signal-mode="site"]');
  await page.waitForFunction(() =>
    document.querySelector("[data-project-viewer]")?.classList.contains("is-view-site"),
  );
  await page.waitForTimeout(600);

  const projectBefore = await activeSlot(page);
  const frameBefore = await iframeState(page);
  check((await viewerMode(page)) === "site", "viewer is in site mode before the switch");
  check(Boolean(frameBefore.dataSrc), "iframe has a target before the switch", String(frameBefore.dataSrc));

  // The preview status used to be a hardcoded Portuguese lookup, and the static
  // data-i18n on the element reset it to standby on every locale change.
  const statusText = (target) => target.evaluate(() => document.querySelector("[data-preview-status]")?.textContent.trim());
  const previewState = () => page.evaluate(() => document.querySelector("[data-project-viewer]")?.dataset.previewState);

  const stateBefore = await previewState();
  const ptStatus = await statusText(page);
  check(Boolean(stateBefore), "viewer records its preview state", String(stateBefore));
  check(/^(●\s)?PRÉVIA/.test(String(ptStatus)), "PT preview status", String(ptStatus));

  await page.click('[data-locale-switch="en"]');
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.waitForTimeout(300);

  check(
    (await activeSlot(page)) === projectBefore,
    "locale switch keeps the active project",
    String(await activeSlot(page)),
  );
  check((await viewerMode(page)) === "site", "locale switch keeps site mode", await viewerMode(page));

  const frameAfter = await iframeState(page);
  check(frameAfter.src === frameBefore.src, "locale switch keeps the iframe src", `${frameBefore.src} -> ${frameAfter.src}`);
  check(
    frameAfter.dataSrc === frameBefore.dataSrc,
    "locale switch keeps the iframe target",
    `${frameBefore.dataSrc} -> ${frameAfter.dataSrc}`,
  );

  // The status is relabelled from the state it is actually in, not reset.
  const enStatus = await statusText(page);
  check(/^(●\s)?(PREVIEW|LIVE)/.test(String(enStatus)), "EN preview status", String(enStatus));
  check(
    (await previewState()) === stateBefore,
    "locale switch keeps the preview state itself",
    `${stateBefore} -> ${await previewState()}`,
  );
  check(enStatus !== ptStatus, "preview status actually changed language", `${ptStatus} -> ${enStatus}`);

  // The copy around the viewer did follow the locale.
  const description = await page.locator("[data-viewer-description]").evaluate((node) => node.textContent.trim());
  check(description === "A dark editorial experience.", "viewer copy switched to English", description);
  const name = await page.locator("[data-viewer-name]").evaluate((node) => node.textContent.trim());
  check(name === "INK Tattoo", "project name stays untranslated", name);

  await page.click('[data-locale-switch="pt-BR"]');
  await page.waitForFunction(() => document.documentElement.lang === "pt-BR");
  await page.waitForTimeout(300);
  check((await viewerMode(page)) === "site", "switching back keeps site mode", await viewerMode(page));
  check((await iframeState(page)).src === frameBefore.src, "switching back keeps the iframe src");
});

await withProjectFixture("pt-BR", async (page) => {
  await page.locator("#work").scrollIntoViewIfNeeded();
  await page.click('[data-project-viewer] [data-signal-mode="detail"]');
  await page.waitForFunction(() =>
    document.querySelector("[data-project-viewer]")?.classList.contains("is-view-detail"),
  );

  await page.click('[data-locale-switch="en"]');
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.waitForTimeout(300);
  check((await viewerMode(page)) === "detail", "locale switch keeps detail mode", await viewerMode(page));
});

// Choosing a different project still resets to overview: that is the viewer's
// normal behaviour and must not change.
await withProjectFixture("pt-BR", async (page) => {
  await page.locator("#work").scrollIntoViewIfNeeded();
  await page.click('[data-project-viewer] [data-signal-mode="detail"]');
  await page.waitForFunction(() =>
    document.querySelector("[data-project-viewer]")?.classList.contains("is-view-detail"),
  );

  await page.click('[data-project-slot="case-002"]');
  await page.waitForTimeout(400);
  check((await activeSlot(page)) === "case-002", "second project opened", String(await activeSlot(page)));
  check(
    (await viewerMode(page)) === "overview",
    "choosing another project still resets to overview",
    await viewerMode(page),
  );
});

// A module with no English translation falls back to its pt-BR text, per field.
await withProjectFixture("en-US", async (page) => {
  await page.locator("#work").scrollIntoViewIfNeeded();
  const modules = await page.evaluate(() =>
    [...document.querySelectorAll("[data-viewer-module]")]
      .filter((button) => !button.hidden)
      .map((button) => button.querySelector("strong")?.textContent.trim()),
  );

  check(modules[0] === "ART DIRECTION", "translated module reads English", String(modules[0]));
  check(modules[1] === "INTERAÇÃO", "untranslated module falls back to pt-BR", String(modules[1]));
});

/* ------------------------------------------------------------- responsive */

// The page already overflows slightly at narrow widths because of decorative
// art (.hero-art, .orbital, .monolith), which predates this work and is not
// copy-driven. What matters for i18n is that English -- which is longer in
// several headings -- does not make the layout any worse than Portuguese, and
// that the locale control stays reachable at every width.
const WIDTHS = [1920, 1440, 1280, 1024, 768, 430, 390, 320];

async function measure(locale, width) {
  const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hero-title");
    // Web fonts change metrics, and the decorative art animates in, so the
    // measurement is taken once both have settled.
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(250);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const switcherReachable =
      (await page.locator('[data-locale-switch="en"]').isVisible()) ||
      (await page.locator("[data-menu-toggle]").isVisible());
    // Copy-bearing containers must stay inside the viewport in both languages.
    const copyOverflow = await page.evaluate((w) => {
      const selectors = [".container", ".section-heading", ".site-nav", ".project-form__grid", ".footer__top"];
      return selectors.flatMap((selector) =>
        [...document.querySelectorAll(selector)]
          .filter((el) => el.getBoundingClientRect().right > w + 1)
          .map(() => selector),
      );
    }, width);
    return { scrollWidth, switcherReachable, copyOverflow };
  } finally {
    await context.close();
  }
}

for (const width of WIDTHS) {
  const pt = await measure("pt-BR", width);
  const en = await measure("en-US", width);

  check(pt.switcherReachable, `pt-BR @ ${width}px keeps the locale control reachable`);
  check(en.switcherReachable, `en @ ${width}px keeps the locale control reachable`);
  // A few pixels of drift come from the animated decorative art, which both
  // locales already exhibit. What would be an i18n regression is English
  // pushing the layout meaningfully wider than Portuguese.
  check(
    en.scrollWidth <= pt.scrollWidth + 16,
    `en @ ${width}px is no wider than pt-BR`,
    `en=${en.scrollWidth} pt=${pt.scrollWidth}`,
  );
  check(pt.copyOverflow.length === 0, `pt-BR @ ${width}px keeps copy inside the viewport`, pt.copyOverflow.join(", "));
  check(en.copyOverflow.length === 0, `en @ ${width}px keeps copy inside the viewport`, en.copyOverflow.join(", "));
}

await browser.close();

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("\nFailures:");
  failed.forEach((entry) => console.log(`  ${entry.label}${entry.extra ? ` — ${entry.extra}` : ""}`));
  process.exit(1);
}

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const INK_PREVIEW = "https://pedruzz30.github.io/TattooSite/?embed=spaceunderground";
const LUCAS_PREVIEW = "https://pedruzz30.github.io/LucasNutri/?embed=spaceunderground";

const checks = [];

function check(ok, label, extra = "") {
  checks.push({ ok, label, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` - ${extra}` : ""}`);
}

const fixture = [
  {
    case_number: 1,
    name: "INK Tattoo",
    slug: "ink-tattoo",
    client: "INK Tattoo",
    category: "Website",
    description: "Site editorial para tatuagem.",
    status: "Live",
    year: 2026,
    accent: "#c6ff00",
    tech_stack: ["HTML", "CSS", "JavaScript"],
    presentation_system: "SISTEMA DE EXPERIÊNCIA / 01",
    presentation_label: "PORTFÓLIO",
    presentation_address: "INK TATTOO / PRODUÇÃO",
    presentation_type: "SITE DE PORTFÓLIO",
    origin: "RJ / BR",
    coordinates: ["22°54'S", "43°12'W"],
    poster_url: "",
    project_url: "https://pedruzz30.github.io/TattooSite/",
    preview_url: INK_PREVIEW,
    live_preview_enabled: true,
    translations: { en: { description: "Editorial tattoo website.", presentation_type: "PORTFOLIO WEBSITE" } },
    project_gallery: [],
    project_modules: [
      { code: "01", title: "DIREÇÃO", description: "PROFUNDIDADE", position: 0, translations: { en: { title: "DIRECTION", description: "DEPTH" } } },
      { code: "02", title: "INTERAÇÃO", description: "MOVIMENTO", position: 1, translations: { en: { title: "INTERACTION", description: "MOTION" } } },
    ],
  },
  {
    case_number: 2,
    name: "Lucas Souza",
    slug: "lucas-souza",
    client: "Lucas Souza",
    category: "Website",
    description: "Presença digital para nutrição esportiva.",
    status: "Live",
    year: 2026,
    accent: "#ff9d00",
    tech_stack: ["HTML", "CSS", "JavaScript"],
    presentation_system: "SISTEMA DE PERFORMANCE / 02",
    presentation_label: "PERFORMANCE",
    presentation_address: "LUCAS SOUZA / PRODUÇÃO",
    presentation_type: "SITE DE NUTRIÇÃO ESPORTIVA",
    origin: "RJ / BR",
    coordinates: ["22°54'S", "43°12'W"],
    poster_url: "",
    project_url: "https://pedruzz30.github.io/LucasNutri/",
    preview_url: LUCAS_PREVIEW,
    live_preview_enabled: true,
    translations: { en: { description: "Sports nutrition digital presence.", presentation_type: "SPORTS NUTRITION WEBSITE" } },
    project_gallery: [],
    project_modules: [],
  },
  {
    case_number: 3,
    name: "JARVIS AI",
    slug: "jarvis-ai",
    client: "Space Underground",
    category: "AI",
    description: "Protótipo de assistente inteligente.",
    status: "Prototype",
    year: 2026,
    accent: "#66d9ef",
    tech_stack: ["Python", "AI"],
    presentation_system: "SISTEMA DE IA / 03",
    presentation_label: "LAB",
    presentation_address: "JARVIS AI / PROTÓTIPO",
    presentation_type: "ASSISTENTE INTELIGENTE",
    origin: "RJ / BR",
    coordinates: ["22°54'S", "43°12'W"],
    poster_url: "",
    project_url: "https://example.com/jarvis",
    preview_url: null,
    live_preview_enabled: false,
    translations: { en: { description: "Intelligent assistant prototype.", presentation_type: "INTELLIGENT ASSISTANT" } },
    project_gallery: [],
    project_modules: [],
  },
  {
    case_number: 4,
    name: "Projeto Sem Capa",
    slug: "projeto-sem-capa",
    client: "Estúdio Novo",
    category: "Website",
    description: "Projeto ainda sem imagem de capa.",
    status: "Live",
    year: 2026,
    accent: "#ff7a45",
    tech_stack: ["HTML"],
    presentation_system: "SISTEMA DE EXPERIÊNCIA / 04",
    presentation_label: "SITE",
    presentation_address: "ESTÚDIO NOVO / PRODUÇÃO",
    presentation_type: "SITE INSTITUCIONAL",
    origin: "RJ / BR",
    coordinates: ["22°54'S", "43°12'W"],
    poster_url: "",
    project_url: "https://example.com/novo",
    preview_url: null,
    live_preview_enabled: false,
    translations: { en: { description: "Project with no cover image yet.", presentation_type: "COMPANY WEBSITE" } },
    project_gallery: [],
    project_modules: [],
  },
];

async function openFixturePage({ width = 1440, height = 1000, locale = "pt-BR" } = {}) {
  const context = await browser.newContext({ locale, viewport: { width, height } });
  const page = await context.newPage();
  const iframeRequests = [];
  const errors = [];

  await context.route("**/rest/v1/projects*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }),
  );
  await context.route("**/rest/v1/plans*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await context.route("**/rest/v1/site_content*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await context.route("**/rest/v1/site_settings*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await context.route("https://pedruzz30.github.io/**", (route) => {
    iframeRequests.push(route.request().url());
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>fixture</title>" });
  });

  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.text().includes("ERR_NETWORK_ACCESS_DENIED")) return;
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#work")?.getAttribute("data-projects-source") === "supabase");
  return { context, page, iframeRequests, errors };
}

const browser = await chromium.launch();

try {
  {
    const { context, page, iframeRequests, errors } = await openFixturePage();
    await page.locator("#services").scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 900);
    await page.waitForFunction((url) => document.querySelector("[data-project-viewer] iframe")?.getAttribute("src") === url, INK_PREVIEW);
    check((await page.getAttribute("[data-project-viewer] iframe", "src")) === INK_PREVIEW, "INK preloads before SITE click");
    check(iframeRequests.includes(INK_PREVIEW), "INK iframe request is issued by preload");
    check(errors.length === 0, "INK preload has no page errors", errors.join(" | "));
    await context.close();
  }

  {
    const { context, page, iframeRequests } = await openFixturePage();
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.click('[data-project-slot="case-002"]');
    await page.waitForFunction((url) => document.querySelector("[data-project-viewer] iframe")?.getAttribute("src") === url, LUCAS_PREVIEW);
    check((await page.textContent("[data-viewer-name]"))?.trim() === "Lucas Souza", "Lucas metadata remains present");
    check((await page.getAttribute("[data-project-viewer] iframe", "src")) === LUCAS_PREVIEW, "Lucas preloads without a second SITE click");
    await context.close();
  }

  {
    const { context, page } = await openFixturePage();
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.waitForFunction((url) => document.querySelector("[data-project-viewer] iframe")?.getAttribute("src") === url, INK_PREVIEW);
    const srcBefore = await page.getAttribute("[data-project-viewer] iframe", "src");
    await page.click('[data-project-viewer] [data-signal-mode="site"]');
    await page.waitForFunction(() => document.querySelector("[data-project-viewer]")?.classList.contains("is-view-site"));
    await page.waitForTimeout(250);
    const srcAfter = await page.getAttribute("[data-project-viewer] iframe", "src");
    check(srcAfter === srcBefore, "SITE uses the already loaded iframe", `${srcBefore} -> ${srcAfter}`);
    await context.close();
  }

  {
    const { context, page, iframeRequests } = await openFixturePage();
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.click('[data-project-slot="case-003"]');
    await page.waitForFunction(() => document.querySelector("[data-viewer-name]")?.textContent.trim() === "JARVIS AI");
    await page.waitForTimeout(500);
    const iframeSrc = await page.getAttribute("[data-project-viewer] iframe", "src");
    const siteDisabled = await page.locator('[data-project-viewer] [data-signal-mode="site"]').first().isDisabled();
    const state = await page.getAttribute("[data-project-viewer]", "data-preview-state");
    const title = await page.locator('[data-project-viewer] [data-signal-mode="site"]').first().getAttribute("title");
    check(iframeSrc === "about:blank", "case without preview_url does not load an iframe", String(iframeSrc));
    check(!iframeRequests.some((url) => url.includes("jarvis") || url.includes("example.com")), "case without preview_url does not request project_url");
    check(siteDisabled, "SITE is disabled for case without live preview");
    check(state === "unavailable", "case without preview_url uses unavailable state", String(state));
    check(title === "Demonstração ao vivo indisponível", "unavailable tooltip is localized in PT", String(title));
    check((await page.textContent("[data-viewer-description]"))?.trim() === "Protótipo de assistente inteligente.", "metadata still renders for case without preview");
    await context.close();
  }

  {
    const { context, page, iframeRequests } = await openFixturePage({ width: 390, height: 900 });
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const iframeSrc = await page.getAttribute("[data-project-viewer] iframe", "src");
    check(iframeSrc !== INK_PREVIEW, "mobile does not autoload the iframe", String(iframeSrc));
    check(!iframeRequests.includes(INK_PREVIEW), "mobile issues no automatic preview request");
    await context.close();
  }

  {
    const { context, page } = await openFixturePage();
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.waitForFunction((url) => document.querySelector("[data-project-viewer] iframe")?.getAttribute("src") === url, INK_PREVIEW);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
    check((await page.getAttribute("[data-project-viewer] iframe", "src")) === INK_PREVIEW, "iframe remains loaded before the 10s sleep delay");
    await context.close();
  }

  {
    const { context, page } = await openFixturePage();
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.waitForFunction((url) => document.querySelector("[data-project-viewer] iframe")?.getAttribute("src") === url, INK_PREVIEW);
    await page.click('[data-project-viewer] [data-signal-mode="site"]');
    await page.waitForFunction(() => document.querySelector("[data-project-viewer]")?.classList.contains("is-view-site"));
    const srcBefore = await page.getAttribute("[data-project-viewer] iframe", "src");
    await page.click('[data-locale-switch="en"]');
    await page.waitForFunction(() => document.documentElement.lang === "en");
    await page.waitForTimeout(250);
    check((await page.textContent("[data-viewer-name]"))?.trim() === "INK Tattoo", "i18n keeps the same project");
    check(await page.evaluate(() => document.querySelector("[data-project-viewer]")?.classList.contains("is-view-site")), "i18n keeps SITE mode");
    check((await page.getAttribute("[data-project-viewer] iframe", "src")) === srcBefore, "i18n keeps the iframe src", String(srcBefore));
    await context.close();
  }
  // Quality: the embed is laid out at one desktop size, the frame settles flat
  // on screen, and every project shows an image or its placeholder.
  for (const width of [1024, 1440]) {
    const { context, page } = await openFixturePage({ width, height: 900 });
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.locator("[data-project-viewer]").scrollIntoViewIfNeeded();
    await page.waitForFunction((url) => document.querySelector("[data-project-viewer] iframe")?.getAttribute("src") === url, INK_PREVIEW);
    await page.waitForTimeout(1100);
    const geometry = await page.evaluate(() => {
      const frame = document.querySelector("[data-project-viewer]");
      const viewport = frame.querySelector(".signal-ui__website-viewport");
      const iframe = frame.querySelector("iframe");
      const surface = frame.querySelector(".signal-ui__website-surface");
      return {
        width: iframe.offsetWidth,
        height: iframe.offsetHeight,
        scale: Number(getComputedStyle(surface).getPropertyValue("--website-scale")),
        viewportWidth: viewport.clientWidth,
        settled: frame.classList.contains("is-settled"),
        transform: getComputedStyle(frame).transform,
      };
    });
    check(geometry.width === 1464 && geometry.height === 900, `${width}px: the embed is laid out at 1440x900 plus a clipped scrollbar`, `${geometry.width}x${geometry.height}`);
    check(Math.abs(geometry.scale - geometry.viewportWidth / 1440) < 0.002, `${width}px: the scale fits the desktop layout to the frame`, String(geometry.scale));
    check(geometry.settled && geometry.transform === "none", `${width}px: the frame lies flat once on screen`, geometry.transform);

    await page.click('[data-project-viewer] [data-signal-mode="detail"]');
    await page.waitForTimeout(700);
    const detail = await page.evaluate(() => {
      const frame = document.querySelector("[data-project-viewer]");
      return {
        width: frame.querySelector("iframe").offsetWidth,
        scale: Number(getComputedStyle(frame.querySelector(".signal-ui__website-surface")).getPropertyValue("--website-scale")),
      };
    });
    check(detail.width === 1464, `${width}px: a mode change never re-lays out the embed`, String(detail.width));
    check(detail.scale > geometry.scale, `${width}px: detail mode zooms in by scale alone`, `${geometry.scale} -> ${detail.scale}`);
    await context.close();
  }

  {
    const { context, page } = await openFixturePage();
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector(".signal-ui__poster")?.getAttribute("src")?.includes("tattoo-preview-poster"));
    check(true, "a project with no uploaded poster shows the artwork shipped with the site");
    await page.click('[data-project-slot="case-003"]');
    await page.waitForFunction(() => document.querySelector(".signal-ui__poster")?.getAttribute("src") === "./jarvis-preview-poster-pt.svg");
    check(true, "JARVIS AI gets its own shipped poster");
    await page.click('[data-project-slot="case-004"]');
    await page.waitForFunction(() => document.querySelector("[data-project-viewer]")?.classList.contains("is-poster-missing"));
    const placeholder = await page.evaluate(() => {
      const node = document.querySelector(".signal-ui__placeholder");
      return {
        visible: getComputedStyle(node).display !== "none",
        name: node.querySelector("[data-placeholder-name]").textContent.trim(),
        caseLabel: node.querySelector("[data-placeholder-case]").textContent.trim(),
        poster: document.querySelector(".signal-ui__poster").getAttribute("src"),
      };
    });
    check(placeholder.visible && placeholder.name === "Projeto Sem Capa" && placeholder.caseLabel === "CASE / 004", "a project with no image at all shows its placeholder, not a black frame", JSON.stringify(placeholder));
    check(placeholder.poster === null, "the previous project's poster does not linger", String(placeholder.poster));
    await page.click('[data-project-slot="case-001"]');
    await page.waitForFunction(() => !document.querySelector("[data-project-viewer]")?.classList.contains("is-poster-missing"));
    check(true, "switching back to a project with a poster hides the placeholder");
    await context.close();
  }

  {
    const { context, page } = await openFixturePage({ width: 390, height: 900 });
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const phone = await page.evaluate(() => {
      const frame = document.querySelector("[data-project-viewer]");
      return { state: frame.dataset.previewState, status: frame.querySelector("[data-preview-status]").textContent.trim() };
    });
    check(phone.state === "still" && phone.status === "PRÉVIA / IMAGEM", "on a phone the status says it is a still image, not standby", JSON.stringify(phone));
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((entry) => console.log(` - ${entry.label}${entry.extra ? `: ${entry.extra}` : ""}`));
  process.exit(1);
}

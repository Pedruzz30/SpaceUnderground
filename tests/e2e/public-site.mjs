// End-to-end validation of the public site against the REAL Supabase project.
//
//   npm run dev                                   # terminal 1
//   BASE_URL=http://127.0.0.1:5173 npm run test:e2e:public
//
// Needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY plus ADMIN_EMAIL and
// ADMIN_PASSWORD (admin/.env and admin/.env.local).
//
// The test temporarily changes the editorial state of real projects to prove
// that drafts, archived and hidden entries never reach the public site. Every
// change is reverted in the finally block, including uploaded files.

import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const RUN_SUPABASE_PUBLIC_E2E = process.env.RUN_SUPABASE_PUBLIC_E2E === "true";

const checks = [];
function check(ok, label, extra = "") {
  checks.push({ ok, label, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
}

if (!RUN_SUPABASE_PUBLIC_E2E || !SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  const browser = await chromium.launch();
  // Explicit pt-BR context: these checks assert the Portuguese default, so they
  // must not inherit whatever language Playwright's default context uses.
  const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    check((await page.locator("html").getAttribute("lang")) === "pt-BR", "public starts in pt-BR");
    check((await page.locator("#hero-title").getAttribute("aria-label")) === "Crie o que ainda não deveria existir.", "hero starts in Portuguese");
    check((await page.locator('[data-nav] [href="#contact"]').innerText()) === "Contato", "navigation starts in Portuguese");

    await page.click('[data-locale-switch="en"]');
    const formLabelSwitched = await page.waitForFunction(() => document.querySelector('label[for="project-name"]')?.textContent.trim() === "Name");
    check((await page.locator("html").getAttribute("lang")) === "en", "switching to EN updates html lang");
    check((await page.locator("#hero-title").getAttribute("aria-label")) === "Build what shouldn't exist yet.", "hero switches to English");
    check((await page.locator('[data-nav] [href="#contact"]').innerText()) === "Contact", "navigation switches to English");
    check(Boolean(await formLabelSwitched.jsonValue()), "form labels switch to English");

    await page.reload({ waitUntil: "domcontentloaded" });
    check((await page.locator("html").getAttribute("lang")) === "en", "reload preserves EN preference");
    await page.click('[data-locale-switch="pt-BR"]');

    const visiblePlans = () => page.$$eval("#plans .plans__grid .project__visual[data-project]", (nodes) => nodes.map((node) => node.dataset.project));
    const planRows = {
      plus: {
        slug: "plan-plus",
        name: "Plus",
        range: "R$ 800",
        scope: "Landing",
        scope_short: "Landing",
        status: "DISPONÍVEL",
        description: "Plus PT",
        timeline: "1 semana",
        position: 0,
        plan_features: [{ text: "Design", position: 0 }],
      },
      pro: {
        slug: "plan-pro",
        name: "Pro",
        range: "R$ 2.500",
        scope: "Site",
        scope_short: "Site",
        status: "AVAILABLE",
        description: "Pro PT",
        timeline: "3 semanas",
        position: 1,
        plan_features: [{ text: "SEO", position: 0 }],
      },
      beta: {
        slug: "beta",
        name: "Beta",
        range: "R$ 9.000",
        scope: "Sistema",
        scope_short: "Sistema",
        status: "ON_REQUEST",
        description: "Beta PT",
        timeline: "8 semanas",
        position: 2,
        translations: { en: { scope: "System", scope_short: "System", description: "Beta EN", timeline: "8 weeks" } },
        plan_features: [{ text: "Portal", position: 0, translations: { en: { text: "Portal" } } }],
      },
    };
    const loadWithPlans = async (rows) => {
      await page.unroute("**/rest/v1/plans*").catch(() => {});
      await page.route("**/rest/v1/plans*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) }));
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        (count) => document.querySelectorAll("#plans .plans__grid .project__visual[data-project]").length === count,
        rows.length,
      );
    };

    await loadWithPlans([planRows.plus, planRows.pro]);
    check(JSON.stringify(await visiblePlans()) === JSON.stringify(["plan-plus", "plan-pro"]), "plans success removes missing static plans");

    await loadWithPlans([planRows.plus, planRows.pro, planRows.beta]);
    check((await visiblePlans()).includes("beta"), "plans success creates cards for new Supabase slugs");
    await page.click('[data-project="beta"]');
    await page.waitForFunction(() => document.querySelector("[data-project-dialog]")?.open === true);
    check((await page.locator("[data-dialog-title]").innerText()) === "Beta", "dynamic plan opens the public dialog");
    const dialogScope = await page.locator("[data-dialog-scope]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
    check(dialogScope.some((line) => line.includes("SOB CONSULTA")), "dialog status comes from structural status");
    await page.keyboard.press("Escape");

    await loadWithPlans([]);
    check((await visiblePlans()).length === 0, "successful empty plans response renders zero cards");

    await page.unroute("**/rest/v1/plans*").catch(() => {});
    await page.route("**/rest/v1/plans*", (route) => route.abort());
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("#plans .plans__grid .project__visual[data-project]").length === 3);
    check(JSON.stringify(await visiblePlans()) === JSON.stringify(["plan-plus", "plan-pro", "plan-max"]), "plans fetch failure keeps bundled fallback");
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
  process.exit(0);
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// --- Supabase helpers (admin session, plain fetch, never service role) -------
// This branch only runs with RUN_SUPABASE_PUBLIC_E2E=true because it mutates
// real Supabase rows and storage objects before restoring them.
let token = "";

async function signIn() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  token = body.access_token;
}

const authHeaders = (extra = {}) => ({ apikey: ANON_KEY, Authorization: `Bearer ${token}`, ...extra });

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: authHeaders({ "Content-Type": "application/json", ...(options.headers ?? {}) }),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${text}`);
  return body;
}

const patchProject = (caseNumber, patch) =>
  rest(`projects?case_number=eq.${caseNumber}`, { method: "PATCH", body: JSON.stringify(patch) });

async function uploadObject(path) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/project-media/${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "image/png" }),
    body: PNG,
  });
  if (!response.ok) throw new Error(`upload failed: ${response.status} ${await response.text()}`);
}

const removeObjects = (paths) =>
  fetch(`${SUPABASE_URL}/storage/v1/object/project-media`, {
    method: "DELETE",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: paths }),
  });

// --- Page helpers ------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const signRequests = [];
page.on("request", (request) => {
  // The signed image URL also contains /object/sign/, so match the POST only.
  if (request.method() === "POST" && request.url().includes("/storage/v1/object/sign/")) {
    try {
      signRequests.push(JSON.parse(request.postData() ?? "{}"));
    } catch {
      /* ignore */
    }
  }
});

const source = () => page.getAttribute("#work", "data-projects-source");

async function loadSite({ offline = false } = {}) {
  signRequests.length = 0;
  if (offline) await page.route("**/*supabase.co/**", (route) => route.abort());
  else await page.unroute("**/*supabase.co/**").catch(() => {});

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#work")?.hasAttribute("data-projects-source"), null, {
    timeout: 20000,
  });
}

// Names shown in the case index, excluding the slots marked reserved.
const liveCaseNames = () =>
  page.$$eval(".case-index__row:not(.is-reserved) .case-index__name", (nodes) =>
    nodes.map((node) => node.textContent.trim()).filter(Boolean),
  );

const isReserved = (caseName) =>
  page.$$eval(
    ".case-index__row.is-reserved .case-index__name",
    (nodes, name) => nodes.some((node) => node.textContent.trim() === name),
    caseName,
  );

const restore = [];

try {
  await signIn();

  // --- Baseline: the database drives the section --------------------------
  await loadSite();
  check((await source()) === "supabase", "Selected Work is driven by Supabase", await source());

  const baseline = await liveCaseNames();
  check(baseline.length > 0, "published projects render", baseline.join(", "));

  const published = await rest("projects?select=case_number,name,id&editorial_status=eq.PUBLISHED&visible=is.true&order=case_number.asc");
  check(published.length === baseline.length, "the page shows exactly the published set", `${published.length} in db, ${baseline.length} on page`);

  // --- A real poster and gallery from project-media ------------------------
  const target = published[0];
  const posterPath = `projects/${target.id}/poster/e2e-${Date.now()}.png`;
  const galleryPath = `projects/${target.id}/gallery/e2e-${Date.now()}.png`;
  await uploadObject(posterPath);
  await uploadObject(galleryPath);
  restore.push(() => removeObjects([posterPath, galleryPath]));

  const previousPoster = await rest(`projects?select=poster_url&case_number=eq.${target.case_number}`);
  await patchProject(target.case_number, { poster_url: posterPath });
  restore.push(() => patchProject(target.case_number, { poster_url: previousPoster[0]?.poster_url ?? null }));

  const galleryRow = await rest("project_gallery", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_id: target.id, url: galleryPath, position: 0 }),
  });
  restore.push(() => rest(`project_gallery?id=eq.${galleryRow[0].id}`, { method: "DELETE" }));

  await loadSite();
  await page.waitForFunction(
    () => document.querySelector(".signal-ui__poster")?.getAttribute("src")?.includes("/storage/v1/object/sign/"),
    null,
    { timeout: 20000 },
  );

  const posterUrl = await page.getAttribute(".signal-ui__poster", "src");
  check(posterUrl.includes("/storage/v1/object/sign/"), "poster is a signed Storage URL", posterUrl.split("?")[0].slice(-46));

  await page
    .waitForFunction(
      () => {
        const img = document.querySelector(".signal-ui__poster");
        return img?.complete && img.naturalWidth > 0;
      },
      null,
      { timeout: 20000 },
    )
    .catch(() => {});
  const posterLoaded = await page.$eval(".signal-ui__poster", (img) => img.complete && img.naturalWidth > 0);
  check(posterLoaded, "the signed poster actually loads in the browser");

  const signedPaths = signRequests.flatMap((body) => body.paths ?? []);
  check(signedPaths.includes(galleryPath), "gallery images are fetched and signed", `${signedPaths.length} path(s) signed`);
  check(signRequests.length === 1, "signing happens in a single batched request", `${signRequests.length} request(s)`);
  check((await page.locator("[data-viewer-gallery] img").count()) >= 1, "gallery renders inside the public project viewer");

  // --- Drafts, archived and hidden must never appear -----------------------
  for (const [label, patch] of [
    ["draft", { editorial_status: "DRAFT" }],
    ["archived", { editorial_status: "ARCHIVED" }],
    ["hidden", { visible: false }],
  ]) {
    await patchProject(target.case_number, patch);
    await loadSite();

    const names = await liveCaseNames();
    check(!names.includes(target.name), `a ${label} project is absent from the public site`, names.join(", ") || "none");
    check(await isReserved(target.name.toUpperCase()) === false, `a ${label} project does not leak its name into a slot`);

    await patchProject(target.case_number, { editorial_status: "PUBLISHED", visible: true });
  }

  // --- Back to normal after a reload ---------------------------------------
  await loadSite();
  const afterRestore = await liveCaseNames();
  check(afterRestore.length === baseline.length, "republishing brings the project back after a reload", afterRestore.join(", "));
  check((await source()) === "supabase", "still driven by Supabase after reload");

  // --- Supabase unavailable -------------------------------------------------
  await loadSite({ offline: true });
  check((await source()) === "unavailable", "uses a neutral fallback when Supabase is unreachable", await source());
  const offlineNames = await liveCaseNames();
  check(!offlineNames.includes(target.name), "offline fallback does not leak the unpublished/stale project name", offlineNames.join(", "));
  const offlinePoster = (await page.getAttribute(".signal-ui__poster", "src")) || "";
  check(!offlinePoster.includes("/storage/v1/"), "offline poster is not a stale signed Storage URL", offlinePoster.slice(-32));
} finally {
  for (const undo of restore.reverse()) {
    try {
      await undo();
    } catch (error) {
      console.log("cleanup step failed:", error.message);
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

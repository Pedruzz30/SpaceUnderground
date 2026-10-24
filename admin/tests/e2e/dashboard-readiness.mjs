import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch();
const context = await browser.newContext({ locale: "pt-BR" });
const page = await context.newPage();

async function signIn(profile) {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForSelector("[data-login-form]");
  assert.equal(await page.evaluate(() => window.__spaceAdminDataSource), "mock");
  await page.fill("#login-email", `${profile}@spaceunderground.local`);
  await page.fill("#login-password", "mock-password");
  await page.selectOption("[data-login-profile]", profile);
  await page.click("[data-login-submit]");
  await page.waitForSelector(".admin-shell");
}

try {
  await signIn("owner");
  await page.waitForSelector("[data-pulse]:not([aria-busy])");
  await page.evaluate(async () => {
    const { getRepositories } = await import("/src/services/repositories/index.js");
    const repositories = await getRepositories();
    const original = repositories.clients.list.bind(repositories.clients);
    repositories.clients.list = () => new Promise((resolve) => {
      window.__releaseClientRead = () => resolve(original());
    });
    window.location.hash = "#/projects";
  });
  await page.waitForSelector("[data-project-list]");
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await page.waitForSelector("[data-pulse]:not([aria-busy])");
  assert.equal(await page.locator("[data-followups]").getAttribute("aria-busy"), "true", "client read is still pending");
  assert.notEqual(await page.locator("[data-dash-kpis] .stat-card strong").first().innerText(), "—", "project KPI renders independently");
  await page.evaluate(() => window.__releaseClientRead());
  await page.waitForSelector("[data-followups]:not([aria-busy])");

  await page.click("[data-logout]");
  await signIn("collaborator");
  await page.waitForSelector("[data-member-projects]:not([aria-busy])");
  await page.evaluate(async () => {
    const { getRepositories } = await import("/src/services/repositories/index.js");
    (await getRepositories()).approvals.list = async () => { throw new Error("fixture read failure"); };
    window.location.hash = "#/projects";
  });
  await page.waitForSelector("[data-project-list]");
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await page.waitForSelector("[data-member-pending]:not([aria-busy])");
  assert.equal(await page.locator("[data-member-metrics] .project-metric strong").nth(1).innerText(), "—");
  assert.match(await page.locator("[data-member-pending]").innerText(), /Não foi possível carregar as solicitações/);
  assert.match(await page.locator("[data-member-changes]").innerText(), /Não foi possível carregar as solicitações/);

  console.log("dashboard readiness: all checks passed");
} finally {
  await browser.close();
}

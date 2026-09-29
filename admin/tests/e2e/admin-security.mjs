// End-to-end coverage of the access model in the Admin's interface, against a
// running mock dev server: what each role sees, drafts and their review, the
// team lifecycle, step-up and the blocked-account screens. The database side
// of the same rules is covered by the PGlite suites (security-*.test.mjs);
// this checks that the interface offers exactly what the model allows and
// explains what it refuses.
//
//   npm run dev:mock                  # terminal 1
//   BASE_URL=http://127.0.0.1:5173 npm run test:e2e:security
//
// Mock mode only: it resets the local store and never touches a backend.

import { strict as assert } from "node:assert";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch();
const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

const settle = () => page.waitForTimeout(300);
const toast = () => page.textContent("[data-toast-region]");
const navLabels = () => page.$$eval(".sidebar .side-link__label", (nodes) => nodes.map((node) => node.textContent.trim()));
const go = async (hash, selector) => {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  if (selector) await page.waitForSelector(selector);
  await settle();
};

async function signIn(profile) {
  if (await page.$(".admin-shell [data-logout]")) await page.click(".admin-shell [data-logout]");
  else if (await page.$("[data-gate-sign-out]")) await page.click("[data-gate-sign-out]");
  else await page.goto(`${BASE_URL}/#/login`);
  await page.waitForSelector("[data-login-form]");
  await page.fill("#login-email", `${profile}@spaceunderground.local`);
  await page.fill("#login-password", "mock-password");
  await page.selectOption("[data-login-profile]", profile);
  await page.click("[data-login-submit]");
}

async function signInToShell(profile) {
  await signIn(profile);
  await page.waitForSelector(".admin-shell");
  await settle();
}

try {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForFunction(() => window.__spaceAdminDataSource !== undefined, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__spaceAdminDataSource), "mock", "refusing to run outside mock mode");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForSelector("[data-login-form]");

  /* ------------------------------------------------ collaborator */

  await signInToShell("collaborator");
  assert.deepEqual(await navLabels(), ["Dashboard", "Meus projetos", "Minhas alterações", "Auditoria", "Configurações"], "a collaborator sees only their own work");
  assert.ok(await page.$("[data-member-projects]"), "the collaborator dashboard");
  for (const route of ["#/financial", "#/clients", "#/commercial", "#/team", "#/logs", "#/approvals"]) {
    await go(route, ".page");
    assert.ok(await page.$("[data-forbidden]"), `${route} is refused with a 403 screen`);
  }
  await go("#/settings", "[data-settings-account]");
  assert.deepEqual(await page.$$eval('.settings-tabs [role="tab"]', (tabs) => tabs.map((tab) => tab.dataset.tab)), ["account"], "only the account tab");

  await go("#/projects/002", ".page-heading h2");
  assert.equal(await page.$("[data-draft-submit]"), null, "a VIEW grant cannot draft");
  await go("#/projects/001", "[data-draft-form]");
  await page.fill("#draft-name", "INK Tattoo Studio");
  await page.fill("#draft-description", "Descrição proposta no teste de segurança.");
  await page.check('input[name="publish"]');
  await page.click("[data-draft-submit]");
  await page.waitForFunction(() => window.location.hash.startsWith("#/approvals/"));
  await page.waitForSelector(".diff-table");
  assert.match(await toast(), /Alterações enviadas para aprovação\./);
  assert.equal(await page.$("[data-review-approve]"), null, "no approve button on your own request");
  assert.equal(await page.locator(".diff-table tr.is-changed").count(), 2, "two fields change");

  /* ------------------------------------------------ SEO reviews */

  await signInToShell("seo");
  await page.waitForSelector('[data-nav-badge="approvals"]');
  assert.equal((await page.textContent('[data-nav-badge="approvals"] [aria-hidden]')).trim(), "1", "the badge counts the pending request");
  await go("#/approvals", "[data-approval-card]");
  await page.click("[data-approval-card] a");
  await page.waitForSelector("[data-review-approve]");
  await page.click("[data-review-approve]");
  await page.fill("[data-reason-input]", "Pode publicar.");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => document.querySelector("[data-toast-region]")?.textContent.includes("Alterações aprovadas e publicadas."));
  await page.waitForSelector(".badge--success");
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem("space-admin:projects:v2")).find((item) => item.id === "001"));
  assert.equal(project.name, "INK Tattoo Studio", "the approval applied the change");

  /* ------------------------------------------------ owner manages the team */

  await signInToShell("owner");
  await go("#/team", "[data-member-row]");
  assert.equal(await page.locator("[data-member-row]").count(), 9);
  assert.equal(await page.locator('[data-member-row][data-member-id="mock-seo"] .row-menu').count(), 0, "no actions on someone of the same rank");

  await go("#/team/invite", "[data-invite-form]");
  const roles = await page.$$eval("#invite-role option", (options) => options.map((option) => option.value));
  assert.deepEqual(roles, ["SEO", "MANAGER", "COLLABORATOR", "VIEWER"], "an owner grants only roles below their own");
  await page.fill("#invite-name", "Pessoa Convidada");
  await page.fill("#invite-email", "convidada@example.com");
  await page.check('input[name="project"][value="002"]');
  await page.selectOption('select[name="level-002"]', "EDIT");
  await page.click("[data-invite-submit]");
  await page.waitForFunction(() => /^#\/team\/mock-invited-/.test(window.location.hash));
  await page.waitForSelector("[data-member-heading] .team-ru");
  assert.match(await page.textContent("[data-member-heading]"), /Convidado/);

  // Suspending a collaborator: a reason is required, then the row changes.
  await go("#/team/mock-viewer", '[data-member-action="suspend"]');
  await page.click('[data-member-action="suspend"]');
  await page.click("[data-modal-confirm]");
  assert.equal(await page.locator("[data-reason-error]").isVisible(), true, "a suspension needs a reason");
  await page.fill("[data-reason-input]", "Pausa no contrato");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => document.querySelector("[data-member-heading]")?.textContent.includes("Suspenso"));

  // Step-up: granting an administrative role asks for a fresh MFA code once
  // the last verification is older than the window. The session verified an
  // hour ago, and its token carries that verification.
  await page.evaluate(() => {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const session = JSON.parse(sessionStorage.getItem("space-admin:session:v1"));
    session.mfaVerifiedAt = hourAgo;
    sessionStorage.setItem("space-admin:session:v1", JSON.stringify(session));
    const live = JSON.parse(localStorage.getItem("space-admin:auth-sessions:v1"));
    live[session.sessionId].mfaAt = hourAgo;
    localStorage.setItem("space-admin:auth-sessions:v1", JSON.stringify(live));
  });
  await go("#/team/mock-collaborator", "[data-member-access]");
  await page.check('[data-member-access] input[name="role"][value="MANAGER"]');
  await page.click("[data-member-save]");
  await page.waitForSelector("[data-step-up-code]");
  await page.fill("[data-step-up-code]", "12");
  await page.click("[data-modal-confirm]");
  assert.equal(await page.locator("[data-step-up-error]").isVisible(), true, "a malformed code is refused");
  await page.fill("[data-step-up-code]", "123456");
  await page.click("[data-modal-confirm]");
  await page.waitForFunction(() => document.querySelector("[data-toast-region]")?.textContent.includes("Acesso atualizado."));
  await page.waitForFunction(() => document.querySelector("[data-member-heading]")?.textContent.includes("Gestor"));

  await go("#/audit", "[data-audit-line]");
  const actions = await page.$$eval("[data-audit-line]", (lines) => lines.map((line) => line.dataset.auditAction));
  for (const action of ["USER_SUSPENDED", "ROLE_ASSIGNED", "USER_INVITED", "APPROVAL_APPROVED", "APPROVAL_REQUESTED"]) {
    assert.ok(actions.includes(action), `the audit trail has ${action}`);
  }

  /* ------------------------------------------------ blocked accounts */

  await signIn("viewer");
  await page.waitForSelector("[data-access-screen]");
  assert.match(await page.textContent("[data-access-screen]"), /CONTA SUSPENSA/, "a suspended member sees why, and nothing else");
  assert.equal(await page.$(".admin-shell"), null);

  /* ------------------------------------------------ ended sessions */

  // Someone ends this member's sessions from another browser: the mock
  // store's cutoff moves past the session this page holds. The next action
  // is refused, the Admin says why, and a new sign-in works.
  await signInToShell("manager");
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("space-admin:security:v1"));
    state.members.find((member) => member.userId === "mock-manager").sessionsValidAfter = new Date().toISOString();
    localStorage.setItem("space-admin:security:v1", JSON.stringify(state));
  });
  await go("#/team");
  await page.waitForSelector("[data-access-screen]");
  assert.match(await page.textContent("[data-access-screen]"), /SESSÃO ENCERRADA/, "the Admin says the session was ended");
  await page.click("[data-gate-sign-out]");
  await page.waitForSelector("[data-login-form]");
  await signInToShell("manager");
  await go("#/team", "[data-member-row]");
  assert.equal(await page.$("[data-access-screen]"), null, "signing in again works");

  /* ------------------------------------------------ removing your own MFA */

  // A privileged member removes their only factor in Settings. The session
  // is refreshed down to aal1, and even before that the database answers
  // MFA_ENROLL_REQUIRED: the enrolment screen replaces the Admin at once.
  // Enrolling again brings it back.
  await signInToShell("seo");
  await go("#/settings", '.settings-tabs [role="tab"][data-tab="account"]');
  await page.click('.settings-tabs [role="tab"][data-tab="account"]');
  await page.waitForSelector("[data-mfa-remove]");
  await page.click("[data-mfa-remove]");
  await page.click("[data-modal-confirm]");
  await page.waitForSelector("[data-access-screen] [data-mfa-start]");
  assert.match(await page.textContent("[data-access-screen]"), /ATIVE O MFA PARA CONTINUAR/, "the Admin asks for MFA again");
  assert.equal(await page.$(".admin-shell"), null, "nothing else is reachable");
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("space-admin:session:v1")).mfaVerifiedAt), null, "the session was refreshed to aal1");
  await page.click("[data-mfa-start]");
  await page.fill("#mfa-enroll-code", "123456");
  await page.click("[data-mfa-verify] button[type=submit]");
  await page.waitForSelector(".admin-shell");

  /* ------------------------------------------------ phone widths */

  // The new screens' content stays inside the viewport. (At 320px the
  // topbar's account chip already overflows on main; that predates this
  // work and the Admin's own responsive check covers the chrome.)
  await signInToShell("owner");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of ["#/team", "#/team/mock-collaborator", "#/approvals", "#/audit", "#/team/invite"]) {
      await go(route, ".page");
      const wide = await page.evaluate((viewport) =>
        [...document.querySelectorAll(".page *")]
          .filter((node) => node.getBoundingClientRect().right > viewport + 1 && !node.closest(".ops-table-scroll, .diff-scroll"))
          .map((node) => node.className || node.tagName),
      width);
      assert.deepEqual(wide, [], `${route} at ${width}px`);
    }
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log("admin security: all checks passed");
} finally {
  await browser.close();
}

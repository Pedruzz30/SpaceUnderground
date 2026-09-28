// The rules behind Settings (public configuration, share readiness, password,
// module health, backup) and the services that apply them, against the mock
// repositories.
//
//   npm test

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

function createStorageStub() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

globalThis.localStorage = createStorageStub();
globalThis.sessionStorage = createStorageStub();

const { setLocale } = await import("../src/i18n/index.js");
const { changePassword, login, logout, signOutEverywhere, getSession, getAdminRoster } = await import("../src/services/auth-service.js");
const { checkModules, exportBackup } = await import("../src/services/system-service.js");
const { resetMockData } = await import("../src/services/dev-tools.js");
const {
  BACKUP_FORMAT,
  HEALTH_MODULES,
  backupFilename,
  buildBackup,
  classifyFailure,
  clipForPreview,
  healthSummary,
  isOgImageReference,
  lengthState,
  ogImageState,
  passwordChecks,
  shareReadiness,
  validateNewPassword,
  validateSiteSettings,
} = await import("../src/utils/settings-checks.js");

setLocale("en", { persist: false });

describe("public configuration", () => {
  it("keeps every field optional and checks only what is filled in", () => {
    assert.deepEqual(validateSiteSettings({}), {});
    assert.deepEqual(validateSiteSettings({ siteUrl: "https://spaceunderground.dev", contactEmail: "hi@space.dev", locale: "en" }), {});
    assert.deepEqual(validateSiteSettings({ siteUrl: "spaceunderground.dev", contactEmail: "hi@", locale: "pt_BR", ogImagePath: "/og.png" }), {
      siteUrl: "settings.invalidUrl",
      contactEmail: "settings.invalidEmail",
      locale: "settings.validation.localeValid",
      ogImagePath: "settings.invalidOgPath",
    });
  });

  it("accepts an absolute URL or a storage path for the OG image", () => {
    assert.equal(isOgImageReference("https://cdn.example.com/og.png"), true);
    assert.equal(isOgImageReference("site/og-cover.png"), true);
    assert.equal(isOgImageReference("/og.png"), false, "resolves against the Admin's host");
    assert.equal(isOgImageReference("site/../secret.png"), false);
    assert.equal(isOgImageReference("site/og cover.png"), false);
  });

  it("measures SEO copy against the search engine limits", () => {
    const limits = { min: 30, max: 60 };
    assert.equal(lengthState("", limits), "empty");
    assert.equal(lengthState("Space Underground", limits), "short");
    assert.equal(lengthState("Space Underground · digital studio for sites", limits), "ok");
    assert.equal(lengthState("x".repeat(61), limits), "long");
  });

  it("clips a preview at the last whole word, like a search result", () => {
    assert.equal(clipForPreview("Short title", 60), "Short title");
    assert.equal(clipForPreview("Digital studio for websites, systems, automation and AI", 30), "Digital studio for websites…");
    assert.equal(clipForPreview("x".repeat(20), 10), `${"x".repeat(9)}…`);
  });

  it("reads the OG image size as missing, unreadable, small, badly cropped or ok", () => {
    assert.equal(ogImageState("", null), "missing");
    assert.equal(ogImageState("site/og.png", null), "unreadable");
    assert.equal(ogImageState("site/og.png", { width: 400, height: 210 }), "small");
    assert.equal(ogImageState("site/og.png", { width: 1200, height: 1200 }), "ratio");
    assert.equal(ogImageState("site/og.png", { width: 1200, height: 630 }), "ok");
    assert.equal(ogImageState("site/og.png", { width: 2400, height: 1260 }), "ok");
  });

  it("scores how ready the site is to be shared, flagging what breaks it", () => {
    const complete = shareReadiness(
      {
        siteUrl: "https://spaceunderground.dev",
        seoTitle: "Space Underground · digital studio for sites",
        seoDescription: "Estúdio digital de sites, sistemas, automações e IA para marcas que querem crescer.",
        ogImagePath: "site/og.png",
        contactEmail: "hi@space.dev",
        translations: { en: { seo_description: "Digital studio." } },
      },
      { width: 1200, height: 630 },
    );
    assert.equal(complete.score, complete.total);

    const bare = shareReadiness({ siteUrl: "http://spaceunderground.dev", siteName: "Space" });
    const failing = Object.fromEntries(bare.checks.filter((check) => !check.ok).map((check) => [check.key, check.severity]));
    assert.deepEqual(failing, {
      siteUrl: "required",
      title: "advice",
      description: "advice",
      ogImage: "required",
      english: "advice",
      contactEmail: "advice",
    });
    assert.equal(bare.score, 0);
  });

  it("treats a small image as advice but a missing one as required", () => {
    const small = shareReadiness({ ogImagePath: "site/og.png" }, { width: 300, height: 150 }).checks.find((check) => check.key === "ogImage");
    assert.deepEqual([small.ok, small.severity, small.state], [false, "advice", "small"]);
  });
});

describe("new password", () => {
  it("ticks each rule on its own", () => {
    const state = (password, confirmation, email) =>
      Object.fromEntries(passwordChecks(password, confirmation, email).map((check) => [check.key, check.ok]));
    assert.deepEqual(state("abc", "", "pedro@space.dev"), { length: false, mix: false, email: true, match: false });
    assert.deepEqual(state("pedro-2026-lab", "pedro-2026-lab", "pedro@space.dev"), { length: true, mix: true, email: false, match: true });
    assert.deepEqual(state("Órbita-2026-lab", "Órbita-2026-lab", "jo@space.dev"), { length: true, mix: true, email: true, match: true });
  });

  it("reports the first broken rule on the field it belongs to", () => {
    assert.deepEqual(validateNewPassword("short1", "short1"), { password: "settings.account.passwordTooShort" });
    assert.deepEqual(validateNewPassword("onlyletters", "onlyletters"), { password: "settings.account.passwordMix" });
    assert.deepEqual(validateNewPassword("admin2026lab", "admin2026lab", "admin@space.dev"), { password: "settings.account.passwordEmail" });
    assert.deepEqual(validateNewPassword("Orbita-2026-lab", "Orbita-2026"), { confirmation: "settings.account.passwordMismatch" });
    assert.deepEqual(validateNewPassword("Orbita-2026-lab", "Orbita-2026-lab", "admin@space.dev"), {});
  });
});

describe("account service", () => {
  beforeEach(async () => {
    sessionStorage.clear();
    await login({ email: "admin@space.dev", password: "mock" });
  });

  it("describes the session with role, last sign-in and expiry", async () => {
    const session = await getSession();
    assert.equal(session.role, "owner");
    assert.ok(session.user.lastSignInAt);
    assert.ok(new Date(session.expiresAt) > new Date());
    assert.deepEqual((await getAdminRoster()).map((member) => [member.userId, member.role]), [["mock-admin", "owner"]]);
  });

  it("refuses a weak password before it reaches the auth provider", async () => {
    await assert.rejects(changePassword("admin2026lab", "admin2026lab"), (error) => error.field === "password" && /email/i.test(error.message));
    await assert.rejects(changePassword("short1", "short1"), (error) => error.field === "password" && /10 characters/.test(error.message));
    await assert.rejects(changePassword("Orbita-2026-lab", "nope"), (error) => error.field === "confirmation");
    await changePassword("Orbita-2026-lab", "Orbita-2026-lab");
  });

  it("ends every session when signing out everywhere", async () => {
    await signOutEverywhere();
    assert.equal(await getSession(), null);
    await logout();
  });
});

describe("module health", () => {
  it("classifies a failure in words an operator can act on", () => {
    assert.equal(classifyFailure({ code: "schema_outdated" }), "schema");
    assert.equal(classifyFailure({ code: "42P01" }), "schema");
    assert.equal(classifyFailure({ code: "unauthorized" }), "unauthorized");
    assert.equal(classifyFailure({ code: "network_error" }), "network");
    assert.equal(classifyFailure({ code: "XX000" }), "error");
  });

  it("summarizes the state and lists the migrations behind schema failures", () => {
    const results = [
      { key: "projects", status: "ok" },
      { key: "financial", status: "schema", migration: "20260928031922_financial_foundation.sql" },
      { key: "commercial", status: "network", migration: "20260928035023_commercial_opportunities.sql" },
    ];
    assert.deepEqual(healthSummary(results), {
      ok: 1,
      total: 3,
      pendingMigrations: ["20260928031922_financial_foundation.sql"],
      state: "degraded",
    });
    assert.equal(healthSummary([{ status: "ok" }]).state, "ok");
    assert.equal(healthSummary([{ status: "error" }]).state, "down");
  });

  it("reads every module and counts its records", async () => {
    resetMockData();
    const results = await checkModules();
    assert.deepEqual(results.map((result) => result.key), HEALTH_MODULES.map((module) => module.key));
    assert.ok(results.every((result) => result.status === "ok" && Number.isInteger(result.latency)));
    const counts = Object.fromEntries(results.map((result) => [result.key, result.count]));
    assert.ok(counts.projects > 0 && counts.clients > 0 && counts.financial > 0);
    assert.equal(counts.settings, 1);
  });
});

describe("backup", () => {
  it("wraps every module with its counts and lists the ones that failed", () => {
    const backup = buildBackup({
      modules: { projects: [{ id: 1 }, { id: 2 }], settings: { siteName: "Space" } },
      failed: ["financial"],
      source: "mock",
      generatedAt: "2026-09-28T12:00:00.000Z",
    });
    assert.equal(backup.format, BACKUP_FORMAT);
    assert.equal(backup.version, 1);
    assert.deepEqual(backup.counts, { projects: 2, settings: 1 });
    assert.deepEqual(backup.missing, ["financial"]);
    assert.equal(backup.data.settings.siteName, "Space");
  });

  it("names the file after the local date and time", () => {
    assert.equal(backupFilename(new Date(2026, 8, 28, 9, 5)), "space-underground-backup-2026-09-28-0905.json");
  });

  it("exports what the modules hold right now", async () => {
    resetMockData();
    const { backup, results } = await exportBackup({ generatedAt: "2026-09-28T12:00:00.000Z" });
    assert.equal(backup.source, "mock");
    assert.deepEqual(backup.missing, []);
    assert.deepEqual(Object.keys(backup.data), HEALTH_MODULES.map((module) => module.key));
    assert.equal(backup.counts.clients, results.find((result) => result.key === "clients").count);
    assert.ok(JSON.parse(JSON.stringify(backup)).data.projects.length > 0, "survives a JSON round trip");
  });
});

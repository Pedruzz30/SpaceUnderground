import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { localizePlanRow } from "../src/scripts/commercial-positioning.js";

const MAX_ROW = {
  slug: "plan-max",
  name: "Max",
  monogram: "P×",
  range: "A PARTIR DE R$ 5.000",
  year: 2026,
  accent: "#f59e0b",
  category: "PLANO / SOFTWARE SOB MEDIDA",
  scope: "SISTEMAS · AUTOMAÇÃO · IA · INTEGRAÇÕES",
  scope_short: "SISTEMAS · AUTOMAÇÃO · IA",
  status: "SOB CONSULTA",
  description: "Para operações que precisam de software sob medida.",
  timeline: "6–12 semanas",
  translations: {
    en: {
      category: "PLAN / CUSTOM SOFTWARE",
      scope: "SYSTEMS · AUTOMATION · AI · INTEGRATIONS",
      scope_short: "SYSTEMS · AUTOMATION · AI",
      status: "ON REQUEST",
      description: "For operations that need custom software.",
      timeline: "6–12 weeks",
    },
  },
};

describe("plan timeline localization", () => {
  it("uses the base timeline in pt-BR", () => {
    assert.equal(localizePlanRow(MAX_ROW, {}, "pt-BR").timeline, "6–12 semanas");
  });

  it("uses the translated timeline in English", () => {
    assert.equal(localizePlanRow(MAX_ROW, {}, "en").timeline, "6–12 weeks");
  });

  it("falls back to the base timeline when English has none", () => {
    const row = { ...MAX_ROW, translations: { en: { description: "Only the description." } } };
    assert.equal(localizePlanRow(row, {}, "en").timeline, "6–12 semanas");
  });

  it("falls back when the translated timeline is blank", () => {
    const row = { ...MAX_ROW, translations: { en: { timeline: "   " } } };
    assert.equal(localizePlanRow(row, {}, "en").timeline, "6–12 semanas");
  });
});

describe("plan structural fields", () => {
  it("keeps the plan name identical in both locales", () => {
    assert.equal(localizePlanRow(MAX_ROW, {}, "pt-BR").name, "Max");
    assert.equal(localizePlanRow(MAX_ROW, {}, "en").name, "Max");
  });

  it("ignores a translation that tries to rename the plan", () => {
    const row = { ...MAX_ROW, translations: { en: { ...MAX_ROW.translations.en, name: "Maximum" } } };
    assert.equal(localizePlanRow(row, {}, "en").name, "Max");
  });

  it("keeps the price range, year, accent and monogram shared", () => {
    const row = {
      ...MAX_ROW,
      translations: {
        en: { ...MAX_ROW.translations.en, range: "FROM R$ 5,000", year: 2030, accent: "#000000", monogram: "MX" },
      },
    };
    const en = localizePlanRow(row, {}, "en");

    assert.equal(en.range, "A PARTIR DE R$ 5.000");
    assert.equal(en.year, "2026");
    assert.equal(en.accent, "#f59e0b");
    assert.equal(en.monogram, "P×");
  });
});

describe("plan editorial fields", () => {
  it("localizes every editorial field", () => {
    const pt = localizePlanRow(MAX_ROW, {}, "pt-BR");
    const en = localizePlanRow(MAX_ROW, {}, "en");

    for (const field of ["category", "scope", "scopeShort", "status", "description", "timeline"]) {
      assert.notEqual(en[field], pt[field], `${field} should differ between locales`);
    }
    assert.equal(en.scopeShort, "SYSTEMS · AUTOMATION · AI");
    assert.equal(en.status, "ON REQUEST");
  });

  it("falls back to the bundled plan when the row has nothing", () => {
    const resolved = localizePlanRow({}, { name: "Plus", description: "Bundled copy." }, "en");
    assert.equal(resolved.name, "Plus");
    assert.equal(resolved.description, "Bundled copy.");
  });
});

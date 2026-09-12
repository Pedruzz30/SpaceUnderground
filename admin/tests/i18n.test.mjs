import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  DEFAULT_LOCALE,
  dictionaryKeys,
  normalizeLocale,
  resolveLocale,
  setLocale,
  t,
} from "../src/i18n/index.js";

describe("admin i18n locale resolution", () => {
  it("normalizes Portuguese variants to pt-BR", () => {
    assert.equal(normalizeLocale("pt"), "pt-BR");
    assert.equal(normalizeLocale("pt-BR"), "pt-BR");
    assert.equal(normalizeLocale("pt-PT"), "pt-BR");
  });

  it("normalizes English variants to en", () => {
    assert.equal(normalizeLocale("en"), "en");
    assert.equal(normalizeLocale("en-US"), "en");
    assert.equal(normalizeLocale("en-GB"), "en");
  });

  it("uses a saved manual preference before browser languages", () => {
    assert.equal(resolveLocale({ saved: "en", languages: ["pt-BR"] }), "en");
  });

  it("falls back to pt-BR for unsupported languages", () => {
    assert.equal(resolveLocale({ saved: "", languages: ["fr-FR", "de-DE"] }), DEFAULT_LOCALE);
  });
});

describe("admin i18n translations", () => {
  it("switches language and interpolates values", () => {
    setLocale("pt-BR", { persist: false });
    assert.equal(t("projects.title"), "Projetos");
    assert.equal(t("dashboard.archivedCount", { count: 2 }), "2 arquivados");

    setLocale("en", { persist: false });
    assert.equal(t("projects.title"), "Projects");
    assert.equal(t("dashboard.archivedCount", { count: 2 }), "2 archived");
  });

  it("falls back to the key when no locale contains it", () => {
    setLocale("en", { persist: false });
    assert.equal(t("missing.example.key"), "missing.example.key");
  });

  it("keeps English dictionary parity with pt-BR", () => {
    const ptKeys = dictionaryKeys("pt-BR");
    const enKeys = dictionaryKeys("en");
    assert.deepEqual(enKeys, ptKeys);
  });
});

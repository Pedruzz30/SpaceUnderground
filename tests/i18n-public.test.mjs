import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  DEFAULT_LOCALE,
  dictionaryKeys,
  normalizeLocale,
  resolveLocale,
  setLocale,
  t,
} from "../src/scripts/i18n/index.js";

describe("public i18n locale resolution", () => {
  it("maps Portuguese browsers to pt-BR", () => {
    assert.equal(normalizeLocale("pt"), "pt-BR");
    assert.equal(normalizeLocale("pt-PT"), "pt-BR");
  });

  it("maps English browsers to en", () => {
    assert.equal(normalizeLocale("en-US"), "en");
    assert.equal(normalizeLocale("en-GB"), "en");
  });

  it("prefers a saved locale over the browser", () => {
    assert.equal(resolveLocale({ saved: "en", languages: ["pt-BR"] }), "en");
  });

  it("falls back to pt-BR for unsupported languages", () => {
    assert.equal(resolveLocale({ saved: "", languages: ["fr-FR"] }), DEFAULT_LOCALE);
  });
});

describe("public i18n dictionaries", () => {
  it("switches language and falls back to the key only when missing everywhere", () => {
    setLocale("pt-BR", { persist: false });
    assert.equal(t("navigation.startProject"), "Iniciar um Projeto");
    setLocale("en", { persist: false });
    assert.equal(t("navigation.startProject"), "Start a Project");
    assert.equal(t("missing.key"), "missing.key");
  });

  it("keeps English dictionary parity with pt-BR", () => {
    assert.deepEqual(dictionaryKeys("en"), dictionaryKeys("pt-BR"));
  });
});

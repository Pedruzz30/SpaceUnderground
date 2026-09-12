import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import en from "../src/scripts/i18n/locales/en.js";
import ptBR from "../src/scripts/i18n/locales/pt-BR.js";
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

function entries(dictionary, prefix = "") {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" ? entries(value, name) : [[name, String(value)]];
  });
}

const PT_ENTRIES = entries(ptBR);
const EN_ENTRIES = entries(en);

describe("public copy quality", () => {
  it("keeps Portuguese accents instead of stripping them", () => {
    const stripped = [
      "nao", "voce", "acao", "acoes", "descricao", "configuracoes", "operacao",
      "informacao", "selecao", "atencao", "publico", "midia", "servico", "servicos",
      "codigo", "titulo", "pagina", "padrao", "periodo", "disponivel", "possivel",
      "tambem", "experiencia", "referencia", "tecnico", "unico", "automatico",
      "portfolio", "sobretitulo", "proximo", "producao", "integracoes", "automacoes",
      "prototipo", "visao", "inteligencia", "presenca", "conversao",
    ];
    // Unicode boundaries, so "Automação" is not flagged for containing "automacao".
    const pattern = new RegExp(`(?<!\\p{L})(${stripped.join("|")})(?!\\p{L})`, "iu");
    const offenders = PT_ENTRIES.filter(([, value]) => pattern.test(value)).map(
      ([key, value]) => `${key}: ${value}`,
    );

    assert.deepEqual(offenders, []);
  });

  it("does not leave Portuguese copy in the English dictionary", () => {
    const portuguese = /\b(?:Não|não|Projetos|Planos|Contato|Sobre|Início|Estúdio|Carregando|Nenhum|Nenhuma|Você|Escolha)\b/;
    const offenders = EN_ENTRIES.filter(([, value]) => portuguese.test(value)).map(
      ([key, value]) => `${key}: ${value}`,
    );

    assert.deepEqual(offenders, []);
  });

  it("does not leave English copy in the Portuguese dictionary", () => {
    const english = /\b(?:Loading|Select an option|View Project|Send Request|Back to top|What's included|Built without)\b/;
    const offenders = PT_ENTRIES.filter(([, value]) => english.test(value)).map(
      ([key, value]) => `${key}: ${value}`,
    );

    assert.deepEqual(offenders, []);
  });

  it("keeps the two dictionaries genuinely different", () => {
    const enByKey = new Map(EN_ENTRIES);
    const compared = PT_ENTRIES.filter(([key]) => enByKey.has(key));
    const identical = compared.filter(([key, value]) => enByKey.get(key) === value);

    assert.ok(
      identical.length / compared.length < 0.3,
      `${identical.length} of ${compared.length} entries are identical across locales`,
    );
  });
});

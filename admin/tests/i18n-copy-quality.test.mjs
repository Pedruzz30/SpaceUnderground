import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import en from "../src/i18n/locales/en.js";
import ptBR from "../src/i18n/locales/pt-BR.js";

function entries(dictionary, prefix = "") {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" ? entries(value, name) : [[name, String(value)]];
  });
}

const PT_ENTRIES = entries(ptBR);
const EN_ENTRIES = entries(en);

// Words whose unaccented spelling is always wrong in Portuguese. Written as the
// stripped form so the test fails on exactly the mistake it is guarding against
// -- dropping accents to dodge an encoding problem the project does not have.
const MUST_BE_ACCENTED = [
  "nao",
  "voce",
  "acao",
  "acoes",
  "opcao",
  "opcoes",
  "configuracao",
  "configuracoes",
  "operacao",
  "operacoes",
  "descricao",
  "descricoes",
  "sessao",
  "transacao",
  "transacoes",
  "negociacao",
  "publicacao",
  "apresentacao",
  "visao",
  "versao",
  "informacao",
  "informacoes",
  "selecao",
  "posicao",
  "atencao",
  "producao",
  "edicao",
  "criacao",
  "navegacao",
  "aplicacao",
  "automacao",
  "publico",
  "publica",
  "midia",
  "recebiveis",
  "proprietario",
  "ultimo",
  "ultima",
  "historico",
  "codigo",
  "titulo",
  "minimo",
  "maximo",
  "numero",
  "pagina",
  "padrao",
  "usuario",
  "dominio",
  "periodo",
  "relatorio",
  "obrigatorio",
  "disponivel",
  "indisponivel",
  "invalido",
  "tambem",
  "mes",
  "area",
  "servico",
  "servicos",
  "nivel",
  "possivel",
  "impossivel",
  "responsavel",
  "referencia",
  "experiencia",
  "analise",
  "tecnico",
  "tecnica",
  "basico",
  "unico",
  "especifico",
  "automatico",
  "estatico",
  "dinamico",
  "grafico",
  "logico",
];

describe("pt-BR copy quality", () => {
  it("keeps Portuguese accents instead of stripping them", () => {
    // ASCII \b treats "ç" as a boundary, which would flag "Publicação" for
    // containing "publica". Unicode letter lookarounds match whole words only.
    const pattern = new RegExp(`(?<!\\p{L})(${MUST_BE_ACCENTED.join("|")})(?!\\p{L})`, "iu");
    const offenders = PT_ENTRIES.filter(([, value]) => pattern.test(value)).map(
      ([key, value]) => `${key}: ${value}`,
    );

    assert.deepEqual(offenders, []);
  });

  it("is stored as UTF-8 with real accented characters", () => {
    const accented = PT_ENTRIES.filter(([, value]) => /[áàâãéêíóôõúüç]/i.test(value));
    assert.ok(accented.length > 50, `expected accented pt-BR copy, found ${accented.length} entries`);

    // Mojibake from a bad encoding round-trip.
    const mangled = PT_ENTRIES.filter(([, value]) => /Ã[-¿]|â|Â./.test(value));
    assert.deepEqual(mangled.map(([key]) => key), []);
  });
});

describe("dictionary separation", () => {
  it("does not leave English copy in the Portuguese dictionary", () => {
    // Words that would only appear if a string had been left untranslated.
    const englishOnly = /\b(?:Unable to|Loading\.\.\.|Save Changes|Delete|Search clients|No projects|Settings|Overview|Client directory)\b/;
    const offenders = PT_ENTRIES.filter(([key, value]) => {
      if (key.startsWith("logs.domains.") || key.startsWith("logs.channels.")) return false;
      return englishOnly.test(value);
    }).map(([key, value]) => `${key}: ${value}`);

    assert.deepEqual(offenders, []);
  });

  it("does not leave Portuguese copy in the English dictionary", () => {
    const portugueseOnly = /\b(?:Não|não|Configurações|Descrição|Projetos|Clientes|Salvar|Excluir|Carregando|Nenhum|Nenhuma)\b/;
    const offenders = EN_ENTRIES.filter(([, value]) => portugueseOnly.test(value)).map(
      ([key, value]) => `${key}: ${value}`,
    );

    assert.deepEqual(offenders, []);
  });

  it("keeps the two dictionaries genuinely different", () => {
    // A handful of tokens are the same by design (PT, EN, MVP, CMS, Logs...),
    // but the bulk of the copy must actually differ between locales.
    const enByKey = new Map(EN_ENTRIES);
    const compared = PT_ENTRIES.filter(([key]) => enByKey.has(key));
    const identical = compared.filter(([key, value]) => enByKey.get(key) === value);

    assert.ok(
      identical.length / compared.length < 0.25,
      `${identical.length} of ${compared.length} entries are identical across locales`,
    );
  });
});

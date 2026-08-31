// Fonte unica de verdade dos planos da secao 06 / Plans.
// Preco, prazo, escopo e o que esta incluso moram AQUI e em lugar nenhum mais:
// o card (plans-renderer.js) e o modal (project-dialog.js) leem deste arquivo.
//
// `scopeShort` e a versao curta que cabe no rodape do card; `scope` e a linha
// completa dos detalhes e do modal. Sao a mesma informacao em dois tamanhos,
// nao dois dados diferentes — mudar preco significa mudar `range` e mais nada.
//
// A ORDEM das chaves e a ordem dos cards na grade e do PLAN / 00x.

export const plans = {
  plus: {
    id: "001",
    key: "plan-plus",
    name: "Plus",
    monogram: "P+",
    category: "PLAN / LANDING PAGES & PORTFOLIOS",
    range: "R$ 800 – R$ 2.500",
    scope: "LANDING PAGES · PORTFOLIOS",
    scopeShort: "LANDING PAGES · PORTFOLIOS",
    status: "AVAILABLE",
    description: "For getting online with clarity — fast, focused, done right.",
    included: ["Single responsive page", "Contact form integration", "1 revision round"],
    timeline: "1–4 weeks",
    year: "2026",
    code: "PLUS_001",
  },

  pro: {
    id: "002",
    key: "plan-pro",
    name: "Pro",
    monogram: "P•",
    category: "PLAN / INSTITUTIONAL WEBSITES",
    range: "R$ 2.500 – R$ 4.500",
    scope: "MULTI-PAGE INSTITUTIONAL SITES",
    scopeShort: "INSTITUTIONAL WEBSITES",
    status: "AVAILABLE",
    description: "For businesses ready to show up as more than a page.",
    included: ["Multi-page structure", "Custom design, no templates", "Basic SEO & performance", "2 revision rounds"],
    timeline: "3–6 weeks",
    year: "2026",
    code: "PRO_002",
  },

  max: {
    id: "003",
    key: "plan-max",
    name: "Max",
    monogram: "P×",
    category: "PLAN / E-COMMERCE & SYSTEMS",
    range: "FROM R$ 5.000",
    scope: "E-COMMERCE · WEB SYSTEMS · CUSTOM BUILDS",
    scopeShort: "E-COMMERCE · SYSTEMS",
    status: "AVAILABLE",
    description: "For the ones who need the full system behind the front.",
    included: [
      "Custom e-commerce or web system",
      "Scalable architecture",
      "Third-party integrations",
      "Revisions scoped per project",
    ],
    timeline: "6–12 weeks",
    year: "2026",
    code: "MAX_003",
  },
};

// Linhas do bloco de escopo, iguais no card e no modal. Uma funcao so para os
// dois consumidores: se o formato mudar, muda nos dois ao mesmo tempo.
export function planScopeLines(plan) {
  return [`SCOPE — ${plan.scope}`, `RANGE — ${plan.range}`, `STATUS — ${plan.status}`];
}

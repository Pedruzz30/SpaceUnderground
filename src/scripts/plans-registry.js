// Fonte unica de verdade dos planos da secao 06 / Plans.
// Os campos-base continuam alimentando o HTML estatico gerado em build time.
// `commercial` concentra a apresentacao comercial atual, aplicada no browser
// antes do dialog e do formulario conectarem seus listeners.

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
    commercial: {
      category: "PLANO / PRESENÇA DIGITAL",
      range: "R$ 800 – R$ 2.500",
      scope: "LANDING PAGES · PORTFÓLIOS",
      scopeShort: "LANDING PAGES · PORTFÓLIOS",
      status: "DISPONÍVEL",
      description: "Para colocar sua presença digital no ar com clareza, identidade e foco em conversão.",
      included: [
        "Design responsivo sob medida",
        "Estrutura focada em conversão",
        "Formulário ou CTA integrado",
        "1 rodada de ajustes",
      ],
      timeline: "1–4 semanas",
    },
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
    commercial: {
      category: "PLANO / SITE COMPLETO",
      range: "R$ 2.500 – R$ 4.500",
      scope: "SITES INSTITUCIONAIS · EXPERIÊNCIAS MULTIPÁGINA",
      scopeShort: "SITES INSTITUCIONAIS",
      status: "DISPONÍVEL",
      description: "Para empresas que precisam de uma presença digital completa, profissional e preparada para crescer.",
      included: [
        "Estrutura com múltiplas páginas",
        "Design personalizado, sem template genérico",
        "SEO técnico e performance básica",
        "2 rodadas de ajustes",
      ],
      timeline: "3–6 semanas",
    },
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
    commercial: {
      category: "PLANO / SOFTWARE SOB MEDIDA",
      range: "A PARTIR DE R$ 5.000",
      scope: "SISTEMAS · AUTOMAÇÃO · IA · INTEGRAÇÕES",
      scopeShort: "SISTEMAS · AUTOMAÇÃO · IA",
      status: "SOB CONSULTA",
      description: "Para operações que precisam de software sob medida: sistemas, automações, integrações e inteligência artificial aplicada ao negócio.",
      included: [
        "Arquitetura e desenvolvimento sob medida",
        "Banco de dados, autenticação e integrações",
        "Automações e fluxos inteligentes",
        "IA aplicada quando fizer sentido ao produto",
      ],
      timeline: "6–12+ semanas",
      accent: "#f59e0b",
    },
  },
};

// Linhas do bloco de escopo, iguais no card e no modal.
export function planScopeLines(plan) {
  return [`SCOPE — ${plan.scope}`, `RANGE — ${plan.range}`, `STATUS — ${plan.status}`];
}

// A visao comercial sobrepoe apenas os campos que mudam no posicionamento.
// O registro-base fica intacto para manter compatibilidade com o renderer atual.
export function commercialPlan(plan) {
  return { ...plan, ...(plan.commercial || {}) };
}

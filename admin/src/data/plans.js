export const seedPlans = [
  {
    id: "mock-plan-plus",
    slug: "plan-plus",
    translations: {
      en: {
        category: "PLAN / DIGITAL PRESENCE",
        scope: "LANDING PAGES · PORTFOLIOS",
        scope_short: "LANDING PAGES · PORTFOLIOS",
        status: "AVAILABLE",
        description: "To get your digital presence live with clarity, identity and a focus on conversion.",
        timeline: "1–4 weeks",
      },
    },
    name: "Plus",
    monogram: "P+",
    category: "PLANO / PRESENÇA DIGITAL",
    range: "R$ 800 – R$ 2.500",
    scope: "LANDING PAGES · PORTFÓLIOS",
    scopeShort: "LANDING PAGES · PORTFÓLIOS",
    status: "AVAILABLE",
    description: "Para colocar sua presença digital no ar com clareza, identidade e foco em conversão.",
    timeline: "1–4 semanas",
    year: "2026",
    accent: "#c6ff00",
    visible: true,
    position: 0,
    features: [
      { id: "mock-plan-plus-1", position: 0, text: "Design responsivo sob medida", translations: { en: { text: "Bespoke responsive design" } } },
      { id: "mock-plan-plus-2", position: 1, text: "Estrutura focada em conversão", translations: { en: { text: "Conversion-focused structure" } } },
      { id: "mock-plan-plus-3", position: 2, text: "Formulário ou CTA integrado", translations: { en: { text: "Integrated form or CTA" } } },
      { id: "mock-plan-plus-4", position: 3, text: "1 rodada de ajustes", translations: { en: { text: "1 round of revisions" } } },
    ],
  },
  {
    id: "mock-plan-pro",
    slug: "plan-pro",
    translations: {
      en: {
        category: "PLAN / FULL WEBSITE",
        scope: "INSTITUTIONAL WEBSITES · MULTI-PAGE EXPERIENCES",
        scope_short: "INSTITUTIONAL WEBSITES",
        status: "AVAILABLE",
        description: "For companies that need a complete, professional digital presence ready to grow.",
        timeline: "3–6 weeks",
      },
    },
    name: "Pro",
    monogram: "P•",
    category: "PLANO / SITE COMPLETO",
    range: "R$ 2.500 – R$ 4.500",
    scope: "SITES INSTITUCIONAIS · EXPERIÊNCIAS MULTIPÁGINA",
    scopeShort: "SITES INSTITUCIONAIS",
    status: "AVAILABLE",
    description: "Para empresas que precisam de uma presença digital completa, profissional e preparada para crescer.",
    timeline: "3–6 semanas",
    year: "2026",
    accent: "#c6ff00",
    visible: true,
    position: 1,
    features: [
      { id: "mock-plan-pro-1", position: 0, text: "Estrutura com múltiplas páginas", translations: { en: { text: "Multi-page structure" } } },
      { id: "mock-plan-pro-2", position: 1, text: "Design personalizado, sem template genérico", translations: { en: { text: "Custom design, no generic template" } } },
      { id: "mock-plan-pro-3", position: 2, text: "SEO técnico e performance básica", translations: { en: { text: "Technical SEO and baseline performance" } } },
      { id: "mock-plan-pro-4", position: 3, text: "2 rodadas de ajustes", translations: { en: { text: "2 rounds of revisions" } } },
    ],
  },
  {
    id: "mock-plan-max",
    slug: "plan-max",
    translations: {
      en: {
        category: "PLAN / CUSTOM SOFTWARE",
        scope: "SYSTEMS · AUTOMATION · AI · INTEGRATIONS",
        scope_short: "SYSTEMS · AUTOMATION · AI",
        status: "ON REQUEST",
        description: "For operations that need custom software: systems, automation, integrations and AI applied to the business.",
        timeline: "6–12+ weeks",
      },
    },
    name: "Max",
    monogram: "P×",
    category: "PLANO / SOFTWARE SOB MEDIDA",
    range: "A PARTIR DE R$ 5.000",
    scope: "SISTEMAS · AUTOMAÇÃO · IA · INTEGRAÇÕES",
    scopeShort: "SISTEMAS · AUTOMAÇÃO · IA",
    status: "ON_REQUEST",
    description: "Para operações que precisam de software sob medida: sistemas, automações, integrações e inteligência artificial aplicada ao negócio.",
    timeline: "6–12+ semanas",
    year: "2026",
    accent: "#f59e0b",
    visible: true,
    position: 2,
    features: [
      { id: "mock-plan-max-1", position: 0, text: "Arquitetura e desenvolvimento sob medida", translations: { en: { text: "Bespoke architecture and development" } } },
      { id: "mock-plan-max-2", position: 1, text: "Banco de dados, autenticação e integrações", translations: { en: { text: "Database, authentication and integrations" } } },
      { id: "mock-plan-max-3", position: 2, text: "Automações e fluxos inteligentes", translations: { en: { text: "Automation and intelligent flows" } } },
      { id: "mock-plan-max-4", position: 3, text: "IA aplicada quando fizer sentido ao produto", translations: { en: { text: "AI applied where it genuinely serves the product" } } },
    ],
  },
];

// pt-BR is the editorial base and lives in `content`. Curated English sits in
// `translations.en` under the same field names, and the public site falls back
// to the base whenever an English field is absent.
export const seedSiteContent = [
  {
    key: "hero",
    content: {
      eyebrow: "SPACE UNDERGROUND",
      headline: "Espaços digitais feitos para serem lembrados.",
      description: "Sites, sistemas e automações com identidade marcante e profundidade operacional real.",
      primaryCtaLabel: "Iniciar um projeto",
      primaryCtaUrl: "#project-request",
      secondaryCtaLabel: "Ver projetos",
      secondaryCtaUrl: "#work",
    },
    translations: {
      en: {
        headline: "Digital spaces designed to be remembered.",
        description: "Websites, systems and automation with a sharp identity and real operational depth.",
        primaryCtaLabel: "Start a project",
        secondaryCtaLabel: "View work",
      },
    },
  },
  {
    key: "capabilities",
    content: {
      items: [
        { title: "Sites", kicker: "Presença", description: "Sites editoriais e portfólios.", link: "#plans", accent: "#c6ff00", position: 0 },
        { title: "Sistemas", kicker: "Operação", description: "Dashboards, portais e ferramentas internas.", link: "#plans", accent: "#22c55e", position: 1 },
        { title: "Automação", kicker: "Fluxo", description: "Integrações que eliminam trabalho manual.", link: "#plans", accent: "#ff9d00", position: 2 },
        { title: "IA", kicker: "Inteligência", description: "Assistentes e fluxos com IA aplicada.", link: "#plans", accent: "#8b5cf6", position: 3 },
      ],
    },
    // Aligned by position: link, accent and position are structural and are
    // never repeated here.
    translations: {
      en: {
        items: [
          { position: 0, title: "Websites", kicker: "Presence", description: "Editorial websites and portfolios." },
          { position: 1, title: "Systems", kicker: "Operations", description: "Dashboards, portals and internal tools." },
          { position: 2, title: "Automation", kicker: "Flow", description: "Integrations that remove manual work." },
          { position: 3, title: "AI", kicker: "Intelligence", description: "Assistants and applied AI workflows." },
        ],
      },
    },
  },
];

export const seedSiteSettings = {
  siteName: "Space Underground",
  siteUrl: "https://spaceunderground.dev",
  contactEmail: "contato@spaceunderground.dev",
  locale: "pt-BR",
  seoTitle: "Space Underground",
  seoDescription: "Estúdio digital de sites, sistemas, automações e IA.",
  ogImagePath: "",
  translations: {
    en: {
      seo_description: "Digital studio for websites, systems, automation and AI.",
    },
  },
};

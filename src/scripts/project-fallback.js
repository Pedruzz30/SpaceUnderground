// Bundled fallback for the Selected Work section.
//
// When Supabase is unreachable or returns zero published projects, the viewer
// still needs to show real work. These entries mirror the shape of a Supabase
// row so renderFromRows() can consume them without any special case. Posters
// resolve through BUNDLED_POSTERS by slug (see project-posters.js) and demo
// URLs point at folders already shipped in /public/.

export const FALLBACK_PROJECTS = [
  {
    case_number: 1,
    name: "Despensa Digital",
    slug: "despensa-digital",
    client: "Gestão Escolar",
    category: "System",
    description:
      "Sistema web para controle de estoque, movimentações, fornecedores e relatórios de pequenas operações.",
    status: "Live",
    year: 2026,
    accent: "#22c55e",
    tech_stack: ["Node.js", "Postgres", "Vite"],
    presentation_system: "SISTEMA DE OPERAÇÃO / 01",
    presentation_label: "DESPENSA DIGITAL",
    presentation_address: "despensa.spaceunderground",
    presentation_type: "BUSINESS SYSTEMS",
    origin: "BR",
    coordinates: ["23°33' S", "46°38' W"],
    poster_url: "",
    project_url: "./gestao-escolar-demo/",
    preview_url: "./gestao-escolar-demo/",
    live_preview_enabled: true,
    cta_label: "Quero um sistema assim",
    cta_label_en: "I want a system like this",
    demo_url: "./gestao-escolar-demo/",
    translations: {
      en: {
        description:
          "Web system for stock, movements, suppliers and reports built for small operations.",
      },
    },
    project_gallery: [],
    project_modules: [
      {
        position: 1,
        code: "PROBLEM",
        title: "Problema",
        description:
          "Pequenas operações controlam estoque em planilhas dispersas, com perdas, retrabalho e baixa visibilidade.",
        translations: {
          en: {
            title: "Problem",
            description:
              "Small operations rely on scattered spreadsheets and manual entries, losing time and visibility.",
          },
        },
      },
      {
        position: 2,
        code: "SOLUTION",
        title: "Solução",
        description:
          "Sistema centralizado com cadastro de produtos, movimentações, fornecedores, alertas e relatórios.",
        translations: {
          en: {
            title: "Solution",
            description:
              "Centralized system covering products, movements, suppliers, alerts and reports.",
          },
        },
      },
      {
        position: 3,
        code: "RESULT",
        title: "Resultado",
        description:
          "Operação visível em um painel, menos tempo em planilha e reposição previsível.",
        translations: {
          en: {
            title: "Result",
            description:
              "A visible operation on a single dashboard with predictable restocking.",
          },
        },
      },
    ],
  },
  {
    case_number: 2,
    name: "Termo Digital",
    slug: "termo-digital",
    client: "Termo Digital",
    category: "Website",
    description:
      "Fluxo digital de termos, assinatura eletrônica e geração de PDF para serviços profissionais.",
    status: "Live",
    year: 2026,
    accent: "#c6ff00",
    tech_stack: ["JavaScript", "HTML Canvas", "PDF-lib"],
    presentation_system: "FLUXO DIGITAL / 02",
    presentation_label: "TERMO DIGITAL",
    presentation_address: "termo.spaceunderground",
    presentation_type: "WEBSITES",
    origin: "BR",
    coordinates: ["23°33' S", "46°38' W"],
    poster_url: "",
    project_url: "./termo-digital-demo/",
    preview_url: "./termo-digital-demo/",
    live_preview_enabled: true,
    cta_label: "Criar meu fluxo digital",
    cta_label_en: "Build my digital flow",
    demo_url: "./termo-digital-demo/",
    translations: {
      en: {
        description:
          "Digital terms flow with electronic signature and PDF generation for professional services.",
      },
    },
    project_gallery: [],
    project_modules: [
      {
        position: 1,
        code: "PROBLEM",
        title: "Problema",
        description:
          "Termos impressos, assinatura manual e papel acumulado em serviços que já são 100% digitais.",
        translations: {
          en: {
            title: "Problem",
            description:
              "Printed consent forms and manual signatures piling up in services that are already digital.",
          },
        },
      },
      {
        position: 2,
        code: "SOLUTION",
        title: "Solução",
        description:
          "Formulário web com assinatura por canvas, geração de PDF e entrega por e-mail ao cliente.",
        translations: {
          en: {
            title: "Solution",
            description:
              "Web form with canvas signature, PDF generation and delivery to the client via email.",
          },
        },
      },
      {
        position: 3,
        code: "RESULT",
        title: "Resultado",
        description:
          "Atendimento sem papel, histórico pesquisável e credibilidade visual no fluxo.",
        translations: {
          en: {
            title: "Result",
            description:
              "A paperless appointment, searchable history and visual credibility in the flow.",
          },
        },
      },
    ],
  },
  {
    case_number: 3,
    name: "JARVIS",
    slug: "jarvis-ai",
    client: "Space Underground Labs",
    category: "AI",
    description:
      "Agente operacional de IA com memória, voz, visão computacional e controle de computador.",
    status: "Prototype",
    year: 2026,
    accent: "#f59e0b",
    tech_stack: ["Python", "LLM", "Vision", "Voice"],
    presentation_system: "AMBIENTE OPERACIONAL / 03",
    presentation_label: "JARVIS",
    presentation_address: "jarvis.spaceunderground",
    presentation_type: "AI SYSTEMS",
    origin: "BR",
    coordinates: ["23°33' S", "46°38' W"],
    poster_url: "",
    project_url: "./jarvis-case/",
    preview_url: "./jarvis-case/",
    live_preview_enabled: true,
    cta_label: "Quero um agente assim",
    cta_label_en: "I want an agent like this",
    demo_url: "./jarvis-case/",
    translations: {
      en: {
        description:
          "Operational AI agent with memory, voice, computer vision and desktop control.",
      },
    },
    project_gallery: [],
    project_modules: [
      {
        position: 1,
        code: "PROBLEM",
        title: "Problema",
        description:
          "Automatizar tarefas reais exige um agente que entenda contexto, veja a tela e aja no sistema.",
        translations: {
          en: {
            title: "Problem",
            description:
              "Automating real tasks requires an agent that understands context, sees the screen and acts on the system.",
          },
        },
      },
      {
        position: 2,
        code: "SOLUTION",
        title: "Solução",
        description:
          "Agente modular com reflex engine, planner, visão, voz e memória persistente entre sessões.",
        translations: {
          en: {
            title: "Solution",
            description:
              "Modular agent with reflex engine, planner, vision, voice and persistent memory across sessions.",
          },
        },
      },
      {
        position: 3,
        code: "RESULT",
        title: "Resultado",
        description:
          "Protótipo em evolução contínua — mais de 100 testes passando entre reflex, visão e planejamento.",
        translations: {
          en: {
            title: "Result",
            description:
              "A continuously evolving prototype — 100+ passing tests across reflex, vision and planning.",
          },
        },
      },
    ],
  },
];

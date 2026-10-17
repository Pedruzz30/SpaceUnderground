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
    name: "StockOS",
    slug: "stockos",
    client: "Space Underground",
    category: "System",
    description:
      "Sistema web completo de estoque e operação: produtos, movimentações, fornecedores, alertas e relatórios conectados em um único painel.",
    status: "Live",
    year: 2026,
    accent: "#38bdf8",
    tech_stack: ["JavaScript", "LocalStorage", "SVG"],
    presentation_system: "BUSINESS SYSTEMS / 01",
    presentation_label: "STOCKOS",
    presentation_address: "stockos.spaceunderground",
    presentation_type: "BUSINESS SYSTEMS",
    origin: "BR",
    coordinates: ["23°33' S", "46°38' W"],
    poster_url: "",
    project_url: "./stockos-demo/",
    preview_url: "./stockos-demo/",
    live_preview_enabled: true,
    cta_label: "Quero um sistema assim",
    cta_label_en: "I want a system like this",
    demo_url: "./stockos-demo/",
    translations: {
      en: {
        description:
          "Full web system for stock and operations: products, movements, suppliers, alerts and reports in a single panel.",
      },
    },
    project_gallery: [],
    project_modules: [
      {
        position: 1,
        code: "PROBLEM",
        title: "Problema",
        description:
          "Pequenas operações controlam estoque em planilhas dispersas, com perdas, retrabalho e baixa visibilidade do que repor.",
        translations: {
          en: {
            title: "Problem",
            description:
              "Small operations rely on scattered spreadsheets, losing time and visibility of what to restock.",
          },
        },
      },
      {
        position: 2,
        code: "SOLUTION",
        title: "Solução",
        description:
          "Sistema centralizado com cadastro de produtos, movimentações auditáveis, fornecedores vinculados aos SKUs, alertas automáticos e exportação.",
        translations: {
          en: {
            title: "Solution",
            description:
              "Centralized system with product registry, auditable movements, suppliers linked to SKUs, automatic alerts and export.",
          },
        },
      },
      {
        position: 3,
        code: "FEATURES",
        title: "Recursos",
        description:
          "Dashboard de KPIs, filtros por categoria e status, CRUD completo, geração de pedidos de reposição e export CSV.",
        translations: {
          en: {
            title: "Features",
            description:
              "KPI dashboard, filters by category and status, full CRUD, auto-generated reorder requests and CSV export.",
          },
        },
      },
      {
        position: 4,
        code: "RESULT",
        title: "Resultado",
        description:
          "Operação visível em um painel, menos tempo em planilha, reposição previsível e histórico auditável de todas as movimentações.",
        translations: {
          en: {
            title: "Result",
            description:
              "A visible operation on a single dashboard, less time on spreadsheets, predictable restocking and auditable movement history.",
          },
        },
      },
    ],
  },
  {
    case_number: 2,
    name: "Underground Store",
    slug: "underground-store",
    client: "Space Underground",
    category: "Commerce",
    description:
      "Loja virtual completa: catálogo com filtros, carrinho persistente, checkout com Pix e cartão simulados e painel de pedidos.",
    status: "Live",
    year: 2026,
    accent: "#ff6ad5",
    tech_stack: ["JavaScript", "LocalStorage", "Vanilla CSS"],
    presentation_system: "COMMERCE / 01",
    presentation_label: "UNDERGROUND STORE",
    presentation_address: "store.spaceunderground",
    presentation_type: "COMMERCE",
    origin: "BR",
    coordinates: ["23°33' S", "46°38' W"],
    poster_url: "",
    project_url: "./underground-store-demo/",
    preview_url: "./underground-store-demo/",
    live_preview_enabled: true,
    cta_label: "Criar minha loja",
    cta_label_en: "Build my store",
    demo_url: "./underground-store-demo/",
    translations: {
      en: {
        description:
          "Full online store: filtered catalogue, persistent cart, checkout with simulated Pix and card and an orders panel.",
      },
    },
    project_gallery: [],
    project_modules: [
      {
        position: 1,
        code: "PROBLEM",
        title: "Problema",
        description:
          "Promessa de e-commerce raramente é provada: cliente precisa ver carrinho, checkout e pagamento rodando, não só telas estáticas.",
        translations: {
          en: {
            title: "Problem",
            description:
              "E-commerce promises are rarely proven: clients need to see cart, checkout and payment running, not just static screens.",
          },
        },
      },
      {
        position: 2,
        code: "SOLUTION",
        title: "Solução",
        description:
          "Loja ao vivo com catálogo, filtros por categoria, carrinho em localStorage, checkout com Pix (5% off) ou cartão e confirmação de pedido.",
        translations: {
          en: {
            title: "Solution",
            description:
              "Live store with catalogue, category filters, cart in localStorage, checkout with Pix (5% off) or card and order confirmation.",
          },
        },
      },
      {
        position: 3,
        code: "FEATURES",
        title: "Recursos",
        description:
          "Busca em tempo real, frete grátis acima de R$ 200, QR Code Pix simulado, timer de expiração e histórico de pedidos.",
        translations: {
          en: {
            title: "Features",
            description:
              "Real-time search, free shipping above R$ 200, simulated Pix QR code, expiry timer and order history.",
          },
        },
      },
      {
        position: 4,
        code: "RESULT",
        title: "Resultado",
        description:
          "Prova viva de capacidade comercial — cliente clica, compra e vê confirmação em um fluxo real, sem backend em produção.",
        translations: {
          en: {
            title: "Result",
            description:
              "Live proof of commerce capability — the client clicks, buys and sees confirmation in a real flow, with no production backend.",
          },
        },
      },
    ],
  },
  {
    case_number: 3,
    name: "Space Agenda",
    slug: "space-agenda",
    client: "Space Underground",
    category: "Booking",
    description:
      "Agenda online para clínicas, estética, beleza e serviços profissionais com reserva em minutos.",
    status: "Live",
    year: 2026,
    accent: "#8b5cf6",
    tech_stack: ["JavaScript", "LocalStorage", "SVG"],
    presentation_system: "BOOKING / 01",
    presentation_label: "SPACE AGENDA",
    presentation_address: "agenda.spaceunderground",
    presentation_type: "BOOKING",
    origin: "BR",
    coordinates: ["23°33' S", "46°38' W"],
    poster_url: "",
    project_url: "./space-agenda-demo/",
    preview_url: "./space-agenda-demo/",
    live_preview_enabled: true,
    cta_label: "Criar minha agenda",
    cta_label_en: "Build my booking",
    demo_url: "./space-agenda-demo/",
    translations: {
      en: {
        description:
          "Online booking for clinics, aesthetics, beauty and professional services — reservations in minutes.",
      },
    },
    project_gallery: [],
    project_modules: [
      {
        position: 1,
        code: "PROBLEM",
        title: "Problema",
        description:
          "Agendamento por WhatsApp dispersa cliente e equipe: horário conflita, no-show acontece e a operação depende da memória de alguém.",
        translations: {
          en: {
            title: "Problem",
            description:
              "Scheduling over WhatsApp scatters client and staff: slots overlap, no-shows happen and the operation depends on someone's memory.",
          },
        },
      },
      {
        position: 2,
        code: "SOLUTION",
        title: "Solução",
        description:
          "Fluxo em 4 passos: serviço, profissional, horário e pagamento. Pix com 10% off ou cartão. Lembretes, remarcação e histórico por cliente.",
        translations: {
          en: {
            title: "Solution",
            description:
              "Four-step flow: service, professional, time slot and payment. Pix with 10% off or card. Reminders, rescheduling and per-client history.",
          },
        },
      },
      {
        position: 3,
        code: "FEATURES",
        title: "Recursos",
        description:
          "Calendário de 14 dias com slots de 30min, filtros por categoria, perfil do profissional, QR Pix com timer e CTA para reagendar/cancelar.",
        translations: {
          en: {
            title: "Features",
            description:
              "14-day calendar with 30-minute slots, category filters, professional profile, Pix QR with timer and reschedule/cancel CTAs.",
          },
        },
      },
      {
        position: 4,
        code: "RESULT",
        title: "Resultado",
        description:
          "Reservas sem conflito, agenda cheia visível em tempo real e a equipe focada no atendimento em vez de administrar horários.",
        translations: {
          en: {
            title: "Result",
            description:
              "No-conflict bookings, a visible full agenda in real time and the team focused on service instead of managing time slots.",
          },
        },
      },
    ],
  },
  {
    case_number: 4,
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
    case_number: 5,
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

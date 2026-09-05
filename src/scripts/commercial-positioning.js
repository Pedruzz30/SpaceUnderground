import { plans, commercialPlan, planScopeLines } from "./plans-registry.js";

const PRODUCT_OPTIONS = [
  {
    value: "landing-page",
    index: "01",
    name: "Landing Page",
    description: "Campanha, oferta, serviço ou página de lançamento.",
    tag: "CONVERSÃO",
    budget: "R$ 800 – R$ 1.500",
    timeline: "1–3 semanas",
  },
  {
    value: "portfolio",
    index: "02",
    name: "Portfólio",
    description: "Presença digital para profissional, criador ou marca.",
    tag: "IDENTIDADE",
    budget: "R$ 1.200 – R$ 2.500",
    timeline: "2–4 semanas",
  },
  {
    value: "institutional-website",
    index: "03",
    name: "Site Institucional",
    description: "Site completo com múltiplas páginas e estrutura escalável.",
    tag: "ESTRUTURA",
    budget: "R$ 2.500 – R$ 4.500",
    timeline: "3–6 semanas",
  },
  {
    value: "e-commerce",
    index: "04",
    name: "E-commerce",
    description: "Loja virtual com catálogo, experiência de compra e conversão.",
    tag: "COMÉRCIO",
    budget: "R$ 4.000 – R$ 8.000",
    timeline: "5–9 semanas",
  },
  {
    value: "web-system",
    index: "05",
    name: "Sistema Web",
    description: "Dashboard, plataforma interna, portal ou ferramenta operacional.",
    tag: "SISTEMA",
    budget: "R$ 6.000 – R$ 12.000",
    timeline: "6–12 semanas",
  },
  {
    value: "automation",
    index: "06",
    name: "Automação / Integrações",
    description: "Processos automáticos, APIs, alertas, sincronizações e redução de trabalho manual.",
    tag: "AUTOMAÇÃO",
    budget: "A partir de R$ 5.000",
    timeline: "4–10 semanas",
  },
  {
    value: "ai-solution",
    index: "07",
    name: "IA / Assistente Inteligente",
    description: "Assistentes, agentes, voz, visão, memória ou IA integrada ao seu sistema.",
    tag: "INTELIGÊNCIA",
    budget: "Sob escopo",
    timeline: "Sob escopo",
  },
  {
    value: "other",
    index: "08",
    name: "Projeto Personalizado",
    description: "Uma necessidade que precisa de diagnóstico técnico antes de ganhar um formato.",
    tag: "CUSTOM",
    budget: "A definir",
    timeline: "A definir",
  },
];

function hydratePlanCard(planKey, basePlan) {
  const plan = commercialPlan(basePlan);
  const opener = document.querySelector(`[data-project="${basePlan.key}"]`);
  const article = opener?.closest("article.project");
  if (!opener || !article) return;

  if (plan.accent) article.style.setProperty("--accent", plan.accent);
  article.classList.toggle("project--plan-max", planKey === "max");

  const write = (selector, value, root = article) => {
    const target = root.querySelector(selector);
    if (target) target.textContent = value;
  };

  opener.setAttribute("aria-label", `Ver plano: ${plan.name}`);
  write(".visual-index", `PLANO / ${plan.id}`, opener);
  write(".plan-card__top span", "PLANO COMERCIAL", opener);
  write(".plan-card__eyebrow", "PLANO", opener);
  write(".plan-card__name", plan.name, opener);
  write(".plan-card__range", plan.range, opener);
  const footer = opener.querySelectorAll(".plan-card__footer span");
  if (footer[0]) footer[0].textContent = plan.scopeShort;
  if (footer[1]) footer[1].textContent = plan.status;
  write(".project__hover-mark", "VER", opener);

  const details = article.querySelector(".project__details");
  if (details) {
    const meta = details.querySelector(".project__meta");
    if (meta) meta.innerHTML = `PLANO COMERCIAL <span>ANO — ${plan.year}</span>`;
    write("h3", plan.name, details);
    const scope = details.querySelector(":scope > p");
    if (scope) scope.innerHTML = planScopeLines(plan).join("<br>");
    const link = details.querySelector(".text-link");
    if (link) {
      link.setAttribute("aria-label", `Ver plano: ${plan.name}`);
      write("span", "Ver Plano", link);
    }
  }
}

function hydratePlansSection() {
  const section = document.querySelector("#plans");
  const grid = section?.querySelector(".plans__grid");
  if (!section || !grid) return;

  const label = section.querySelector(".section-label");
  if (label) label.innerHTML = "<span>06</span> Planos / Contratação";
  const title = section.querySelector("#plans-title");
  if (title) title.innerHTML = "Três formas de <em>começar.</em>";
  const intro = section.querySelector(".section-intro");
  if (intro) intro.textContent = "Faixas de investimento por nível de projeto. O escopo final, prazo e proposta são definidos antes do início do desenvolvimento.";

  Object.entries(plans).forEach(([key, plan]) => hydratePlanCard(key, plan));

  if (!section.querySelector(".plans__commercial-note")) {
    const note = document.createElement("div");
    note.className = "plans__commercial-note reveal";
    note.dataset.reveal = "";
    note.innerHTML = `
      <div>
        <span>MAX / SOFTWARE SOB MEDIDA</span>
        <strong>Seu projeto precisa ir além de um site?</strong>
      </div>
      <p>O Max cobre sistemas web, automações, integrações e soluções com IA. Projetos partem de R$ 5.000 e recebem orçamento conforme arquitetura, integrações e nível de inteligência necessário.</p>
      <a class="text-link" href="#project-request"><span>Solicitar uma proposta</span><i aria-hidden="true"></i></a>
    `;
    grid.after(note);
  }
}

function productButton(option) {
  return `
    <button class="product-option" type="button" data-product-option data-value="${option.value}" data-budget="${option.budget}" data-timeline="${option.timeline}" aria-pressed="false">
      <span class="product-option__index">${option.index}</span>
      <strong>${option.name}</strong>
      <small>${option.description}</small>
      <i>${option.tag}</i>
    </button>
  `;
}

function hydrateProjectForm() {
  const form = document.querySelector("#project-request");
  if (!form) return;

  const select = form.querySelector("#project-need");
  if (select) {
    select.innerHTML = `
      <option value="">Selecione uma opção</option>
      ${PRODUCT_OPTIONS.map((option) => `<option value="${option.value}">${option.name}</option>`).join("")}
    `;
  }

  const picker = form.querySelector("[data-product-picker]");
  const options = picker?.querySelector(".product-options");
  if (options) options.innerHTML = PRODUCT_OPTIONS.map(productButton).join("");

  const pickerHeader = picker?.querySelector(".product-picker__header p");
  if (pickerHeader) pickerHeader.textContent = "Escolha o tipo de projeto";
  const count = picker?.querySelector("[data-product-count]");
  if (count) count.textContent = `00 / ${String(PRODUCT_OPTIONS.length).padStart(2, "0")}`;

  const summary = picker?.querySelector("[data-product-summary]");
  if (summary) {
    const kicker = summary.querySelector("span");
    const title = summary.querySelector("strong");
    const text = summary.querySelector("[data-product-summary-text]");
    if (kicker) kicker.textContent = "NENHUM PROJETO SELECIONADO";
    if (title) title.textContent = "Escolha um tipo de projeto para calibrar a solicitação.";
    if (text) text.textContent = "Faixa de investimento e prazo estimado aparecerão aqui. Você ainda poderá editar os campos manualmente.";
  }

  const budgetField = form.querySelector("#project-budget");
  const budgetWrapper = budgetField?.closest(".form-field");
  const budgetLabel = budgetWrapper?.querySelector("label");
  if (budgetLabel) budgetLabel.textContent = "Investimento estimado";
  if (budgetField) budgetField.placeholder = "Exemplo: R$ 6.000 – R$ 12.000";
  const budgetOptions = budgetWrapper?.querySelector(".field-options");
  if (budgetOptions) {
    const values = [
      "R$ 800 – R$ 1.500",
      "R$ 1.200 – R$ 2.500",
      "R$ 2.500 – R$ 4.500",
      "R$ 4.000 – R$ 8.000",
      "R$ 6.000 – R$ 12.000",
      "A partir de R$ 5.000",
      "Sob escopo",
      "A definir",
    ];
    budgetOptions.innerHTML = values.map((value) => `<button type="button" data-budget-choice="${value}">${value.toUpperCase()}</button>`).join("");
    budgetOptions.setAttribute("aria-label", "Faixas de investimento");
  }

  const timelineField = form.querySelector("#project-timeline");
  const timelineWrapper = timelineField?.closest(".form-field");
  const timelineLabel = timelineWrapper?.querySelector("label");
  if (timelineLabel) timelineLabel.textContent = "Prazo desejado";
  if (timelineField) timelineField.placeholder = "Exemplo: 6–12 semanas";
  const timelineOptions = timelineWrapper?.querySelector(".field-options");
  if (timelineOptions) {
    const values = ["1–3 semanas", "2–4 semanas", "3–6 semanas", "4–10 semanas", "5–9 semanas", "6–12 semanas", "Sob escopo", "A definir"];
    timelineOptions.innerHTML = values.map((value) => `<button type="button" data-timeline-choice="${value}">${value.toUpperCase()}</button>`).join("");
    timelineOptions.setAttribute("aria-label", "Opções de prazo");
  }
}

export function initCommercialPositioning() {
  hydratePlansSection();
  hydrateProjectForm();
}

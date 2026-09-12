import { plans, commercialPlan } from "./plans-registry.js";
import { fetchVisiblePlans, isConfigured } from "./supabase-public.js";
import { getLocale, subscribeLocaleChange, t } from "./i18n/index.js";

let localeSubscribed = false;
let loadedPlanRows = [];

const PRODUCT_OPTIONS = {
  "pt-BR": [
    ["landing-page", "01", "Landing Page", "Campanha, oferta, serviço ou página de lançamento.", "CONVERSÃO", "R$ 800 – R$ 1.500", "1–3 semanas"],
    ["portfolio", "02", "Portfólio", "Presença digital para profissional, criador ou marca.", "IDENTIDADE", "R$ 1.200 – R$ 2.500", "2–4 semanas"],
    ["institutional-website", "03", "Site Institucional", "Site completo com múltiplas páginas e estrutura escalável.", "ESTRUTURA", "R$ 2.500 – R$ 4.500", "3–6 semanas"],
    ["e-commerce", "04", "E-commerce", "Loja virtual com catálogo, experiência de compra e conversão.", "COMÉRCIO", "R$ 4.000 – R$ 8.000", "5–9 semanas"],
    ["web-system", "05", "Sistema Web", "Dashboard, plataforma interna, portal ou ferramenta operacional.", "SISTEMA", "R$ 6.000 – R$ 12.000", "6–12 semanas"],
    ["automation", "06", "Automação / Integrações", "Processos automáticos, APIs, alertas, sincronizações e redução de trabalho manual.", "AUTOMAÇÃO", "A partir de R$ 5.000", "4–10 semanas"],
    ["ai-solution", "07", "IA / Assistente Inteligente", "Assistentes, agentes, voz, visão, memória ou IA integrada ao seu sistema.", "INTELIGÊNCIA", "Sob escopo", "Sob escopo"],
    ["other", "08", "Projeto Personalizado", "Uma necessidade que precisa de diagnóstico técnico antes de ganhar um formato.", "PERSONALIZADO", "A definir", "A definir"],
  ],
  en: [
    ["landing-page", "01", "Landing Page", "Campaign, offer, service or launch page.", "CONVERSION", "R$ 800 – R$ 1,500", "1–3 weeks"],
    ["portfolio", "02", "Portfolio", "Digital presence for a professional, creator or brand.", "IDENTITY", "R$ 1,200 – R$ 2,500", "2–4 weeks"],
    ["institutional-website", "03", "Institutional Website", "A full website with multiple pages and a scalable structure.", "STRUCTURE", "R$ 2,500 – R$ 4,500", "3–6 weeks"],
    ["e-commerce", "04", "E-commerce", "Online store with catalog, buying experience and conversion.", "COMMERCE", "R$ 4,000 – R$ 8,000", "5–9 weeks"],
    ["web-system", "05", "Web System", "Dashboard, internal platform, portal or operational tool.", "SYSTEM", "R$ 6,000 – R$ 12,000", "6–12 weeks"],
    ["automation", "06", "Automation / Integrations", "Automated processes, APIs, alerts, syncs and less manual work.", "AUTOMATION", "From R$ 5,000", "4–10 weeks"],
    ["ai-solution", "07", "AI / Intelligent Assistant", "Assistants, agents, voice, vision, memory or AI integrated into your system.", "INTELLIGENCE", "Scoped", "Scoped"],
    ["other", "08", "Custom Project", "A need that deserves technical diagnosis before it becomes a format.", "CUSTOM", "To define", "To define"],
  ],
};

function productOptions() {
  return (PRODUCT_OPTIONS[getLocale()] || PRODUCT_OPTIONS["pt-BR"]).map(([value, index, name, description, tag, budget, timeline]) => ({
    value,
    index,
    name,
    description,
    tag,
    budget,
    timeline,
  }));
}

function localized(row, field) {
  const translated = row?.translations?.[getLocale()]?.[field];
  return translated || row?.[field];
}

const scopeLines = (plan) => [
  t("commercial.scope", { value: plan.scope }),
  t("commercial.investment", { value: plan.range }),
  t("commercial.status", { value: plan.status }),
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

  opener.setAttribute("aria-label", t("commercial.selectedPlan", { name: plan.name }));
  write(".visual-index", t("commercial.planIndex", { id: plan.id }), opener);
  write(".plan-card__top span", t("commercial.commercialPlan"), opener);
  write(".plan-card__eyebrow", t("commercial.plan"), opener);
  write(".plan-card__name", plan.name, opener);
  write(".plan-card__range", plan.range, opener);
  const footer = opener.querySelectorAll(".plan-card__footer span");
  if (footer[0]) footer[0].textContent = plan.scopeShort;
  if (footer[1]) footer[1].textContent = plan.status;
  write(".project__hover-mark", t("commercial.view"), opener);

  const details = article.querySelector(".project__details");
  if (details) {
    const meta = details.querySelector(".project__meta");
    if (meta) meta.innerHTML = `${t("commercial.commercialPlan")} <span>${t("commercial.year", { year: plan.year })}</span>`;
    write("h3", plan.name, details);
    const scope = details.querySelector(":scope > p");
    if (scope) scope.innerHTML = scopeLines(plan).join("<br>");
    const link = details.querySelector(".text-link");
    if (link) {
      link.setAttribute("aria-label", t("commercial.selectedPlan", { name: plan.name }));
      write("span", t("commercial.viewPlan"), link);
    }
  }
}

function hydratePlansSection() {
  const section = document.querySelector("#plans");
  const grid = section?.querySelector(".plans__grid");
  if (!section || !grid) return;

  const label = section.querySelector(".section-label");
  if (label) label.innerHTML = t("commercial.plansLabel");
  const title = section.querySelector("#plans-title");
  if (title) title.innerHTML = t("commercial.plansTitle");
  const intro = section.querySelector(".section-intro");
  if (intro) intro.textContent = t("commercial.plansIntro");

  loadedPlanRows.forEach(applyPlanRow);
  Object.entries(plans).forEach(([key, plan]) => hydratePlanCard(key, plan));

  if (!section.querySelector(".plans__commercial-note")) {
    const note = document.createElement("div");
    note.className = "plans__commercial-note reveal";
    note.dataset.reveal = "";
    note.innerHTML = `
      <div>
        <span></span>
        <strong></strong>
      </div>
      <p></p>
      <a class="text-link" href="#project-request"><span></span><i aria-hidden="true"></i></a>
    `;
    grid.after(note);
  }

  const note = section.querySelector(".plans__commercial-note");
  const noteKicker = note?.querySelector("span");
  const noteTitle = note?.querySelector("strong");
  const noteText = note?.querySelector("p");
  const noteLink = note?.querySelector(".text-link span");
  if (noteKicker) noteKicker.textContent = t("commercial.customKicker");
  if (noteTitle) noteTitle.textContent = t("commercial.customTitle");
  if (noteText) noteText.textContent = t("commercial.customText");
  if (noteLink) noteLink.textContent = t("commercial.requestProposal");
}

function applyPlanRow(row) {
  const key = String(row.slug || "").replace(/^plan-/, "");
  const plan = plans[key];
  if (!plan) return;

  const included = Array.isArray(row.plan_features)
    ? [...row.plan_features]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((feature) => localized(feature, "text"))
        .filter(Boolean)
    : plan.included;

  Object.assign(plan, {
    name: localized(row, "name") || plan.name,
    monogram: row.monogram || plan.monogram,
    category: localized(row, "category") || plan.category,
    range: localized(row, "range") || plan.range,
    scope: localized(row, "scope") || plan.scope,
    scopeShort: localized(row, "scope_short") || plan.scopeShort,
    status: localized(row, "status") || plan.status,
    description: localized(row, "description") || plan.description,
    included,
    timeline: row.timeline || plan.timeline,
    year: row.year ? String(row.year) : plan.year,
    accent: row.accent || plan.accent,
    commercial: {
      ...(plan.commercial || {}),
      category: localized(row, "category") || plan.commercial?.category || plan.category,
      range: localized(row, "range") || plan.commercial?.range || plan.range,
      scope: localized(row, "scope") || plan.commercial?.scope || plan.scope,
      scopeShort: localized(row, "scope_short") || plan.commercial?.scopeShort || plan.scopeShort,
      status: localized(row, "status") || plan.commercial?.status || plan.status,
      description: localized(row, "description") || plan.commercial?.description || plan.description,
      included,
      timeline: row.timeline || plan.commercial?.timeline || plan.timeline,
      accent: row.accent || plan.commercial?.accent,
    },
  });
}

async function hydratePlansFromSupabase() {
  if (!isConfigured()) return;
  try {
    const rows = await fetchVisiblePlans();
    loadedPlanRows = rows;
    loadedPlanRows.forEach(applyPlanRow);
    hydratePlansSection();
  } catch (error) {
    console.warn("[plans] Supabase unavailable, keeping bundled plan copy.", error);
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
  const optionsData = productOptions();

  const select = form.querySelector("#project-need");
  if (select) {
    select.innerHTML = `
      <option value="">${t("commercial.selectPlaceholder")}</option>
      ${optionsData.map((option) => `<option value="${option.value}">${option.name}</option>`).join("")}
    `;
  }

  const picker = form.querySelector("[data-product-picker]");
  const options = picker?.querySelector(".product-options");
  if (options) options.innerHTML = optionsData.map(productButton).join("");

  const pickerHeader = picker?.querySelector(".product-picker__header p");
  if (pickerHeader) pickerHeader.textContent = t("commercial.pickerTitle");
  const count = picker?.querySelector("[data-product-count]");
  if (count) count.textContent = `00 / ${String(optionsData.length).padStart(2, "0")}`;

  const summary = picker?.querySelector("[data-product-summary]");
  if (summary) {
    const kicker = summary.querySelector("span");
    const title = summary.querySelector("strong");
    const text = summary.querySelector("[data-product-summary-text]");
    if (kicker) kicker.textContent = t("commercial.noProjectSelected");
    if (title) title.textContent = t("commercial.summaryTitle");
    if (text) text.textContent = t("commercial.summaryText");
  }

  const budgetField = form.querySelector("#project-budget");
  const budgetWrapper = budgetField?.closest(".form-field");
  const budgetLabel = budgetWrapper?.querySelector("label");
  if (budgetLabel) budgetLabel.textContent = t("commercial.budgetLabel");
  if (budgetField) budgetField.placeholder = t("commercial.budgetPlaceholder");
  const budgetOptions = budgetWrapper?.querySelector(".field-options");
  if (budgetOptions) {
    const values = [...new Set(optionsData.map((option) => option.budget))];
    budgetOptions.innerHTML = values.map((value) => `<button type="button" data-budget-choice="${value}">${value.toUpperCase()}</button>`).join("");
    budgetOptions.setAttribute("aria-label", t("commercial.budgetOptions"));
  }

  const timelineField = form.querySelector("#project-timeline");
  const timelineWrapper = timelineField?.closest(".form-field");
  const timelineLabel = timelineWrapper?.querySelector("label");
  if (timelineLabel) timelineLabel.textContent = t("commercial.timelineLabel");
  if (timelineField) timelineField.placeholder = t("commercial.timelinePlaceholder");
  const timelineOptions = timelineWrapper?.querySelector(".field-options");
  if (timelineOptions) {
    const values = [...new Set(optionsData.map((option) => option.timeline))];
    timelineOptions.innerHTML = values.map((value) => `<button type="button" data-timeline-choice="${value}">${value.toUpperCase()}</button>`).join("");
    timelineOptions.setAttribute("aria-label", t("commercial.timelineOptions"));
  }
}

export function initCommercialPositioning() {
  if (!localeSubscribed) {
    localeSubscribed = true;
    subscribeLocaleChange(() => {
      hydratePlansSection();
      hydrateProjectForm();
    });
  }
  hydratePlansSection();
  hydratePlansFromSupabase();
  hydrateProjectForm();
}

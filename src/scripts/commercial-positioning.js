import { fetchVisiblePlans, isConfigured } from "./supabase-public.js";
import { getLocale, subscribeLocaleChange, t } from "./i18n/index.js";
import { listPublicPlans, planRowToViewModel, refreshPublicPlansForLocale, resetPublicPlansToFallback, setPublicPlanRows } from "./public-plan-store.js";
import { observeReveal } from "./reveal.js";

export function localizePlanRow(row, basePlan = {}, locale = "pt-BR") {
  return planRowToViewModel({ ...basePlan, ...row }, 0, locale);
}

let localeSubscribed = false;

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

const scopeLines = (plan) => [
  t("commercial.scope", { value: plan.scope }),
  t("commercial.investment", { value: plan.range }),
  t("commercial.status", { value: plan.statusLabel }),
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPlanCard(plan) {
  const label = t("commercial.selectedPlan", { name: plan.name });
  const scope = scopeLines(plan).map(escapeHtml).join("<br>");
  return `
    <article class="project project--compact reveal${plan.slug === "plan-max" ? " project--plan-max" : ""}" data-reveal style="--accent:${escapeHtml(plan.accent || "#c6ff00")}">
      <a class="project__visual project__visual--plan" href="#project-preview" data-project="${escapeHtml(plan.key)}" aria-label="${escapeHtml(label)}">
        <div class="visual-index">${escapeHtml(t("commercial.planIndex", { id: plan.id }))}</div>
        <div class="plan-card" aria-hidden="true">
          <div class="plan-card__top"><span>${escapeHtml(t("commercial.commercialPlan"))}</span><strong>${escapeHtml(plan.monogram)}</strong></div>
          <div class="plan-card__body">
            <span class="plan-card__eyebrow">${escapeHtml(t("commercial.plan"))}</span>
            <strong class="plan-card__name">${escapeHtml(plan.name)}</strong>
            <span class="plan-card__range">${escapeHtml(plan.range)}</span>
          </div>
          <div class="plan-card__footer"><span>${escapeHtml(plan.scopeShort)}</span><span>${escapeHtml(plan.statusLabel)}</span></div>
        </div>
        <span class="project__hover-mark" aria-hidden="true">${escapeHtml(t("commercial.view"))}</span>
      </a>
      <div class="project__details project__details--stacked">
        <div>
          <p class="project__meta">${escapeHtml(t("commercial.commercialPlan"))} <span>${escapeHtml(t("commercial.year", { year: plan.year }))}</span></p>
          <h3>${escapeHtml(plan.name)}</h3>
        </div>
        <p>${scope}</p>
        <a class="text-link" href="#project-preview" data-project="${escapeHtml(plan.key)}" aria-label="${escapeHtml(label)}"><span>${escapeHtml(t("commercial.viewPlan"))}</span><i aria-hidden="true"></i></a>
      </div>
    </article>
  `;
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

  grid.innerHTML = listPublicPlans().map(renderPlanCard).join("");
  observeReveal(grid);

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
    observeReveal(note);
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

async function hydratePlansFromSupabase() {
  if (!isConfigured()) return;
  try {
    const rows = await fetchVisiblePlans();
    setPublicPlanRows(rows, getLocale());
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
    // Rebuilding the options discards the select's value, which would silently
    // clear the visitor's chosen project type on a locale change. Captured and
    // restored so project-form can re-apply the selection afterwards.
    const chosen = select.value;
    select.innerHTML = `
      <option value="">${t("commercial.selectPlaceholder")}</option>
      ${optionsData.map((option) => `<option value="${option.value}">${option.name}</option>`).join("")}
    `;
    select.value = chosen;
  }

  const picker = form.querySelector("[data-product-picker]");
  const options = picker?.querySelector(".product-options");
  if (options) options.innerHTML = optionsData.map(productButton).join("");

  const pickerHeader = picker?.querySelector(".product-picker__header p");
  if (pickerHeader) pickerHeader.textContent = t("commercial.pickerTitle");

  // The count and summary describe the current selection, so they are only
  // reset when nothing is selected. project-form fills them in otherwise.
  const hasSelection = Boolean(select?.value);
  const count = picker?.querySelector("[data-product-count]");
  if (count && !hasSelection) count.textContent = `00 / ${String(optionsData.length).padStart(2, "0")}`;

  const summary = picker?.querySelector("[data-product-summary]");
  if (summary && !hasSelection) {
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
      refreshPublicPlansForLocale(getLocale());
      hydratePlansSection();
      hydrateProjectForm();
    });
  }
  resetPublicPlansToFallback(getLocale());
  hydratePlansSection();
  hydratePlansFromSupabase();
  hydrateProjectForm();
}

import { confirmModal, openModal } from "../components/modal.js";
import { bindRowMenus, closeRowMenus } from "../components/row-menu.js";
import { bindTabs } from "../components/tabs.js";
import { showToast } from "../components/toast.js";
import { getLocale, onLocaleChange, plural, t } from "../i18n/index.js";
import { getClients } from "../services/client-service.js";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunities,
  loseOpportunity,
  moveOpportunity,
  newOpportunityDefaults,
  reopenOpportunity,
  reorderOpportunity,
  sanitizeOpportunity,
  updateOpportunity,
  validateOpportunity,
  winOpportunity,
} from "../services/commercial-service.js";
import { describeError } from "../services/errors.js";
import { getPlans } from "../services/plan-service.js";
import {
  averageDaysToWin,
  CLOSED_STAGES,
  closedDay,
  daysInStage,
  displayName,
  isActionOverdue,
  isStale,
  LOST_REASONS,
  lostReasons,
  OPEN_STAGES,
  pipelineSummary,
  positionBetween,
  renumberColumn,
  PRIORITIES,
  sortForBoard,
  SOURCES,
  stageTotals,
  wonBySource,
} from "../utils/commercial-metrics.js";
import { csvCell, csvNumber, csvText, downloadCsv } from "../utils/csv.js";
import { FINANCIAL_PERIODS, parseAmount, periodRange, todayKey } from "../utils/financial-metrics.js";
import { formatCurrency } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const DEFAULT_PERIOD = "this_month";

/* ------------------------------------------------------------ helpers */

function formatDay(key) {
  if (!key) return "—";
  return new Intl.DateTimeFormat(getLocale(), { day: "2-digit", month: "short" }).format(new Date(`${key}T00:00:00`)).replace(".", "");
}

function percent(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(getLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function optionList(options, selected) {
  return options
    .map(([value, label]) => `<option value="${escapeAttribute(value)}"${String(value) === String(selected ?? "") ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

const stageLabel = (stage) => t(`commercial.stages.${stage}`);

function matchesQuery(deal, query) {
  if (!query) return true;
  return [deal.title, deal.clientName, deal.company, deal.contactName, deal.email, deal.nextAction, deal.planName]
    .some((value) => String(value || "").toLowerCase().includes(query));
}

// Closed columns only show what closed inside the period; open columns show
// everything still being worked.
function onBoard(deal, range) {
  if (!CLOSED_STAGES.includes(deal.stage)) return true;
  const [from, to] = range;
  const day = closedDay(deal);
  if (!from && !to) return true;
  return Boolean(day) && (!from || day >= from) && (!to || day <= to);
}

/* ------------------------------------------------------------- metrics */

function metricsMarkup(deals, range, now) {
  const summary = pipelineSummary(deals, range, now);
  const metrics = [
    ["commercial.metricOpenValue", formatCurrency(summary.openValue), ""],
    ["commercial.metricForecast", formatCurrency(summary.forecast), ""],
    ["commercial.metricOpenCount", String(summary.openCount), ""],
    ["commercial.metricWon", formatCurrency(summary.wonValue), ""],
    ["commercial.metricConversion", percent(summary.conversion), ""],
    ["commercial.metricOverdue", String(summary.overdueActions), summary.overdueActions ? "is-warn" : ""],
  ];
  return metrics
    .map(
      ([key, value, tone]) => `
        <div class="project-metric${tone ? ` ${tone}` : ""}">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(t(key))}</span>
        </div>
      `,
    )
    .join("");
}

/* --------------------------------------------------------------- board */

function priorityBadge(priority) {
  const tone = { HIGH: "danger", MEDIUM: "neutral", LOW: "muted" }[priority];
  return `<span class="badge badge--${tone}">${escapeHtml(t(`commercial.priorities.${priority}`).toUpperCase())}</span>`;
}

function cardFooter(deal, now) {
  if (deal.stage === "WON") return `<span class="deal-card__note">${escapeHtml(t("commercial.wonOn", { date: formatDay(closedDay(deal)) }))}</span>`;
  if (deal.stage === "LOST") {
    return `<span class="deal-card__note">${escapeHtml(t("commercial.lostBecause", { reason: t(`commercial.lostReasons.${deal.lostReason || "OTHER"}`) }))}</span>`;
  }
  const parts = [];
  if (deal.nextAction || deal.nextActionAt) {
    const overdue = isActionOverdue(deal, now);
    const date = deal.nextActionAt === todayKey(now) ? t("commercial.today") : formatDay(deal.nextActionAt);
    const text = deal.nextActionAt ? t("commercial.nextActionOn", { action: deal.nextAction || "—", date }) : deal.nextAction;
    parts.push(`
      <span class="deal-card__action${overdue ? " is-overdue" : ""}">
        <i aria-hidden="true">→</i>
        <span>${escapeHtml(text)}</span>
        ${overdue ? `<b>${escapeHtml(t("commercial.actionOverdue"))}</b>` : ""}
      </span>
    `);
  }
  const days = daysInStage(deal, now);
  if (days !== null) {
    parts.push(`<span class="deal-card__age${isStale(deal, now) ? " is-stale" : ""}">${escapeHtml(plural("commercial.daysInStage", days))}</span>`);
  }
  return parts.join("");
}

function menuMarkup(deal) {
  const open = OPEN_STAGES.includes(deal.stage);
  const moves = open
    ? OPEN_STAGES.filter((stage) => stage !== deal.stage)
        .map((stage) => `<button type="button" role="menuitem" data-com-action="move" data-stage="${stage}" data-id="${escapeAttribute(deal.id)}">${escapeHtml(t("commercial.moveTo", { stage: stageLabel(stage) }))}</button>`)
        .join("")
    : "";
  return `
    <span class="row-menu" data-row-menu>
      <button class="button button--compact row-menu__toggle" type="button" data-row-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="${escapeAttribute(t("commercial.actions"))}">⋯</button>
      <span class="row-menu__panel" role="menu" hidden>
        <button type="button" role="menuitem" data-com-action="edit" data-id="${escapeAttribute(deal.id)}">${escapeHtml(t("commercial.edit"))}</button>
        ${moves}
        ${
          open
            ? `<button type="button" role="menuitem" class="row-menu__success" data-com-action="win" data-id="${escapeAttribute(deal.id)}">${escapeHtml(t("commercial.markWon"))}</button>
               <button type="button" role="menuitem" data-com-action="lose" data-id="${escapeAttribute(deal.id)}">${escapeHtml(t("commercial.markLost"))}</button>`
            : `${
                deal.stage === "WON"
                  ? `<button type="button" role="menuitem" data-com-action="complete" data-id="${escapeAttribute(deal.id)}">${escapeHtml(t("commercial.completeWin"))}</button>`
                  : ""
              }<button type="button" role="menuitem" data-com-action="reopen" data-id="${escapeAttribute(deal.id)}">${escapeHtml(t("commercial.reopen"))}</button>`
        }
        ${deal.clientId ? `<a role="menuitem" href="#/clients/${encodeURIComponent(deal.clientId)}">${escapeHtml(t("commercial.openClient"))}</a>` : ""}
        <button type="button" role="menuitem" class="row-menu__danger" data-com-action="delete" data-id="${escapeAttribute(deal.id)}">${escapeHtml(t("commercial.delete"))}</button>
      </span>
    </span>
  `;
}

function cardMarkup(deal, now) {
  const who = displayName(deal);
  const showWho = who && who !== deal.title;
  return `
    <article class="deal-card deal-card--${deal.stage.toLowerCase()}${isActionOverdue(deal, now) ? " is-overdue" : ""}" draggable="${OPEN_STAGES.includes(deal.stage)}" tabindex="0" data-opportunity-id="${escapeAttribute(deal.id)}" data-stage="${deal.stage}" aria-label="${escapeAttribute(`${deal.title}${showWho ? `, ${who}` : ""}`)}">
      <header class="deal-card__top">
        ${priorityBadge(deal.priority)}
        <span class="deal-card__source">${escapeHtml(t(`commercial.sources.${deal.source}`))}</span>
        ${menuMarkup(deal)}
      </header>
      <strong class="deal-card__title">${escapeHtml(deal.title)}</strong>
      ${showWho ? `<span class="deal-card__who">${escapeHtml(who)}</span>` : ""}
      <span class="deal-card__value${deal.estimatedValue === null ? " is-empty" : ""}">
        ${escapeHtml(deal.estimatedValue === null ? t("commercial.noValue") : formatCurrency(deal.estimatedValue))}
        ${deal.planName ? `<small>${escapeHtml(deal.planName)}</small>` : ""}
      </span>
      <footer class="deal-card__foot">${cardFooter(deal, now)}</footer>
    </article>
  `;
}

function columnMarkup(stage, deals, totals, now) {
  const cards = sortForBoard(deals.filter((deal) => deal.stage === stage));
  const total = totals.get(stage);
  return `
      <section class="deal-column deal-column--${stage.toLowerCase()}" data-stage-column="${stage}" aria-label="${escapeAttribute(stageLabel(stage))}">
        <header class="deal-column__head">
          <h3>${escapeHtml(stageLabel(stage))}</h3>
          <span class="deal-column__count">${escapeHtml(total.count)}</span>
          <span class="deal-column__value">${escapeHtml(formatCurrency(total.value))}</span>
        </header>
        <div class="deal-column__body" data-stage-drop="${stage}">
          ${cards.length ? cards.map((deal) => cardMarkup(deal, now)).join("") : `<p class="deal-column__empty">${escapeHtml(t("commercial.emptyStage"))}</p>`}
        </div>
      </section>
    `;
}

// The four open stages share the full width; closed deals sit below, so the
// columns people work in are never pushed off screen by the ones they don't.
function boardMarkup(deals, now) {
  const totals = new Map(stageTotals(deals).map((item) => [item.stage, item]));
  return `
    <div class="deal-board">
      ${OPEN_STAGES.map((stage) => columnMarkup(stage, deals, totals, now)).join("")}
    </div>
    <div class="deal-closed">
      <h3 class="deal-closed__title">${escapeHtml(t("commercial.closedInPeriod"))}</h3>
      <div class="deal-closed__grid">
        ${CLOSED_STAGES.map((stage) => columnMarkup(stage, deals, totals, now)).join("")}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------- reports */

function barList(rows, emptyMessage) {
  if (!rows.length) return `<p class="empty-inline">${escapeHtml(emptyMessage)}</p>`;
  const max = Math.max(...rows.map((row) => row.measure), 1);
  return `
    <ul class="fin-bars">
      ${rows
        .map(
          (row) => `
            <li>
              <span class="fin-bars__label">${escapeHtml(row.label)}</span>
              <span class="fin-bars__track" aria-hidden="true"><b style="width:${Math.max(2, Math.round((row.measure / max) * 100))}%"></b></span>
              <span class="fin-bars__value">${escapeHtml(row.value)}<small>${escapeHtml(row.note ?? "")}</small></span>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function reportsMarkup(deals, range, now) {
  const summary = pipelineSummary(deals, range, now);
  const totals = stageTotals(deals);
  const funnel = [...OPEN_STAGES, "WON"].map((stage) => {
    const item = stage === "WON" ? { count: summary.wonCount, value: summary.wonValue } : totals.find((row) => row.stage === stage);
    return {
      label: stageLabel(stage),
      measure: item.count,
      value: plural("commercial.dealCount", item.count),
      note: formatCurrency(item.value),
    };
  });
  const lost = lostReasons(deals, range).map((row) => ({
    label: t(`commercial.lostReasons.${row.reason}`),
    measure: row.count,
    value: plural("commercial.dealCount", row.count),
    note: t("commercial.shareOfTotal", { percent: percent(row.share) }),
  }));
  const sources = wonBySource(deals, range).map((row) => ({
    label: t(`commercial.sources.${row.source}`),
    measure: row.value,
    value: formatCurrency(row.value),
    note: plural("commercial.dealCount", row.count),
  }));
  const days = averageDaysToWin(deals, range);
  const figures = [
    ["commercial.resultWon", String(summary.wonCount)],
    ["commercial.resultLost", String(summary.lostCount)],
    ["commercial.metricConversion", percent(summary.conversion)],
    ["commercial.resultAverage", summary.averageWon === null ? "—" : formatCurrency(summary.averageWon)],
    ["commercial.resultDays", days === null ? "—" : t("commercial.resultDaysValue", { count: days })],
  ];

  return `
    <article class="panel fin-report">
      <header class="panel__head"><div><span>${escapeHtml(t("commercial.reportFunnelSub"))}</span><h3>${escapeHtml(t("commercial.reportFunnel"))}</h3></div></header>
      ${barList(funnel, t("commercial.empty"))}
    </article>
    <article class="panel fin-report">
      <header class="panel__head"><div><span>${escapeHtml(t("commercial.reportResultsSub"))}</span><h3>${escapeHtml(t("commercial.reportResults"))}</h3></div></header>
      <div class="com-figures">
        ${figures.map(([key, value]) => `<div><span>${escapeHtml(t(key))}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      </div>
    </article>
    <article class="panel fin-report">
      <header class="panel__head"><div><span>${escapeHtml(t("commercial.reportLostSub"))}</span><h3>${escapeHtml(t("commercial.reportLost"))}</h3></div></header>
      ${barList(lost, t("commercial.reportEmptyLost"))}
    </article>
    <article class="panel fin-report">
      <header class="panel__head"><div><span>${escapeHtml(t("commercial.reportSourcesSub"))}</span><h3>${escapeHtml(t("commercial.reportSources"))}</h3></div></header>
      ${barList(sources, t("commercial.reportEmptySources"))}
    </article>
  `;
}

/* ---------------------------------------------------------------- forms */

function fieldError(name) {
  return `<p class="field-error" data-error-for="${name}" hidden></p>`;
}

function field({ name, labelKey, value = "", type = "text", wide = false, attrs = "", hintKey = "", placeholderKey = "" }) {
  return `
    <div class="field${wide ? " field--wide" : ""}">
      <label for="com-${name}">${escapeHtml(t(labelKey))}</label>
      <input id="com-${name}" name="${name}" type="${type}" value="${escapeAttribute(value ?? "")}"${placeholderKey ? ` placeholder="${escapeAttribute(t(placeholderKey))}"` : ""} ${attrs}>
      ${hintKey ? `<p class="field-hint">${escapeHtml(t(hintKey))}</p>` : ""}
      ${fieldError(name)}
    </div>
  `;
}

function selectField({ name, labelKey, options, selected }) {
  return `
    <div class="field">
      <label for="com-${name}">${escapeHtml(t(labelKey))}</label>
      <select id="com-${name}" name="${name}">${optionList(options, selected)}</select>
      ${fieldError(name)}
    </div>
  `;
}

function formMarkup(values, { clients, plans, isCreate }) {
  // Closing happens through its own dialog; the form only moves between open
  // stages, or keeps a closed deal where it is.
  const stages = OPEN_STAGES.includes(values.stage) || isCreate ? OPEN_STAGES : [values.stage];
  const amount = values.estimatedValue === null || values.estimatedValue === "" || values.estimatedValue === undefined
    ? ""
    : String(values.estimatedValue).replace(".", getLocale() === "pt-BR" ? "," : ".");
  return `
    <form class="com-form" data-com-form novalidate>
      <div class="form-grid">
        ${field({ name: "title", labelKey: "commercial.fieldTitle", value: values.title, wide: true, attrs: 'maxlength="160" required', placeholderKey: "commercial.fieldTitlePlaceholder" })}
        ${selectField({ name: "stage", labelKey: "commercial.fieldStage", options: stages.map((stage) => [stage, stageLabel(stage)]), selected: values.stage })}
        ${selectField({ name: "priority", labelKey: "commercial.fieldPriority", options: PRIORITIES.map((priority) => [priority, t(`commercial.priorities.${priority}`)]), selected: values.priority })}
        ${selectField({ name: "clientId", labelKey: "commercial.fieldClient", options: [["", t("commercial.noClient")], ...clients.map((client) => [client.id, client.name])], selected: values.clientId })}
        ${selectField({ name: "source", labelKey: "commercial.fieldSource", options: SOURCES.map((source) => [source, t(`commercial.sources.${source}`)]), selected: values.source })}
      </div>
      <fieldset class="com-contact" data-contact-fields ${values.clientId ? "hidden" : ""}>
        <p class="field-hint">${escapeHtml(t("commercial.contactHint"))}</p>
        <div class="form-grid">
          ${field({ name: "contactName", labelKey: "commercial.fieldContactName", value: values.contactName, attrs: 'maxlength="120" autocomplete="off"' })}
          ${field({ name: "company", labelKey: "commercial.fieldCompany", value: values.company, attrs: 'maxlength="120" autocomplete="off"' })}
          ${field({ name: "email", labelKey: "commercial.fieldEmail", value: values.email, type: "email", attrs: 'maxlength="160" autocomplete="off"' })}
          ${field({ name: "phone", labelKey: "commercial.fieldPhone", value: values.phone, type: "tel", attrs: 'maxlength="40" autocomplete="off"' })}
        </div>
      </fieldset>
      <div class="form-grid">
        ${selectField({ name: "planId", labelKey: "commercial.fieldPlan", options: [["", t("commercial.noPlan")], ...plans.map((plan) => [plan.id, plan.name])], selected: values.planId })}
        ${field({ name: "estimatedValue", labelKey: "commercial.fieldValue", value: amount, attrs: 'inputmode="decimal" autocomplete="off"', hintKey: "financial.fieldAmountHint" })}
        ${field({ name: "nextAction", labelKey: "commercial.fieldNextAction", value: values.nextAction, attrs: 'maxlength="160"', placeholderKey: "commercial.fieldNextActionPlaceholder" })}
        ${field({ name: "nextActionAt", labelKey: "commercial.fieldNextActionAt", value: values.nextActionAt, type: "date" })}
        ${field({ name: "expectedCloseDate", labelKey: "commercial.fieldExpectedClose", value: values.expectedCloseDate, type: "date" })}
        ${field({ name: "lastContactAt", labelKey: "commercial.fieldLastContact", value: values.lastContactAt, type: "date", attrs: `max="${todayKey()}"` })}
        <div class="field field--wide">
          <label for="com-notes">${escapeHtml(t("commercial.fieldNotes"))}</label>
          <textarea id="com-notes" name="notes" rows="3" maxlength="2000">${escapeHtml(values.notes ?? "")}</textarea>
        </div>
      </div>
      <button type="submit" hidden></button>
    </form>
  `;
}

function readForm(form) {
  const data = new FormData(form);
  const value = (name) => data.get(name) ?? "";
  return {
    title: value("title"),
    stage: value("stage"),
    priority: value("priority"),
    source: value("source"),
    clientId: value("clientId"),
    contactName: value("contactName"),
    company: value("company"),
    email: value("email"),
    phone: value("phone"),
    planId: value("planId"),
    estimatedValue: value("estimatedValue"),
    nextAction: value("nextAction"),
    nextActionAt: value("nextActionAt"),
    expectedCloseDate: value("expectedCloseDate"),
    lastContactAt: value("lastContactAt"),
    notes: value("notes"),
  };
}

function showErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((node) => {
    const message = errors[node.dataset.errorFor];
    node.hidden = !message;
    node.textContent = message ?? "";
    form.querySelector(`[name="${node.dataset.errorFor}"]`)?.setAttribute("aria-invalid", message ? "true" : "false");
  });
  // The "who" rule belongs to the contact block: reveal it so the error shows.
  if (errors.contactName) form.querySelector("[data-contact-fields]")?.removeAttribute("hidden");
  const [first] = Object.keys(errors);
  form.querySelector(`[name="${first}"]`)?.focus();
}

function bindFormBehaviour(form) {
  const client = form.querySelector("[name=clientId]");
  const contact = form.querySelector("[data-contact-fields]");
  client?.addEventListener("change", () => {
    contact.hidden = Boolean(client.value);
  });
  form.addEventListener("input", (event) => {
    const name = event.target?.name;
    const error = name ? form.querySelector(`[data-error-for="${name}"]`) : null;
    if (!error || error.hidden) return;
    error.hidden = true;
    error.textContent = "";
    event.target.setAttribute("aria-invalid", "false");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    document.querySelector("[data-modal-confirm]")?.click();
  });
}

/* ----------------------------------------------------------------- page */

function selectMarkup({ labelKey, name, options, selected }) {
  return `
    <label class="sort-field">
      <span>${escapeHtml(t(labelKey))}</span>
      <select data-com-${name}>${optionList(options, selected)}</select>
    </label>
  `;
}

export const commercialPage = {
  title: () => t("commercial.title"),
  breadcrumb: () => t("commercial.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="commercial.eyebrow">${t("commercial.eyebrow")}</span>
        <h2 data-i18n="commercial.heading">${t("commercial.heading")}</h2>
        <p data-i18n="commercial.intro">${t("commercial.intro")}</p>
      </div>
      <div class="heading-actions">
        <button class="button" type="button" data-com-export disabled data-i18n="commercial.exportCsv">${t("commercial.exportCsv")}</button>
        <button class="button button--primary" type="button" data-com-new disabled data-i18n="commercial.newOpportunity">${t("commercial.newOpportunity")}</button>
      </div>
    </section>

    <div class="metric-strip com-metrics" data-com-metrics aria-label="${escapeAttribute(t("commercial.summary"))}" aria-live="polite"></div>

    <div class="fin-toolbar com-toolbar">
      ${selectMarkup({ labelKey: "commercial.period", name: "period", options: FINANCIAL_PERIODS.map((period) => [period, t(`commercial.periods.${period}`)]), selected: DEFAULT_PERIOD })}
      <label class="search-field">
        <span data-i18n="commercial.search">${t("commercial.search")}</span>
        <input type="search" data-com-search placeholder="${escapeAttribute(t("commercial.searchPlaceholder"))}">
      </label>
      ${selectMarkup({ labelKey: "commercial.priority", name: "priority", options: [["ALL", t("common.all")], ...PRIORITIES.map((priority) => [priority, t(`commercial.priorities.${priority}`)])], selected: "ALL" })}
      ${selectMarkup({ labelKey: "commercial.source", name: "source", options: [["ALL", t("common.all")], ...SOURCES.map((source) => [source, t(`commercial.sources.${source}`)])], selected: "ALL" })}
    </div>
    <p class="fin-period-note" data-i18n="commercial.periodNote">${t("commercial.periodNote")}</p>

    <section data-commercial>
      <div class="tabs fin-tabs" role="tablist" aria-label="${escapeAttribute(t("commercial.sections"))}">
        <button type="button" role="tab" id="commercial-tab-board" aria-selected="true" aria-controls="commercial-panel-board" tabindex="0" data-i18n="commercial.tabBoard">${t("commercial.tabBoard")}</button>
        <button type="button" role="tab" id="commercial-tab-reports" aria-selected="false" aria-controls="commercial-panel-reports" tabindex="-1" data-i18n="commercial.tabReports">${t("commercial.tabReports")}</button>
      </div>

      <div class="com-panel" id="commercial-panel-board" role="tabpanel" aria-labelledby="commercial-tab-board">
        <div class="log-status">
          <p class="ops-count" data-com-count></p>
          <button class="text-link log-status__clear" type="button" data-com-clear hidden data-i18n="commercial.clearFilters">${t("commercial.clearFilters")}</button>
        </div>
        <p class="com-hint" data-i18n="commercial.dragHint">${t("commercial.dragHint")}</p>
        <div class="deal-workspace" role="group" aria-label="${escapeAttribute(t("commercial.boardLabel"))}" data-com-board aria-busy="true">
          <p class="empty-inline" data-i18n="commercial.loading">${t("commercial.loading")}</p>
        </div>
        <div class="deal-dock" data-deal-dock hidden>
          <div class="deal-dock__zone deal-dock__zone--won" data-stage-drop="WON">${escapeHtml(t("commercial.dropWon"))}</div>
          <div class="deal-dock__zone deal-dock__zone--lost" data-stage-drop="LOST">${escapeHtml(t("commercial.dropLost"))}</div>
        </div>
      </div>

      <div class="com-panel fin-reports" id="commercial-panel-reports" role="tabpanel" aria-labelledby="commercial-tab-reports" hidden data-com-reports></div>
    </section>
  `,
  afterRender: async () => {
    bindTabs(document.querySelector("[data-commercial]"));

    const board = document.querySelector("[data-com-board]");
    const dock = document.querySelector("[data-deal-dock]");
    const workspace = document.querySelector("#commercial-panel-board");
    const reports = document.querySelector("[data-com-reports]");
    const metricsRoot = document.querySelector("[data-com-metrics]");
    const count = document.querySelector("[data-com-count]");
    const clearButton = document.querySelector("[data-com-clear]");
    const period = document.querySelector("[data-com-period]");
    const search = document.querySelector("[data-com-search]");
    const priority = document.querySelector("[data-com-priority]");
    const source = document.querySelector("[data-com-source]");
    const newButton = document.querySelector("[data-com-new]");
    const exportButton = document.querySelector("[data-com-export]");

    let raw = [];
    let deals = [];
    let visible = [];
    let clients = [];
    let plans = [];
    let loadFailed = false;

    function enrich() {
      const clientNames = new Map(clients.map((client) => [client.id, client.name]));
      const planNames = new Map(plans.map((plan) => [plan.id, plan.name]));
      deals = raw.map((deal) => ({
        ...deal,
        clientName: deal.clientId ? clientNames.get(deal.clientId) ?? "" : "",
        planName: deal.planId ? planNames.get(deal.planId) ?? "" : "",
      }));
    }

    const filtersActive = () => search.value.trim() !== "" || priority.value !== "ALL" || source.value !== "ALL";

    function render() {
      const now = new Date();
      const range = periodRange(period.value, now);
      const query = search.value.trim().toLowerCase();

      metricsRoot.innerHTML = metricsMarkup(deals, range, now);
      if (loadFailed) {
        board.innerHTML = `<p class="empty-inline fin-error">${escapeHtml(t("commercial.loadError"))}</p>`;
        reports.innerHTML = "";
        count.textContent = "";
        return;
      }

      visible = deals.filter(
        (deal) =>
          onBoard(deal, range) &&
          matchesQuery(deal, query) &&
          (priority.value === "ALL" || deal.priority === priority.value) &&
          (source.value === "ALL" || deal.source === source.value),
      );

      clearButton.hidden = !filtersActive();
      exportButton.disabled = !visible.length;
      count.textContent = plural("commercial.count", deals.length, { visible: visible.length, total: deals.length });
      board.innerHTML = deals.length ? boardMarkup(visible, now) : `<p class="empty-inline">${escapeHtml(t("commercial.empty"))}</p>`;
      reports.innerHTML = reportsMarkup(deals, range, now);
    }

    async function load() {
      board.setAttribute("aria-busy", "true");
      try {
        raw = await getOpportunities();
        loadFailed = false;
      } catch (error) {
        raw = [];
        loadFailed = true;
        showToast(describeError(error, t("commercial.loadError")));
      }
      if (!board.isConnected) return;
      enrich();
      board.removeAttribute("aria-busy");
      newButton.disabled = loadFailed;
      render();
    }

    async function run(action, message) {
      try {
        const result = await action();
        if (message) showToast(typeof message === "function" ? message(result) : message);
      } catch (error) {
        showToast(describeError(error, t("errors.data.saveOpportunity")));
      }
      await load();
    }

    /* -------------------------------------------------------- dialogs */

    function openForm(existing = null) {
      const isCreate = !existing;
      const values = isCreate
        ? newOpportunityDefaults()
        : {
            ...existing,
            clientId: existing.clientId ?? "",
            planId: existing.planId ?? "",
            nextActionAt: existing.nextActionAt ?? "",
            expectedCloseDate: existing.expectedCloseDate ?? "",
            lastContactAt: existing.lastContactAt ?? "",
          };

      openModal({
        title: t(isCreate ? "commercial.formNewTitle" : "commercial.formEditTitle"),
        className: "modal--wide",
        // Archived clients keep labelling old deals but are not offered for new ones.
        body: formMarkup(values, {
          clients: clients.filter((client) => client.status !== "ARCHIVED" || client.id === values.clientId),
          plans,
          isCreate,
        }),
        actions: [
          { label: t("common.cancel"), role: "cancel" },
          {
            label: t(isCreate ? "commercial.create" : "commercial.save"),
            role: "confirm",
            variant: "primary",
            onSelect: async () => {
              const form = document.querySelector("[data-com-form]");
              const input = readForm(form);
              const merged = isCreate ? sanitizeOpportunity({ ...newOpportunityDefaults(), ...input }) : sanitizeOpportunity({ ...existing, ...input });
              const errors = validateOpportunity(merged);
              if (Object.keys(errors).length) {
                showErrors(form, errors);
                return false;
              }
              try {
                if (isCreate) {
                  // New cards land at the top of their column.
                  const top = Math.min(0, ...raw.filter((deal) => deal.stage === input.stage).map((deal) => Number(deal.position) || 0));
                  await createOpportunity({ ...input, position: top - 1 });
                  showToast(t("commercial.created"));
                } else {
                  // The log names the client the deal points at after the save.
                  const clientName = clients.find((client) => client.id === input.clientId)?.name ?? "";
                  // A stage change from the form lands at the top of the new
                  // column, like a new card, instead of keeping an old number.
                  const patch = { ...input };
                  if (input.stage !== existing.stage) {
                    patch.position = Math.min(0, ...raw.filter((deal) => deal.stage === input.stage).map((deal) => Number(deal.position) || 0)) - 1;
                  }
                  await updateOpportunity(existing.id, patch, { context: { clientName } });
                  showToast(t("commercial.saved"));
                }
              } catch (error) {
                if (error?.field) showErrors(form, { [error.field]: error.message });
                else showToast(describeError(error, t("errors.data.saveOpportunity")));
                return false;
              }
              load();
              return true;
            },
          },
        ],
      });
      bindFormBehaviour(document.querySelector("[data-com-form]"));
    }

    // A win whose later steps failed says so in a dialog that stays until it is
    // read, and points at the menu action that finishes it.
    function showWinWarnings(warnings) {
      openModal({
        title: t("commercial.winPendingTitle"),
        body: `
          <p>${escapeHtml(t("commercial.winPendingBody"))}</p>
          <ul class="com-warnings">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
          <p>${escapeHtml(t("commercial.winPendingHint"))}</p>
        `,
        actions: [{ label: t("common.close"), role: "confirm", variant: "primary" }],
      });
    }

    // complete: the deal is already won and the dialog finishes what an
    // earlier win left undone (winOpportunity never repeats a finished step).
    function openWin(deal, { complete = false } = {}) {
      const name = deal.contactName || deal.company || deal.title;
      const hasValue = deal.estimatedValue !== null && deal.estimatedValue > 0;
      const amount = hasValue ? String(deal.estimatedValue).replace(".", getLocale() === "pt-BR" ? "," : ".") : "";
      openModal({
        title: t(complete ? "commercial.completeWinTitle" : "commercial.winTitle"),
        className: "modal--wide",
        body: `
          <form class="com-form" data-win-form novalidate>
            <p class="com-dialog__deal"><strong>${escapeHtml(deal.title)}</strong> · ${escapeHtml(displayName(deal))}</p>
            ${complete ? `<p class="com-dialog__note">${escapeHtml(t("commercial.completeWinNote"))}</p>` : ""}
            ${
              deal.clientId
                ? ""
                : `<label class="com-check"><input type="checkbox" name="createClient" checked><span>${escapeHtml(t("commercial.winCreateClient", { name }))}</span></label>`
            }
            <label class="com-check"><input type="checkbox" name="receivable" ${hasValue ? "checked" : ""}><span>${escapeHtml(t("commercial.winReceivable"))}</span></label>
            <div class="form-grid" data-receivable-fields ${hasValue ? "" : "hidden"}>
              <div class="field">
                <label for="win-amount">${escapeHtml(t("commercial.winAmount"))}</label>
                <input id="win-amount" name="amount" inputmode="decimal" value="${escapeAttribute(amount)}">
                ${fieldError("amount")}
              </div>
              <div class="field">
                <label for="win-installments">${escapeHtml(t("commercial.winInstallments"))}</label>
                <input id="win-installments" name="installments" type="number" min="1" max="60" step="1" value="1">
                ${fieldError("installments")}
              </div>
              <div class="field">
                <label for="win-due">${escapeHtml(t("commercial.winDueDate"))}</label>
                <input id="win-due" name="dueDate" type="date" value="${escapeAttribute(todayKey())}">
                ${fieldError("dueDate")}
              </div>
            </div>
          </form>
        `,
        actions: [
          { label: t("common.cancel"), role: "cancel" },
          {
            label: t(complete ? "commercial.completeWinConfirm" : "commercial.winConfirm"),
            role: "confirm",
            variant: "primary",
            onSelect: async () => {
              const form = document.querySelector("[data-win-form]");
              const data = new FormData(form);
              const wantsReceivable = data.get("receivable") === "on";
              if (wantsReceivable) {
                const errors = {};
                const value = parseAmount(data.get("amount"));
                if (!Number.isFinite(value) || value <= 0) errors.amount = t("financial.validation.amountPositive");
                const installments = Number(data.get("installments"));
                if (!Number.isInteger(installments) || installments < 1 || installments > 60) {
                  errors.installments = t("financial.validation.installmentsRange", { max: 60 });
                }
                if (!data.get("dueDate")) errors.dueDate = t("financial.validation.dueDateRequired");
                if (Object.keys(errors).length) {
                  showErrors(form, errors);
                  return false;
                }
              }
              try {
                const result = await winOpportunity(deal.id, {
                  createClientRecord: data.get("createClient") === "on",
                  receivable: wantsReceivable
                    ? {
                        amount: data.get("amount"),
                        installments: Number(data.get("installments")),
                        dueDate: data.get("dueDate"),
                        clientName: deal.clientName,
                      }
                    : null,
                });
                const messages = [t(complete ? "commercial.completeWinToast" : "commercial.wonToast")];
                if (result.client) {
                  messages.push(t(result.clientReused ? "commercial.clientReused" : "commercial.clientCreated", { name: result.client.name }));
                }
                if (result.transactions.length) messages.push(plural("commercial.receivableCreated", result.transactions.length));
                if (result.receivableExists) messages.push(t("commercial.receivableExists"));
                showToast(messages.join(" "));
                // After this dialog has closed, or closing it would close the warning too.
                if (result.warnings.length) setTimeout(() => showWinWarnings(result.warnings), 0);
              } catch (error) {
                showToast(describeError(error, t("errors.data.saveOpportunity")));
                return false;
              }
              load();
              return true;
            },
          },
        ],
      });
      const form = document.querySelector("[data-win-form]");
      const toggle = form.querySelector("[name=receivable]");
      const fields = form.querySelector("[data-receivable-fields]");
      toggle.addEventListener("change", () => {
        fields.hidden = !toggle.checked;
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        document.querySelector("[data-modal-confirm]")?.click();
      });
    }

    function openLose(deal) {
      openModal({
        title: t("commercial.lostTitle"),
        body: `
          <form class="com-form" data-lost-form novalidate>
            <p class="com-dialog__deal"><strong>${escapeHtml(deal.title)}</strong> · ${escapeHtml(displayName(deal))}</p>
            <div class="field">
              <label for="lost-reason">${escapeHtml(t("commercial.lostReason"))}</label>
              <select id="lost-reason" name="lostReason">${optionList([["", "—"], ...LOST_REASONS.map((reason) => [reason, t(`commercial.lostReasons.${reason}`)])], "")}</select>
              ${fieldError("lostReason")}
            </div>
            <div class="field">
              <label for="lost-note">${escapeHtml(t("commercial.lostNote"))}</label>
              <textarea id="lost-note" name="note" rows="3" maxlength="1000"></textarea>
            </div>
          </form>
        `,
        actions: [
          { label: t("common.cancel"), role: "cancel" },
          {
            label: t("commercial.lostConfirm"),
            role: "confirm",
            variant: "danger",
            onSelect: async () => {
              const form = document.querySelector("[data-lost-form]");
              const data = new FormData(form);
              const reason = String(data.get("lostReason") ?? "");
              if (!reason) {
                showErrors(form, { lostReason: t("commercial.validation.lostReasonRequired") });
                return false;
              }
              try {
                await loseOpportunity(deal.id, reason, String(data.get("note") ?? "").trim());
                showToast(t("commercial.lostToast"));
              } catch (error) {
                showToast(describeError(error, t("errors.data.saveOpportunity")));
                return false;
              }
              load();
              return true;
            },
          },
        ],
      });
    }

    /* ------------------------------------------------------- actions */

    async function handleAction(action, deal, button) {
      switch (action) {
        case "edit":
          openForm(deal);
          break;
        case "move":
          await run(() => moveOpportunity(deal.id, button.dataset.stage), t("commercial.moved", { stage: stageLabel(button.dataset.stage) }));
          break;
        case "win":
          openWin(deal);
          break;
        case "complete":
          openWin(deal, { complete: true });
          break;
        case "lose":
          openLose(deal);
          break;
        case "reopen":
          await run(() => reopenOpportunity(deal.id), t("commercial.reopened"));
          break;
        case "delete": {
          const confirmed = await confirmModal({
            title: t("commercial.deleteTitle"),
            body: `<p>${escapeHtml(deal.title)}</p><p>${escapeHtml(t("commercial.deleteBody"))}</p>`,
            confirmLabel: t("commercial.deleteConfirm"),
          });
          if (confirmed) await run(() => deleteOpportunity(deal.id), t("commercial.deleted"));
          break;
        }
        default:
          break;
      }
    }

    // Opening, closing and the document listeners (which detach once the page
    // is gone) belong to the shared row menu.
    bindRowMenus(board);

    board.addEventListener("click", async (event) => {
      if (event.target.closest("[data-row-menu-toggle]")) return;
      const button = event.target.closest("[data-com-action]");
      if (button) {
        closeRowMenus(board);
        const deal = deals.find((item) => item.id === button.dataset.id);
        if (deal) await handleAction(button.dataset.comAction, deal, button);
        return;
      }
      // A click anywhere else on a card opens it, unless it was a link.
      if (event.target.closest("a, [data-row-menu]")) return;
      const card = event.target.closest("[data-opportunity-id]");
      const deal = card && deals.find((item) => item.id === card.dataset.opportunityId);
      if (deal) openForm(deal);
    });

    board.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !event.target.matches?.("[data-opportunity-id]")) return;
      const deal = deals.find((item) => item.id === event.target.dataset.opportunityId);
      if (deal) openForm(deal);
    });

    /* ----------------------------------------------------- drag & drop */

    // Only open cards drag; dropping on Won or Lost opens that dialog instead
    // of moving silently, because closing a deal needs its details.
    let dragged = null;

    // The card is re-rendered by the drop, so its own dragend may never reach
    // the board: every exit path clears the drag state itself.
    function endDrag() {
      dragged = null;
      dock.hidden = true;
      workspace.classList.remove("is-dragging");
      workspace.querySelectorAll(".is-dragging, .is-drop-target").forEach((node) => node.classList.remove("is-dragging", "is-drop-target"));
    }

    workspace.addEventListener("dragstart", (event) => {
      const card = event.target.closest?.("[data-opportunity-id]");
      if (!card || card.getAttribute("draggable") !== "true") return;
      dragged = card.dataset.opportunityId;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragged);
      card.classList.add("is-dragging");
      workspace.classList.add("is-dragging");
      dock.hidden = false;
    });

    workspace.addEventListener("dragend", endDrag);

    workspace.addEventListener("dragover", (event) => {
      const column = event.target.closest?.("[data-stage-drop]");
      if (!dragged || !column) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      workspace.querySelectorAll(".is-drop-target").forEach((node) => node !== column && node.classList.remove("is-drop-target"));
      column.classList.add("is-drop-target");
    });

    workspace.addEventListener("dragleave", (event) => {
      const column = event.target.closest?.("[data-stage-drop]");
      if (column && !column.contains(event.relatedTarget)) column.classList.remove("is-drop-target");
    });

    workspace.addEventListener("drop", async (event) => {
      const column = event.target.closest?.("[data-stage-drop]");
      if (!dragged || !column) return;
      event.preventDefault();
      const id = dragged;
      endDrag();
      const stage = column.dataset.stageDrop;
      const deal = deals.find((item) => item.id === id);
      if (!deal) return;

      if (stage === "WON") return openWin(deal);
      if (stage === "LOST") return openLose(deal);

      // Land before the card under the pointer, or at the end of the column.
      const siblings = sortForBoard(deals.filter((item) => item.stage === stage && item.id !== id));
      const target = event.target.closest?.("[data-opportunity-id]");
      const index = target ? siblings.findIndex((item) => item.id === target.dataset.opportunityId) : -1;
      const before = index > 0 ? siblings[index - 1] : index === -1 ? siblings.at(-1) : null;
      const after = index >= 0 ? siblings[index] : null;
      const beforePosition = before ? Number(before.position) || 0 : undefined;
      const afterPosition = after ? Number(after.position) || 0 : undefined;
      const sameStage = stage === deal.stage;
      if (sameStage && (!target || target.dataset.opportunityId === id)) return;

      // Neighbours with the same number leave no room between them: rewrite
      // the column in the dropped order instead.
      if (before && after && beforePosition >= afterPosition) {
        const order = siblings.map((item) => item.id);
        order.splice(index, 0, id);
        const positions = new Map(deals.map((item) => [item.id, item.stage === stage ? item.position : NaN]));
        const changes = renumberColumn(order, positions);
        const moved = changes.find((change) => change.id === id) ?? { id, position: order.indexOf(id) };
        await run(async () => {
          if (!sameStage) await moveOpportunity(id, stage, moved.position);
          for (const change of changes) {
            if (change.id !== id || sameStage) await reorderOpportunity(change.id, change.position);
          }
        }, sameStage ? "" : t("commercial.moved", { stage: stageLabel(stage) }));
        return;
      }

      const position = positionBetween(beforePosition, afterPosition);
      if (sameStage) {
        await run(() => reorderOpportunity(id, position));
        return;
      }
      await run(() => moveOpportunity(id, stage, position), t("commercial.moved", { stage: stageLabel(stage) }));
    });

    /* ---------------------------------------------------------- misc */

    function exportVisible() {
      const header = ["title", "stage", "priority", "source", "client", "company", "contact", "email", "phone", "service", "estimated_value", "next_action", "next_action_at", "expected_close", "lost_reason", "closed_at", "notes"];
      const rows = visible.map((deal) => [
        csvCell(deal.title),
        csvCell(deal.stage),
        csvCell(deal.priority),
        csvCell(deal.source),
        csvCell(deal.clientName),
        csvCell(deal.company),
        csvCell(deal.contactName),
        csvCell(deal.email),
        csvCell(deal.phone),
        csvCell(deal.planName),
        deal.estimatedValue === null ? '""' : csvNumber(deal.estimatedValue),
        csvCell(deal.nextAction),
        csvCell(deal.nextActionAt ?? ""),
        csvCell(deal.expectedCloseDate ?? ""),
        csvCell(deal.lostReason ?? ""),
        csvCell(closedDay(deal) ?? ""),
        csvCell(deal.notes),
      ]);
      downloadCsv(`space-underground-comercial-${todayKey()}.csv`, csvText(header, rows));
      showToast(plural("commercial.exported", visible.length));
    }

    [period, priority, source].forEach((control) => control.addEventListener("change", render));
    search.addEventListener("input", render);
    clearButton.addEventListener("click", () => {
      search.value = "";
      priority.value = "ALL";
      source.value = "ALL";
      render();
    });
    newButton.addEventListener("click", () => openForm());
    exportButton.addEventListener("click", exportVisible);

    onLocaleChange(board, () => {
      [...period.options].forEach((option) => {
        option.textContent = t(`commercial.periods.${option.value}`);
      });
      [...priority.options].forEach((option) => {
        option.textContent = option.value === "ALL" ? t("common.all") : t(`commercial.priorities.${option.value}`);
      });
      [...source.options].forEach((option) => {
        option.textContent = option.value === "ALL" ? t("common.all") : t(`commercial.sources.${option.value}`);
      });
      search.placeholder = t("commercial.searchPlaceholder");
      render();
    });

    // Clients and services only label deals: if either is missing (a
    // migration not applied, an outage) the board still works unlinked.
    const [clientsResult, plansResult] = await Promise.allSettled([getClients(), getPlans()]);
    clients = clientsResult.status === "fulfilled" ? clientsResult.value : [];
    plans = plansResult.status === "fulfilled" ? plansResult.value : [];

    await load();
  },
};

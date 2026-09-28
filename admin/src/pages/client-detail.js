import { badge, badgeType, healthBadge } from "../components/badge.js";
import { openContactDialog } from "../components/contact-dialog.js";
import { contactLinks } from "../components/contact-links.js";
import { confirmModal, openModal } from "../components/modal.js";
import { bindTabs } from "../components/tabs.js";
import { showToast } from "../components/toast.js";
import { onLocaleChange, plural, statusLabel, t } from "../i18n/index.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import {
  CLIENT_STATUSES,
  archiveClient,
  createClient,
  getClient,
  getClientActivity,
  getClientProjects,
  getClients,
  linkProjectToClient,
  newClientDefaults,
  unarchiveClient,
  unlinkProjectFromClient,
  updateClient,
  validateClient,
} from "../services/client-service.js";
import { createOpportunity, getOpportunities, sanitizeOpportunity, validateOpportunity } from "../services/commercial-service.js";
import { describeError, toDataError } from "../services/errors.js";
import { createTransaction, getTransactions, markTransactionPaid, sanitizeTransaction, validateTransaction } from "../services/financial-service.js";
import { getProjects } from "../services/project-service.js";
import { clientHealth } from "../utils/client-health.js";
import { isActiveProject, projectSummary } from "../utils/client-metrics.js";
import {
  clientFinance,
  clientPipeline,
  contactTimestampForDay,
  findDuplicates,
  initials,
  relationshipSignals,
} from "../utils/client-relationship.js";
import { isActionOverdue, OPEN_STAGES, sortForBoard } from "../utils/commercial-metrics.js";
import { byEffectiveDateDesc, categoriesFor, effectiveDate, isOverdue, signedAmount, todayKey } from "../utils/financial-metrics.js";
import { formatCurrency, formatFullDate, formatRelativeDay, formatSignedCurrency } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { actionKey } from "../utils/log-entries.js";

const FORM_FIELDS = ["code", "name", "company", "email", "phone", "status", "notes", "lastContactAt"];

// The last contact is picked as a calendar day and stored at 12:00 UTC of that
// day (capped at "now" for today), which stays on the same date in every
// Brazilian time zone, and is read back through its UTC date.
function contactDay(iso) {
  return iso ? String(iso).slice(0, 10) : "";
}

function contactTimestamp(day, original) {
  if (!day) return null;
  // An untouched day keeps its original timestamp instead of being rewritten.
  if (original && contactDay(original) === day) return original;
  return contactTimestampForDay(day);
}

function lastContactField(value) {
  return `
    <div class="field" data-field="lastContactAt">
      <label for="field-lastContactAt" data-i18n="clientEditor.lastContact">${escapeHtml(t("clientEditor.lastContact"))}</label>
      <div class="client-contact-field">
        <input id="field-lastContactAt" name="lastContactAt" type="date" value="${escapeAttribute(contactDay(value))}" max="${todayKey()}">
        <button type="button" class="button button--compact" data-clear-last-contact data-i18n="clientEditor.clearLastContact">${escapeHtml(t("clientEditor.clearLastContact"))}</button>
      </div>
      <p class="field-hint" data-i18n="clientEditor.lastContactHint">${escapeHtml(t("clientEditor.lastContactHint"))}</p>
      <p class="field-error" id="field-lastContactAt-error" hidden></p>
    </div>
  `;
}

function tabsFor(isCreate) {
  // Projects, deals, money and activity hang off a saved record, so a new
  // client starts on the two tabs it can actually fill in.
  return isCreate
    ? [
        ["general", "clientEditor.tabGeneral"],
        ["notes", "clientEditor.tabNotes"],
      ]
    : [
        ["overview", "clientEditor.tabOverview"],
        ["general", "clientEditor.tabGeneral"],
        ["notes", "clientEditor.tabNotes"],
        ["projects", "clientEditor.tabProjects"],
        ["commercial", "clientEditor.tabCommercial"],
        ["financial", "clientEditor.tabFinancial"],
        ["activity", "clientEditor.tabActivity"],
      ];
}

/* ----------------------------------------------------------------- markup */

function fieldMarkup({ labelKey, name, value = "", type = "text", attrs = "", hintKey = "", rows = 6 }) {
  const id = `field-${name}`;
  const control =
    type === "textarea"
      ? `<textarea id="${id}" name="${name}" rows="${rows}" ${attrs}>${escapeHtml(value)}</textarea>`
      : `<input id="${id}" name="${name}" type="${type}" value="${escapeAttribute(value)}" ${attrs}>`;
  return `
    <div class="field${type === "textarea" ? " field--wide" : ""}" data-field="${name}">
      <label for="${id}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      ${control}
      ${hintKey ? `<p class="field-hint" data-i18n="${hintKey}">${escapeHtml(t(hintKey))}</p>` : ""}
      <p class="field-error" id="${id}-error" hidden></p>
    </div>
  `;
}

function statusSelect(value) {
  return `
    <div class="field" data-field="status">
      <label for="field-status" data-i18n="clientEditor.status">${escapeHtml(t("clientEditor.status"))}</label>
      <select id="field-status" name="status">
        ${CLIENT_STATUSES.map(
          (status) =>
            `<option value="${status}" data-status-label="${status}" ${status === value ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`,
        ).join("")}
      </select>
      <p class="field-error" id="field-status-error" hidden></p>
    </div>
  `;
}

function figure(labelKey, value, accent = false) {
  return `
    <div>
      <span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span>
      <strong${accent ? ' class="is-accent"' : ""}>${escapeHtml(value)}</strong>
    </div>
  `;
}

function healthCard(client) {
  const health = clientHealth(client);
  return `
    <strong>${escapeHtml(t("clientHealth.score", { score: health.score, total: health.total }))}</strong>
    ${healthBadge(health.status, `clientHealth.status.${health.status}`)}
    <div class="health-checks">
      ${health.checks
        .map(
          (check) => `
            <div class="health-check health-check--${check.ok ? "ok" : check.severity}">
              <span aria-hidden="true">${check.ok ? "OK" : "!"}</span>
              <strong data-i18n="clientHealth.checks.${check.key}">${escapeHtml(t(`clientHealth.checks.${check.key}`))}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function metaItem(labelKey, value) {
  return `<div><span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span><strong>${escapeHtml(value || "—")}</strong></div>`;
}

// The raw ISO string rides on the node so applyLocaleFormatting() re-reads the
// date in the new locale without re-rendering.
function dateItem(labelKey, value) {
  const stamp = value ? ` data-full-date="${escapeAttribute(value)}"` : "";
  return `<div><span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span><strong${stamp}>${escapeHtml(formatFullDate(value))}</strong></div>`;
}

function detailsGrid(client) {
  return `
    <div class="meta-grid">
      ${metaItem("clientEditor.email", client.email)}
      ${metaItem("clientEditor.phone", client.phone)}
      ${metaItem("clientEditor.company", client.company)}
      ${dateItem("clientEditor.clientSince", client.createdAt)}
      ${dateItem("clientEditor.lastUpdate", client.updatedAt)}
      ${dateItem("clientEditor.lastContact", client.lastContactAt)}
      ${client.archivedAt ? dateItem("clientEditor.archivedOn", client.archivedAt) : ""}
    </div>
  `;
}

/* -------------------------------------------------------------- overview */

function kpiStrip(state) {
  const finance = clientFinance(state.entries);
  const pipeline = clientPipeline(state.deals);
  const activeProjects = state.projects.filter(isActiveProject).length;
  const money = (value) => (state.relatedOk ? formatCurrency(value) : "—");
  const items = [
    ["clientEditor.kpiReceived", money(finance.received), ""],
    ["clientEditor.kpiToReceive", money(finance.toReceive), ""],
    ["clientEditor.kpiOverdue", money(finance.overdue), finance.overdue ? "is-danger" : ""],
    ["clientEditor.kpiPipeline", money(pipeline.openValue), ""],
    ["clientEditor.kpiProjects", state.projectsOk ? String(activeProjects) : "—", ""],
  ];
  return `
    <div class="metric-strip client-kpis">
      ${items
        .map(
          ([key, value, tone]) => `
            <div class="project-metric${tone ? ` ${tone}` : ""}">
              <strong>${escapeHtml(value)}</strong>
              <span>${escapeHtml(t(key))}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

const SIGNAL_ACTIONS = {
  overdue: ["financial", "clientEditor.signalActions.financial"],
  dealAction: ["commercial", "clientEditor.signalActions.commercial"],
  stalledDeal: ["commercial", "clientEditor.signalActions.commercial"],
  leadNoDeal: ["commercial", "clientEditor.signalActions.commercial"],
  stale: ["contact", "clientEditor.signalActions.contact"],
  neverContacted: ["contact", "clientEditor.signalActions.contact"],
};

function signalText(signal) {
  const key = `clientEditor.signals.${signal.key}`;
  if (signal.key === "dealAction" || signal.key === "stalledDeal") return plural(key, signal.params.count);
  if (signal.key === "overdue") return t(key, { amount: formatCurrency(signal.params.amount) });
  return t(key, signal.params);
}

function signalsMarkup(state) {
  if (!state.relatedOk) return `<p class="empty-inline">${escapeHtml(t("clientEditor.relatedLoadError"))}</p>`;
  const signals = relationshipSignals({ client: state.client, entries: state.entries, deals: state.deals, projects: state.projects });
  if (!signals.length) return `<p class="client-signals__empty">${escapeHtml(t("clientEditor.signalsEmpty"))}</p>`;
  return `
    <ul class="client-signals">
      ${signals
        .map((signal) => {
          const [target, labelKey] = SIGNAL_ACTIONS[signal.key] ?? [];
          const archived = state.client.status === "ARCHIVED";
          const action =
            target === "contact"
              ? archived
                ? ""
                : `<button type="button" class="text-link" data-record-contact>${escapeHtml(t(labelKey))}</button>`
              : target
                ? `<button type="button" class="text-link" data-open-tab="${target}">${escapeHtml(t(labelKey))}</button>`
                : "";
          return `
            <li class="client-signal client-signal--${signal.tone}" data-signal="${signal.key}">
              <i aria-hidden="true"></i>
              <span>${escapeHtml(signalText(signal))}</span>
              ${action}
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function overviewMarkup(state) {
  const { client } = state;
  const archived = client.status === "ARCHIVED";
  return `
    <div class="project-overview client-overview">
      ${kpiStrip(state)}
      <section class="overview-grid">
        <article class="overview-card">
          <span data-i18n="clientEditor.signalsTitle">${escapeHtml(t("clientEditor.signalsTitle"))}</span>
          <div data-client-signals>${signalsMarkup(state)}</div>
        </article>
        <article class="overview-card">
          <span data-i18n="clientHealth.title">${escapeHtml(t("clientHealth.title"))}</span>
          <div data-client-health>${healthCard(client)}</div>
        </article>
      </section>
      ${detailsGrid(client)}
      ${
        state.activity.length
          ? `<section class="client-recent">
              <h3 data-i18n="clientEditor.recentActivity">${escapeHtml(t("clientEditor.recentActivity"))}</h3>
              ${activityMarkup(state.activity.slice(0, 3))}
            </section>`
          : ""
      }
      <div class="overview-actions">
        <button type="button" class="button" data-client-lifecycle="${archived ? "unarchive" : "archive"}">${escapeHtml(
          archived ? t("clients.actionUnarchive") : t("clients.actionArchive"),
        )}</button>
      </div>
    </div>
  `;
}

/* -------------------------------------------------------------- projects */

function projectRow(project) {
  return `
    <div class="ops-row" data-client-project="${escapeAttribute(project.id)}">
      <span class="ops-row__primary">
        <a href="#/projects/${encodeURIComponent(project.id)}"><strong>${escapeHtml(project.name || t("projects.untitled"))}</strong></a>
        <small>CASE ${escapeHtml(project.caseNumber)} · <span data-status-label="${escapeAttribute(project.category)}">${escapeHtml(statusLabel(project.category))}</span></small>
      </span>
      <span data-label="${escapeAttribute(t("clientEditor.projectStatus"))}">${badge(project.status, badgeType(project.status))}</span>
      <span data-label="${escapeAttribute(t("clientEditor.projectEditorial"))}">${badge(project.editorialStatus, badgeType(project.editorialStatus))}</span>
      <span class="ops-meta" data-label="${escapeAttribute(t("common.updated"))}" data-relative-date="${escapeAttribute(project.updatedAt ?? "")}">${escapeHtml(formatRelativeDay(project.updatedAt))}</span>
      <span class="client-projects__actions">
        <a class="button button--compact" href="#/projects/${encodeURIComponent(project.id)}">${escapeHtml(t("clientEditor.openProject"))}</a>
        <button type="button" class="button button--compact" data-unlink-project="${escapeAttribute(project.id)}">${escapeHtml(t("clientEditor.unlinkProject"))}</button>
      </span>
    </div>
  `;
}

function linkControl(candidates) {
  if (!candidates.length) {
    return `<p class="field-hint" data-i18n="clientEditor.noProjectsToLink">${escapeHtml(t("clientEditor.noProjectsToLink"))}</p>`;
  }
  return `
    <div class="client-link-project">
      <label class="sort-field">
        <span data-i18n="clientEditor.linkProjectLabel">${escapeHtml(t("clientEditor.linkProjectLabel"))}</span>
        <select data-link-project-select>
          ${candidates
            .map((project) => `<option value="${escapeAttribute(project.id)}">CASE ${escapeHtml(project.caseNumber)} · ${escapeHtml(project.name)}</option>`)
            .join("")}
        </select>
      </label>
      <button type="button" class="button" data-link-project>${escapeHtml(t("clientEditor.linkProject"))}</button>
    </div>
  `;
}

function projectsMarkup(state) {
  if (!state.projectsOk) {
    return `<p class="empty-inline">${escapeHtml(state.projectsError)}</p>`;
  }
  const summary = projectSummary(state.projects);
  return `
    <div class="ops-figures">
      ${figure("clientEditor.projectsActive", String(summary.active), true)}
      ${figure("clientEditor.projectsDelivered", String(summary.delivered))}
      ${figure("clientEditor.projectsTotal", String(summary.total))}
    </div>
    ${
      state.projects.length
        ? `<div class="ops-table client-projects">${state.projects.map(projectRow).join("")}</div>`
        : `<p class="empty-inline" data-i18n="clientEditor.noProjectsLinked">${escapeHtml(t("clientEditor.noProjectsLinked"))}</p>`
    }
    ${linkControl(state.linkCandidates)}
    <p class="ops-note" data-i18n="clientEditor.linkNote">${escapeHtml(t("clientEditor.linkNote"))}</p>
  `;
}

/* ------------------------------------------------------------ commercial */

function panelHeader(titleKey, actions) {
  return `
    <header class="client-panel__head">
      <h3>${escapeHtml(t(titleKey))}</h3>
      <div class="client-panel__actions">${actions}</div>
    </header>
  `;
}

function dealRow(deal) {
  const overdue = isActionOverdue(deal);
  const next = deal.nextAction || deal.nextActionAt
    ? `<small class="${overdue ? "is-danger" : ""}">→ ${escapeHtml(deal.nextAction || "—")}${deal.nextActionAt ? ` · ${escapeHtml(formatFullDate(`${deal.nextActionAt}T12:00:00`))}` : ""}</small>`
    : "";
  return `
    <div class="ops-row client-deal" data-client-deal="${escapeAttribute(deal.id)}">
      <span class="ops-row__primary">
        <strong>${escapeHtml(deal.title)}</strong>
        ${next}
      </span>
      <span data-label="${escapeAttribute(t("commercial.fieldStage"))}"><span class="badge badge--${deal.stage === "WON" ? "success" : deal.stage === "LOST" ? "muted" : "neutral"}">${escapeHtml(t(`commercial.stages.${deal.stage}`).toUpperCase())}</span></span>
      <span class="ops-amount ops-amount--neutral" data-label="${escapeAttribute(t("commercial.fieldValue"))}">${escapeHtml(deal.estimatedValue === null ? t("commercial.noValue") : formatCurrency(deal.estimatedValue))}</span>
    </div>
  `;
}

function commercialMarkup(state) {
  if (!state.relatedOk) return `<p class="empty-inline">${escapeHtml(t("clientEditor.relatedLoadError"))}</p>`;
  const pipeline = clientPipeline(state.deals);
  const archived = state.client.status === "ARCHIVED";
  const open = sortForBoard(state.deals.filter((deal) => OPEN_STAGES.includes(deal.stage)));
  const closed = state.deals.filter((deal) => !OPEN_STAGES.includes(deal.stage));
  return `
    ${panelHeader(
      "clientEditor.dealsTitle",
      `${archived ? "" : `<button type="button" class="button button--primary button--compact" data-new-deal>${escapeHtml(t("clientEditor.newDeal"))}</button>`}
       <a class="button button--compact" href="#/commercial">${escapeHtml(t("clientEditor.openPipeline"))}</a>`,
    )}
    <div class="ops-figures">
      ${figure("clientEditor.dealsOpen", String(pipeline.openCount), true)}
      ${figure("clientEditor.dealsOpenValue", formatCurrency(pipeline.openValue))}
      ${figure("clientEditor.dealsWon", `${pipeline.wonCount} · ${formatCurrency(pipeline.wonValue)}`)}
      ${figure("clientEditor.dealsLost", String(pipeline.lostCount))}
    </div>
    ${
      state.deals.length
        ? `<div class="ops-table client-deals">${[...open, ...closed].map(dealRow).join("")}</div>`
        : `<p class="empty-inline">${escapeHtml(t("clientEditor.noDeals"))}</p>`
    }
  `;
}

/* ------------------------------------------------------------- financial */

function entryRow(entry) {
  const late = isOverdue(entry);
  const state = late ? "OVERDUE" : entry.status;
  const tone = { PAID: "success", PENDING: "neutral", CANCELLED: "muted", OVERDUE: "danger" }[state];
  const amount = entry.status === "PAID" ? formatSignedCurrency(signedAmount(entry)) : formatCurrency(entry.amount);
  const amountTone = entry.status !== "PAID" ? "neutral" : entry.type === "INCOME" ? "positive" : "negative";
  return `
    <div class="ops-row client-entry" data-client-entry="${escapeAttribute(entry.id)}">
      <span class="ops-meta" data-label="${escapeAttribute(t("financial.fieldDueDate"))}" data-full-date="${escapeAttribute(`${effectiveDate(entry)}T12:00:00`)}">${escapeHtml(formatFullDate(`${effectiveDate(entry)}T12:00:00`))}</span>
      <span class="ops-row__primary">
        <strong>${escapeHtml(entry.description)}</strong>
        <small>${escapeHtml(t(`financial.types.${entry.type}`))} · ${escapeHtml(t(`financial.categories.${entry.category}`))}</small>
      </span>
      <span data-label="${escapeAttribute(t("financial.fieldStatus"))}"><span class="badge badge--${tone}">${escapeHtml(t(`financial.statuses.${state}`).toUpperCase())}</span></span>
      <span class="ops-amount ops-amount--${amountTone}" data-label="${escapeAttribute(t("financial.fieldAmount"))}">${escapeHtml(amount)}</span>
      <span class="client-projects__actions">
        ${entry.status === "PENDING" ? `<button type="button" class="button button--compact" data-settle-entry="${escapeAttribute(entry.id)}">${escapeHtml(t("financial.markPaid"))}</button>` : ""}
      </span>
    </div>
  `;
}

function financialMarkup(state) {
  if (!state.relatedOk) return `<p class="empty-inline">${escapeHtml(t("clientEditor.relatedLoadError"))}</p>`;
  const finance = clientFinance(state.entries);
  const archived = state.client.status === "ARCHIVED";
  return `
    ${panelHeader(
      "clientEditor.entriesTitle",
      `${archived ? "" : `<button type="button" class="button button--primary button--compact" data-new-entry>${escapeHtml(t("clientEditor.newEntry"))}</button>`}
       <a class="button button--compact" href="#/financial">${escapeHtml(t("clientEditor.openFinancial"))}</a>`,
    )}
    <div class="ops-figures">
      ${figure("clientEditor.kpiReceived", formatCurrency(finance.received), true)}
      ${figure("clientEditor.kpiToReceive", formatCurrency(finance.toReceive))}
      ${figure("clientEditor.kpiOverdue", formatCurrency(finance.overdue))}
      ${figure("clientEditor.costs", formatCurrency(finance.costs))}
    </div>
    ${
      state.entries.length
        ? `<div class="ops-table client-entries">${[...state.entries].sort(byEffectiveDateDesc).map(entryRow).join("")}</div>`
        : `<p class="empty-inline">${escapeHtml(t("clientEditor.noEntries"))}</p>`
    }
  `;
}

/* -------------------------------------------------------------- activity */

// Stored titles are English data; known actions read in the active locale,
// the same way the Logs screen reads them.
function activityTitle(entry) {
  const key = actionKey(entry.action);
  const label = t(key);
  return label && label !== key ? label : entry.title;
}

function activityMarkup(entries) {
  if (!entries.length) {
    return `<p class="empty-inline" data-i18n="clientEditor.noActivity">${escapeHtml(t("clientEditor.noActivity"))}</p>`;
  }
  return `
    <div class="activity-list client-activity">
      ${entries
        .map(
          (entry) => `
            <div class="${entry.action === "client.contacted" ? "is-contact" : ""}">
              <span></span>
              <strong>${escapeHtml(activityTitle(entry))}</strong>
              <p>${escapeHtml(entry.detail || entry.action || "")}</p>
              <small data-relative-date="${escapeAttribute(entry.time ?? "")}">${escapeHtml(formatRelativeDay(entry.time))}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

/* -------------------------------------------------------------- heading */

function identityMeta(client) {
  return `
    <span class="editor-identity__meta">${escapeHtml(client.code || t("clientEditor.codePending"))}</span>
    ${client.company ? `<span class="editor-identity__meta">${escapeHtml(client.company)}</span>` : ""}
    ${badge(client.status, badgeType(client.status))}
  `;
}

function duplicateMarkup(matches) {
  if (!matches.length) return "";
  return `
    <div class="client-duplicate" role="status">
      <strong>${escapeHtml(t("clientEditor.duplicateTitle"))}</strong>
      ${matches
        .slice(0, 3)
        .map(
          ({ client, reasons }) => `
            <p>
              ${escapeHtml(t("clientEditor.duplicateBody", { name: client.name, code: client.code, reasons: reasons.map((reason) => t(`clientEditor.duplicateReasons.${reason}`)).join(", ") }))}
              <a href="#/clients/${encodeURIComponent(client.id)}">${escapeHtml(t("clientEditor.openDuplicate"))}</a>
            </p>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderEditor(state) {
  const { client, isCreate } = state;
  const tabs = tabsFor(isCreate);
  const archived = client.status === "ARCHIVED";
  const panel = (id, content) => {
    const index = tabs.findIndex(([tab]) => tab === id);
    return `<div class="tab-panel" id="client-panel-${id}" role="tabpanel" aria-labelledby="client-tab-${id}"${index === 0 ? "" : " hidden"}>${content}</div>`;
  };

  return `
    <section class="page-heading page-heading--split client-heading">
      <div class="client-heading__profile">
        ${isCreate ? "" : `<div class="client-avatar client-avatar--large client-avatar--${client.status.toLowerCase()}" aria-hidden="true" data-client-avatar>${escapeHtml(initials(client.name))}</div>`}
        <div>
          <span data-i18n="${isCreate ? "clientEditor.newBreadcrumb" : "clientEditor.recordBreadcrumb"}">${escapeHtml(
            t(isCreate ? "clientEditor.newBreadcrumb" : "clientEditor.recordBreadcrumb"),
          )}</span>
          ${
            isCreate
              ? `<h2 data-i18n="clientEditor.newHeading">${escapeHtml(t("clientEditor.newHeading"))}</h2>`
              : `<h2 data-client-heading>${escapeHtml(client.name || t("clientEditor.untitled"))}</h2>`
          }
          <div class="editor-identity">
            <span class="client-identity" data-client-identity>${identityMeta(client)}</span>
            <span class="save-state is-saved" data-save-state ${isCreate ? "hidden" : ""}>${escapeHtml(t("common.saved"))}</span>
          </div>
        </div>
      </div>
      <div class="heading-actions client-heading__actions">
        ${isCreate ? "" : `<span data-client-links>${contactLinks(client, { labels: true })}</span>`}
        ${isCreate || archived ? "" : `<button type="button" class="button button--primary" data-record-contact>${escapeHtml(t("clientEditor.recordContact"))}</button>`}
        <a class="button" href="#/clients" data-i18n="clientEditor.allClients">${escapeHtml(t("clientEditor.allClients"))}</a>
      </div>
    </section>

    <form class="editor-form client-editor-form" data-client-editor data-mode="${isCreate ? "create" : "edit"}" novalidate>
      <div class="editor-toolbar">
        <button type="submit" class="button button--primary" data-client-save data-i18n="${isCreate ? "clientEditor.createClient" : "clientEditor.saveChanges"}">${escapeHtml(
          t(isCreate ? "clientEditor.createClient" : "clientEditor.saveChanges"),
        )}</button>
      </div>

      <div class="tabs" role="tablist" aria-label="${escapeAttribute(t("clientEditor.sections"))}" data-i18n-aria-label="clientEditor.sections">
        ${tabs
          .map(
            ([id, key], index) =>
              `<button type="button" role="tab" id="client-tab-${id}" data-tab="${id}" aria-selected="${index === 0}" aria-controls="client-panel-${id}" tabindex="${index === 0 ? 0 : -1}" data-i18n="${key}">${escapeHtml(t(key))}</button>`,
          )
          .join("")}
      </div>

      ${isCreate ? "" : panel("overview", `<div data-client-overview>${overviewMarkup(state)}</div>`)}
      ${panel(
        "general",
        `
          <div data-duplicate-warning>${duplicateMarkup(findDuplicates(client, state.allClients))}</div>
          <div class="form-grid">
            ${fieldMarkup({ labelKey: "clientEditor.code", name: "code", value: client.code, hintKey: "clientEditor.codeHint", attrs: 'autocomplete="off" spellcheck="false"' })}
            ${fieldMarkup({ labelKey: "clientEditor.name", name: "name", value: client.name, attrs: "required" })}
            ${fieldMarkup({ labelKey: "clientEditor.company", name: "company", value: client.company })}
            ${fieldMarkup({ labelKey: "clientEditor.email", name: "email", value: client.email, type: "email", attrs: 'autocomplete="off"' })}
            ${fieldMarkup({ labelKey: "clientEditor.phone", name: "phone", value: client.phone, type: "tel", attrs: 'autocomplete="off"' })}
            ${statusSelect(client.status)}
            ${lastContactField(client.lastContactAt)}
          </div>
        `,
      )}
      ${panel(
        "notes",
        `
          <div class="form-grid">
            ${fieldMarkup({ labelKey: "clientEditor.notes", name: "notes", value: client.notes, type: "textarea", hintKey: "clientEditor.notesHint", rows: 10 })}
          </div>
        `,
      )}
      ${isCreate ? "" : panel("projects", `<div data-client-projects>${projectsMarkup(state)}</div>`)}
      ${isCreate ? "" : panel("commercial", `<div data-client-commercial>${commercialMarkup(state)}</div>`)}
      ${isCreate ? "" : panel("financial", `<div data-client-financial>${financialMarkup(state)}</div>`)}
      ${isCreate ? "" : panel("activity", `<div data-client-activity>${activityMarkup(state.activity)}</div>`)}
    </form>
  `;
}

function renderMissing(id) {
  return `
    <section class="empty-state">
      <span>${escapeHtml(id ?? "—")}</span>
      <h2 data-i18n="clientEditor.notFound">${escapeHtml(t("clientEditor.notFound"))}</h2>
      <p data-i18n="clientEditor.notFoundBody">${escapeHtml(t("clientEditor.notFoundBody"))}</p>
      <a class="button" href="#/clients" data-i18n="clientEditor.allClients">${escapeHtml(t("clientEditor.allClients"))}</a>
    </section>
  `;
}

/* ---------------------------------------------------------------- dialogs */

function dialogErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((node) => {
    const message = errors[node.dataset.errorFor];
    node.hidden = !message;
    node.textContent = message ?? "";
    form.querySelector(`[name="${node.dataset.errorFor}"]`)?.setAttribute("aria-invalid", message ? "true" : "false");
  });
  const [first] = Object.keys(errors);
  form.querySelector(`[name="${first}"]`)?.focus();
}

function dialogField({ name, labelKey, type = "text", value = "", attrs = "" }) {
  return `
    <div class="field">
      <label for="dlg-${name}">${escapeHtml(t(labelKey))}</label>
      <input id="dlg-${name}" name="${name}" type="${type}" value="${escapeAttribute(value)}" ${attrs}>
      <p class="field-error" data-error-for="${name}" hidden></p>
    </div>
  `;
}

function dialogSelect({ name, labelKey, options, selected }) {
  return `
    <div class="field">
      <label for="dlg-${name}">${escapeHtml(t(labelKey))}</label>
      <select id="dlg-${name}" name="${name}">${options
        .map(([value, label]) => `<option value="${escapeAttribute(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`)
        .join("")}</select>
      <p class="field-error" data-error-for="${name}" hidden></p>
    </div>
  `;
}

function bindDialogForm(selector) {
  const form = document.querySelector(selector);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    document.querySelector("[data-modal-confirm]")?.click();
  });
  form?.addEventListener("input", (event) => {
    const error = form.querySelector(`[data-error-for="${event.target?.name}"]`);
    if (error) error.hidden = true;
  });
  return form;
}

// A deal started from the client record: the few fields that matter at the
// first contact, already pointed at this client.
function openDealDialog(client) {
  return new Promise((resolve) => {
    let created = null;
    openModal({
      title: t("commercial.formNewTitle"),
      className: "modal--wide",
      onDismiss: () => resolve(created),
      body: `
        <form class="com-form" data-client-deal-form novalidate>
          <p class="com-dialog__deal"><strong>${escapeHtml(client.name)}</strong>${client.company ? ` · ${escapeHtml(client.company)}` : ""}</p>
          <div class="form-grid">
            <div class="field field--wide">
              <label for="dlg-title">${escapeHtml(t("commercial.fieldTitle"))}</label>
              <input id="dlg-title" name="title" maxlength="160" placeholder="${escapeAttribute(t("commercial.fieldTitlePlaceholder"))}">
              <p class="field-error" data-error-for="title" hidden></p>
            </div>
            ${dialogSelect({ name: "stage", labelKey: "commercial.fieldStage", options: OPEN_STAGES.map((stage) => [stage, t(`commercial.stages.${stage}`)]), selected: "NEW" })}
            ${dialogField({ name: "estimatedValue", labelKey: "commercial.fieldValue", attrs: 'inputmode="decimal" autocomplete="off"' })}
            ${dialogField({ name: "nextAction", labelKey: "commercial.fieldNextAction", attrs: `maxlength="160" placeholder="${escapeAttribute(t("commercial.fieldNextActionPlaceholder"))}"` })}
            ${dialogField({ name: "nextActionAt", labelKey: "commercial.fieldNextActionAt", type: "date" })}
          </div>
        </form>
      `,
      actions: [
        { label: t("common.cancel"), role: "cancel" },
        {
          label: t("commercial.create"),
          role: "confirm",
          variant: "primary",
          onSelect: async () => {
            const form = document.querySelector("[data-client-deal-form]");
            const data = Object.fromEntries(new FormData(form));
            const values = { title: data.title, stage: data.stage, estimatedValue: data.estimatedValue, nextAction: data.nextAction, nextActionAt: data.nextActionAt, clientId: client.id, priority: "MEDIUM", source: "OTHER" };
            const errors = validateOpportunity(sanitizeOpportunity(values));
            if (Object.keys(errors).length) {
              dialogErrors(form, errors);
              return false;
            }
            try {
              created = await createOpportunity(values);
              showToast(t("clientEditor.dealCreated"));
              resolve(created);
              return true;
            } catch (error) {
              if (error?.field) dialogErrors(form, { [error.field]: error.message });
              else showToast(describeError(error, t("errors.data.saveOpportunity")));
              return false;
            }
          },
        },
      ],
    });
    bindDialogForm("[data-client-deal-form]");
  });
}

// An entry started from the client record, already pointed at this client.
function openEntryDialog(client) {
  return new Promise((resolve) => {
    let created = null;
    const categoryOptions = (type) => categoriesFor(type).map((category) => [category, t(`financial.categories.${category}`)]);
    openModal({
      title: t("financial.formNewTitle"),
      className: "modal--wide",
      onDismiss: () => resolve(created),
      body: `
        <form class="fin-form" data-client-entry-form novalidate>
          <p class="com-dialog__deal"><strong>${escapeHtml(client.name)}</strong>${client.company ? ` · ${escapeHtml(client.company)}` : ""}</p>
          <div class="fin-form__type" role="radiogroup" aria-label="${escapeAttribute(t("financial.fieldType"))}">
            ${["INCOME", "EXPENSE"]
              .map(
                (type) => `
                  <label class="fin-type">
                    <input type="radio" name="type" value="${type}"${type === "INCOME" ? " checked" : ""}>
                    <span>${escapeHtml(t(`financial.types.${type}`))}</span>
                  </label>
                `,
              )
              .join("")}
          </div>
          <div class="form-grid">
            <div class="field field--wide">
              <label for="dlg-description">${escapeHtml(t("financial.fieldDescription"))}</label>
              <input id="dlg-description" name="description" maxlength="160">
              <p class="field-error" data-error-for="description" hidden></p>
            </div>
            ${dialogField({ name: "amount", labelKey: "financial.fieldAmount", attrs: 'inputmode="decimal" autocomplete="off"' })}
            ${dialogSelect({ name: "category", labelKey: "financial.fieldCategory", options: categoryOptions("INCOME"), selected: "PROJECT" })}
            ${dialogField({ name: "dueDate", labelKey: "financial.fieldDueDate", type: "date", value: todayKey() })}
            ${dialogSelect({ name: "status", labelKey: "financial.fieldStatus", options: ["PENDING", "PAID"].map((status) => [status, t(`financial.statuses.${status}`)]), selected: "PENDING" })}
          </div>
        </form>
      `,
      actions: [
        { label: t("common.cancel"), role: "cancel" },
        {
          label: t("financial.create"),
          role: "confirm",
          variant: "primary",
          onSelect: async () => {
            const form = document.querySelector("[data-client-entry-form]");
            const data = Object.fromEntries(new FormData(form));
            const values = { ...data, clientId: client.id, paidAt: "" };
            const errors = validateTransaction(sanitizeTransaction(values));
            if (Object.keys(errors).length) {
              dialogErrors(form, errors);
              return false;
            }
            try {
              [created] = await createTransaction(values);
              showToast(t("clientEditor.entryCreated"));
              resolve(created);
              return true;
            } catch (error) {
              if (error?.field) dialogErrors(form, { [error.field]: error.message });
              else showToast(describeError(error, t("errors.data.saveTransaction")));
              return false;
            }
          },
        },
      ],
    });
    const form = bindDialogForm("[data-client-entry-form]");
    form?.querySelectorAll("[name=type]").forEach((radio) => {
      radio.addEventListener("change", () => {
        const select = form.querySelector("[name=category]");
        select.innerHTML = categoryOptions(radio.value)
          .map(([value, label], index) => `<option value="${escapeAttribute(value)}"${index === 0 ? " selected" : ""}>${escapeHtml(label)}</option>`)
          .join("");
      });
    });
  });
}

/* ------------------------------------------------------------------- data */

async function loadState(id) {
  if (id === "new") {
    const all = await getClients().catch(() => []);
    return {
      client: newClientDefaults(),
      isCreate: true,
      projects: [],
      projectsOk: true,
      linkCandidates: [],
      activity: [],
      entries: [],
      deals: [],
      relatedOk: true,
      allClients: all,
    };
  }

  const client = await getClient(id);
  if (!client) return null;

  // Everything below only enriches the record; any of it failing leaves the
  // client itself editable.
  const [linked, all, activity, entries, deals, clients] = await Promise.allSettled([
    getClientProjects(client.id),
    getProjects(),
    getClientActivity(client.id),
    getTransactions(),
    getOpportunities(),
    getClients(),
  ]);
  const projectsOk = linked.status === "fulfilled";
  const relatedOk = entries.status === "fulfilled" && deals.status === "fulfilled";

  return {
    client,
    isCreate: false,
    projects: projectsOk ? linked.value : [],
    projectsOk,
    projectsError: projectsOk ? "" : describeError(linked.reason, t("clientEditor.projectsLoadError")),
    // Only unowned projects are offered, so linking never silently moves a
    // project away from another client.
    linkCandidates: all.status === "fulfilled" ? all.value.filter((project) => !project.clientId) : [],
    activity: activity.status === "fulfilled" ? activity.value : [],
    entries: entries.status === "fulfilled" ? entries.value.filter((entry) => entry.clientId === client.id) : [],
    deals: deals.status === "fulfilled" ? deals.value.filter((deal) => deal.clientId === client.id).map((deal) => ({ ...deal, clientName: client.name })) : [],
    relatedOk,
    allClients: clients.status === "fulfilled" ? clients.value : [],
  };
}

/* ------------------------------------------------------------------ mount */

// Each mount renders into a fresh container and binds its listeners there, so
// a reload after a save never stacks a second set on the long-lived .page.
function mount(page, state, { tab } = {}) {
  page.innerHTML = `<div class="client-record" data-client-record>${renderEditor(state)}</div>`;
  const root = page.querySelector("[data-client-record]");
  const form = root.querySelector("[data-client-editor]");
  const saveState = page.querySelector("[data-save-state]");
  const saveButton = form.querySelector("[data-client-save]");
  const { isCreate } = state;

  bindTabs(form);
  if (tab) form.querySelector(`[data-tab="${tab}"]`)?.click();

  const collect = () => ({
    ...Object.fromEntries(
      FORM_FIELDS.filter((field) => field !== "lastContactAt").map((field) => [field, String(form.elements[field]?.value ?? "").trim()]),
    ),
    lastContactAt: contactTimestamp(String(form.elements.lastContactAt?.value ?? "").trim(), state.client.lastContactAt),
  });

  let savedSnapshot = JSON.stringify(collect());
  let dirty = false;
  let saving = false;
  let failed = false;

  function paintSaveState() {
    if (!saveState) return;
    const [key, cls] = saving
      ? ["clientEditor.saving", "is-saving"]
      : failed
        ? ["clientEditor.saveFailed", "is-error"]
        : dirty
          ? ["shell.unsavedChanges", "is-unsaved"]
          : ["common.saved", "is-saved"];
    saveState.hidden = isCreate && !dirty && !saving && !failed;
    saveState.textContent = t(key);
    saveState.className = `save-state ${cls}`;
  }

  function paintIdentity() {
    const values = { ...state.client, ...collect() };
    const identity = page.querySelector("[data-client-identity]");
    if (identity) identity.innerHTML = identityMeta({ ...values, code: values.code || state.client.code });
    const heading = page.querySelector("[data-client-heading]");
    if (heading) heading.textContent = values.name || t("clientEditor.untitled");
    const avatar = page.querySelector("[data-client-avatar]");
    if (avatar) avatar.textContent = initials(values.name);
    const health = page.querySelector("[data-client-health]");
    if (health) health.innerHTML = healthCard(values);
    const duplicate = page.querySelector("[data-duplicate-warning]");
    if (duplicate) duplicate.innerHTML = duplicateMarkup(findDuplicates({ ...values, id: state.client.id }, state.allClients));
  }

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  function showErrors(errors) {
    clearErrors();
    let first = null;
    Object.entries(errors).forEach(([field, message]) => {
      const container = form.querySelector(`[data-field="${field}"]`);
      const input = container?.querySelector("input, select, textarea");
      const error = container?.querySelector(".field-error");
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
      input?.setAttribute("aria-invalid", "true");
      first ??= input;
    });
    // A field on a hidden tab cannot take focus, so open its tab first.
    const panelId = first?.closest("[role='tabpanel']")?.id;
    if (panelId) form.querySelector(`[aria-controls="${panelId}"]`)?.click();
    first?.focus();
    showToast(t("clientEditor.fixHighlighted"));
  }

  function markDirty() {
    dirty = JSON.stringify(collect()) !== savedSnapshot;
    failed = false;
    paintSaveState();
    paintIdentity();
  }

  async function save() {
    if (saving) return;
    const values = collect();
    const errors = validateClient(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    saving = true;
    saveButton.disabled = true;
    paintSaveState();
    try {
      const saved = isCreate ? await createClient(values) : await updateClient(state.client.id, values);
      dirty = false;
      clearNavigationGuard();
      showToast(isCreate ? t("clientEditor.clientCreated") : t("clientEditor.clientSaved"));
      if (isCreate) {
        window.location.hash = `#/clients/${encodeURIComponent(saved.id)}`;
        return;
      }
      await reload(page, saved.id, { tab: activeTab(form) });
    } catch (error) {
      const dataError = toDataError(error, t("clientEditor.saveError"));
      failed = true;
      if (dataError.field && FORM_FIELDS.includes(dataError.field)) showErrors({ [dataError.field]: dataError.message });
      else showToast(dataError.message);
    } finally {
      saving = false;
      if (saveButton.isConnected) saveButton.disabled = false;
      if (saveState?.isConnected) paintSaveState();
    }
  }

  // Actions that write outside the form would be undone, or undo the form,
  // if they ran over unsaved edits: they ask for a save first.
  function blockedByEdits() {
    if (!dirty) return false;
    showToast(t("clientEditor.saveBeforeArchive"));
    return true;
  }

  async function changeLifecycle(archive) {
    if (blockedByEdits()) return;
    const confirmed = await confirmModal({
      title: archive ? t("clients.archiveTitle") : t("clients.unarchiveTitle"),
      body: `<p>${escapeHtml(archive ? t("clients.archiveBody") : t("clients.unarchiveBody"))}</p>`,
      confirmLabel: archive ? t("clients.actionArchive") : t("clients.actionUnarchive"),
      danger: archive,
    });
    if (!confirmed) return;
    try {
      if (archive) await archiveClient(state.client.id);
      else await unarchiveClient(state.client.id);
      showToast(archive ? t("clients.clientArchived") : t("clients.clientUnarchived"));
      await reload(page, state.client.id, { tab: activeTab(form) });
    } catch (error) {
      showToast(describeError(error, t("clients.archiveError")));
    }
  }

  // Keep whatever the user typed in the form: only the side panels reload.
  async function refreshPanels() {
    const fresh = await loadState(state.client.id);
    if (!fresh || !form.isConnected) return;
    Object.assign(state, {
      projects: fresh.projects,
      projectsOk: fresh.projectsOk,
      projectsError: fresh.projectsError,
      linkCandidates: fresh.linkCandidates,
      activity: fresh.activity,
      entries: fresh.entries,
      deals: fresh.deals,
      relatedOk: fresh.relatedOk,
    });
    paintPanels();
  }

  async function changeLink(projectId, link) {
    try {
      if (link) await linkProjectToClient(state.client.id, projectId);
      else await unlinkProjectFromClient(state.client.id, projectId);
      showToast(link ? t("clientEditor.projectLinked") : t("clientEditor.projectUnlinked"));
      await refreshPanels();
    } catch (error) {
      showToast(describeError(error, t("clientEditor.linkError")));
      // Another tab changed the link first: show what is true now.
      if (error?.code === "conflict") await refreshPanels().catch(() => {});
    }
  }

  // A contact moves lastContactAt, which the form also holds, so it reloads
  // the record instead of patching one field under the user's edits.
  async function recordContact() {
    if (blockedByEdits()) return;
    const updated = await openContactDialog(state.client);
    if (updated && page.isConnected) await reload(page, state.client.id, { tab: activeTab(form) });
  }

  async function settleEntry(id) {
    try {
      await markTransactionPaid(id);
      showToast(t("financial.paid"));
      await refreshPanels();
    } catch (error) {
      showToast(describeError(error, t("errors.data.saveTransaction")));
    }
  }

  function paintPanels() {
    const live = { ...state, client: { ...state.client, ...collect(), code: state.client.code } };
    const overview = page.querySelector("[data-client-overview]");
    if (overview) overview.innerHTML = overviewMarkup(live);
    const projects = page.querySelector("[data-client-projects]");
    if (projects) projects.innerHTML = projectsMarkup(state);
    const commercial = page.querySelector("[data-client-commercial]");
    if (commercial) commercial.innerHTML = commercialMarkup(state);
    const financial = page.querySelector("[data-client-financial]");
    if (financial) financial.innerHTML = financialMarkup(state);
    const activity = page.querySelector("[data-client-activity]");
    if (activity) activity.innerHTML = activityMarkup(state.activity);
    const links = page.querySelector("[data-client-links]");
    if (links) links.innerHTML = contactLinks(live.client, { labels: true });
  }

  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
  });

  // One listener for the record: the header lives outside the form.
  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-clear-last-contact]")) {
      form.elements.lastContactAt.value = "";
      markDirty();
    }

    const lifecycle = event.target.closest("[data-client-lifecycle]");
    if (lifecycle) changeLifecycle(lifecycle.dataset.clientLifecycle === "archive");

    if (event.target.closest("[data-link-project]")) {
      const select = form.querySelector("[data-link-project-select]");
      if (select?.value) changeLink(select.value, true);
    }

    const unlink = event.target.closest("[data-unlink-project]");
    if (unlink) changeLink(unlink.dataset.unlinkProject, false);

    if (event.target.closest("[data-record-contact]")) recordContact();

    const openTab = event.target.closest("[data-open-tab]");
    if (openTab) form.querySelector(`[data-tab="${openTab.dataset.openTab}"]`)?.click();

    if (event.target.closest("[data-new-deal]") && (await openDealDialog(state.client))) await refreshPanels();
    if (event.target.closest("[data-new-entry]") && (await openEntryDialog(state.client))) await refreshPanels();

    const settle = event.target.closest("[data-settle-entry]");
    if (settle) settleEntry(settle.dataset.settleEntry);
  });

  // Every static label carries data-i18n; the pieces built from dictionary
  // lookups (badges, health, figures, relative dates) are repainted from the
  // live form values, so typed text and the open tab survive a locale switch.
  onLocaleChange(form, () => {
    paintPanels();
    paintIdentity();
    paintSaveState();
  });

  paintSaveState();
  setNavigationGuard(() => dirty);
}

function activeTab(form) {
  return form.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab;
}

async function reload(page, id, options) {
  const state = await loadState(id);
  if (!page.isConnected) return;
  if (!state) {
    page.innerHTML = renderMissing(id);
    return;
  }
  mount(page, state, options);
}

export const clientDetailPage = {
  title: () => t("clientEditor.title"),
  breadcrumb: () => t("clientEditor.breadcrumb"),
  render: () => `<section class="empty-state" aria-busy="true"><span data-i18n="clientEditor.loading">${escapeHtml(t("clientEditor.loading"))}</span></section>`,
  afterRender: async ({ id }) => {
    const page = document.querySelector(".page");
    try {
      await reload(page, id);
    } catch (error) {
      if (!page.isConnected) return;
      page.innerHTML = `<section class="empty-state"><p>${escapeHtml(describeError(error, t("clientEditor.loadError")))}</p><a class="button" href="#/clients" data-i18n="clientEditor.allClients">${escapeHtml(t("clientEditor.allClients"))}</a></section>`;
    }
  },
};

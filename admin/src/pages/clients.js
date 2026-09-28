import { badge, badgeType, healthBadge } from "../components/badge.js";
import { openContactDialog } from "../components/contact-dialog.js";
import { contactLinks } from "../components/contact-links.js";
import { confirmModal } from "../components/modal.js";
import { bindRowMenus, rowMenu } from "../components/row-menu.js";
import { showToast } from "../components/toast.js";
import { onLocaleChange, plural, statusLabel, t } from "../i18n/index.js";
import { archiveClient, getClients, unarchiveClient, CLIENT_STATUSES } from "../services/client-service.js";
import { getOpportunities } from "../services/commercial-service.js";
import { describeError } from "../services/errors.js";
import { getTransactions } from "../services/financial-service.js";
import { getProjects } from "../services/project-service.js";
import { clientHealth } from "../utils/client-health.js";
import { groupProjectsByClient, matchesClientQuery, projectSummary } from "../utils/client-metrics.js";
import {
  CLIENT_FOCUS,
  CLIENT_SORTS,
  clientFinance,
  clientPipeline,
  contactState,
  groupBy,
  initials,
  matchesFocus,
  sortClients,
} from "../utils/client-relationship.js";
import { csvCell, csvNumber, csvText, downloadCsv } from "../utils/csv.js";
import { todayKey } from "../utils/financial-metrics.js";
import { formatCurrency, formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const FILTERS = ["ALL", ...CLIENT_STATUSES];

/* ------------------------------------------------------------ metrics */

// Before the first read resolves the strip shows dashes, never a zero that
// could be mistaken for a real count.
function metricsMarkup(rows, relatedOk, now) {
  const clients = rows.map((row) => row.client);
  const count = (status) => clients.filter((client) => client.status === status).length;
  const sum = (field) => rows.reduce((total, row) => total + row.finance[field], 0);
  const stale = rows.filter(
    (row) => ["ACTIVE", "LEAD"].includes(row.client.status) && ["stale", "never"].includes(contactState(row.client, now)),
  ).length;
  const metrics = [
    ["clients.metricTotal", String(clients.length), ""],
    ["clients.metricActive", String(count("ACTIVE")), ""],
    ["clients.metricLeads", String(count("LEAD")), ""],
    ["clients.metricReceived", relatedOk ? formatCurrency(sum("received")) : "—", ""],
    ["clients.metricToReceive", relatedOk ? formatCurrency(sum("toReceive")) : "—", ""],
    ["clients.metricStale", String(stale), stale ? "is-warn" : ""],
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

function pendingMetrics() {
  return ["clients.metricTotal", "clients.metricActive", "clients.metricLeads", "clients.metricReceived", "clients.metricToReceive", "clients.metricStale"]
    .map((key) => `<div class="project-metric"><strong>—</strong><span>${escapeHtml(t(key))}</span></div>`)
    .join("");
}

/* --------------------------------------------------------------- rows */

function relationshipCell(row, state) {
  const summary = projectSummary(row.projects);
  const projects = !state.projectsOk
    ? "—"
    : summary.total
      ? `${plural("clients.projectCount", summary.total)} · ${plural("clients.activeProjectCount", summary.active)}`
      : t("clients.noProjects");
  const deals = !state.relatedOk
    ? ""
    : row.pipeline.openCount
      ? `${plural("clients.openDeals", row.pipeline.openCount)} · ${formatCurrency(row.pipeline.openValue)}`
      : t("clients.noOpenDeals");
  return `
    <span class="ops-stack" data-label="${escapeAttribute(t("clients.columnRelationship"))}">
      <span class="ops-meta">${escapeHtml(projects)}</span>
      ${deals ? `<small class="${row.pipeline.openCount ? "is-live" : ""}">${escapeHtml(deals)}</small>` : ""}
    </span>
  `;
}

function financeCell(row, state) {
  if (!state.relatedOk) return `<span class="ops-meta" data-label="${escapeAttribute(t("clients.columnFinance"))}">—</span>`;
  const { received, toReceive, overdue } = row.finance;
  if (!received && !toReceive) {
    return `<span class="ops-meta is-muted" data-label="${escapeAttribute(t("clients.columnFinance"))}">${escapeHtml(t("clients.noMoney"))}</span>`;
  }
  return `
    <span class="ops-stack" data-label="${escapeAttribute(t("clients.columnFinance"))}">
      <span class="ops-meta">${escapeHtml(t("clients.received", { amount: formatCurrency(received) }))}</span>
      ${
        overdue
          ? `<small class="is-danger">${escapeHtml(t("clients.overdue", { amount: formatCurrency(overdue) }))}</small>`
          : toReceive
            ? `<small>${escapeHtml(t("clients.toReceive", { amount: formatCurrency(toReceive) }))}</small>`
            : ""
      }
    </span>
  `;
}

function contactCell(client, now) {
  const state = contactState(client, now);
  const quiet = state === "stale" || (state === "never" && ["ACTIVE", "LEAD"].includes(client.status));
  const value = client.lastContactAt
    ? `<span class="ops-meta" data-relative-date="${escapeAttribute(client.lastContactAt)}">${escapeHtml(formatRelativeDay(client.lastContactAt))}</span>`
    : `<span class="ops-meta is-muted">${escapeHtml(t("clients.neverContacted"))}</span>`;
  return `
    <span class="ops-stack" data-label="${escapeAttribute(t("clients.columnLastContact"))}">
      ${value}
      ${quiet ? `<small class="is-warning">${escapeHtml(t("clients.staleContact"))}</small>` : ""}
    </span>
  `;
}

// Client name, company, email and phone are records rather than copy: they
// read identically in both locales.
function clientRow(row, state, now) {
  const { client } = row;
  const health = clientHealth(client);
  const archived = client.status === "ARCHIVED";
  const href = `#/clients/${encodeURIComponent(client.id)}`;

  return `
    <article class="ops-row clients-row${archived ? " is-archived" : ""}" data-client-row data-client-id="${escapeAttribute(client.id)}">
      <span class="ops-row__primary clients-row__who">
        <span class="client-avatar client-avatar--${client.status.toLowerCase()}" aria-hidden="true">${escapeHtml(initials(client.name))}</span>
        <span class="clients-row__identity">
          <a class="clients-row__name" href="${escapeAttribute(href)}"><strong>${escapeHtml(client.name)}</strong></a>
          <small>${escapeHtml(client.code)} · ${escapeHtml(client.company || "—")}</small>
        </span>
      </span>
      <span class="ops-stack clients-row__contact" data-label="${escapeAttribute(t("clients.columnContact"))}">
        <span class="ops-meta">${escapeHtml(client.email || "—")}</span>
        <small>${escapeHtml(client.phone || "—")}</small>
        ${contactLinks(client)}
      </span>
      ${relationshipCell(row, state)}
      ${financeCell(row, state)}
      ${contactCell(client, now)}
      <span class="clients-row__badges" data-label="${escapeAttribute(t("clients.columnStatus"))}">
        ${badge(client.status, badgeType(client.status))}
        ${healthBadge(health.status, `clientHealth.status.${health.status}`)}
      </span>
      <span class="clients-row__actions">
        <a class="button button--compact" href="${escapeAttribute(href)}" data-client-open="${escapeAttribute(client.id)}">${escapeHtml(t("clients.actionOpen"))}</a>
        ${rowMenu({
          label: t("clients.actions"),
          items: [
            { label: t("clients.actionOpen"), href },
            ...(archived ? [] : [{ label: t("clientEditor.recordContact"), attrs: `data-client-contact="${escapeAttribute(client.id)}" data-requires="clients.edit"` }]),
            archived
              ? { label: t("clients.actionUnarchive"), attrs: `data-client-unarchive="${escapeAttribute(client.id)}" data-requires="clients.archive"` }
              : { label: t("clients.actionArchive"), attrs: `data-client-archive="${escapeAttribute(client.id)}" data-requires="clients.archive"` },
          ],
        })}
      </span>
    </article>
  `;
}

// Status chips carry their own count, so the filter doubles as a breakdown.
function filterChips(rows, active) {
  return FILTERS.map((filter) => {
    const isActive = filter === active;
    const count = filter === "ALL" ? rows.length : rows.filter((row) => row.client.status === filter).length;
    const label = filter === "ALL" ? t("common.all") : statusLabel(filter);
    return `
      <button type="button" class="log-channel${isActive ? " is-active" : ""}" data-client-filter="${filter}" aria-pressed="${isActive}">
        <span>${escapeHtml(label)}</span>
        <b>${escapeHtml(count)}</b>
      </button>
    `;
  }).join("");
}

function optionList(options, selected) {
  return options
    .map(([value, label]) => `<option value="${escapeAttribute(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

async function confirmLifecycle(archive) {
  return confirmModal({
    title: archive ? t("clients.archiveTitle") : t("clients.unarchiveTitle"),
    body: `<p>${escapeHtml(archive ? t("clients.archiveBody") : t("clients.unarchiveBody"))}</p>`,
    confirmLabel: archive ? t("clients.actionArchive") : t("clients.actionUnarchive"),
    danger: archive,
  });
}

export const clientsPage = {
  title: () => t("clients.title"),
  breadcrumb: () => t("clients.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="clients.eyebrow">${t("clients.eyebrow")}</span>
        <h2 data-i18n="clients.heading">${t("clients.heading")}</h2>
        <p data-i18n="clients.intro">${t("clients.intro")}</p>
      </div>
      <div class="heading-actions">
        <button class="button" type="button" data-client-export data-requires="data.export" disabled data-i18n="clients.exportCsv">${t("clients.exportCsv")}</button>
        <a class="button button--primary" href="#/clients/new" data-new-client data-requires="clients.create" data-i18n="clients.newClient">${t("clients.newClient")}</a>
      </div>
    </section>

    <div class="metric-strip clients-metrics" aria-label="${escapeAttribute(t("clients.summary"))}" data-i18n-aria-label="clients.summary" data-client-metrics aria-live="polite">
      ${pendingMetrics()}
    </div>

    <div class="clients-toolbar">
      <label class="search-field">
        <span data-i18n="clients.searchClients">${t("clients.searchClients")}</span>
        <input data-search-clients type="search" placeholder="${t("clients.searchPlaceholder")}" data-i18n-placeholder="clients.searchPlaceholder" disabled>
      </label>
      <label class="sort-field">
        <span data-i18n="clients.sortBy">${t("clients.sortBy")}</span>
        <select data-client-sort>${optionList(CLIENT_SORTS.map((sort) => [sort, t(`clients.sorts.${sort}`)]), "updated")}</select>
      </label>
      <label class="sort-field">
        <span data-i18n="clients.focus">${t("clients.focus")}</span>
        <select data-client-focus>${optionList(CLIENT_FOCUS.map((focus) => [focus, t(`clients.focuses.${focus}`)]), "all")}</select>
      </label>
    </div>

    <div class="log-channels" role="group" aria-label="${t("clients.filterByStatus")}" data-i18n-aria-label="clients.filterByStatus" data-client-filters></div>

    <p class="ops-count" data-client-count></p>
    <p class="ops-note" data-client-projects-note hidden></p>

    <div class="ops-table-scroll">
      <div class="ops-table clients-table" data-client-list aria-live="polite" aria-busy="true">
        <p class="empty-inline" data-i18n="clients.loading">${t("clients.loading")}</p>
      </div>
    </div>
  `,
  afterRender: async () => {
    const list = document.querySelector("[data-client-list]");
    const count = document.querySelector("[data-client-count]");
    const search = document.querySelector("[data-search-clients]");
    const metrics = document.querySelector("[data-client-metrics]");
    const note = document.querySelector("[data-client-projects-note]");
    const filtersRoot = document.querySelector("[data-client-filters]");
    const sort = document.querySelector("[data-client-sort]");
    const focus = document.querySelector("[data-client-focus]");
    const exportButton = document.querySelector("[data-client-export]");

    let activeFilter = "ALL";
    let rows = [];
    let visible = [];
    const state = { projectsOk: false, relatedOk: false };
    let loaded = false;

    const head = () => `
      <div class="ops-table__head" aria-hidden="true">
        <span>${t("clients.columnClient")}</span><span>${t("clients.columnContact")}</span><span>${t("clients.columnRelationship")}</span><span>${t("clients.columnFinance")}</span><span>${t("clients.columnLastContact")}</span><span>${t("clients.columnStatus")}</span><span>${t("clients.columnActions")}</span>
      </div>
    `;

    const renderList = () => {
      if (!loaded) return;
      const now = new Date();
      const query = search.value.trim();
      visible = sortClients(
        rows.filter(
          (row) =>
            matchesClientQuery(row.client, query) &&
            (activeFilter === "ALL" || row.client.status === activeFilter) &&
            matchesFocus(row, focus.value, now),
        ),
        sort.value,
      );

      const emptyMessage = !rows.length
        ? t("clients.noClients")
        : query
          ? t("clients.noMatch", { query: escapeHtml(query) })
          : t("clients.emptyForStatus");

      list.innerHTML = `${head()}${
        visible.length ? visible.map((row) => clientRow(row, state, now)).join("") : `<p class="empty-inline">${emptyMessage}</p>`
      }`;

      metrics.innerHTML = metricsMarkup(rows, state.relatedOk, now);
      filtersRoot.innerHTML = filterChips(rows, activeFilter);

      // The noun agrees with the total, not with the filtered count, so a
      // single match still reads "1 de 6 clientes".
      count.textContent = plural("clients.countLabel", rows.length, { visible: visible.length, total: rows.length });
      exportButton.disabled = !visible.length;

      const notes = [];
      if (!state.projectsOk) notes.push(t("clients.projectsUnavailable"));
      if (!state.relatedOk) notes.push(t("clients.relatedUnavailable"));
      note.hidden = !notes.length;
      note.textContent = notes.join(" · ");
    };

    const load = async () => {
      // Projects, deals and entries only enrich the list: if any fails,
      // clients still render and the affected columns read "—".
      const [clientsResult, projectsResult, entriesResult, dealsResult] = await Promise.allSettled([
        getClients(),
        getProjects(),
        getTransactions(),
        getOpportunities(),
      ]);
      if (!list.isConnected) return false;

      if (clientsResult.status === "rejected") {
        list.removeAttribute("aria-busy");
        list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(clientsResult.reason, t("clients.loadError")))}</p>`;
        return false;
      }

      state.projectsOk = projectsResult.status === "fulfilled";
      state.relatedOk = entriesResult.status === "fulfilled" && dealsResult.status === "fulfilled";
      const projectsByClient = state.projectsOk ? groupProjectsByClient(projectsResult.value) : new Map();
      const entriesByClient = entriesResult.status === "fulfilled" ? groupBy(entriesResult.value) : new Map();
      const dealsByClient = dealsResult.status === "fulfilled" ? groupBy(dealsResult.value) : new Map();
      const now = new Date();

      rows = clientsResult.value.map((client) => ({
        client,
        projects: projectsByClient.get(client.id) ?? [],
        finance: clientFinance(entriesByClient.get(client.id) ?? [], now),
        pipeline: clientPipeline(dealsByClient.get(client.id) ?? [], now),
      }));
      loaded = true;
      return true;
    };

    const reload = async () => {
      if (await load()) renderList();
    };

    const changeLifecycle = async (id, archive) => {
      if (!(await confirmLifecycle(archive))) return;
      try {
        if (archive) await archiveClient(id);
        else await unarchiveClient(id);
        showToast(archive ? t("clients.clientArchived") : t("clients.clientUnarchived"));
        await reload();
      } catch (error) {
        showToast(describeError(error, t("clients.archiveError")));
      }
    };

    function exportVisible() {
      const header = ["code", "name", "company", "email", "phone", "status", "last_contact", "received", "to_receive", "overdue", "open_deals", "open_pipeline", "projects"];
      const csvRows = visible.map(({ client, finance, pipeline, projects }) => [
        csvCell(client.code),
        csvCell(client.name),
        csvCell(client.company),
        csvCell(client.email),
        csvCell(client.phone),
        csvCell(client.status),
        csvCell(client.lastContactAt ? String(client.lastContactAt).slice(0, 10) : ""),
        csvNumber(finance.received),
        csvNumber(finance.toReceive),
        csvNumber(finance.overdue),
        csvNumber(pipeline.openCount),
        csvNumber(pipeline.openValue),
        csvNumber(projects.length),
      ]);
      downloadCsv(`space-underground-clientes-${todayKey()}.csv`, csvText(header, csvRows));
      showToast(plural("clients.exported", visible.length));
    }

    bindRowMenus(list);
    list.addEventListener("click", async (event) => {
      const archive = event.target.closest("[data-client-archive]");
      const restore = event.target.closest("[data-client-unarchive]");
      const contact = event.target.closest("[data-client-contact]");
      if (archive) changeLifecycle(archive.dataset.clientArchive, true);
      if (restore) changeLifecycle(restore.dataset.clientUnarchive, false);
      if (contact) {
        const row = rows.find((item) => item.client.id === contact.dataset.clientContact);
        if (row && (await openContactDialog(row.client))) await reload();
      }
    });

    filtersRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-client-filter]");
      if (!button) return;
      activeFilter = button.dataset.clientFilter;
      renderList();
    });
    search.addEventListener("input", renderList);
    sort.addEventListener("change", renderList);
    focus.addEventListener("change", renderList);
    exportButton.addEventListener("click", exportVisible);

    // Re-labels rows, chips and metrics from the live search/filter state, so
    // switching locale keeps the typed query, the active filter and the scroll
    // position, without a new query.
    onLocaleChange(list, () => {
      [...sort.options].forEach((option) => {
        option.textContent = t(`clients.sorts.${option.value}`);
      });
      [...focus.options].forEach((option) => {
        option.textContent = t(`clients.focuses.${option.value}`);
      });
      renderList();
    });

    if (await load()) {
      list.removeAttribute("aria-busy");
      search.disabled = false;
      renderList();
    }
  },
};

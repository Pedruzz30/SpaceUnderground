import { badge, badgeType, healthBadge } from "../components/badge.js";
import { confirmModal } from "../components/modal.js";
import { bindRowMenus, rowMenu } from "../components/row-menu.js";
import { statCard } from "../components/stat-card.js";
import { showToast } from "../components/toast.js";
import { onLocaleChange, plural, statusLabel, t } from "../i18n/index.js";
import { archiveClient, getClients, unarchiveClient, CLIENT_STATUSES } from "../services/client-service.js";
import { describeError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { clientHealth } from "../utils/client-health.js";
import { clientMetrics, groupProjectsByClient, matchesClientQuery, projectSummary } from "../utils/client-metrics.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const FILTERS = ["ALL", ...CLIENT_STATUSES];

const METRICS = [
  ["total", "clients.totalClients", "clients.totalClientsDetail"],
  ["active", "clients.active", "clients.activeDetail"],
  ["leads", "clients.leads", "clients.leadsDetail"],
  ["withActiveProjects", "clients.withActiveProjects", "clients.withActiveProjectsDetail"],
  ["inactiveOrArchived", "clients.inactiveArchived", "clients.inactiveArchivedDetail"],
];

// Before the first read resolves the cards show a dash, never a zero that
// could be mistaken for a real count.
function renderMetrics(values = null) {
  return METRICS.map(([field, labelKey, detailKey]) =>
    statCard({
      label: t(labelKey),
      labelKey,
      value: values ? values[field] : "—",
      detail: t(detailKey),
      detailKey,
    }),
  ).join("");
}

function projectsCell(summary, projectsOk) {
  if (!projectsOk) return `<span class="ops-meta" data-label="${t("clients.columnProjects")}">—</span>`;
  if (!summary.total) {
    return `<span class="ops-meta" data-label="${t("clients.columnProjects")}">${escapeHtml(t("clients.noProjects"))}</span>`;
  }
  return `
    <span class="ops-stack" data-label="${t("clients.columnProjects")}">
      <span class="ops-meta">${escapeHtml(plural("clients.projectCount", summary.total))}</span>
      <small>${escapeHtml(plural("clients.activeProjectCount", summary.active))}</small>
    </span>
  `;
}

// Client name, company, email and phone are records rather than copy: they
// read identically in both locales.
function clientRow(client, projects, projectsOk) {
  const health = clientHealth(client);
  const archived = client.status === "ARCHIVED";
  const href = `#/clients/${encodeURIComponent(client.id)}`;

  return `
    <article class="ops-row clients-row" data-client-row data-client-id="${escapeAttribute(client.id)}">
      <span class="ops-row__primary">
        <a class="clients-row__name" href="${escapeAttribute(href)}"><strong>${escapeHtml(client.name)}</strong></a>
        <small>${escapeHtml(client.code)} · ${escapeHtml(client.company || "—")}</small>
      </span>
      <span class="ops-stack" data-label="${t("clients.columnContact")}">
        <span class="ops-meta">${escapeHtml(client.email || "—")}</span>
        <small>${escapeHtml(client.phone || "—")}</small>
      </span>
      ${projectsCell(projectSummary(projects), projectsOk)}
      <span data-label="${t("clients.columnStatus")}">${badge(client.status, badgeType(client.status))}</span>
      <span data-label="${t("clients.columnHealth")}">${healthBadge(health.status, `clientHealth.status.${health.status}`)}</span>
      <span class="ops-meta" data-label="${t("clients.columnUpdated")}" data-relative-date="${escapeAttribute(client.updatedAt ?? "")}">${escapeHtml(formatRelativeDay(client.updatedAt))}</span>
      <span class="clients-row__actions">
        <a class="button button--compact" href="${escapeAttribute(href)}" data-client-open="${escapeAttribute(client.id)}">${escapeHtml(t("clients.actionOpen"))}</a>
        ${rowMenu({
          label: t("clients.actions"),
          items: [
            { label: t("clients.actionOpen"), href },
            archived
              ? { label: t("clients.actionUnarchive"), attrs: `data-client-unarchive="${escapeAttribute(client.id)}"` }
              : { label: t("clients.actionArchive"), attrs: `data-client-archive="${escapeAttribute(client.id)}"` },
          ],
        })}
      </span>
    </article>
  `;
}

function filterButton(filter, activeFilter) {
  const isActive = filter === activeFilter;
  // ALL is a UI word; the lifecycle values are stored enums re-labelled
  // through statusLabel() by applyStaticTranslations().
  const label =
    filter === "ALL"
      ? `data-i18n="common.all">${escapeHtml(t("common.all"))}`
      : `data-status-label="${filter}">${escapeHtml(statusLabel(filter))}`;
  return `<button type="button" class="${isActive ? "is-active" : ""}" data-client-filter="${filter}" aria-pressed="${isActive}" ${label}</button>`;
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
        <a class="button button--primary" href="#/clients/new" data-new-client data-i18n="clients.newClient">${t("clients.newClient")}</a>
      </div>
    </section>

    <section class="stats-grid stats-grid--quad stats-grid--five" aria-label="${t("clients.summary")}" data-i18n-aria-label="clients.summary" data-client-metrics>
      ${renderMetrics()}
    </section>

    <section class="panel">
      <div class="toolbar">
        <label class="search-field">
          <span data-i18n="clients.searchClients">${t("clients.searchClients")}</span>
          <input data-search-clients type="search" placeholder="${t("clients.searchPlaceholder")}" data-i18n-placeholder="clients.searchPlaceholder" disabled>
        </label>
        <div class="toolbar__controls">
          <div class="segmented" role="group" aria-label="${t("clients.filterByStatus")}" data-i18n-aria-label="clients.filterByStatus">
            ${FILTERS.map((filter) => filterButton(filter, "ALL")).join("")}
          </div>
        </div>
      </div>

      <p class="ops-count" data-client-count></p>
      <p class="ops-note" data-client-projects-note hidden></p>

      <div class="ops-table-scroll">
        <div class="ops-table clients-table" data-client-list aria-live="polite" aria-busy="true">
          <p class="empty-inline" data-i18n="clients.loading">${t("clients.loading")}</p>
        </div>
      </div>
    </section>
  `,
  afterRender: async () => {
    const list = document.querySelector("[data-client-list]");
    const count = document.querySelector("[data-client-count]");
    const search = document.querySelector("[data-search-clients]");
    const metrics = document.querySelector("[data-client-metrics]");
    const projectsNote = document.querySelector("[data-client-projects-note]");
    const filters = [...document.querySelectorAll("[data-client-filter]")];

    let activeFilter = "ALL";
    let clients = [];
    let projectsByClient = new Map();
    let projectsOk = false;
    let loaded = false;

    const head = () => `
      <div class="ops-table__head" aria-hidden="true">
        <span>${t("clients.columnClient")}</span><span>${t("clients.columnContact")}</span><span>${t("clients.columnProjects")}</span><span>${t("clients.columnStatus")}</span><span>${t("clients.columnHealth")}</span><span>${t("clients.columnUpdated")}</span><span>${t("clients.columnActions")}</span>
      </div>
    `;

    const renderList = () => {
      if (!loaded) return;
      const query = search.value.trim();
      const visible = clients.filter(
        (client) => matchesClientQuery(client, query) && (activeFilter === "ALL" || client.status === activeFilter),
      );

      const emptyMessage = !clients.length
        ? t("clients.noClients")
        : query
          ? t("clients.noMatch", { query: escapeHtml(query) })
          : t("clients.emptyForStatus");

      list.innerHTML = `${head()}${
        visible.length
          ? visible.map((client) => clientRow(client, projectsByClient.get(client.id) ?? [], projectsOk)).join("")
          : `<p class="empty-inline">${emptyMessage}</p>`
      }`;

      metrics.innerHTML = renderMetrics(clientMetrics(clients, projectsByClient));

      // The noun agrees with the total, not with the filtered count, so a
      // single match still reads "1 de 6 clientes".
      count.textContent = plural("clients.countLabel", clients.length, { visible: visible.length, total: clients.length });

      projectsNote.hidden = projectsOk;
      projectsNote.textContent = projectsOk ? "" : t("clients.projectsUnavailable");
    };

    const load = async () => {
      // Projects only enrich the list: if they fail, clients still render.
      const [clientsResult, projectsResult] = await Promise.allSettled([getClients(), getProjects()]);
      if (!list.isConnected) return false;

      if (clientsResult.status === "rejected") {
        list.removeAttribute("aria-busy");
        list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(clientsResult.reason, t("clients.loadError")))}</p>`;
        return false;
      }

      clients = clientsResult.value;
      projectsOk = projectsResult.status === "fulfilled";
      projectsByClient = projectsOk ? groupProjectsByClient(projectsResult.value) : new Map();
      loaded = true;
      return true;
    };

    const changeLifecycle = async (id, archive) => {
      if (!(await confirmLifecycle(archive))) return;
      try {
        if (archive) await archiveClient(id);
        else await unarchiveClient(id);
        showToast(archive ? t("clients.clientArchived") : t("clients.clientUnarchived"));
        if (await load()) renderList();
      } catch (error) {
        showToast(describeError(error, t("clients.archiveError")));
      }
    };

    bindRowMenus(list);
    list.addEventListener("click", (event) => {
      const archive = event.target.closest("[data-client-archive]");
      const restore = event.target.closest("[data-client-unarchive]");
      if (archive) changeLifecycle(archive.dataset.clientArchive, true);
      if (restore) changeLifecycle(restore.dataset.clientUnarchive, false);
    });

    filters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.clientFilter;
        filters.forEach((item) => {
          const isActive = item === button;
          item.classList.toggle("is-active", isActive);
          item.setAttribute("aria-pressed", String(isActive));
        });
        renderList();
      });
    });
    search.addEventListener("input", renderList);

    // Re-labels rows and metrics from the live search/filter state, so
    // switching locale keeps the typed query, the active filter and the scroll
    // position, without a new query.
    onLocaleChange(list, renderList);

    if (await load()) {
      list.removeAttribute("aria-busy");
      search.disabled = false;
      renderList();
    }
  },
};

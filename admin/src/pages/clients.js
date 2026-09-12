import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { showToast } from "../components/toast.js";
import { demoClients } from "../data/operations-demo.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { formatCurrency, formatRelativeDay } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";

const FILTERS = ["ALL", "ACTIVE", "LEAD", "INACTIVE", "ARCHIVED"];

function activeProjects(client) {
  return client.projects.filter((project) => project.status === "ACTIVE").length;
}

function renderMetrics(clients) {
  const active = clients.filter((client) => client.status === "ACTIVE").length;
  const withProjects = clients.filter((client) => activeProjects(client) > 0).length;
  const inactive = clients.filter((client) => client.status === "INACTIVE").length;

  return `
    ${statCard({
      label: t("clients.totalClients"),
      labelKey: "clients.totalClients",
      value: clients.length,
      detail: t("clients.totalClientsDetail"),
      detailKey: "clients.totalClientsDetail",
    })}
    ${statCard({
      label: t("clients.active"),
      labelKey: "clients.active",
      value: active,
      detail: t("clients.activeDetail"),
      detailKey: "clients.activeDetail",
    })}
    ${statCard({
      label: t("clients.withActiveProjects"),
      labelKey: "clients.withActiveProjects",
      value: withProjects,
      detail: t("clients.withActiveProjectsDetail"),
      detailKey: "clients.withActiveProjectsDetail",
    })}
    ${statCard({
      label: t("clients.inactive"),
      labelKey: "clients.inactive",
      value: inactive,
      detail: t("clients.inactiveDetail"),
      detailKey: "clients.inactiveDetail",
    })}
  `;
}

function projectsLabel(client) {
  const total = client.projects.length;
  if (!total) return t("clients.noProjects");
  return plural("clients.projectCount", total);
}

// Client name, company, email and phone are records rather than copy: they read
// identically in both locales.
function clientRow(client) {
  return `
    <a class="ops-row ops-row--link" href="#/clients/${encodeURIComponent(client.id)}" data-client-row>
      <span class="ops-row__primary">
        <strong>${escapeHtml(client.name)}</strong>
        <small>${t("clients.clientPrefix")} / ${escapeHtml(client.code)} · ${escapeHtml(client.company || "—")}</small>
      </span>
      <span class="ops-stack" data-label="${t("clients.columnContact")}">
        <span class="ops-meta">${escapeHtml(client.email)}</span>
        <small>${escapeHtml(client.phone || "—")}</small>
      </span>
      <span class="ops-meta" data-label="${t("clients.columnProjects")}">${escapeHtml(projectsLabel(client))}</span>
      <span data-label="${t("clients.columnStatus")}">${badge(client.status, badgeType(client.status))}</span>
      <span class="ops-meta" data-label="${t("clients.columnTotalValue")}">${escapeHtml(formatCurrency(client.totalValue))}</span>
      <span class="ops-meta" data-label="${t("clients.columnUpdated")}">${escapeHtml(formatRelativeDay(client.updatedAt))}</span>
      <span class="ops-row__arrow" aria-hidden="true">&rarr;</span>
    </a>
  `;
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
        <button class="button button--primary" type="button" data-new-client data-i18n="clients.newClient">${t("clients.newClient")}</button>
      </div>
    </section>

    <section class="stats-grid stats-grid--quad" aria-label="${t("clients.summary")}" data-i18n-aria-label="clients.summary" data-client-metrics>
      ${renderMetrics(demoClients)}
    </section>

    <section class="panel">
      <div class="toolbar">
        <label class="search-field">
          <span data-i18n="clients.searchClients">${t("clients.searchClients")}</span>
          <input data-search-clients type="search" placeholder="${t("clients.searchPlaceholder")}" data-i18n-placeholder="clients.searchPlaceholder">
        </label>
        <div class="toolbar__controls">
          <div class="segmented" role="group" aria-label="${t("clients.filterByStatus")}" data-i18n-aria-label="clients.filterByStatus">
            ${FILTERS.map(
              (filter, index) => `
                <button type="button" class="${index === 0 ? "is-active" : ""}" data-client-filter="${filter}" aria-pressed="${index === 0}">${filter}</button>
              `,
            ).join("")}
          </div>
        </div>
      </div>

      <p class="ops-count" data-client-count></p>

      <div class="ops-table-scroll">
        <div class="ops-table clients-table" data-client-list aria-live="polite">
          <div class="ops-table__head" aria-hidden="true">
            <span data-i18n="clients.columnClient">${t("clients.columnClient")}</span><span data-i18n="clients.columnContact">${t("clients.columnContact")}</span><span data-i18n="clients.columnProjects">${t("clients.columnProjects")}</span><span data-i18n="clients.columnStatus">${t("clients.columnStatus")}</span><span data-i18n="clients.columnTotalValue">${t("clients.columnTotalValue")}</span><span data-i18n="clients.columnUpdated">${t("clients.columnUpdated")}</span><span></span>
          </div>
        </div>
      </div>
    </section>

    <p class="ops-note ops-note--spaced" data-i18n="clients.presentationNote">${t("clients.presentationNote")}</p>
  `,
  afterRender: () => {
    const list = document.querySelector("[data-client-list]");
    const count = document.querySelector("[data-client-count]");
    const search = document.querySelector("[data-search-clients]");
    const filters = [...document.querySelectorAll("[data-client-filter]")];
    const head = list.querySelector(".ops-table__head");
    let activeFilter = "ALL";

    document.querySelector("[data-new-client]")?.addEventListener("click", () => {
      showToast(t("clients.creationSoon"));
    });

    const renderList = () => {
      const query = search.value.trim().toLowerCase();
      const visible = demoClients
        .filter((client) => {
          const matchesQuery =
            !query ||
            [client.name, client.company, client.email, client.phone, client.code].some((value) =>
              String(value ?? "").toLowerCase().includes(query),
            );
          const matchesFilter = activeFilter === "ALL" || client.status === activeFilter;
          return matchesQuery && matchesFilter;
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      const emptyMessage = query
        ? t("clients.noMatch", { query: escapeHtml(search.value.trim()) })
        : t("clients.emptyForStatus");

      list.innerHTML = "";
      list.append(head);
      list.insertAdjacentHTML(
        "beforeend",
        visible.length ? visible.map(clientRow).join("") : `<p class="empty-inline">${emptyMessage}</p>`,
      );

      count.textContent = plural("clients.countLabel", visible.length, {
        visible: visible.length,
        total: demoClients.length,
      });

      list.querySelectorAll("[data-client-row]").forEach((row) => {
        // Immediate feedback while the detail route renders.
        row.addEventListener("click", () => row.classList.add("is-selected"));
      });
    };

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
    renderList();

    // Re-labels rows and metrics from the live search/filter state, so switching
    // locale keeps the typed query, the active filter and the scroll position.
    onLocaleChange(list, () => {
      const metrics = document.querySelector("[data-client-metrics]");
      if (metrics) metrics.innerHTML = renderMetrics(demoClients);
      renderList();
    });
  },
};

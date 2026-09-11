import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { showToast } from "../components/toast.js";
import { demoClients } from "../data/operations-demo.js";
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
    ${statCard({ label: "TOTAL CLIENTS", value: clients.length, detail: "Relationships tracked" })}
    ${statCard({ label: "ACTIVE", value: active, detail: "Currently engaged" })}
    ${statCard({ label: "WITH ACTIVE PROJECTS", value: withProjects, detail: "Delivery in progress" })}
    ${statCard({ label: "INACTIVE", value: inactive, detail: "No open scope" })}
  `;
}

function projectsLabel(client) {
  const total = client.projects.length;
  if (!total) return "No projects";
  return `${total} project${total === 1 ? "" : "s"}`;
}

function clientRow(client) {
  return `
    <a class="ops-row ops-row--link" href="#/clients/${encodeURIComponent(client.id)}" data-client-row>
      <span class="ops-row__primary">
        <strong>${escapeHtml(client.name)}</strong>
        <small>CLIENT / ${escapeHtml(client.code)} · ${escapeHtml(client.company || "—")}</small>
      </span>
      <span class="ops-stack" data-label="Contact">
        <span class="ops-meta">${escapeHtml(client.email)}</span>
        <small>${escapeHtml(client.phone || "—")}</small>
      </span>
      <span class="ops-meta" data-label="Projects">${escapeHtml(projectsLabel(client))}</span>
      <span data-label="Status">${badge(client.status, badgeType(client.status))}</span>
      <span class="ops-meta" data-label="Total value">${escapeHtml(formatCurrency(client.totalValue))}</span>
      <span class="ops-meta" data-label="Updated">${escapeHtml(formatRelativeDay(client.updatedAt))}</span>
      <span class="ops-row__arrow" aria-hidden="true">&rarr;</span>
    </a>
  `;
}

export const clientsPage = {
  title: "Clients",
  breadcrumb: "OPERATIONS / CLIENTS",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>CLIENTS</span>
        <h2>Client directory.</h2>
        <p>Manage relationships, projects and client history.</p>
      </div>
      <div class="heading-actions">
        <button class="button button--primary" type="button" data-new-client>New Client</button>
      </div>
    </section>

    <section class="stats-grid stats-grid--quad" aria-label="Client summary">
      ${renderMetrics(demoClients)}
    </section>

    <section class="panel">
      <div class="toolbar">
        <label class="search-field">
          <span>Search clients</span>
          <input data-search-clients type="search" placeholder="Search clients...">
        </label>
        <div class="toolbar__controls">
          <div class="segmented" role="group" aria-label="Filter clients by status">
            ${FILTERS.map(
              (filter, index) => `
                <button type="button" class="${index === 0 ? "is-active" : ""}" data-client-filter="${filter}" aria-pressed="${index === 0}">${filter}</button>
              `,
            ).join("")}
          </div>
        </div>
      </div>

      <p class="ops-count" data-client-count></p>

      <div class="ops-table clients-table" data-client-list aria-live="polite">
        <div class="ops-table__head" aria-hidden="true">
          <span>CLIENT</span><span>CONTACT</span><span>PROJECTS</span><span>STATUS</span><span>TOTAL VALUE</span><span>UPDATED</span><span></span>
        </div>
      </div>
    </section>

    <p class="ops-note ops-note--spaced">Presentation data · client records are not persisted yet</p>
  `,
  afterRender: () => {
    const list = document.querySelector("[data-client-list]");
    const count = document.querySelector("[data-client-count]");
    const search = document.querySelector("[data-search-clients]");
    const filters = [...document.querySelectorAll("[data-client-filter]")];
    const head = list.querySelector(".ops-table__head");
    let activeFilter = "ALL";

    document.querySelector("[data-new-client]")?.addEventListener("click", () => {
      showToast("Client creation arrives with the clients backend.");
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
        ? `No clients match "${escapeHtml(search.value.trim())}".`
        : "No clients with this status yet.";

      list.innerHTML = "";
      list.append(head);
      list.insertAdjacentHTML(
        "beforeend",
        visible.length ? visible.map(clientRow).join("") : `<p class="empty-inline">${emptyMessage}</p>`,
      );

      count.textContent = `${visible.length} of ${demoClients.length} clients`;

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
  },
};

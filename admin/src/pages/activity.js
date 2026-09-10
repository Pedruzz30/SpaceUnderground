import { getActivity } from "../services/activity-service.js";
import { escapeHtml } from "../utils/html.js";

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" });
}

function groupFor(entry) {
  const value = `${entry.action || ""} ${entry.entityType || ""}`.toLowerCase();
  if (value.includes("project") || value.includes("publish")) return "Projects";
  if (value.includes("media")) return "Media";
  if (value.includes("content")) return "Content";
  if (value.includes("settings")) return "Settings";
  return "All";
}

function row(entry) {
  return `
    <div class="activity-row" data-activity-group="${escapeHtml(groupFor(entry))}">
      <span>${escapeHtml(formatTime(entry.time))}</span>
      <strong>${escapeHtml(entry.title)}</strong>
      <p>${escapeHtml(entry.detail || entry.action || "No detail.")}</p>
      <small>${escapeHtml(entry.entityType || "system")}</small>
    </div>
  `;
}

export const activityPage = {
  title: "Activity",
  breadcrumb: "SYSTEM / ACTIVITY",
  render: () => `
    <section class="page-heading">
      <span>ACTIVITY</span>
      <h2>Administrative log.</h2>
      <p>Relevant editorial, media and system actions.</p>
    </section>
    <section class="panel">
      <div class="segmented" role="group" aria-label="Filter activity">
        ${["All", "Projects", "Media", "Publishing", "Content", "Settings"].map((item, index) => `<button type="button" class="${index === 0 ? "is-active" : ""}" data-activity-filter="${item}" aria-pressed="${index === 0}">${item}</button>`).join("")}
      </div>
      <div class="activity-table" data-activity-table aria-busy="true">
        <p class="empty-inline">Loading activity...</p>
      </div>
    </section>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-activity-table]");
    const filters = [...document.querySelectorAll("[data-activity-filter]")];
    let entries = [];

    function render(filter = "All") {
      const visible = filter === "All" ? entries : entries.filter((entry) => groupFor(entry) === filter || (filter === "Publishing" && String(entry.action).includes("publish")));
      root.innerHTML = visible.length ? visible.map(row).join("") : '<p class="empty-inline">No activity for this filter.</p>';
    }

    filters.forEach((button) => {
      button.addEventListener("click", () => {
        filters.forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        render(button.dataset.activityFilter);
      });
    });

    entries = await getActivity({ limit: 60 });
    render();
    root.removeAttribute("aria-busy");
  },
};

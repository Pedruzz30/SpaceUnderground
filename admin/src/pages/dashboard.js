import { spaceStatus } from "../data/dashboard.js";
import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { getActivity, getProjects } from "../services/mock-storage.js";
import { escapeHtml } from "../utils/html.js";

function formatTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

export const dashboardPage = {
  title: "Dashboard",
  breadcrumb: "OVERVIEW / DASHBOARD",
  render: () => {
    const projects = getProjects();
    const published = projects.filter((project) => project.editorialStatus === "PUBLISHED").length;
    const drafts = projects.filter((project) => project.editorialStatus === "DRAFT").length;
    const recentProjects = [...projects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 4);
    const activity = getActivity();

    return `
      <section class="page-heading">
        <span>DASHBOARD</span>
        <h2>Welcome back.</h2>
        <p>Here's the current state of Space Underground.</p>
      </section>

      <section class="stats-grid" aria-label="Resumo do Admin">
        ${statCard({ label: "PROJECTS", value: projects.length, detail: "Cases tracked in mock storage" })}
        ${statCard({ label: "PUBLISHED", value: published, detail: "Visible editorial entries" })}
        ${statCard({ label: "DRAFTS", value: drafts, detail: "Pending review" })}
      </section>

      <section class="dashboard-grid">
        <article class="panel">
          <header class="panel__head">
            <div>
              <span>SPACE STATUS</span>
              <h3>${escapeHtml(spaceStatus.label)}</h3>
            </div>
            ${badge("ONLINE", "success")}
          </header>
          <p>${escapeHtml(spaceStatus.detail)}</p>
        </article>

        <article class="panel">
          <header class="panel__head">
            <div>
              <span>RECENT PROJECTS</span>
              <h3>Portfolio cases</h3>
            </div>
            <a class="text-link" href="#/projects">Manage</a>
          </header>
          <div class="compact-list">
            ${recentProjects.length ? recentProjects.map((project) => `
              <a href="#/projects/${project.id}">
                <span>${escapeHtml(project.caseNumber)}</span>
                <strong>${escapeHtml(project.name || "Untitled project")}</strong>
                <small>${escapeHtml(project.category)}</small>
                ${badge(project.status, badgeType(project.status))}
              </a>
            `).join("") : '<p class="empty-inline">No projects yet.</p>'}
          </div>
        </article>

        <article class="panel panel--wide">
          <header class="panel__head">
            <div>
              <span>RECENT ACTIVITY</span>
              <h3>Mock editorial log</h3>
            </div>
          </header>
          <div class="activity-list">
            ${activity.length ? activity.map((item) => `
              <div>
                <span></span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
                <small>${formatTimestamp(item.time)}</small>
              </div>
            `).join("") : '<p class="empty-inline">No recent activity yet.</p>'}
          </div>
        </article>
      </section>
    `;
  },
};

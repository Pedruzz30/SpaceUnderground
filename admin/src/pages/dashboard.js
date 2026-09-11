import { spaceStatus } from "../data/dashboard.js";
import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { getActivity } from "../services/activity-service.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { escapeHtml } from "../utils/html.js";

function formatRelativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "updated recently";

  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return "updated now";
  if (abs < hour) return `updated ${Math.max(1, Math.round(abs / minute))}m ago`;
  if (abs < day) return `updated ${Math.max(1, Math.round(abs / hour))}h ago`;
  if (abs < day * 7) return `updated ${Math.max(1, Math.round(abs / day))}d ago`;

  return `updated ${date.toLocaleDateString(undefined, { month: "short", day: "2-digit" })}`;
}

function formatActivityTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function renderStats(projects) {
  const published = projects.filter((project) => project.editorialStatus === "PUBLISHED").length;
  const drafts = projects.filter((project) => project.editorialStatus === "DRAFT").length;

  return ` 
    ${statCard({ label: "PROJECTS", value: projects.length, detail: "Cases tracked in the admin store" })}
    ${statCard({ label: "PUBLISHED", value: published, detail: "Visible editorial entries" })}
    ${statCard({ label: "DRAFTS", value: drafts, detail: "Pending review" })}
  `;
}

function renderRecentProjects(projects) {
  const recent = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 4);

  if (!recent.length) return '<p class="empty-inline">No projects yet.</p>';

  return recent
    .map(
      (project) => `
        <a href="#/projects/${encodeURIComponent(project.id)}">
          <span>${escapeHtml(project.caseNumber)}</span>
          <strong>${escapeHtml(project.name || "Untitled project")}</strong>
          ${badge(project.editorialStatus, badgeType(project.editorialStatus))}
          <small>${escapeHtml(project.category)}</small>
          <em>${escapeHtml(formatRelativeTime(project.updatedAt))}</em>
        </a>
      `,
    )
    .join("");
}

function renderActivity(activity) {
  if (!activity.length) return '<p class="empty-inline">No recent activity yet.</p>';

  return activity
    .map(
      (item) => `
        <div>
          <span></span>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.detail)}</p>
          <small>${formatActivityTime(item.time)}</small>
        </div>
      `,
    )
    .join("");
}

function renderAttention(projects) {
  const attention = projects
    .flatMap((project) => {
      const items = [];
      if (project.editorialStatus === "DRAFT") items.push("Draft project");
      if (!project.poster) items.push("Missing poster");
      if (project.editorialStatus === "PUBLISHED" && !project.visible) items.push("Published but hidden");
      if (!String(project.description || "").trim()) items.push("Missing description");
      return items.map((reason) => ({ project, reason }));
    })
    .slice(0, 5);

  if (!attention.length) return '<p class="empty-inline">All projects look ready.</p>';

  return attention
    .map(
      ({ project, reason }) => `
        <a href="#/projects/${encodeURIComponent(project.id)}">
          <span>${escapeHtml(project.caseNumber)}</span>
          <strong>${escapeHtml(project.name || "Untitled project")}</strong>
          <small>${escapeHtml(reason)}</small>
        </a>
      `,
    )
    .join("");
}

export const dashboardPage = {
  title: "Dashboard",
  breadcrumb: "OVERVIEW / DASHBOARD",
  render: () => `
    <section class="page-heading">
      <span>DASHBOARD</span>
      <h2>Welcome back.</h2>
      <p>Here's the current state of Space Underground.</p>
    </section>

      <section class="stats-grid" data-dashboard-stats aria-label="Resumo do Admin" aria-busy="true">
        <article class="stat-card skeleton-card"></article>
        <article class="stat-card skeleton-card"></article>
        <article class="stat-card skeleton-card"></article>
      </section>

      <section class="dashboard-grid">
        <article class="panel dashboard-status-panel">
          <header class="panel__head">
            <div>
              <span>SPACE STATUS</span>
            <h3>${escapeHtml(spaceStatus.label)}</h3>
          </div>
          ${badge("ONLINE", "success")}
        </header>
        <p>${escapeHtml(spaceStatus.detail)}</p>
        </article>

        <article class="panel quick-actions-panel">
          <header class="panel__head">
            <div>
              <span>QUICK ACTIONS</span>
              <h3>Operational shortcuts</h3>
            </div>
          </header>
          <div class="quick-actions">
            <a class="button button--primary" href="#/projects/new">New Project</a>
            <a class="button" href="#/projects">Manage Projects</a>
            <a class="button" href="../" target="_blank" rel="noreferrer">View Website</a>
          </div>
        </article>

        <article class="panel">
          <header class="panel__head">
            <div>
              <span>RECENT PROJECTS</span>
            <h3>Portfolio cases</h3>
          </div>
          <a class="text-link" href="#/projects">Manage</a>
        </header>
        <div class="compact-list" data-recent-projects aria-busy="true">
          <p class="empty-inline">Loading projects...</p>
        </div>
        </article>

        <article class="panel">
          <header class="panel__head">
            <div>
              <span>NEEDS ATTENTION</span>
              <h3>Derived checks</h3>
            </div>
          </header>
          <div class="compact-list attention-list" data-attention aria-busy="true">
            <p class="empty-inline">Checking projects...</p>
          </div>
        </article>

        <article class="panel panel--wide">
        <header class="panel__head">
          <div>
            <span>RECENT ACTIVITY</span>
            <h3>Administrative log</h3>
          </div>
          <a class="text-link" href="#/logs">Open Logs</a>
        </header>
        <div class="activity-list" data-activity aria-busy="true">
          <p class="empty-inline">Loading activity...</p>
        </div>
      </article>
    </section>
  `,
  afterRender: async () => {
    const statsEl = document.querySelector("[data-dashboard-stats]");
    const recentEl = document.querySelector("[data-recent-projects]");
    const activityEl = document.querySelector("[data-activity]");
    const attentionEl = document.querySelector("[data-attention]");

    try {
      const [projects, activity] = await Promise.all([getProjects(), getActivity()]);
      if (!statsEl?.isConnected) return;

      statsEl.innerHTML = renderStats(projects);
      recentEl.innerHTML = renderRecentProjects(projects);
      activityEl.innerHTML = renderActivity(activity);
      attentionEl.innerHTML = renderAttention(projects);
    } catch (error) {
      if (!statsEl?.isConnected) return;
      const message = escapeHtml(describeError(error, "Unable to load projects."));
      statsEl.innerHTML = `<p class="empty-inline">${message}</p>`;
      recentEl.innerHTML = `<p class="empty-inline">${message}</p>`;
      activityEl.innerHTML = '<p class="empty-inline">Unavailable.</p>';
      attentionEl.innerHTML = '<p class="empty-inline">Unavailable.</p>';
    } finally {
      statsEl?.removeAttribute("aria-busy");
      recentEl?.removeAttribute("aria-busy");
      activityEl?.removeAttribute("aria-busy");
      attentionEl?.removeAttribute("aria-busy");
    }
  },
};

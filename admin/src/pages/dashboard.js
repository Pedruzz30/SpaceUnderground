import { dashboardActivity, spaceStatus } from "../data/dashboard.js";
import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { getProjects } from "../services/mock-storage.js";

export const dashboardPage = {
  title: "Dashboard",
  breadcrumb: "OVERVIEW / DASHBOARD",
  render: () => {
    const projects = getProjects();
    const published = projects.filter((project) => project.editorialStatus === "PUBLISHED").length;
    const drafts = projects.filter((project) => project.editorialStatus === "DRAFT").length;

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
              <h3>${spaceStatus.label}</h3>
            </div>
            ${badge("ONLINE", "success")}
          </header>
          <p>${spaceStatus.detail}</p>
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
            ${projects.slice(0, 4).map((project) => `
              <a href="#/projects/${project.id}">
                <span>${project.caseNumber}</span>
                <strong>${project.name}</strong>
                <small>${project.category}</small>
                ${badge(project.status, badgeType(project.status))}
              </a>
            `).join("")}
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
            ${dashboardActivity.map((item) => `
              <div>
                <span></span>
                <strong>${item.title}</strong>
                <p>${item.detail}</p>
                <small>${item.time}</small>
              </div>
            `).join("")}
          </div>
        </article>
      </section>
    `;
  },
};

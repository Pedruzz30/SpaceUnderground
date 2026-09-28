import { onLocaleChange, plural, t } from "../i18n/index.js";
import { getAccess, hasPermission } from "../security/access.js";
import { listRequests } from "../services/approval-service.js";
import { describeError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { projectKey, requestStatusBadge } from "./approvals.js";

// The dashboard for members who work on assigned projects (collaborators and
// viewers): their projects, their requests waiting for review, their recent
// changes. It asks for nothing else, and RLS would return nothing else: no
// clients, money, pipeline, team or logs ever reach this screen.

function projectCard(project, access) {
  const grant = access.projects.find((item) => item.projectId === projectKey(project));
  return `
    <a class="ops-row ops-row--link member-project" href="#/projects/${encodeURIComponent(project.id)}">
      <span class="ops-row__primary"><strong>${escapeHtml(project.name)}</strong><small>CASE ${escapeHtml(project.caseNumber)}</small></span>
      <span class="badge badge--${grant?.accessLevel === "EDIT" ? "success" : "neutral"}">${escapeHtml(t(grant?.accessLevel === "EDIT" ? "security.projectLevel.edit" : "security.projectLevel.view"))}</span>
    </a>
  `;
}

function requestRow(request, projects) {
  const project = projects.get(request.resourceId);
  return `
    <a class="ops-row ops-row--link" href="#/approvals/${encodeURIComponent(request.id)}">
      <span class="ops-row__primary"><strong>${escapeHtml(t("security.approvals.requestNumber", { number: request.number }))}</strong><small>${escapeHtml(project?.name ?? t("security.approvals.unknownProject"))}</small></span>
      ${requestStatusBadge(request.status)}
      <small data-relative-date="${escapeAttribute(request.updatedAt)}">${escapeHtml(formatRelativeDay(request.updatedAt))}</small>
    </a>
  `;
}

export const memberDashboard = {
  render: () => `
    <section class="page-heading">
      <div>
        <span data-i18n="dashboard.eyebrow">${escapeHtml(t("dashboard.eyebrow"))}</span>
        <h2>${escapeHtml(t("security.memberDashboard.heading", { name: getAccess()?.member?.displayName ?? "" }))}</h2>
        <p>${escapeHtml(t("security.memberDashboard.intro"))}</p>
      </div>
    </section>
    <div class="metric-strip" data-member-metrics aria-live="polite"></div>
    <div class="dash-grid dash-grid--member">
      <article class="panel" aria-labelledby="member-projects-title">
        <h3 id="member-projects-title">${escapeHtml(t("nav.myProjects"))}</h3>
        <div data-member-projects aria-busy="true"><p class="empty-inline">${escapeHtml(t("common.loading"))}</p></div>
      </article>
      <article class="panel" aria-labelledby="member-pending-title">
        <h3 id="member-pending-title">${escapeHtml(t("security.memberDashboard.pending"))}</h3>
        <div data-member-pending aria-busy="true"><p class="empty-inline">${escapeHtml(t("common.loading"))}</p></div>
      </article>
      <article class="panel" aria-labelledby="member-changes-title">
        <h3 id="member-changes-title">${escapeHtml(t("nav.myChanges"))}</h3>
        <div data-member-changes aria-busy="true"><p class="empty-inline">${escapeHtml(t("common.loading"))}</p></div>
      </article>
    </div>
  `,
  afterRender: async () => {
    const access = getAccess();
    const projectsEl = document.querySelector("[data-member-projects]");
    const pendingEl = document.querySelector("[data-member-pending]");
    const changesEl = document.querySelector("[data-member-changes]");
    const metricsEl = document.querySelector("[data-member-metrics]");
    const [projectsResult, requestsResult] = await Promise.allSettled([
      getProjects(),
      hasPermission("approvals.read") ? listRequests({ requesterId: access.member.userId }) : Promise.resolve([]),
    ]);
    if (!projectsEl?.isConnected) return;

    const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
    const requests = requestsResult.status === "fulfilled" ? requestsResult.value : [];
    const byKey = new Map(projects.map((project) => [projectKey(project), project]));

    const paint = () => {
      const pending = requests.filter((request) => request.status === "PENDING");
      const drafts = requests.filter((request) => request.status === "DRAFT");
      metricsEl.innerHTML = [
        [plural("security.memberDashboard.projects", projects.length), projects.length],
        [plural("security.memberDashboard.pendingCount", pending.length), pending.length],
        [plural("security.memberDashboard.drafts", drafts.length), drafts.length],
      ]
        .map(([label, value]) => `<div class="project-metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`)
        .join("");
      projectsEl.innerHTML =
        projectsResult.status === "rejected"
          ? `<p class="empty-inline">${escapeHtml(describeError(projectsResult.reason, t("dashboard.loadProjectsError")))}</p>`
          : projects.length
            ? projects.map((project) => projectCard(project, access)).join("")
            : `<p class="empty-inline">${escapeHtml(t("security.memberDashboard.noProjects"))}</p>`;
      pendingEl.innerHTML = pending.length ? pending.map((request) => requestRow(request, byKey)).join("") : `<p class="empty-inline">${escapeHtml(t("security.memberDashboard.noPending"))}</p>`;
      const recent = requests.filter((request) => request.status !== "PENDING").slice(0, 8);
      changesEl.innerHTML = recent.length ? recent.map((request) => requestRow(request, byKey)).join("") : `<p class="empty-inline">${escapeHtml(t("security.memberDashboard.noChanges"))}</p>`;
      [projectsEl, pendingEl, changesEl].forEach((node) => node.removeAttribute("aria-busy"));
    };

    paint();
    onLocaleChange(projectsEl, paint);
  },
};

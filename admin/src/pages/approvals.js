import { onLocaleChange, plural, t } from "../i18n/index.js";
import { getAccess } from "../security/access.js";
import { resolveMembers } from "../services/access-service.js";
import { listRequests } from "../services/approval-service.js";
import { describeError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

// The approvals center (reviewers) and "Minhas alterações" (everyone who
// proposes changes). What each list holds is decided by RLS: your own
// requests, and everyone's submitted ones with approvals.read_all.

const TABS = {
  reviewer: ["PENDING", "APPROVED", "REJECTED", "MINE", "ALL"],
  requester: ["ALL", "DRAFT", "PENDING", "APPROVED", "REJECTED"],
};

const STATUS_TONE = { DRAFT: "neutral", PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "muted", EXPIRED: "muted" };
const RISK_TONE = { LOW: "neutral", MEDIUM: "warning", HIGH: "danger", CRITICAL: "danger" };

export const requestStatusBadge = (status) =>
  `<span class="badge badge--${STATUS_TONE[status] ?? "neutral"}" data-i18n="security.requestStatus.${String(status).toLowerCase()}">${escapeHtml(t(`security.requestStatus.${String(status).toLowerCase()}`))}</span>`;

export const riskBadge = (risk) =>
  `<span class="badge badge--${RISK_TONE[risk] ?? "neutral"}" data-i18n="security.risk.${String(risk).toLowerCase()}">${escapeHtml(t(`security.risk.${String(risk).toLowerCase()}`))}</span>`;

export const actionLabel = (action) => t(action === "project.publish" ? "security.approvals.actionPublish" : "security.approvals.actionUpdate");

// Projects are addressed by uuid in Supabase and by case number in mock mode.
export const projectKey = (project) => project?.dbId || project?.id;

function matchesTab(request, tab, me) {
  if (tab === "ALL") return true;
  if (tab === "MINE") return request.requesterId === me;
  return request.status === tab;
}

function card(request, { projects, people, me }) {
  const project = projects.get(request.resourceId);
  const requester = people.get(request.requesterId);
  // Fields proposed, plus publication when the request asks for it.
  const changes = Object.keys(request.proposed ?? {}).length + (request.action === "project.publish" ? 1 : 0);
  const mine = request.requesterId === me;
  return `
    <article class="approval-card" data-approval-card data-request-id="${escapeAttribute(request.id)}">
      <header>
        <strong class="approval-card__number">${escapeHtml(t("security.approvals.requestNumber", { number: request.number }))}</strong>
        ${requestStatusBadge(request.status)}
        ${riskBadge(request.riskLevel)}
      </header>
      <dl>
        <div><dt>${escapeHtml(t("security.approvals.requester"))}</dt><dd>${escapeHtml(mine ? t("security.team.you") : requester ? `${requester.displayName} · ${requester.ru}` : "—")}</dd></div>
        <div><dt>${escapeHtml(t("security.approvals.resource"))}</dt><dd>${escapeHtml(project ? `${project.name} · CASE ${project.caseNumber}` : t("security.approvals.unknownProject"))}</dd></div>
        <div><dt>${escapeHtml(t("security.approvals.action"))}</dt><dd>${escapeHtml(actionLabel(request.action))}</dd></div>
        <div><dt>${escapeHtml(t("security.approvals.changes"))}</dt><dd>${escapeHtml(plural("security.approvals.changeCount", changes))}</dd></div>
      </dl>
      <footer>
        <small>${escapeHtml(formatRelativeDay(request.submittedAt ?? request.updatedAt))}</small>
        <a class="button button--compact${request.status === "PENDING" && !mine ? " button--primary" : ""}" href="#/approvals/${encodeURIComponent(request.id)}">${escapeHtml(t(request.status === "PENDING" && !mine ? "security.approvals.review" : "security.approvals.open"))}</a>
      </footer>
    </article>
  `;
}

function tabLabel(tab) {
  return tab === "ALL" ? t("security.approvals.tabAll") : tab === "MINE" ? t("security.approvals.tabMine") : t(`security.requestStatus.${tab.toLowerCase()}`);
}

function listPage({ mode }) {
  const reviewer = mode === "reviewer";
  return {
    title: () => t(reviewer ? "security.approvals.title" : "security.approvals.mineTitle"),
    breadcrumb: () => t(reviewer ? "security.approvals.breadcrumb" : "security.approvals.mineBreadcrumb"),
    render: () => `
      <section class="page-heading">
        <div>
          <span data-i18n="security.approvals.eyebrow">${escapeHtml(t("security.approvals.eyebrow"))}</span>
          <h2>${escapeHtml(t(reviewer ? "security.approvals.heading" : "security.approvals.mineHeading"))}</h2>
          <p>${escapeHtml(t(reviewer ? "security.approvals.intro" : "security.approvals.mineIntro"))}</p>
        </div>
      </section>
      <div class="log-channels" role="group" aria-label="${escapeAttribute(t("security.approvals.filter"))}" data-approval-tabs></div>
      <div class="approval-grid" data-approval-list aria-live="polite" aria-busy="true"><p class="empty-inline">${escapeHtml(t("common.loading"))}</p></div>
    `,
    afterRender: async () => {
      const list = document.querySelector("[data-approval-list]");
      const tabs = document.querySelector("[data-approval-tabs]");
      const me = getAccess()?.member?.userId ?? null;
      const tabKeys = TABS[mode];
      let active = tabKeys[0];
      let requests = [];
      let projects = new Map();
      let people = new Map();

      const paint = () => {
        tabs.innerHTML = tabKeys
          .map((tab) => {
            const count = requests.filter((request) => matchesTab(request, tab, me)).length;
            return `<button type="button" class="log-channel${tab === active ? " is-active" : ""}" data-approval-tab="${tab}" aria-pressed="${tab === active}"><span>${escapeHtml(tabLabel(tab))}</span><b>${count}</b></button>`;
          })
          .join("");
        const visible = requests.filter((request) => matchesTab(request, active, me));
        list.removeAttribute("aria-busy");
        list.innerHTML = visible.length ? visible.map((request) => card(request, { projects, people, me })).join("") : `<p class="empty-inline">${escapeHtml(t("security.approvals.empty"))}</p>`;
      };

      tabs.addEventListener("click", (event) => {
        const tab = event.target.closest("[data-approval-tab]");
        if (!tab) return;
        active = tab.dataset.approvalTab;
        paint();
      });

      try {
        const [loaded, projectList] = await Promise.all([listRequests(reviewer ? {} : { requesterId: me }), getProjects().catch(() => [])]);
        requests = loaded;
        projects = new Map(projectList.map((project) => [projectKey(project), project]));
        people = await resolveMembers(requests.map((request) => request.requesterId));
        paint();
        onLocaleChange(list, paint);
      } catch (error) {
        list.removeAttribute("aria-busy");
        list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("security.approvals.loadError")))}</p>`;
      }
    },
  };
}

export const approvalsPage = listPage({ mode: "reviewer" });
export const myChangesPage = listPage({ mode: "requester" });

import { confirmModal } from "../components/modal.js";
import { promptReason } from "../components/reason-dialog.js";
import { bindRowMenus, rowMenu } from "../components/row-menu.js";
import { withStepUp } from "../components/step-up.js";
import { showToast } from "../components/toast.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { getAccess, hasPermission } from "../security/access.js";
import { permissionsForRoles, roleLabelKey } from "../security/catalog.js";
import { expireStaleAccess } from "../services/access-service.js";
import { describeError } from "../services/errors.js";
import { listMembers, offboardMember, reactivateMember, revokeMemberSessions, suspendMember } from "../services/team-service.js";
import { initials } from "../utils/client-relationship.js";
import { formatFullDate, formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { MEMBER_FILTERS, canManage, countByStatus, filterMembers, isExpiringSoon, mfaState } from "../utils/team-view.js";

// EQUIPE: everyone with Admin access, their RU, roles, status, MFA, projects,
// validity and last access, with the lifecycle actions the signed-in member is
// allowed to take on each (the database re-checks every one).

const STATUS_TONE = { ACTIVE: "success", INVITED: "warning", SUSPENDED: "danger", EXPIRED: "muted", OFFBOARDED: "muted" };
const MFA_TONE = { enabled: "success", grace: "warning", required: "danger", optional: "neutral" };

export const memberStatusBadge = (status) =>
  `<span class="badge badge--${STATUS_TONE[status] ?? "neutral"}" data-i18n="security.status.${String(status).toLowerCase()}">${escapeHtml(t(`security.status.${String(status).toLowerCase()}`))}</span>`;

export const mfaBadge = (member) => {
  const state = mfaState(member);
  return `<span class="badge badge--${MFA_TONE[state]}" data-i18n="security.mfaState.${state}">${escapeHtml(t(`security.mfaState.${state}`))}</span>`;
};

export const roleBadges = (roles = []) =>
  roles.length
    ? roles.map((key) => `<span class="badge badge--role" data-i18n="${roleLabelKey(key)}">${escapeHtml(t(roleLabelKey(key)))}</span>`).join("")
    : `<span class="ops-meta is-muted">—</span>`;

// Every project for roles with projects.read; otherwise the assigned ones.
export function projectsLabel(member) {
  if (permissionsForRoles(member.roles).includes("projects.read")) return t("security.team.allProjects");
  return member.projects.length ? plural("security.team.projectCount", member.projects.length) : t("security.team.noProjects");
}

export function validityLabel(member) {
  if (!member.accessExpiresAt) return t("security.team.permanent");
  return t("security.team.until", { date: formatFullDate(member.accessExpiresAt) });
}

// Every lifecycle action a row may offer; the database decides each again.
export async function runLifecycleAction(action, member) {
  const name = member.displayName || member.email;
  if (action === "suspend") {
    const reason = await promptReason({
      title: t("security.member.suspendTitle", { name }),
      body: `<p>${escapeHtml(t("security.member.suspendBody"))}</p>`,
      label: t("security.member.reasonLabel"),
      confirmLabel: t("security.member.suspend"),
    });
    if (reason === null) return false;
    await withStepUp(() => suspendMember(member.userId, reason));
    showToast(t("security.member.suspended", { name }));
    return true;
  }
  if (action === "reactivate") {
    const ok = await confirmModal({
      title: t("security.member.reactivateTitle", { name }),
      body: `<p>${escapeHtml(t(member.effectiveStatus === "EXPIRED" ? "security.member.reactivateExpiredBody" : "security.member.reactivateBody"))}</p>`,
      confirmLabel: t("security.member.reactivate"),
      danger: false,
    });
    if (!ok) return false;
    await withStepUp(() => reactivateMember(member.userId, null));
    showToast(t("security.member.reactivated", { name }));
    return true;
  }
  if (action === "revoke") {
    const ok = await confirmModal({
      title: t("security.member.revokeTitle", { name }),
      body: `<p>${escapeHtml(t("security.member.revokeBody"))}</p>`,
      confirmLabel: t("security.member.revoke"),
    });
    if (!ok) return false;
    await withStepUp(() => revokeMemberSessions(member.userId));
    showToast(t("security.member.revoked", { name }));
    return true;
  }
  if (action === "offboard") {
    const reason = await promptReason({
      title: t("security.member.offboardTitle", { name }),
      body: `<p>${escapeHtml(t("security.member.offboardBody"))}</p>`,
      label: t("security.member.reasonLabel"),
      confirmLabel: t("security.member.offboard"),
    });
    if (reason === null) return false;
    await withStepUp(() => offboardMember(member.userId, reason));
    showToast(t("security.member.offboarded", { name }));
    return true;
  }
  return false;
}

export function lifecycleItems(member, access) {
  if (!canManage(member, access)) return [];
  const id = escapeAttribute(member.userId);
  const status = member.effectiveStatus;
  const items = [];
  if (["ACTIVE", "INVITED", "EXPIRED"].includes(status) && hasPermission("team.suspend", access)) {
    items.push({ label: t("security.member.suspend"), attrs: `data-member-action="suspend" data-member-id="${id}"` });
  }
  if (["SUSPENDED", "EXPIRED"].includes(status) && hasPermission("team.suspend", access)) {
    items.push({ label: t("security.member.reactivate"), attrs: `data-member-action="reactivate" data-member-id="${id}"` });
  }
  if (status !== "OFFBOARDED" && hasPermission("sessions.revoke", access)) {
    items.push({ label: t("security.member.revoke"), attrs: `data-member-action="revoke" data-member-id="${id}"` });
  }
  if (status !== "OFFBOARDED" && hasPermission("team.offboard", access)) {
    items.push({ label: t("security.member.offboard"), attrs: `data-member-action="offboard" data-member-id="${id}"` });
  }
  return items;
}

function memberRow(member, access) {
  const href = `#/team/${encodeURIComponent(member.userId)}`;
  const isYou = member.userId === access?.member?.userId;
  const expiring = isExpiringSoon(member.accessExpiresAt);
  return `
    <article class="ops-row team-row${member.effectiveStatus === "OFFBOARDED" ? " is-archived" : ""}" data-member-row data-member-id="${escapeAttribute(member.userId)}">
      <span class="ops-row__primary team-row__who">
        <span class="client-avatar client-avatar--${member.effectiveStatus === "ACTIVE" ? "active" : "inactive"}" aria-hidden="true">${escapeHtml(initials(member.displayName || member.email))}</span>
        <span class="clients-row__identity">
          <a class="clients-row__name" href="${escapeAttribute(href)}"><strong>${escapeHtml(member.displayName || "—")}</strong></a>
          <small>${escapeHtml(member.email)}${isYou ? ` · ${escapeHtml(t("security.team.you"))}` : ""}</small>
        </span>
      </span>
      <span class="ops-stack" data-label="${escapeAttribute(t("security.team.columnRu"))}"><code class="team-ru">${escapeHtml(member.ru)}</code></span>
      <span class="team-row__roles" data-label="${escapeAttribute(t("security.team.columnRoles"))}">${roleBadges(member.roles)}</span>
      <span class="team-row__badges" data-label="${escapeAttribute(t("security.team.columnStatus"))}">${memberStatusBadge(member.effectiveStatus)}${mfaBadge(member)}</span>
      <span class="ops-stack" data-label="${escapeAttribute(t("security.team.columnProjects"))}">
        <span class="ops-meta">${escapeHtml(projectsLabel(member))}</span>
        <small class="${expiring ? "is-warning" : ""}">${escapeHtml(validityLabel(member))}</small>
      </span>
      <span class="ops-stack" data-label="${escapeAttribute(t("security.team.columnLastAccess"))}">
        ${member.lastSignInAt ? `<span class="ops-meta" data-relative-date="${escapeAttribute(member.lastSignInAt)}">${escapeHtml(formatRelativeDay(member.lastSignInAt))}</span>` : `<span class="ops-meta is-muted">${escapeHtml(t("security.team.never"))}</span>`}
      </span>
      <span class="clients-row__actions">
        <a class="button button--compact" href="${escapeAttribute(href)}">${escapeHtml(t("security.team.open"))}</a>
        ${(() => {
          const items = lifecycleItems(member, access);
          return items.length ? rowMenu({ label: t("security.team.actions"), items: [{ label: t("security.team.editAccess"), href }, ...items, { label: t("security.team.history"), href }] }) : "";
        })()}
      </span>
    </article>
  `;
}

function filterChips(counts, active) {
  return MEMBER_FILTERS.map((filter) => {
    const isActive = filter === active;
    const label = filter === "ALL" ? t("common.all") : t(`security.status.${filter.toLowerCase()}`);
    return `<button type="button" class="log-channel${isActive ? " is-active" : ""}" data-member-filter="${filter}" aria-pressed="${isActive}"><span>${escapeHtml(label)}</span><b>${counts[filter] ?? 0}</b></button>`;
  }).join("");
}

function metricsMarkup(members) {
  const counts = countByStatus(members);
  const mfaPending = members.filter((member) => member.effectiveStatus === "ACTIVE" && ["required", "grace"].includes(mfaState(member))).length;
  return [
    ["security.team.metricActive", counts.ACTIVE, ""],
    ["security.team.metricInvited", counts.INVITED, ""],
    ["security.team.metricSuspended", counts.SUSPENDED, counts.SUSPENDED ? "is-warn" : ""],
    ["security.team.metricMfaPending", mfaPending, mfaPending ? "is-warn" : ""],
  ]
    .map(([key, value, tone]) => `<div class="project-metric${tone ? ` ${tone}` : ""}"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(t(key))}</span></div>`)
    .join("");
}

export const teamPage = {
  title: () => t("security.team.title"),
  breadcrumb: () => t("security.team.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="security.team.eyebrow">${escapeHtml(t("security.team.eyebrow"))}</span>
        <h2 data-i18n="security.team.heading">${escapeHtml(t("security.team.heading"))}</h2>
        <p data-i18n="security.team.intro">${escapeHtml(t("security.team.intro"))}</p>
      </div>
      <div class="heading-actions">
        <a class="button button--primary" href="#/team/invite" data-requires="team.invite" data-team-invite data-i18n="security.team.invite">${escapeHtml(t("security.team.invite"))}</a>
      </div>
    </section>

    <div class="metric-strip" data-team-metrics aria-live="polite">${metricsMarkup([])}</div>

    <div class="clients-toolbar">
      <label class="search-field">
        <span data-i18n="security.team.search">${escapeHtml(t("security.team.search"))}</span>
        <input data-team-search type="search" placeholder="${escapeAttribute(t("security.team.searchPlaceholder"))}" data-i18n-placeholder="security.team.searchPlaceholder">
      </label>
    </div>

    <div class="log-channels" role="group" aria-label="${escapeAttribute(t("security.team.filterByStatus"))}" data-i18n-aria-label="security.team.filterByStatus" data-team-filters></div>
    <p class="ops-count" data-team-count></p>

    <div class="ops-table-scroll">
      <div class="ops-table team-table" data-team-list aria-live="polite" aria-busy="true">
        <p class="empty-inline" data-i18n="common.loading">${escapeHtml(t("common.loading"))}</p>
      </div>
    </div>
  `,
  afterRender: async () => {
    const list = document.querySelector("[data-team-list]");
    const search = document.querySelector("[data-team-search]");
    const filters = document.querySelector("[data-team-filters]");
    const count = document.querySelector("[data-team-count]");
    const metrics = document.querySelector("[data-team-metrics]");
    let members = [];
    let active = "ALL";
    let loaded = false;

    const head = () => `
      <div class="ops-table__head" aria-hidden="true">
        <span>${escapeHtml(t("security.team.columnMember"))}</span><span>${escapeHtml(t("security.team.columnRu"))}</span><span>${escapeHtml(t("security.team.columnRoles"))}</span><span>${escapeHtml(t("security.team.columnStatus"))}</span><span>${escapeHtml(t("security.team.columnProjects"))}</span><span>${escapeHtml(t("security.team.columnLastAccess"))}</span><span>${escapeHtml(t("security.team.columnActions"))}</span>
      </div>
    `;

    const paint = () => {
      if (!loaded) return;
      const access = getAccess();
      const visible = filterMembers(members, active, search.value);
      list.innerHTML = `${head()}${visible.length ? visible.map((member) => memberRow(member, access)).join("") : `<p class="empty-inline">${escapeHtml(t("security.team.empty"))}</p>`}`;
      filters.innerHTML = filterChips(countByStatus(members), active);
      metrics.innerHTML = metricsMarkup(members);
      count.textContent = plural("security.team.countLabel", members.length, { visible: visible.length, total: members.length });
      bindRowMenus(list);
    };

    const load = async () => {
      try {
        await expireStaleAccess();
        members = await listMembers();
        loaded = true;
        list.removeAttribute("aria-busy");
        paint();
      } catch (error) {
        list.removeAttribute("aria-busy");
        list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("security.team.loadError")))}</p>`;
      }
    };

    list.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-member-action]");
      if (!button) return;
      const member = members.find((item) => item.userId === button.dataset.memberId);
      if (!member) return;
      try {
        if (await runLifecycleAction(button.dataset.memberAction, member)) await load();
      } catch (error) {
        showToast(describeError(error, t("security.member.actionError")));
      }
    });
    filters.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-member-filter]");
      if (!chip) return;
      active = chip.dataset.memberFilter;
      paint();
    });
    search.addEventListener("input", paint);
    onLocaleChange(list, paint);

    await load();
  },
};

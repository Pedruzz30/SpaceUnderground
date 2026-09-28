import { withStepUp } from "../components/step-up.js";
import { showToast } from "../components/toast.js";
import { onLocaleChange, t } from "../i18n/index.js";
import { getAccess, hasPermission } from "../security/access.js";
import { ROLES, roleLabelKey } from "../security/catalog.js";
import { resolveMembers } from "../services/access-service.js";
import { listRequests } from "../services/approval-service.js";
import { listAuditEntries } from "../services/audit-service.js";
import { describeError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { getMember, resendInvitation, updateMemberAccess } from "../services/team-service.js";
import { formatFullDate, formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { canManage, grantableRoles, isAdministrativeRole } from "../utils/team-view.js";
import { auditLine } from "./audit.js";
import { lifecycleItems, memberStatusBadge, mfaBadge, roleBadges, runLifecycleAction, validityLabel } from "./team.js";

// One member: identity, access (roles, projects, validity), security (MFA,
// sessions), activity (their audit trail and requests) and the danger zone.
// Editing is offered only where the rank rule allows it; the database decides
// every change again and records it.

function fact(labelKey, value, raw = false) {
  return `<div><dt>${escapeHtml(t(labelKey))}</dt><dd>${raw ? value : escapeHtml(value || "—")}</dd></div>`;
}

function identityMarkup(member, people) {
  const inviter = member.invitedBy ? people.get(member.invitedBy) : null;
  return `
    <dl class="settings-facts">
      ${fact("security.member.name", member.displayName)}
      ${fact("security.member.email", member.email)}
      ${fact("security.ru", `<code class="team-ru">${escapeHtml(member.ru)}</code>`, true)}
      ${fact("security.member.userId", `<code class="team-uuid">${escapeHtml(member.userId)}</code>`, true)}
      ${fact("security.member.invitedBy", inviter ? `${inviter.displayName} · ${inviter.ru}` : "—")}
      ${fact("security.member.invitedAt", formatFullDate(member.invitedAt))}
      ${fact("security.member.activatedAt", formatFullDate(member.activatedAt))}
      ${member.statusReason ? fact("security.member.statusReason", member.statusReason) : ""}
    </dl>
  `;
}

function accessForm(member, projects, access, editable) {
  const grantable = new Set(grantableRoles(access));
  const projectRows = projects
    .map((project) => {
      const key = project.dbId || project.id;
      const grant = member.projects.find((item) => item.projectId === key);
      return `
        <label class="invite-project">
          <input type="checkbox" name="project" value="${escapeAttribute(key)}"${grant ? " checked" : ""}${editable ? "" : " disabled"}>
          <span><strong>${escapeHtml(project.name)}</strong><small>CASE ${escapeHtml(project.caseNumber)}</small></span>
          <select name="level-${escapeAttribute(key)}"${editable ? "" : " disabled"} aria-label="${escapeAttribute(t("security.invite.projectLevel", { name: project.name }))}">
            <option value="VIEW"${grant?.accessLevel === "EDIT" ? "" : " selected"}>${escapeHtml(t("security.projectLevel.view"))}</option>
            <option value="EDIT"${grant?.accessLevel === "EDIT" ? " selected" : ""}>${escapeHtml(t("security.projectLevel.edit"))}</option>
          </select>
        </label>
      `;
    })
    .join("");
  const expiry = member.accessExpiresAt ? String(member.accessExpiresAt).slice(0, 10) : "";
  return `
    <form class="member-access" data-member-access novalidate>
      <fieldset>
        <legend data-i18n="security.member.roles">${escapeHtml(t("security.member.roles"))}</legend>
        <div class="member-roles">
          ${ROLES.map((role) => {
            const held = member.roles.includes(role.key);
            const allowed = editable && grantable.has(role.key);
            return `<label class="settings-toggle"><input type="checkbox" name="role" value="${role.key}"${held ? " checked" : ""}${allowed ? "" : " disabled"}> <span>${escapeHtml(t(roleLabelKey(role.key)))}${isAdministrativeRole(role.key) ? ` <small>${escapeHtml(t("security.member.administrative"))}</small>` : ""}</span></label>`;
          }).join("")}
        </div>
      </fieldset>
      <fieldset class="invite-validity">
        <legend data-i18n="security.invite.validity">${escapeHtml(t("security.invite.validity"))}</legend>
        <label><input type="radio" name="validity" value="permanent"${expiry ? "" : " checked"}${editable ? "" : " disabled"}> <span>${escapeHtml(t("security.invite.permanent"))}</span></label>
        <label><input type="radio" name="validity" value="temporary"${expiry ? " checked" : ""}${editable ? "" : " disabled"}> <span>${escapeHtml(t("security.invite.temporary"))}</span></label>
        <input type="date" name="expiresAt" value="${escapeAttribute(expiry)}" aria-label="${escapeAttribute(t("security.invite.expiresAt"))}"${editable ? "" : " disabled"}>
      </fieldset>
      <fieldset class="invite-projects">
        <legend data-i18n="security.invite.projects">${escapeHtml(t("security.invite.projects"))}</legend>
        <p class="field-hint" data-i18n="security.invite.projectsHint">${escapeHtml(t("security.invite.projectsHint"))}</p>
        ${projectRows || `<p class="empty-inline">${escapeHtml(t("security.invite.noProjects"))}</p>`}
      </fieldset>
      <p class="field-error" data-member-error role="alert" hidden></p>
      ${editable ? `<div class="settings-password__actions"><button class="button button--primary" type="submit" data-member-save data-i18n="security.member.save">${escapeHtml(t("security.member.save"))}</button></div>` : `<p class="settings-note">${escapeHtml(t(member.userId === access?.member?.userId ? "security.member.selfReadOnly" : "security.member.readOnly"))}</p>`}
    </form>
  `;
}

function securityMarkup(member) {
  return `
    <dl class="settings-facts">
      ${fact("security.member.mfa", mfaBadge(member), true)}
      ${fact("security.member.lastSignIn", member.lastSignInAt ? formatRelativeDay(member.lastSignInAt) : t("security.team.never"))}
      ${fact("security.member.validity", validityLabel(member))}
      ${member.inviteExpiresAt && member.effectiveStatus === "INVITED" ? fact("security.member.inviteExpires", formatFullDate(member.inviteExpiresAt)) : ""}
    </dl>
  `;
}

function requestsMarkup(requests) {
  if (!requests.length) return `<p class="empty-inline">${escapeHtml(t("security.member.noRequests"))}</p>`;
  return `<ul class="member-requests">${requests
    .slice(0, 10)
    .map((request) => `<li><a href="#/approvals/${encodeURIComponent(request.id)}">#${request.number}</a> <span class="badge badge--${request.status === "APPROVED" ? "success" : request.status === "PENDING" ? "warning" : "muted"}">${escapeHtml(t(`security.requestStatus.${request.status.toLowerCase()}`))}</span> <small>${escapeHtml(formatRelativeDay(request.updatedAt))}</small></li>`)
    .join("")}</ul>`;
}

function dangerMarkup(member, access) {
  const items = lifecycleItems(member, access);
  if (!items.length) return `<p class="settings-note">${escapeHtml(t("security.member.noActions"))}</p>`;
  return `<div class="danger-actions">${items.map((item) => `<button type="button" class="button button--danger" ${item.attrs}>${escapeHtml(item.label)}</button>`).join("")}</div>`;
}

export const teamMemberPage = {
  title: () => t("security.member.title"),
  breadcrumb: () => t("security.team.breadcrumb"),
  render: () => `
    <section class="page-heading" data-member-heading>
      <div>
        <a class="back-link" href="#/team" data-i18n="security.invite.back">${escapeHtml(t("security.invite.back"))}</a>
        <p class="empty-inline">${escapeHtml(t("common.loading"))}</p>
      </div>
    </section>
    <div class="member-grid" data-member-body></div>
  `,
  afterRender: async ({ id }) => {
    const heading = document.querySelector("[data-member-heading]");
    const body = document.querySelector("[data-member-body]");
    const userId = decodeURIComponent(id ?? "");
    let member = null;
    let projects = [];
    let audit = [];
    let requests = [];
    let people = new Map();

    const paint = () => {
      const access = getAccess();
      const editable = canManage(member, access) && hasPermission("team.edit_access", access) && member.effectiveStatus !== "OFFBOARDED";
      heading.innerHTML = `
        <div>
          <a class="back-link" href="#/team" data-i18n="security.invite.back">${escapeHtml(t("security.invite.back"))}</a>
          <span><code class="team-ru">${escapeHtml(member.ru)}</code></span>
          <h2>${escapeHtml(member.displayName || member.email)}</h2>
          <p class="member-heading__badges">${memberStatusBadge(member.effectiveStatus)} ${mfaBadge(member)} ${roleBadges(member.roles)}</p>
        </div>
        ${member.effectiveStatus === "INVITED" && canManage(member, access) ? `<div class="heading-actions"><button class="button" type="button" data-member-resend data-requires="team.invite">${escapeHtml(t("security.member.resend"))}</button></div>` : ""}
      `;
      body.innerHTML = `
        <section class="panel settings-panel"><h3>${escapeHtml(t("security.member.identity"))}</h3>${identityMarkup(member, people)}</section>
        <section class="panel settings-panel"><h3>${escapeHtml(t("security.member.access"))}</h3>${accessForm(member, projects, access, editable)}</section>
        <section class="panel settings-panel"><h3>${escapeHtml(t("security.member.security"))}</h3>${securityMarkup(member)}</section>
        <section class="panel settings-panel" id="activity"><h3>${escapeHtml(t("security.member.activity"))}</h3>
          <h4>${escapeHtml(t("security.member.requests"))}</h4>${requestsMarkup(requests)}
          <h4>${escapeHtml(t("security.member.history"))}</h4>
          ${audit.length ? `<ol class="audit-list">${audit.map((entry) => auditLine(entry, people)).join("")}</ol>` : `<p class="empty-inline">${escapeHtml(t("security.audit.empty"))}</p>`}
        </section>
        <section class="panel settings-panel settings-panel--danger"><h3>${escapeHtml(t("security.member.danger"))}</h3>
          <p class="settings-copy">${escapeHtml(t("security.member.dangerCopy"))}</p>
          ${dangerMarkup(member, access)}
        </section>
      `;
    };

    const load = async () => {
      member = await getMember(userId);
      if (!member) {
        heading.innerHTML = `<div><a class="back-link" href="#/team">${escapeHtml(t("security.invite.back"))}</a><h2>${escapeHtml(t("security.member.notFound"))}</h2></div>`;
        body.innerHTML = "";
        return false;
      }
      const [projectsResult, auditResult, requestsResult] = await Promise.allSettled([
        getProjects(),
        listAuditEntries({ userId, limit: 30 }),
        hasPermission("approvals.read_all") ? listRequests({ requesterId: userId }) : Promise.resolve([]),
      ]);
      projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
      audit = auditResult.status === "fulfilled" ? auditResult.value : [];
      requests = requestsResult.status === "fulfilled" ? requestsResult.value : [];
      people = await resolveMembers([member.invitedBy, ...audit.map((entry) => entry.actorUserId), ...audit.map((entry) => entry.targetUserId)]);
      paint();
      return true;
    };

    body.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-member-action]");
      if (!button) return;
      try {
        if (await runLifecycleAction(button.dataset.memberAction, member)) await load();
      } catch (error) {
        showToast(describeError(error, t("security.member.actionError")));
      }
    });

    heading.addEventListener("click", async (event) => {
      if (!event.target.closest("[data-member-resend]")) return;
      try {
        await withStepUp(() => resendInvitation(member.userId));
        showToast(t("security.member.resent", { email: member.email }));
        await load();
      } catch (error) {
        showToast(describeError(error, t("security.invite.resendError")));
      }
    });

    body.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-member-access]");
      if (!form) return;
      event.preventDefault();
      const error = form.querySelector("[data-member-error]");
      const roles = [...form.querySelectorAll('input[name="role"]:checked')].map((input) => input.value);
      const temporary = form.elements.validity.value === "temporary";
      const date = form.elements.expiresAt.value;
      const expiresAt = temporary && date ? new Date(`${date}T23:59:59`).toISOString() : null;
      if (!roles.length) {
        error.hidden = false;
        error.textContent = t("security.member.roleRequired");
        return;
      }
      if (temporary && (!expiresAt || new Date(expiresAt).getTime() <= Date.now())) {
        error.hidden = false;
        error.textContent = t("security.invite.expiryInvalid");
        return;
      }
      const grants = [...form.querySelectorAll('input[name="project"]:checked')].map((input) => ({
        projectId: input.value,
        accessLevel: form.elements[`level-${input.value}`]?.value === "EDIT" ? "EDIT" : "VIEW",
        expiresAt: member.projects.find((grant) => grant.projectId === input.value)?.expiresAt ?? null,
      }));
      const button = form.querySelector("[data-member-save]");
      button.disabled = true;
      try {
        await withStepUp(() => updateMemberAccess(member.userId, { roles, projects: grants, accessExpiresAt: expiresAt }));
        showToast(t("security.member.saved"));
        await load();
      } catch (failure) {
        error.hidden = false;
        error.textContent = describeError(failure, t("security.member.saveError"));
        button.disabled = false;
      }
    });

    try {
      if (await load()) onLocaleChange(body, paint);
    } catch (error) {
      heading.innerHTML = `<div><a class="back-link" href="#/team">${escapeHtml(t("security.invite.back"))}</a><p class="empty-inline">${escapeHtml(describeError(error, t("security.team.loadError")))}</p></div>`;
    }
  },
};

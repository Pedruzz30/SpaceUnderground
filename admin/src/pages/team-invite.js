import { withStepUp } from "../components/step-up.js";
import { showToastAfterNavigation } from "../components/toast.js";
import { t } from "../i18n/index.js";
import { getAccess } from "../security/access.js";
import { permissionLabelKey, permissionsForRoles, roleLabelKey } from "../security/catalog.js";
import { describeError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { inviteMember } from "../services/team-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { accessPreview, grantableRoles, isAdministrativeRole } from "../utils/team-view.js";

// Invite-only access: the inviter chooses who, which role, which projects and
// for how long; the team-invite Edge Function asks the database (as the
// inviter) whether that is allowed, then Supabase Auth emails the person, who
// chooses their own password. Nobody's password is ever set here.

// Members whose role reaches every project need no project list.
const needsProjects = (role) => !permissionsForRoles([role]).includes("projects.read");

function projectOptions(projects) {
  if (!projects.length) return `<p class="empty-inline">${escapeHtml(t("security.invite.noProjects"))}</p>`;
  return projects
    .map((project) => {
      const key = project.dbId || project.id;
      return `
        <label class="invite-project">
          <input type="checkbox" name="project" value="${escapeAttribute(key)}">
          <span><strong>${escapeHtml(project.name)}</strong><small>CASE ${escapeHtml(project.caseNumber)}</small></span>
          <select name="level-${escapeAttribute(key)}" aria-label="${escapeAttribute(t("security.invite.projectLevel", { name: project.name }))}">
            <option value="VIEW">${escapeHtml(t("security.projectLevel.view"))}</option>
            <option value="EDIT">${escapeHtml(t("security.projectLevel.edit"))}</option>
          </select>
        </label>
      `;
    })
    .join("");
}

function previewMarkup(role) {
  const preview = accessPreview([role]);
  const can = preview.permissions.slice(0, 40);
  return `
    <div class="invite-preview__column">
      <h4 data-i18n="security.invite.can">${escapeHtml(t("security.invite.can"))}</h4>
      <ul>${can.map((key) => `<li class="is-ok">${escapeHtml(t(permissionLabelKey(key)))}</li>`).join("")}</ul>
    </div>
    <div class="invite-preview__column">
      <h4 data-i18n="security.invite.cannot">${escapeHtml(t("security.invite.cannot"))}</h4>
      <ul>${preview.blocked.map((module) => `<li class="is-missing">${escapeHtml(t(`security.modules.${module}`))}</li>`).join("") || `<li>${escapeHtml(t("security.invite.nothingBlocked"))}</li>`}</ul>
    </div>
  `;
}

export const teamInvitePage = {
  title: () => t("security.invite.title"),
  breadcrumb: () => t("security.invite.breadcrumb"),
  render: () => {
    const roles = grantableRoles(getAccess());
    const initial = roles.includes("COLLABORATOR") ? "COLLABORATOR" : roles.at(-1);
    return `
      <section class="page-heading">
        <div>
          <a class="back-link" href="#/team" data-i18n="security.invite.back">${escapeHtml(t("security.invite.back"))}</a>
          <span data-i18n="security.team.eyebrow">${escapeHtml(t("security.team.eyebrow"))}</span>
          <h2 data-i18n="security.invite.heading">${escapeHtml(t("security.invite.heading"))}</h2>
          <p data-i18n="security.invite.intro">${escapeHtml(t("security.invite.intro"))}</p>
        </div>
      </section>

      <form class="invite-grid" data-invite-form novalidate>
        <section class="panel settings-panel">
          <div class="field">
            <label for="invite-name" data-i18n="security.invite.name">${escapeHtml(t("security.invite.name"))}</label>
            <input id="invite-name" name="displayName" maxlength="120" autocomplete="off" required>
          </div>
          <div class="field">
            <label for="invite-email" data-i18n="security.invite.email">${escapeHtml(t("security.invite.email"))}</label>
            <input id="invite-email" name="email" type="email" maxlength="254" autocomplete="off" required>
          </div>
          <div class="field">
            <label for="invite-role" data-i18n="security.invite.role">${escapeHtml(t("security.invite.role"))}</label>
            <select id="invite-role" name="role">
              ${roles.map((role) => `<option value="${escapeAttribute(role)}"${role === initial ? " selected" : ""}>${escapeHtml(t(roleLabelKey(role)))}</option>`).join("")}
            </select>
            <p class="field-hint" data-invite-role-hint></p>
          </div>

          <fieldset class="invite-validity">
            <legend data-i18n="security.invite.validity">${escapeHtml(t("security.invite.validity"))}</legend>
            <label><input type="radio" name="validity" value="permanent" checked> <span data-i18n="security.invite.permanent">${escapeHtml(t("security.invite.permanent"))}</span></label>
            <label><input type="radio" name="validity" value="temporary"> <span data-i18n="security.invite.temporary">${escapeHtml(t("security.invite.temporary"))}</span></label>
            <div class="field" data-invite-expiry hidden>
              <label for="invite-expires" data-i18n="security.invite.expiresAt">${escapeHtml(t("security.invite.expiresAt"))}</label>
              <input id="invite-expires" name="expiresAt" type="date">
            </div>
          </fieldset>

          <fieldset class="invite-projects" data-invite-projects>
            <legend data-i18n="security.invite.projects">${escapeHtml(t("security.invite.projects"))}</legend>
            <p class="field-hint" data-i18n="security.invite.projectsHint">${escapeHtml(t("security.invite.projectsHint"))}</p>
            <div data-invite-project-list><p class="empty-inline">${escapeHtml(t("common.loading"))}</p></div>
          </fieldset>
          <p class="settings-note" data-invite-global hidden data-i18n="security.invite.globalProjects">${escapeHtml(t("security.invite.globalProjects"))}</p>

          <p class="field-error" data-invite-error role="alert" hidden></p>
          <div class="settings-password__actions">
            <a class="button" href="#/team" data-i18n="common.cancel">${escapeHtml(t("common.cancel"))}</a>
            <button class="button button--primary" type="submit" data-invite-submit data-i18n="security.invite.submit">${escapeHtml(t("security.invite.submit"))}</button>
          </div>
        </section>

        <aside class="panel settings-panel invite-preview" aria-live="polite">
          <h3 data-i18n="security.invite.previewTitle">${escapeHtml(t("security.invite.previewTitle"))}</h3>
          <div class="invite-preview__grid" data-invite-preview>${initial ? previewMarkup(initial) : ""}</div>
        </aside>
      </form>
    `;
  },
  afterRender: async () => {
    const form = document.querySelector("[data-invite-form]");
    if (!form) return;
    const list = form.querySelector("[data-invite-project-list]");
    const projectsBox = form.querySelector("[data-invite-projects]");
    const globalNote = form.querySelector("[data-invite-global]");
    const expiry = form.querySelector("[data-invite-expiry]");
    const preview = form.querySelector("[data-invite-preview]");
    const hint = form.querySelector("[data-invite-role-hint]");
    const error = form.querySelector("[data-invite-error]");
    const submit = form.querySelector("[data-invite-submit]");

    const paintRole = () => {
      const role = form.elements.role.value;
      preview.innerHTML = role ? previewMarkup(role) : "";
      const scoped = role && needsProjects(role);
      projectsBox.hidden = !scoped;
      globalNote.hidden = scoped;
      hint.textContent = isAdministrativeRole(role) ? t("security.invite.administrativeHint") : "";
    };
    const paintValidity = () => {
      expiry.hidden = form.elements.validity.value !== "temporary";
    };

    form.elements.role.addEventListener("change", paintRole);
    form.addEventListener("change", (event) => {
      if (event.target.name === "validity") paintValidity();
    });
    paintRole();
    paintValidity();

    try {
      list.innerHTML = projectOptions(await getProjects());
    } catch (failure) {
      list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(failure, t("security.invite.projectsError")))}</p>`;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.hidden = true;
      const role = form.elements.role.value;
      const temporary = form.elements.validity.value === "temporary";
      const expiresAt = temporary && form.elements.expiresAt.value ? new Date(`${form.elements.expiresAt.value}T23:59:59`).toISOString() : null;
      const projects = needsProjects(role)
        ? [...form.querySelectorAll('input[name="project"]:checked')].map((input) => ({
            projectId: input.value,
            accessLevel: form.elements[`level-${input.value}`]?.value === "EDIT" ? "EDIT" : "VIEW",
          }))
        : [];

      const problems = [];
      if (!form.elements.displayName.value.trim()) problems.push(t("security.invite.nameRequired"));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.elements.email.value.trim())) problems.push(t("security.invite.emailInvalid"));
      if (temporary && (!expiresAt || new Date(expiresAt).getTime() <= Date.now())) problems.push(t("security.invite.expiryInvalid"));
      if (problems.length) {
        error.hidden = false;
        error.textContent = problems.join(" ");
        return;
      }

      submit.disabled = true;
      submit.textContent = t("security.invite.sending");
      try {
        const result = await withStepUp(() =>
          inviteMember({ displayName: form.elements.displayName.value.trim(), email: form.elements.email.value.trim(), roles: [role], projects, accessExpiresAt: expiresAt }),
        );
        showToastAfterNavigation(t("security.invite.sent", { email: form.elements.email.value.trim() }));
        window.location.hash = result?.user_id ? `#/team/${encodeURIComponent(result.user_id)}` : "#/team";
      } catch (failure) {
        error.hidden = false;
        error.textContent = describeError(failure, t("security.invite.error"));
        submit.disabled = false;
        submit.textContent = t("security.invite.submit");
      }
    });
  },
};

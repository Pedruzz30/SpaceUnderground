import { bindLocaleSwitcher, localeSwitcher, t } from "../i18n/index.js";
import { escapeHtml } from "../utils/html.js";

function displayName(session) {
  const user = session?.user ?? {};
  const metadataName = user.user_metadata?.name || user.user_metadata?.full_name;
  if (metadataName) return metadataName;
  if (user.email) return user.email;
  return t("common.admin");
}

export function topbar({ title, breadcrumb, session }) {
  const accountLabel = displayName(session);

  return `
    <header class="topbar">
      <button class="topbar__menu" type="button" data-menu-toggle aria-controls="admin-sidebar" aria-expanded="false">
        <span></span>
        <span></span>
        <span class="visually-hidden">${t("shell.openMenu")}</span>
      </button>
      <div>
        <p>${escapeHtml(breadcrumb)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="topbar__account">
        ${localeSwitcher()}
        <div class="topbar__user" aria-label="${t("shell.authenticatedAdministrator")}">
          <span aria-hidden="true"></span>
          <strong>${escapeHtml(accountLabel)}</strong>
          <small>${session?.isAdmin ? t("common.owner").toUpperCase() : t("common.session").toUpperCase()}</small>
        </div>
        <button class="button topbar__logout" type="button" data-logout>${t("common.logout")}</button>
      </div>
    </header>
  `;
}

export function bindTopbar(root = document) {
  bindLocaleSwitcher(root);
}

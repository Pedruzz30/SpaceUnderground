import { bindLocaleSwitcher, localeSwitcher, t } from "../i18n/index.js";
import { roleLabelKey } from "../security/catalog.js";
import { escapeHtml } from "../utils/html.js";

// Who is signed in, as the database knows them: their name and RU from the
// team, and their highest role. A display name from Supabase user metadata is
// only a fallback label, never a source of access.
function displayName(session, access) {
  if (access?.member?.displayName) return access.member.displayName;
  const user = session?.user ?? {};
  const metadataName = user.user_metadata?.name || user.user_metadata?.full_name;
  if (metadataName) return metadataName;
  if (user.email) return user.email;
  return t("common.admin");
}

function roleBadge(session, access) {
  const [top] = [...(access?.roles ?? [])].sort((a, b) => b.rank - a.rank);
  if (top) return `<small data-i18n="${roleLabelKey(top.key)}">${escapeHtml(t(roleLabelKey(top.key)).toUpperCase())}</small>`;
  return `<small data-i18n="${session?.isAdmin ? "common.owner" : "common.session"}">${session?.isAdmin ? t("common.owner").toUpperCase() : t("common.session").toUpperCase()}</small>`;
}

export function topbar({ title, breadcrumb, session, access = null }) {
  const accountLabel = displayName(session, access);
  const ru = access?.member?.ru;

  return `
    <header class="topbar">
      <button class="topbar__menu" type="button" data-menu-toggle aria-controls="admin-sidebar" aria-expanded="false">
        <span></span>
        <span></span>
        <span class="visually-hidden" data-i18n="shell.openMenu">${t("shell.openMenu")}</span>
      </button>
      <div>
        <p data-page-breadcrumb>${escapeHtml(breadcrumb)}</p>
        <h1 data-page-title>${escapeHtml(title)}</h1>
      </div>
      <div class="topbar__account">
        ${localeSwitcher()}
        <div class="topbar__user" aria-label="${t("shell.authenticatedAdministrator")}" data-i18n-aria-label="shell.authenticatedAdministrator">
          <span aria-hidden="true"></span>
          <strong>${escapeHtml(accountLabel)}</strong>
          ${ru ? `<code class="topbar__ru" title="${escapeHtml(t("security.ru"))}">${escapeHtml(ru)}</code>` : ""}
          ${roleBadge(session, access)}
        </div>
        <button class="button topbar__logout" type="button" data-logout data-i18n="common.logout">${t("common.logout")}</button>
      </div>
    </header>
  `;
}

export function bindTopbar(root = document) {
  bindLocaleSwitcher(root);
}

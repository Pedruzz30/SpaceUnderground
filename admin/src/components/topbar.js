import { escapeHtml } from "../utils/html.js";

function displayName(session) {
  const user = session?.user ?? {};
  const metadataName = user.user_metadata?.name || user.user_metadata?.full_name;
  if (metadataName) return metadataName;
  if (user.email) return user.email;
  return "Admin";
}

export function topbar({ title, breadcrumb, session }) {
  const accountLabel = displayName(session);

  return `
    <header class="topbar">
      <button class="topbar__menu" type="button" data-menu-toggle aria-controls="admin-sidebar" aria-expanded="false">
        <span></span>
        <span></span>
        <span class="visually-hidden">Abrir menu</span>
      </button>
      <div>
        <p>${escapeHtml(breadcrumb)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="topbar__account">
        <div class="topbar__user" aria-label="Authenticated administrator">
          <span aria-hidden="true"></span>
          <strong>${escapeHtml(accountLabel)}</strong>
          <small>${session?.isAdmin ? "OWNER" : "SESSION"}</small>
        </div>
        <button class="button topbar__logout" type="button" data-logout>Logout</button>
      </div>
    </header>
  `;
}

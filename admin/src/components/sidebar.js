import { plural, t } from "../i18n/index.js";
import { hasAnyPermission, hasPermission, isSecurityModelActive } from "../security/access.js";

// Navigation for the Space Underground Lab. `match` is the canonical route of
// an item; `alias` holds routes that belong to the same area so the nav still
// reads correctly on legacy links (#/activity) and on the screens the CMS hub
// owns (#/media, #/content).
//
// `any` lists the permissions that open an item. Hiding an item is only
// courtesy: the route refuses too, and the database refuses the data behind it.
const navGroups = [
  {
    labelKey: "nav.overview",
    items: [{ labelKey: "nav.dashboard", href: "#/dashboard", match: "/dashboard" }],
  },
  {
    labelKey: "nav.operations",
    items: [
      { labelKey: "nav.projects", href: "#/projects", match: "/projects", any: ["projects.read"] },
      { labelKey: "nav.myProjects", href: "#/projects", match: "/projects", any: ["projects.read_assigned"], unless: ["projects.read"] },
      { labelKey: "nav.clients", href: "#/clients", match: "/clients", any: ["clients.read"] },
      { labelKey: "nav.commercial", href: "#/commercial", match: "/commercial", any: ["commercial.read"] },
      { labelKey: "nav.services", href: "#/services", match: "/services", any: ["services.read"] },
      { labelKey: "nav.financial", href: "#/financial", match: "/financial", any: ["finance.read"] },
    ],
  },
  {
    labelKey: "nav.content",
    items: [{ labelKey: "nav.cms", href: "#/cms", match: "/cms", alias: ["/media", "/content"], any: ["cms.read"] }],
  },
  {
    labelKey: "nav.review",
    security: true,
    items: [
      { labelKey: "nav.approvals", href: "#/approvals", match: "/approvals", any: ["approvals.read_all"], badge: "approvals" },
      { labelKey: "nav.myChanges", href: "#/my-changes", match: "/my-changes", any: ["approvals.request"] },
    ],
  },
  {
    labelKey: "nav.system",
    items: [
      { labelKey: "nav.team", href: "#/team", match: "/team", any: ["team.read"], security: true },
      { labelKey: "nav.audit", href: "#/audit", match: "/audit", any: ["audit.read"], security: true },
      { labelKey: "nav.logs", href: "#/logs", match: "/logs", alias: ["/activity"], any: ["logs.read"] },
      { labelKey: "nav.settings", href: "#/settings", match: "/settings" },
    ],
  },
];

function isCurrent(item, route) {
  return [item.match, ...(item.alias ?? [])].some(
    (candidate) => route === candidate || route.startsWith(`${candidate}/`),
  );
}

function visible(item, group, access) {
  if ((item.security || group.security) && !isSecurityModelActive(access)) return false;
  if (item.unless && hasAnyPermission(item.unless, access)) return false;
  return !item.any || hasAnyPermission(item.any, access);
}

const badgeHtml = (name, value) =>
  `<span class="side-link__badge" data-nav-badge="${name}"><span aria-hidden="true">${value}</span><span class="visually-hidden">${plural("nav.pendingCount", value)}</span></span>`;

function badgeMarkup(item, counts) {
  const value = item.badge ? counts[item.badge] : null;
  return value ? badgeHtml(item.badge, value) : "";
}

function navItem(item, route, counts) {
  const current = isCurrent(item, route);
  return `<a class="side-link${current ? " is-current" : ""}" href="${item.href}"${current ? ' aria-current="page"' : ""}><span class="side-link__label" data-i18n="${item.labelKey}">${t(item.labelKey)}</span>${badgeMarkup(item, counts)}</a>`;
}

export function sidebar(route, access = null, counts = {}) {
  const groups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => visible(item, group, access)) }))
    .filter((group) => group.items.length);

  return `
    <aside class="sidebar" data-sidebar>
      <div class="sidebar__brand">
        <span class="brand-mark" aria-hidden="true">SU</span>
        <div>
          <strong>SPACE UNDERGROUND</strong>
          <small data-i18n="nav.labControl">${t("nav.labControl")}</small>
        </div>
      </div>

      <nav class="sidebar__nav" aria-label="${t("nav.adminNavigation")}" data-i18n-aria-label="nav.adminNavigation">
        ${groups.map((group) => `
          <section>
            <p data-i18n="${group.labelKey}">${t(group.labelKey)}</p>
            ${group.items.map((item) => navItem(item, route, counts)).join("")}
          </section>
        `).join("")}
      </nav>

      ${access?.source === "legacy" && hasPermission("settings.read", access) ? `<p class="sidebar__notice" data-i18n="nav.securityPending">${t("nav.securityPending")}</p>` : ""}
      <a class="sidebar__website" href="../" target="_blank" rel="noreferrer"><span data-i18n="nav.viewWebsite">${t("nav.viewWebsite")}</span> <span aria-hidden="true">↗</span></a>
    </aside>
  `;
}

// Updates the approvals badge in place once its count arrives.
export function paintNavBadge(name, value) {
  const link = document.querySelector(`.side-link[href="#/${name}"]`);
  if (!link) return;
  link.querySelector("[data-nav-badge]")?.remove();
  if (value) link.insertAdjacentHTML("beforeend", badgeHtml(name, value));
}

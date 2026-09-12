import { t } from "../i18n/index.js";

// Navigation for the Space Underground Lab. `match` is the canonical route of
// an item; `alias` holds routes that belong to the same area so the nav still
// reads correctly on legacy links (#/activity) and on the screens the CMS hub
// owns (#/media, #/content).
const navGroups = [
  {
    labelKey: "nav.overview",
    items: [{ labelKey: "nav.dashboard", href: "#/dashboard", match: "/dashboard" }],
  },
  {
    labelKey: "nav.operations",
    items: [
      { labelKey: "nav.projects", href: "#/projects", match: "/projects" },
      { labelKey: "nav.clients", href: "#/clients", match: "/clients" },
      { labelKey: "nav.commercial", href: "#/commercial", match: "/commercial" },
      { labelKey: "nav.services", href: "#/services", match: "/services" },
      { labelKey: "nav.financial", href: "#/financial", match: "/financial" },
    ],
  },
  {
    labelKey: "nav.content",
    items: [{ labelKey: "nav.cms", href: "#/cms", match: "/cms", alias: ["/media", "/content"] }],
  },
  {
    labelKey: "nav.system",
    items: [
      { labelKey: "nav.logs", href: "#/logs", match: "/logs", alias: ["/activity"] },
      { labelKey: "nav.settings", href: "#/settings", match: "/settings" },
    ],
  },
];

function isCurrent(item, route) {
  return [item.match, ...(item.alias ?? [])].some(
    (candidate) => route === candidate || route.startsWith(`${candidate}/`),
  );
}

function navItem(item, route) {
  if (item.soon) {
    return `<button class="side-link side-link--disabled" type="button" disabled><span data-i18n="${item.labelKey}">${t(item.labelKey)}</span><span data-i18n="common.soon">${t("common.soon")}</span></button>`;
  }

  const current = isCurrent(item, route);
  return `<a class="side-link${current ? " is-current" : ""}" href="${item.href}"${current ? ' aria-current="page"' : ""} data-i18n="${item.labelKey}">${t(item.labelKey)}</a>`;
}

export function sidebar(route) {
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
        ${navGroups.map((group) => `
          <section>
            <p data-i18n="${group.labelKey}">${t(group.labelKey)}</p>
            ${group.items.map((item) => navItem(item, route)).join("")}
          </section>
        `).join("")}
      </nav>

      <a class="sidebar__website" href="../" target="_blank" rel="noreferrer"><span data-i18n="nav.viewWebsite">${t("nav.viewWebsite")}</span> <span aria-hidden="true">↗</span></a>
    </aside>
  `;
}

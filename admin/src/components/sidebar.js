// Navigation for the Space Underground Lab. `match` is the canonical route of
// an item; `alias` holds routes that belong to the same area so the nav still
// reads correctly on legacy links (#/activity) and on the screens the CMS hub
// owns (#/media, #/content).
const navGroups = [
  {
    label: "OVERVIEW",
    items: [{ label: "Dashboard", href: "#/dashboard", match: "/dashboard" }],
  },
  {
    label: "OPERATIONS",
    items: [
      { label: "Projects", href: "#/projects", match: "/projects" },
      { label: "Clients", href: "#/clients", match: "/clients" },
      { label: "Commercial", href: "#/commercial", match: "/commercial" },
      { label: "Services", href: "#/services", match: "/services" },
      { label: "Financial", href: "#/financial", match: "/financial" },
    ],
  },
  {
    label: "CONTENT",
    items: [{ label: "CMS", href: "#/cms", match: "/cms", alias: ["/media", "/content"] }],
  },
  {
    label: "SYSTEM",
    items: [
      { label: "Logs", href: "#/logs", match: "/logs", alias: ["/activity"] },
      { label: "Settings", href: "#/settings", match: "/settings" },
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
    return `<button class="side-link side-link--disabled" type="button" disabled>${item.label}<span>soon</span></button>`;
  }

  const current = isCurrent(item, route);
  return `<a class="side-link${current ? " is-current" : ""}" href="${item.href}"${current ? ' aria-current="page"' : ""}>${item.label}</a>`;
}

export function sidebar(route) {
  return `
    <aside class="sidebar" data-sidebar>
      <div class="sidebar__brand">
        <span class="brand-mark" aria-hidden="true">SU</span>
        <div>
          <strong>SPACE UNDERGROUND</strong>
          <small>LAB / CONTROL</small>
        </div>
      </div>

      <nav class="sidebar__nav" aria-label="Navegacao administrativa">
        ${navGroups.map((group) => `
          <section>
            <p>${group.label}</p>
            ${group.items.map((item) => navItem(item, route)).join("")}
          </section>
        `).join("")}
      </nav>

      <a class="sidebar__website" href="../" target="_blank" rel="noreferrer">View Website <span aria-hidden="true">↗</span></a>
    </aside>
  `;
}

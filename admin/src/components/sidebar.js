const navGroups = [
  {
    label: "OVERVIEW",
    items: [{ label: "Dashboard", href: "#/dashboard", match: "/dashboard" }],
  },
  {
    label: "CONTENT",
    items: [{ label: "Projects", href: "#/projects", match: "/projects" }],
  },
  {
    label: "FUTURE",
    items: [
      { label: "Services", soon: true },
      { label: "Media", soon: true },
      { label: "Settings", soon: true },
    ],
  },
];

function navItem(item, route) {
  if (item.soon) {
    return `<button class="side-link side-link--disabled" type="button" disabled>${item.label}<span>soon</span></button>`;
  }

  const isCurrent = route === item.match || route.startsWith(`${item.match}/`);
  return `<a class="side-link${isCurrent ? " is-current" : ""}" href="${item.href}"${isCurrent ? ' aria-current="page"' : ""}>${item.label}</a>`;
}

export function sidebar(route) {
  return `
    <aside class="sidebar" data-sidebar>
      <div class="sidebar__brand">
        <span class="brand-mark" aria-hidden="true">SU</span>
        <div>
          <strong>SPACE UNDERGROUND</strong>
          <small>ADMIN / CONTROL</small>
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

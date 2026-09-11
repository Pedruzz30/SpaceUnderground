import { escapeHtml } from "../utils/html.js";

// The CMS is one area of the Lab, not the whole system: every public-website
// surface is reachable from here, and nothing else is.
const modules = [
  {
    eyebrow: "PROJECTS / CASES",
    title: "Portfolio records",
    description: "Public portfolio records and presentation.",
    action: "Open Projects",
    href: "#/projects",
  },
  {
    eyebrow: "MEDIA",
    title: "Assets",
    description: "Posters, galleries and project assets.",
    action: "Open Media",
    href: "#/media",
  },
  {
    eyebrow: "SITE CONTENT",
    title: "Public sections",
    description: "Hero, About, Capabilities, Process, Contact and Footer.",
    action: "Edit Content",
    href: "#/content",
  },
  {
    eyebrow: "PLANS / PRICING",
    title: "Commercial plans",
    description: "Public commercial plans and pricing.",
    action: "Manage Plans",
    href: "#/services",
  },
  {
    eyebrow: "SEO / PUBLIC SETTINGS",
    title: "Site identity",
    description: "Site identity, metadata and public configuration.",
    action: "Open Settings",
    href: "#/settings",
  },
];

function moduleCard(module) {
  return `
    <article class="panel cms-card">
      <header class="panel__head">
        <div>
          <span>${escapeHtml(module.eyebrow)}</span>
          <h3>${escapeHtml(module.title)}</h3>
        </div>
      </header>
      <p>${escapeHtml(module.description)}</p>
      <a class="button" href="${escapeHtml(module.href)}">${escapeHtml(module.action)}</a>
    </article>
  `;
}

export const cmsPage = {
  title: "CMS",
  breadcrumb: "CONTENT / CMS",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>CMS</span>
        <h2>Content management.</h2>
        <p>Manage everything published on the Space Underground public website.</p>
      </div>
      <div class="heading-actions">
        <a class="button" href="../" target="_blank" rel="noreferrer">View Website</a>
      </div>
    </section>

    <div class="cms-grid">
      ${modules.map(moduleCard).join("")}
    </div>

    <p class="ops-note ops-note--spaced">CMS is the public-website area of the Space Underground Lab</p>
  `,
};

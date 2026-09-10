// Brings the Selected Work section under the control of the database.
//
// The page ships with the static registry, so it renders instantly and keeps
// working when Supabase is unreachable. Once the live data arrives it decides
// what stays: only projects that are PUBLISHED and visible remain, and their
// editorial fields and Storage images replace the bundled ones.
//
// The registry still supplies the presentation copy the admin has no column
// for (modules, coordinates, system, address) and the optimised poster
// variants, so nothing about the layout changes.

import { projects, defaultProjectKey } from "./project-registry.js";
import { fetchPublishedProjects, isConfigured, signPaths } from "./supabase-public.js";
import { getActiveProjectKey, showProject } from "./signal-frame.js";

const SOURCE_ATTRIBUTE = "data-projects-source";

// Anything without a scheme is a path inside the project-media bucket.
const isStoragePath = (value) => Boolean(value) && !/^(https?:|data:|blob:|\/|\.{1,2}\/)/i.test(value);

const text = (value) => (typeof value === "string" ? value.trim() : "");

function markSection(state) {
  document.querySelector("#work")?.setAttribute(SOURCE_ATTRIBUTE, state);
}

function slotsFor(key) {
  return [...document.querySelectorAll(`[data-project-slot="${key}"]`)];
}

// Projects the database no longer publishes fall back to the "reserved" state
// the design already has, and lose the copy that identified them.
function retireProject(key) {
  const project = projects[key];
  if (project) project.reserved = true;

  slotsFor(key).forEach((slot) => {
    slot.classList.remove("is-active");
    slot.classList.add("is-reserved");
    slot.setAttribute("data-slot-reserved", "");
    slot.setAttribute("aria-disabled", "true");
    slot.removeAttribute("aria-pressed");

    const caseNumber = project?.id ?? "";
    slot.setAttribute("aria-label", `Slot de projeto ${caseNumber} — reservado`);

    const tip = slot.querySelector(".signal-ui__slot-tip");
    if (tip) tip.innerHTML = `<em>PROJETO / ${caseNumber}</em>RESERVADO`;

    const name = slot.querySelector(".case-index__name");
    if (name) name.textContent = "RESERVADO";
    const type = slot.querySelector(".case-index__type");
    if (type) type.textContent = "—";
    const status = slot.querySelector(".case-index__status");
    if (status) status.innerHTML = '<i aria-hidden="true"></i>—';
  });
}

function applyRow(project, row, posterUrl) {
  // Only overwrite what the database actually holds: an empty column must not
  // erase the editorial copy the registry provides.
  const assign = (field, value) => {
    if (value !== undefined && value !== null && value !== "") project[field] = value;
  };

  assign("name", text(row.name));
  assign("client", text(row.client));
  assign("description", text(row.description));
  assign("accent", text(row.accent));
  assign("year", row.year ? String(row.year) : "");
  assign("url", text(row.project_url));
  assign("previewUrl", text(row.preview_url));

  if (Array.isArray(row.tech_stack) && row.tech_stack.length) {
    project.tech = row.tech_stack.join(" / ").toUpperCase();
  }

  if (posterUrl) {
    // Keep the bundled artwork as the fallback for an expired or failed token.
    project.posterFallback = project.poster;
    project.poster = posterUrl;
  }

  // Exposed for future use; Selected Work has no gallery surface yet.
  project.gallery = Array.isArray(row.project_gallery)
    ? [...row.project_gallery]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((image) => ({ url: image.signedUrl ?? "", alt: text(image.alt), caption: text(image.caption) }))
        .filter((image) => image.url)
    : [];
}

export async function initPublicProjects() {
  // Without configuration the site behaves exactly as it always has.
  if (!isConfigured()) return;

  try {
    const rows = await fetchPublishedProjects();
    const byCase = new Map(rows.map((row) => [Number(row.case_number), row]));

    // One batched signing request for every image on the page.
    const paths = [];
    rows.forEach((row) => {
      if (isStoragePath(row.poster_url)) paths.push(row.poster_url);
      (row.project_gallery ?? []).forEach((image) => {
        if (isStoragePath(image.url)) paths.push(image.url);
      });
    });

    let signed = new Map();
    if (paths.length) {
      try {
        signed = await signPaths(paths);
      } catch (error) {
        // Images are optional; the bundled posters carry the page.
        console.warn("[projects] could not sign image urls", error);
      }
    }

    rows.forEach((row) => {
      (row.project_gallery ?? []).forEach((image) => {
        image.signedUrl = isStoragePath(image.url) ? signed.get(image.url) ?? "" : image.url;
      });
    });

    const published = [];
    Object.entries(projects).forEach(([key, project]) => {
      const row = byCase.get(Number(project.id));
      if (!row) {
        retireProject(key);
        return;
      }
      applyRow(project, row, isStoragePath(row.poster_url) ? signed.get(row.poster_url) : text(row.poster_url));
      published.push(key);
    });

    if (!published.length) {
      markSection("empty");
      return;
    }

    markSection("supabase");

    // If the project on screen was just retired, move to one that is live.
    const active = getActiveProjectKey();
    const next = published.includes(active) ? active : published.includes(defaultProjectKey) ? defaultProjectKey : published[0];
    showProject(next);
  } catch (error) {
    // Supabase is unreachable or slow: keep the page exactly as it shipped.
    markSection("static");
    console.warn("[projects] Supabase unavailable, keeping the bundled registry.", error);
  }
}

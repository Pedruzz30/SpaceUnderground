import { projects, defaultProjectKey } from "./project-registry.js";
import { subscribeLocaleChange, t } from "./i18n/index.js";

const LIVE_PREVIEW_SELECTOR = "[data-live-project]";
const MOBILE_QUERY = "(max-width: 759px)";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const SLEEP_DELAY = 4000;
const LOAD_TIMEOUT = 8000;
const STATE_CLASS_NAMES = ["is-preview-loading", "is-preview-live", "is-preview-sleeping", "is-preview-fallback"];
const VIEW_CLASS_NAMES = ["is-view-site", "is-view-detail", "is-view-origin"];

// Resolved through t() at paint time rather than frozen into a lookup, so the
// status follows the locale like the rest of the viewer's copy.
const STATE_KEYS = {
  loading: "work.previewStatus.loading",
  live: "work.previewStatus.live",
  sleeping: "work.previewStatus.sleeping",
  fallback: "work.previewStatus.fallback",
};

let activePreview = null;
let viewer = null;

function openProject(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function resolveUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const resolved = new URL(raw, document.baseURI);
    return ["http:", "https:"].includes(resolved.protocol) ? resolved.href : "";
  } catch {
    return "";
  }
}

function originOf(url) {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function setPreviewStatus(frame, label) {
  const status = frame.querySelector("[data-preview-status]");
  if (status && status.textContent !== label) status.textContent = label;
}

function setPreviewState(frame, state) {
  frame.classList.remove(...STATE_CLASS_NAMES);
  frame.classList.add(`is-preview-${state}`);
  // Stamped so a locale change can re-label the status it is actually in,
  // rather than assuming standby.
  frame.dataset.previewState = state;
  setPreviewStatus(frame, t(STATE_KEYS[state] || STATE_KEYS.sleeping));
}

// Re-labels the status of every viewer from the state it is already in. Touches
// nothing else: not the mode, the project, the source or the iframe.
function relabelPreviewStatuses() {
  document.querySelectorAll(LIVE_PREVIEW_SELECTOR).forEach((frame) => {
    const state = frame.dataset.previewState || "sleeping";
    setPreviewStatus(frame, t(STATE_KEYS[state] || STATE_KEYS.sleeping));
  });
}

function createCalibration(frame) {
  let timer = 0;

  return () => {
    window.clearTimeout(timer);
    frame.classList.add("is-calibrating");
    timer = window.setTimeout(() => frame.classList.remove("is-calibrating"), 420);
  };
}

function setMode(frame, mode, modeButtons) {
  const nextMode = mode === "reset" ? "overview" : mode;
  frame.classList.remove(...VIEW_CLASS_NAMES);

  if (nextMode === "site") frame.classList.add("is-view-site");
  if (nextMode === "detail") frame.classList.add("is-view-detail");
  if (nextMode === "origin") frame.classList.add("is-view-origin");

  modeButtons.forEach((button) => {
    const isReset = button.dataset.signalMode === "reset";
    const isActive = button.dataset.signalMode === nextMode;
    button.classList.toggle("is-active", isActive);
    if (isReset) button.removeAttribute("aria-pressed");
    else button.setAttribute("aria-pressed", String(isActive));
  });

  return nextMode;
}

function createLivePreview(frame, mobileMedia) {
  // The display mode the viewer is in. Kept here so a locale change can put it
  // back exactly as it was instead of inferring it from CSS classes.
  let currentMode = "overview";
  const finePointerMedia = window.matchMedia(FINE_POINTER_QUERY);
  const visual = frame.closest(".project__visual");
  const hoverMark = visual?.querySelector(".project__hover-mark");
  const iframe = frame.querySelector("iframe");
  const poster = frame.querySelector(".signal-ui__poster");
  const posterSources = new Map(
    [...frame.querySelectorAll("[data-poster-source]")].map((node) => [node.dataset.posterSource, node]),
  );
  const modeButtons = [...frame.querySelectorAll("[data-signal-mode]")];
  const openButtons = [...frame.querySelectorAll("[data-signal-open]")];

  let projectUrl = frame.dataset.projectUrl || iframe?.dataset.src || "";
  let previewUrl = resolveUrl(frame.dataset.projectPreviewUrl || iframe?.dataset.src || projectUrl);
  let previewOrigin = originOf(previewUrl);
  let posterUrl = frame.dataset.projectPoster || "";

  const applyPoster = (next) => {
    if (!poster || !next) return;
    const formats = typeof next === "string" ? { png: next } : next;

    posterSources.forEach((node, format) => {
      if (formats[format]) node.setAttribute("srcset", formats[format]);
      else node.removeAttribute("srcset");
    });

    if (formats.width) poster.width = formats.width;
    if (formats.height) poster.height = formats.height;
    if (formats.png) poster.src = formats.png;
  };

  let sleepTimer = 0;
  let loadTimer = 0;
  let hasLoaded = false;
  const calibrate = createCalibration(frame);

  const clearSleepTimer = () => {
    if (!sleepTimer) return;
    window.clearTimeout(sleepTimer);
    sleepTimer = 0;
  };

  const clearLoadTimer = () => {
    if (!loadTimer) return;
    window.clearTimeout(loadTimer);
    loadTimer = 0;
  };

  const unload = () => {
    clearSleepTimer();
    clearLoadTimer();
    if (!iframe) return;
    if (iframe.src !== "about:blank") iframe.src = "about:blank";
    hasLoaded = false;
    if (activePreview === frame) activePreview = null;
    setPreviewState(frame, "sleeping");
  };

  const load = () => {
    clearSleepTimer();
    if (!iframe || mobileMedia.matches || !frame.classList.contains("is-view-site")) {
      setPreviewState(frame, "sleeping");
      return;
    }

    if (!previewUrl) {
      setPreviewState(frame, "fallback");
      return;
    }

    if (activePreview && activePreview !== frame) {
      activePreview.dispatchEvent(new CustomEvent("live-preview:release"));
    }

    activePreview = frame;

    if (iframe.src === previewUrl) {
      if (hasLoaded) setPreviewState(frame, "live");
      if (hasLoaded || frame.classList.contains("is-preview-loading")) return;
    }

    hasLoaded = false;
    setPreviewState(frame, "loading");
    iframe.src = previewUrl;

    clearLoadTimer();
    loadTimer = window.setTimeout(() => {
      if (!hasLoaded) setPreviewState(frame, "fallback");
    }, LOAD_TIMEOUT);
  };

  const scheduleSleep = () => {
    clearSleepTimer();
    sleepTimer = window.setTimeout(unload, SLEEP_DELAY);
  };

  // A remote poster (a signed Storage URL) can fail: an expired token, an
  // offline backend. Fall back to the poster shipped with the page instead of
  // leaving a broken image in the frame.
  let posterFallback = null;
  let posterFailed = false;

  poster?.addEventListener("error", () => {
    if (posterFailed || !posterFallback) return;
    posterFailed = true;
    applyPoster(posterFallback);
  });

  const setSource = ({ url, previewUrl: nextPreviewUrl, poster: nextPoster, posterFallback: fallback, title }) => {
    const resolvedPreview = resolveUrl(nextPreviewUrl || url);
    // Re-applying the same project -- which is what a locale change does -- must
    // not tear down a preview that is already loaded. Only the surrounding copy
    // changes, so the iframe is left exactly as it is.
    if (resolvedPreview === previewUrl && (nextPoster || "") === posterUrl) {
      projectUrl = url || "";
      if (iframe && title) iframe.title = title;
      return;
    }

    unload();
    projectUrl = url || "";
    previewUrl = resolveUrl(nextPreviewUrl || url);
    previewOrigin = originOf(previewUrl);
    posterUrl = nextPoster || "";
    posterFallback = fallback || null;
    posterFailed = false;
    if (iframe) {
      iframe.dataset.src = previewUrl;
      if (title) iframe.title = title;
    }
    applyPoster(posterUrl);
  };

  iframe?.addEventListener("load", () => {
    if (!iframe || iframe.src === "about:blank") return;
    clearLoadTimer();
    hasLoaded = true;
    setPreviewState(frame, "live");
  });

  iframe?.addEventListener("error", () => {
    clearLoadTimer();
    hasLoaded = false;
    setPreviewState(frame, "fallback");
  });

  window.addEventListener("message", (event) => {
    if (!iframe || event.source !== iframe.contentWindow) return;
    if (!previewOrigin || event.origin !== previewOrigin) return;
    const type = event.data?.type;
    if (typeof type !== "string" || !type.endsWith("preview:ready")) return;

    clearLoadTimer();
    hasLoaded = true;
    setPreviewState(frame, "live");
  });

  frame.addEventListener("live-preview:sleep", scheduleSleep);
  frame.addEventListener("live-preview:release", unload);

  modeButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextMode = setMode(frame, button.dataset.signalMode || "overview", modeButtons);
      currentMode = nextMode;
      calibrate();

      if (nextMode === "site" && !mobileMedia.matches) load();
      else if (hasLoaded || iframe?.src !== "about:blank") scheduleSleep();
    });
  });

  openButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (projectUrl) openProject(projectUrl);
    });
  });

  if (visual && hoverMark) {
    visual.addEventListener("pointermove", (event) => {
      if (!finePointerMedia.matches) return;

      const bounds = visual.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 14;
      const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 14;

      hoverMark.style.setProperty("--view-x", `${Math.max(-7, Math.min(7, x)).toFixed(2)}px`);
      hoverMark.style.setProperty("--view-y", `${Math.max(-7, Math.min(7, y)).toFixed(2)}px`);
    }, { passive: true });

    visual.addEventListener("pointerleave", () => {
      hoverMark.style.setProperty("--view-x", "0px");
      hoverMark.style.setProperty("--view-y", "0px");
    });
  }

  const activeObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        clearSleepTimer();
        frame.classList.add("is-preview-active");
      } else {
        frame.classList.remove("is-preview-active");
        scheduleSleep();
      }
    });
  }, { threshold: 0.12 });

  mobileMedia.addEventListener("change", (event) => {
    if (event.matches) unload();
  });

  currentMode = setMode(frame, "overview", modeButtons);
  applyPoster(posterUrl);
  setPreviewState(frame, "sleeping");
  activeObserver.observe(frame);

  return {
    setSource,
    calibrate,
    setMode: (mode) => {
      currentMode = setMode(frame, mode, modeButtons);
      return currentMode;
    },
    getMode: () => currentMode,
    refresh: () => {
      if (!mobileMedia.matches && frame.classList.contains("is-view-site")) load();
    },
  };
}

function createProjectViewer(frame, preview) {
  const article = frame.closest(".project") || frame;
  const root = frame.closest("section") || article;
  const caseIndex = root.querySelector("[data-case-index]");
  const accentTargets = [article, caseIndex].filter(Boolean);
  let slots = [];

  const pick = (attribute, scope = article) => [...scope.querySelectorAll(`[${attribute}]`)];
  const fields = {
    index: pick("data-viewer-index"),
    eyebrow: pick("data-viewer-eyebrow"),
    client: pick("data-viewer-client"),
    category: pick("data-viewer-category"),
    description: pick("data-viewer-description"),
    address: pick("data-viewer-address"),
    system: pick("data-viewer-system"),
    label: pick("data-viewer-label"),
    origin: pick("data-viewer-origin"),
    coordinates: pick("data-viewer-coordinates"),
    name: pick("data-viewer-name"),
    year: pick("data-viewer-year"),
    specs: pick("data-viewer-specs"),
    links: pick("data-viewer-link"),
    open: pick("data-viewer-open"),
    modules: [...article.querySelectorAll("[data-viewer-module]")],
    gallery: [...root.querySelectorAll("[data-viewer-gallery]")],
  };

  const write = (nodes, value) => nodes.forEach((node) => { node.textContent = value; });
  let activeKey = "";

  // `preserveMode` is for re-applying the same project after a locale change:
  // the copy around the viewer is rewritten, but the visitor stays in whatever
  // mode they had open. Choosing a different project still resets to overview.
  const apply = (key, { force = false, preserveMode = false } = {}) => {
    const project = projects[key];
    if (!project || project.reserved || (key === activeKey && !force)) return;
    activeKey = key;

    preview.setSource({
      url: project.url,
      previewUrl: project.previewUrl,
      poster: project.poster,
      // Set when the poster came from Supabase Storage: the bundled artwork
      // stays available as the fallback.
      posterFallback: project.posterFallback,
      title: t("work.livePreviewOf", { name: project.name }),
    });

    accentTargets.forEach((target) => target.style.setProperty("--accent", project.accent || "#c6ff00"));

    write(fields.index, t("work.caseIndex", { id: project.id }));
    write(fields.eyebrow, t("work.clientIndex", { id: project.id }));
    write(fields.client, project.client || "");
    write(fields.category, project.category || "");
    write(fields.description, project.description || "");
    write(fields.address, project.address || "");
    write(fields.system, project.system || "");
    write(fields.label, project.label || "");
    write(fields.origin, project.origin || "");
    write(fields.coordinates, (project.coordinates || []).join("\n"));
    write(fields.name, project.name || "");
    write(fields.year, t("work.yearValue", { year: project.year }));
    write(fields.specs, t("work.specs", { type: project.type, tech: project.tech, status: project.status }));

    const openLabel = t("work.openNamedTab", { name: project.name });
    fields.links.forEach((link) => {
      link.href = project.url;
      link.setAttribute("aria-label", openLabel);
    });
    fields.open.forEach((button) => {
      button.setAttribute("aria-label", t("work.openNamed", { name: project.name }));
    });

    fields.modules.forEach((button) => {
      const module = (project.modules || [])[Number(button.dataset.viewerModule)];
      button.hidden = !module;
      if (!module) return;
      const [number, title, caption] = module;
      const numberNode = button.querySelector("span");
      const titleNode = button.querySelector("strong");
      const captionNode = button.querySelector("small");
      if (numberNode) numberNode.textContent = number;
      if (titleNode) titleNode.textContent = title;
      if (captionNode) captionNode.textContent = caption;
      button.setAttribute("aria-label", t("work.inspectModule", { title: title.toLowerCase() }));
    });

    fields.gallery.forEach((node) => {
      const gallery = project.gallery || [];
      node.hidden = !gallery.length;
      node.innerHTML = gallery.length
        ? gallery.map((image) => `
          <figure class="project-gallery__item">
            <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || project.name || "")}" loading="lazy" decoding="async">
            ${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}
          </figure>
        `).join("")
        : "";
    });

    slots.forEach((slot) => {
      if (slot.hasAttribute("data-slot-reserved")) return;
      const isActive = slot.dataset.projectSlot === key;
      slot.classList.toggle("is-active", isActive);
      slot.setAttribute("aria-pressed", String(isActive));
    });

    preview.setMode(preserveMode ? preview.getMode() : "overview");
    preview.calibrate();
  };

  function bindSlots() {
    slots = [...root.querySelectorAll("[data-project-slot]")];
    slots.forEach((slot) => {
      if (slot.dataset.viewerBound === "true") return;
      slot.dataset.viewerBound = "true";
      slot.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (slot.hasAttribute("data-slot-reserved")) return;
        apply(slot.dataset.projectSlot || defaultProjectKey);
        if (!slot.closest(".signal-ui")) {
          article.querySelector(".project__visual")?.scrollIntoView({ block: "center" });
        }
      });
    });
  }

  bindSlots();

  slots.forEach((slot) => {
    slot.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      slot.click();
    });
  });

  if (defaultProjectKey) apply(defaultProjectKey);

  return { apply, bindSlots, getActiveKey: () => activeKey };
}

export function initSignalFrame() {
  const mobileMedia = window.matchMedia(MOBILE_QUERY);
  document.querySelectorAll(LIVE_PREVIEW_SELECTOR).forEach((frame) => {
    const preview = createLivePreview(frame, mobileMedia);
    if (frame.hasAttribute("data-project-viewer")) viewer = createProjectViewer(frame, preview);
  });

  subscribeLocaleChange(relabelPreviewStatuses);
}

export function getActiveProjectKey() {
  return viewer?.getActiveKey() ?? "";
}

// Called once live data arrives, so the viewer repaints with it.
export function showProject(key, { preserveMode = false } = {}) {
  if (!viewer) return;
  viewer.apply(key ?? viewer.getActiveKey(), { force: true, preserveMode });
}

export function refreshProjectViewerSlots() {
  viewer?.bindSlots();
}

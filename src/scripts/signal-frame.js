import { projects, defaultProjectKey } from "./project-registry.js";

const LIVE_PREVIEW_SELECTOR = "[data-live-project]";
const MOBILE_QUERY = "(max-width: 759px)";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const SLEEP_DELAY = 10000;
const LOAD_TIMEOUT = 8000;
const STATE_CLASS_NAMES = ["is-preview-loading", "is-preview-live", "is-preview-sleeping", "is-preview-fallback"];
const VIEW_CLASS_NAMES = ["is-view-site", "is-view-detail", "is-view-origin"];

// Texto do [data-preview-status], no canto do frame.
const STATE_LABELS = {
  loading: "PREVIEW / INITIALIZING",
  live: "● LIVE PREVIEW",
  sleeping: "PREVIEW / SLEEP",
  fallback: "PREVIEW / FALLBACK",
};

let activePreview = null;

function openProject(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// So aceita http(s); qualquer outra coisa vira string vazia e o frame cai em fallback.
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

function setPreviewStatus(frame, label) {
  const status = frame.querySelector("[data-preview-status]");
  if (status && status.textContent !== label) status.textContent = label;
}

function setPreviewState(frame, state) {
  frame.classList.remove(...STATE_CLASS_NAMES);
  frame.classList.add(`is-preview-${state}`);
  setPreviewStatus(frame, STATE_LABELS[state] || STATE_LABELS.sleeping);
}

function createCalibration(frame) {
  let timer = 0;

  return () => {
    window.clearTimeout(timer);
    frame.classList.add("is-calibrating");
    timer = window.setTimeout(() => frame.classList.remove("is-calibrating"), 720);
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
}

function createLivePreview(frame, mobileMedia) {
  const finePointerMedia = window.matchMedia(FINE_POINTER_QUERY);
  const visual = frame.closest(".project__visual");
  const hoverMark = visual?.querySelector(".project__hover-mark");
  const iframe = frame.querySelector("iframe");
  const poster = frame.querySelector(".signal-ui__poster");
  // <source> do <picture> do poster, por formato. Trocar so o img.src deixaria
  // o navegador servindo o AVIF/WebP do case anterior.
  const posterSources = new Map(
    [...frame.querySelectorAll("[data-poster-source]")].map((node) => [node.dataset.posterSource, node]),
  );
  const modeButtons = [...frame.querySelectorAll("[data-signal-mode]")];
  const openButtons = [...frame.querySelectorAll("[data-signal-open]")];

  // Fonte corrente do frame. Trocar de projeto so reescreve estas tres variaveis.
  let projectUrl = frame.dataset.projectUrl || iframe?.dataset.src || "";
  let previewUrl = resolveUrl(frame.dataset.projectPreviewUrl || iframe?.dataset.src || projectUrl);
  let previewOrigin = originOf(previewUrl);
  let posterUrl = frame.dataset.projectPoster || "";

  const applyPoster = (next) => {
    if (!poster || !next) return;
    // Aceita tanto a string antiga quanto o objeto com os tres formatos.
    const formats = typeof next === "string" ? { png: next } : next;
    posterSources.forEach((node, format) => {
      if (formats[format]) node.srcset = formats[format];
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
    iframe.src = "about:blank";
    hasLoaded = false;
    if (activePreview === frame) activePreview = null;
    setPreviewState(frame, "sleeping");
  };

  const load = ({ preload = false } = {}) => {
    clearSleepTimer();
    if (!iframe || mobileMedia.matches) {
      setPreviewState(frame, "sleeping");
      return;
    }

    if (!previewUrl) {
      setPreviewState(frame, "fallback");
      return;
    }

    if (activePreview && activePreview !== frame) {
      if (preload && activePreview.classList.contains("is-preview-active")) return;
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
      if (hasLoaded) return;
      setPreviewState(frame, "fallback");
    }, LOAD_TIMEOUT);
  };

  const scheduleSleep = () => {
    clearSleepTimer();
    sleepTimer = window.setTimeout(unload, SLEEP_DELAY);
  };

  // Descarrega o projeto atual e aponta o mesmo iframe para o proximo.
  const setSource = ({ url, previewUrl: nextPreviewUrl, poster: nextPoster, title }) => {
    unload();
    projectUrl = url || "";
    previewUrl = resolveUrl(nextPreviewUrl || url);
    previewOrigin = originOf(previewUrl);
    posterUrl = nextPoster || "";
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
      setMode(frame, button.dataset.signalMode || "overview", modeButtons);
      calibrate();
      if (!mobileMedia.matches) load();
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

  const preloadObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) load({ preload: true });
    });
  }, { rootMargin: "800px 0px" });

  const activeObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        clearSleepTimer();
        frame.classList.add("is-preview-active");
        if (!mobileMedia.matches) load();
      } else {
        frame.classList.remove("is-preview-active");
        scheduleSleep();
      }
    });
  }, { threshold: 0.18 });

  mobileMedia.addEventListener("change", (event) => {
    if (event.matches) unload();
    else if (frame.classList.contains("is-preview-active")) load();
  });

  setMode(frame, "overview", modeButtons);
  applyPoster(posterUrl);
  setPreviewState(frame, "sleeping");
  preloadObserver.observe(frame);
  activeObserver.observe(frame);

  return {
    setSource,
    calibrate,
    setMode: (mode) => setMode(frame, mode, modeButtons),
    refresh: ({ force = false } = {}) => {
      if (mobileMedia.matches) return;
      if (force || frame.classList.contains("is-preview-active")) load();
    },
  };
}

// PROJECT VIEWER: um frame, varios projetos. Os dados vem de project-registry.js.
function createProjectViewer(frame, preview) {
  const article = frame.closest(".project") || frame;
  // Os seletores vivem em dois lugares: os quadradinhos do rail (dentro do frame)
  // e as linhas do indice de cases (irmao do card). Ambos usam data-project-slot.
  const root = frame.closest("section") || article;
  const caseIndex = root.querySelector("[data-case-index]");
  const accentTargets = [article, caseIndex].filter(Boolean);
  const slots = [...root.querySelectorAll("[data-project-slot]")];

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
  };

  const write = (nodes, value) => nodes.forEach((node) => { node.textContent = value; });

  let activeKey = "";

  const apply = (key, { force = false } = {}) => {
    const project = projects[key];
    if (!project || project.reserved || key === activeKey) return;
    activeKey = key;

    // 1. descarrega o projeto atual antes de qualquer troca de conteudo
    preview.setSource({
      url: project.url,
      previewUrl: project.previewUrl,
      poster: project.poster,
      title: `${project.name} live website preview`,
    });

    // 2. accent do projeto vale para o card inteiro (frame, grid e detalhes)
    accentTargets.forEach((target) => target.style.setProperty("--accent", project.accent));

    // 3. metadados
    write(fields.index, `CASE / ${project.id}`);
    write(fields.eyebrow, `CLIENT / ${project.id}`);
    write(fields.client, project.client);
    write(fields.category, project.category);
    write(fields.description, project.description);
    write(fields.address, project.address);
    write(fields.system, project.system);
    write(fields.label, project.label);
    write(fields.origin, project.origin);
    write(fields.coordinates, project.coordinates.join("\n"));
    write(fields.name, project.name);
    write(fields.year, `YEAR — ${project.year}`);
    write(fields.specs, `TYPE — ${project.type}\nTECH — ${project.tech}\nSTATUS — ${project.status}`);

    const openLabel = `View ${project.name} website (opens in a new tab)`;
    fields.links.forEach((link) => {
      link.href = project.url;
      link.setAttribute("aria-label", openLabel);
    });
    fields.open.forEach((button) => {
      button.setAttribute("aria-label", `Open ${project.name} website in a new tab`);
    });

    fields.modules.forEach((button) => {
      const module = project.modules[Number(button.dataset.viewerModule)];
      if (!module) return;
      const [number, title, caption] = module;
      const numberNode = button.querySelector("span");
      const titleNode = button.querySelector("strong");
      const captionNode = button.querySelector("small");
      if (numberNode) numberNode.textContent = number;
      if (titleNode) titleNode.textContent = title;
      if (captionNode) captionNode.textContent = caption;
      button.setAttribute("aria-label", `Inspect ${title.toLowerCase()}`);
    });

    // 4. estado dos quadrados da coluna esquerda
    slots.forEach((slot) => {
      if (slot.hasAttribute("data-slot-reserved")) return;
      const isActive = slot.dataset.projectSlot === key;
      slot.classList.toggle("is-active", isActive);
      slot.setAttribute("aria-pressed", String(isActive));
    });

    // 5. volta para overview e recarrega o iframe unico
    preview.setMode("overview");
    preview.calibrate();
    preview.refresh({ force });
  };

  slots.forEach((slot) => {
    slot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (slot.hasAttribute("data-slot-reserved")) return;
      apply(slot.dataset.projectSlot || defaultProjectKey, { force: true });
      if (!slot.closest(".signal-ui")) {
        article.querySelector(".project__visual")?.scrollIntoView({ block: "center" });
      }
    });
  });

  apply(defaultProjectKey);
}

export function initSignalFrame() {
  const mobileMedia = window.matchMedia(MOBILE_QUERY);
  document.querySelectorAll(LIVE_PREVIEW_SELECTOR).forEach((frame) => {
    const preview = createLivePreview(frame, mobileMedia);
    if (frame.hasAttribute("data-project-viewer")) createProjectViewer(frame, preview);
  });
}

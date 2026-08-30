const LIVE_PREVIEW_SELECTOR = "[data-live-project]";
const MOBILE_QUERY = "(max-width: 759px)";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const SLEEP_DELAY = 10000;
const LOAD_TIMEOUT = 8000;
const STATE_CLASS_NAMES = ["is-preview-loading", "is-preview-live", "is-preview-sleeping", "is-preview-fallback"];
const VIEW_CLASS_NAMES = ["is-view-site", "is-view-detail", "is-view-origin"];

let activePreview = null;

function openProject(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function setPreviewStatus(frame, label) {
  const status = frame.querySelector("[data-preview-status]");
  if (status) status.textContent = label;
}

function setPreviewState(frame, state) {
  frame.classList.remove(...STATE_CLASS_NAMES);
  frame.classList.add(`is-preview-${state}`);

  const labels = {
    loading: "PREVIEW / INITIALIZING",
    live: "● LIVE PREVIEW",
    sleeping: "PREVIEW / SLEEP",
    fallback: "PREVIEW / FALLBACK",
  };

  setPreviewStatus(frame, labels[state] || labels.sleeping);
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
    const isActive = button.dataset.signalMode === nextMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function createLivePreview(frame, mobileMedia) {
  const finePointerMedia = window.matchMedia(FINE_POINTER_QUERY);
  const visual = frame.closest(".project__visual--signal");
  const hoverMark = visual?.querySelector(".project__hover-mark");
  const iframe = frame.querySelector("iframe");
  const poster = frame.querySelector(".signal-ui__poster");
  const modeButtons = [...frame.querySelectorAll("[data-signal-mode]")];
  const reloadButtons = [...frame.querySelectorAll("[data-signal-action='reload']")];
  const openButtons = [...frame.querySelectorAll("[data-signal-open]")];
  const projectUrl = frame.dataset.projectUrl || iframe?.dataset.src || "";
  const previewUrl = frame.dataset.projectPreviewUrl || iframe?.dataset.src || projectUrl;
  const posterUrl = frame.dataset.projectPoster;
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

  const load = () => {
    clearSleepTimer();
    if (!iframe || mobileMedia.matches) {
      setPreviewState(frame, "sleeping");
      return;
    }

    if (activePreview && activePreview !== frame) {
      activePreview.dispatchEvent(new CustomEvent("live-preview:release"));
    }

    activePreview = frame;

    if (iframe.src === previewUrl && hasLoaded) {
      setPreviewState(frame, "live");
      return;
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
    if (event.origin !== "https://pedruzz30.github.io") return;
    if (event.data?.type !== "tattoo-preview:ready") return;

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

  reloadButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      calibrate();
      unload();
      if (!mobileMedia.matches) window.requestAnimationFrame(load);
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
      if (entry.isIntersecting) load();
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
    else load();
  });

  setMode(frame, "overview", modeButtons);
  if (poster && posterUrl) poster.src = posterUrl;
  setPreviewState(frame, "sleeping");
  preloadObserver.observe(frame);
  activeObserver.observe(frame);
}

export function initSignalFrame() {
  const mobileMedia = window.matchMedia(MOBILE_QUERY);
  document.querySelectorAll(LIVE_PREVIEW_SELECTOR).forEach((frame) => {
    createLivePreview(frame, mobileMedia);
  });
}

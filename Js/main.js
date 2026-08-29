"use strict";

document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const header = document.querySelector("[data-header]");
const progressBar = document.querySelector(".scroll-progress span");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-nav]");
const mainContent = document.querySelector("main");
const siteFooter = document.querySelector(".site-footer");
const navLinks = [...document.querySelectorAll(".nav-link")];
const revealElements = document.querySelectorAll("[data-reveal]");
const clippedLines = document.querySelectorAll(".statement-line, .contact-line");
const yearTargets = document.querySelectorAll("[data-year]");
const projectDialog = document.querySelector("[data-project-dialog]");
const projectOpeners = document.querySelectorAll("[data-project]");

let menuOpen = false;
let previousFocus = null;
let scrollTicking = false;

const updateScrollUI = () => {
  const scrollTop = window.scrollY;
  const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollRange > 0 ? scrollTop / scrollRange : 0;

  header?.classList.toggle("is-scrolled", scrollTop > 24);

  if (progressBar) {
    progressBar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
  }

  scrollTicking = false;
};

const requestScrollUpdate = () => {
  if (scrollTicking) return;
  scrollTicking = true;
  window.requestAnimationFrame(updateScrollUI);
};

window.addEventListener("scroll", requestScrollUpdate, { passive: true });
window.addEventListener("resize", requestScrollUpdate, { passive: true });
updateScrollUI();

const getMenuFocusableItems = () => {
  if (!navigation) return [];
  const items = [...navigation.querySelectorAll("a[href], button:not([disabled])")];
  if (menuToggle) items.push(menuToggle);
  return items;
};

const setMenuState = (open, { restoreFocus = true } = {}) => {
  if (!menuToggle || !navigation) return;

  menuOpen = open;
  navigation.classList.toggle("is-open", open);
  navigation.style.visibility = open ? "visible" : "";
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  document.body.classList.toggle("menu-open", open);
  document.body.style.overflow = open ? "hidden" : "";

  [mainContent, siteFooter].forEach((region) => {
    if (!region) return;
    region.toggleAttribute("inert", open);
    if (open) region.setAttribute("aria-hidden", "true");
    else region.removeAttribute("aria-hidden");
  });

  if (open) {
    previousFocus = document.activeElement;
    const firstItem = getMenuFocusableItems()[0];
    if (firstItem) {
      navigation.getBoundingClientRect();
      firstItem.focus({ preventScroll: true });
      if (document.activeElement !== firstItem) {
        window.requestAnimationFrame(() => firstItem.focus({ preventScroll: true }));
      }
    }
  } else if (restoreFocus && previousFocus instanceof HTMLElement) {
    previousFocus.focus();
  }
};

menuToggle?.addEventListener("click", () => setMenuState(!menuOpen));

navigation?.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (link && menuOpen) setMenuState(false);
});

document.addEventListener("keydown", (event) => {
  if (!menuOpen) return;

  if (event.key === "Escape") {
    event.preventDefault();
    setMenuState(false);
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = getMenuFocusableItems();
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener("resize", () => {
  if (menuOpen && window.innerWidth > 980) {
    setMenuState(false, { restoreFocus: false });
  }
}, { passive: true });

const makeVisible = (element) => element.classList.add("is-visible");

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealElements.forEach(makeVisible);
  clippedLines.forEach(makeVisible);
} else {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      makeVisible(entry.target);
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -8% 0px",
    threshold: 0.08,
  });

  revealElements.forEach((element) => revealObserver.observe(element));

  const lineObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      makeVisible(entry.target);
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -5% 0px",
    threshold: 0.35,
  });

  clippedLines.forEach((line) => lineObserver.observe(line));
}

const sectionNavMap = new Map([
  ["home", "home"],
  ["services", "services"],
  ["work", "work"],
  ["philosophy", "about"],
  ["process", "about"],
  ["why", "about"],
  ["about", "about"],
  ["contact", "contact"],
]);

const observedSections = [...sectionNavMap.keys()]
  .map((id) => document.getElementById(id))
  .filter(Boolean);

if ("IntersectionObserver" in window && observedSections.length) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;

    const currentNavId = sectionNavMap.get(visible.target.id);

    navLinks.forEach((link) => {
      const isCurrent = link.getAttribute("href") === `#${currentNavId}`;
      link.classList.toggle("is-active", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }, {
    rootMargin: "-30% 0px -55% 0px",
    threshold: [0, 0.15, 0.4],
  });

  observedSections.forEach((section) => sectionObserver.observe(section));
}

yearTargets.forEach((target) => {
  target.textContent = String(new Date().getFullYear());
});

const projectPreviews = {
  signal: {
    index: "001",
    category: "SaaS Platform",
    year: "2026",
    title: "Signal OS",
    description: "A real-time operations platform turning complex data into clear, decisive action.",
    scope: ["Product strategy", "UX / UI design", "Front-end system"],
    code: "SGNL_001",
    monogram: "S/",
  },
  form: {
    index: "002",
    category: "Editorial Portfolio",
    year: "2025",
    title: "Form & Void",
    description: "An architecture portfolio where restraint, rhythm and spatial thinking lead the experience.",
    scope: ["Creative direction", "Editorial UX", "Creative development"],
    code: "FRMV_002",
    monogram: "F/V",
  },
  nox: {
    index: "003",
    category: "E-commerce",
    year: "2025",
    title: "NOX Objects",
    description: "A tactile storefront for limited-run objects sitting between design, art and utility.",
    scope: ["Commerce strategy", "Art direction", "Storefront development"],
    code: "NOX_003",
    monogram: "N/",
  },
};

if (projectDialog) {
  const dialogFields = {
    index: projectDialog.querySelector("[data-dialog-index]"),
    category: projectDialog.querySelector("[data-dialog-category]"),
    year: projectDialog.querySelector("[data-dialog-year]"),
    title: projectDialog.querySelector("[data-dialog-title]"),
    description: projectDialog.querySelector("[data-dialog-description]"),
    code: projectDialog.querySelector("[data-dialog-code]"),
    monogram: projectDialog.querySelector("[data-dialog-monogram]"),
    scope: [...projectDialog.querySelectorAll("[data-dialog-scope]")],
  };
  const dialogClose = projectDialog.querySelector("[data-dialog-close]");
  const dialogContact = projectDialog.querySelector("[data-dialog-contact]");
  let previousBodyOverflow = "";

  const restoreDialogState = () => {
    document.body.style.overflow = previousBodyOverflow;
  };

  const closeProjectDialog = () => {
    if (typeof projectDialog.close === "function" && projectDialog.open) {
      projectDialog.close();
    } else {
      projectDialog.removeAttribute("open");
      restoreDialogState();
    }
  };

  projectOpeners.forEach((opener) => {
    opener.addEventListener("click", (event) => {
      const preview = projectPreviews[opener.dataset.project];
      if (!preview) return;

      event.preventDefault();
      dialogFields.index.textContent = preview.index;
      dialogFields.category.textContent = preview.category;
      dialogFields.year.textContent = preview.year;
      dialogFields.title.textContent = preview.title;
      dialogFields.description.textContent = preview.description;
      dialogFields.code.textContent = preview.code;
      dialogFields.monogram.textContent = preview.monogram;
      dialogFields.scope.forEach((field, index) => {
        field.textContent = preview.scope[index] || "";
      });

      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      if (typeof projectDialog.showModal === "function") projectDialog.showModal();
      else projectDialog.setAttribute("open", "");

      dialogClose?.focus({ preventScroll: true });
    });
  });

  dialogClose?.addEventListener("click", closeProjectDialog);
  dialogContact?.addEventListener("click", closeProjectDialog);
  projectDialog.addEventListener("close", restoreDialogState);
  projectDialog.addEventListener("click", (event) => {
    if (event.target !== projectDialog) return;
    const bounds = projectDialog.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!inside) closeProjectDialog();
  });
}

if (finePointer && !reduceMotion) {
  const cursorAura = document.querySelector(".cursor-aura");
  const hoverTargets = document.querySelectorAll("a, button");
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;
  let auraX = pointerX;
  let auraY = pointerY;
  let auraFrame = 0;

  const renderAura = () => {
    auraX += (pointerX - auraX) * 0.11;
    auraY += (pointerY - auraY) * 0.11;

    if (cursorAura) {
      cursorAura.style.left = `${auraX}px`;
      cursorAura.style.top = `${auraY}px`;
    }

    const stillMoving = Math.abs(pointerX - auraX) > 0.1 || Math.abs(pointerY - auraY) > 0.1;
    auraFrame = stillMoving ? window.requestAnimationFrame(renderAura) : 0;
  };

  window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    document.body.classList.add("has-pointer");
    if (!auraFrame) auraFrame = window.requestAnimationFrame(renderAura);
  }, { passive: true });

  document.documentElement.addEventListener("mouseleave", () => {
    document.body.classList.remove("has-pointer");
  });

  hoverTargets.forEach((target) => {
    target.addEventListener("pointerenter", () => document.body.classList.add("is-link-hover"));
    target.addEventListener("pointerleave", () => document.body.classList.remove("is-link-hover"));
  });

  document.querySelectorAll("[data-tilt]").forEach((tiltArea) => {
    const frame = tiltArea.querySelector(".hero-art__frame");
    if (!frame) return;

    tiltArea.addEventListener("pointermove", (event) => {
      const bounds = tiltArea.getBoundingClientRect();
      const xRatio = (event.clientX - bounds.left) / bounds.width - 0.5;
      const yRatio = (event.clientY - bounds.top) / bounds.height - 0.5;

      frame.style.setProperty("--tilt-x", `${xRatio * 7}deg`);
      frame.style.setProperty("--tilt-y", `${yRatio * -7}deg`);
    });

    tiltArea.addEventListener("pointerleave", () => {
      frame.style.setProperty("--tilt-x", "0deg");
      frame.style.setProperty("--tilt-y", "0deg");
    });
  });
}

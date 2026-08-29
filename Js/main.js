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
const projectForm = document.querySelector("[data-project-form]");

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
  ["labs", "labs"],
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
    category: "Concept Project / Software Interface",
    year: "2026",
    title: "Signal OS",
    description: "A speculative interface study for real-time operations. Prepared as a case-study slot for future client work or Space Labs products.",
    scope: ["TYPE — SOFTWARE", "TECH — HTML / CSS / JS", "STATUS — EXPERIMENT"],
    code: "SGNL_001",
    monogram: "S/",
  },
  form: {
    index: "002",
    category: "Concept Project / Portfolio",
    year: "2026",
    title: "Form & Void",
    description: "A portfolio concept where restraint, rhythm and spatial thinking lead the experience. Ready to be replaced by a real client case.",
    scope: ["TYPE — PORTFOLIO", "TECH — HTML / CSS / JS", "STATUS — CONCEPT"],
    code: "FRMV_002",
    monogram: "F/V",
  },
  nox: {
    index: "003",
    category: "Experiment / E-commerce",
    year: "2026",
    title: "NOX Objects",
    description: "A tactile storefront experiment for limited-run objects. The component already supports real project metadata later.",
    scope: ["TYPE — E-COMMERCE", "TECH — HTML / CSS / JS", "STATUS — CONCEPT"],
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

if (projectForm) {
  const formStatus = projectForm.querySelector("[data-form-status]");
  const fields = [...projectForm.querySelectorAll("input, select, textarea")];
  const projectNeedField = projectForm.querySelector("#project-need");
  const nameField = projectForm.querySelector("#project-name");
  const emailField = projectForm.querySelector("#project-email");
  const messageField = projectForm.querySelector("#project-message");
  const budgetField = projectForm.querySelector("#project-budget");
  const timelineField = projectForm.querySelector("#project-timeline");
  const gotchaField = projectForm.querySelector("[name='_gotcha']");
  const submitButton = projectForm.querySelector("[type='submit']");
  const submitButtonText = submitButton?.querySelector("span");
  const budgetChoices = [...projectForm.querySelectorAll("[data-budget-choice]")];
  const timelineChoices = [...projectForm.querySelectorAll("[data-timeline-choice]")];
  const productOptions = [...projectForm.querySelectorAll("[data-product-option]")];
  const productCount = projectForm.querySelector("[data-product-count]");
  const productSummary = projectForm.querySelector("[data-product-summary]");
  const productSummaryTitle = productSummary?.querySelector("strong");
  const productSummaryKicker = productSummary?.querySelector("span");
  const productSummaryText = projectForm.querySelector("[data-product-summary-text]");

  const productDetails = {
    "landing-page": {
      label: "Landing Page",
      text: "Best for campaigns, launches and focused offers. Usually includes strategy, page structure, responsive interface and a conversion-ready contact path.",
    },
    portfolio: {
      label: "Portfolio",
      text: "Best for professionals, creators and brands that need a memorable digital identity with selected work, story and contact flow.",
    },
    "institutional-website": {
      label: "Institutional Website",
      text: "Best for companies that need a complete presence with multiple pages, clear navigation, service content and a scalable structure.",
    },
    "e-commerce": {
      label: "E-commerce",
      text: "Best for product catalogs and stores where discovery, usability, checkout intent and visual direction need to work together.",
    },
    "web-system": {
      label: "Web System",
      text: "Best for dashboards, internal platforms and custom tools where workflow, data and interface behavior matter more than decoration.",
    },
    other: {
      label: "Other",
      text: "Best for unusual scopes, early product ideas or builds that need a technical conversation before being named properly.",
    },
  };

  const setFieldState = (field) => {
    const wrapper = field.closest(".form-field");
    if (!wrapper) return;
    wrapper.classList.toggle("is-invalid", field.matches(":invalid") && field.dataset.touched === "true");
  };

  const setManualFieldState = (field, isInvalid) => {
    if (!field) return;
    const wrapper = field.closest(".form-field");
    if (!wrapper) return;
    wrapper.classList.toggle("is-invalid", isInvalid);
  };

  const setChoiceState = (choices, value, attribute) => {
    choices.forEach((choice) => {
      choice.classList.toggle("is-selected", choice.dataset[attribute] === value);
    });
  };

  const setProductChoice = (value, { autofill = true } = {}) => {
    const selectedOption = productOptions.find((option) => option.dataset.value === value);
    const details = productDetails[value];

    productOptions.forEach((option) => {
      const isSelected = option === selectedOption;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-pressed", String(isSelected));
    });

    if (projectNeedField && projectNeedField.value !== value) {
      projectNeedField.value = value;
    }

    if (productCount) {
      const selectedIndex = selectedOption ? productOptions.indexOf(selectedOption) + 1 : 0;
      productCount.textContent = `${String(selectedIndex).padStart(2, "0")} / ${String(productOptions.length).padStart(2, "0")}`;
    }

    if (productSummaryKicker) productSummaryKicker.textContent = details ? "PRODUCT SELECTED" : "NO PRODUCT SELECTED";
    if (productSummaryTitle) productSummaryTitle.textContent = details ? details.label : "Choose a build type to calibrate the request.";
    if (productSummaryText) {
      const budget = selectedOption?.dataset.budget || "To define";
      const timeline = selectedOption?.dataset.timeline || "To define";
      productSummaryText.textContent = details
        ? `${details.text} Budget range: ${budget}. Estimated time: ${timeline}.`
        : "Budget range and timeline hints will appear here. You can still edit the fields manually.";
    }

    if (autofill && selectedOption) {
      if (budgetField) budgetField.value = selectedOption.dataset.budget || "";
      if (timelineField) timelineField.value = selectedOption.dataset.timeline || "";
    }

    setChoiceState(budgetChoices, budgetField?.value || "", "budgetChoice");
    setChoiceState(timelineChoices, timelineField?.value || "", "timelineChoice");

    if (projectNeedField) setFieldState(projectNeedField);
  };

  productOptions.forEach((option) => {
    option.addEventListener("click", () => {
      if (formStatus) formStatus.textContent = "";
      projectNeedField.dataset.touched = "true";
      setProductChoice(option.dataset.value);
    });
  });

  projectNeedField?.addEventListener("change", () => {
    setProductChoice(projectNeedField.value, { autofill: false });
  });

  budgetChoices.forEach((choice) => {
    choice.addEventListener("click", () => {
      if (!budgetField) return;
      budgetField.value = choice.dataset.budgetChoice || "";
      setChoiceState(budgetChoices, budgetField.value, "budgetChoice");
      if (formStatus) formStatus.textContent = "";
    });
  });

  timelineChoices.forEach((choice) => {
    choice.addEventListener("click", () => {
      if (!timelineField) return;
      timelineField.value = choice.dataset.timelineChoice || "";
      setChoiceState(timelineChoices, timelineField.value, "timelineChoice");
      if (formStatus) formStatus.textContent = "";
    });
  });

  fields.forEach((field) => {
    field.addEventListener("blur", () => {
      field.dataset.touched = "true";
      setFieldState(field);
    });

    field.addEventListener("input", () => {
      if (field.dataset.touched === "true") setFieldState(field);
      if (formStatus) formStatus.textContent = "";
      if (field === budgetField) setChoiceState(budgetChoices, field.value, "budgetChoice");
      if (field === timelineField) setChoiceState(timelineChoices, field.value, "timelineChoice");
    });

    field.addEventListener("change", () => {
      if (field.dataset.touched === "true") setFieldState(field);
      if (formStatus) formStatus.textContent = "";
    });
  });

  const validateProjectForm = () => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidFields = [
      [nameField, !nameField?.value.trim()],
      [emailField, !emailPattern.test(emailField?.value.trim() || "")],
      [projectNeedField, !projectNeedField?.value],
      [messageField, !messageField?.value.trim()],
    ].filter(([, isInvalid]) => isInvalid);

    [nameField, emailField, projectNeedField, messageField].forEach((field) => {
      setManualFieldState(field, invalidFields.some(([invalidField]) => invalidField === field));
    });

    return invalidFields.map(([field]) => field);
  };

  const setSubmitState = (isSending) => {
    if (!submitButton) return;
    submitButton.disabled = isSending;
    submitButton.classList.toggle("is-sending", isSending);
    if (submitButtonText) submitButtonText.textContent = isSending ? "Enviando..." : "Send Project Request";
  };

  projectForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (gotchaField?.value) {
      if (formStatus) formStatus.textContent = "Recebemos sua mensagem! Retornamos em até 1 dia útil.";
      projectForm.reset();
      setProductChoice("", { autofill: false });
      return;
    }

    fields.forEach((field) => {
      field.dataset.touched = "true";
    });

    const invalidFields = validateProjectForm();

    if (invalidFields.length) {
      if (formStatus) formStatus.textContent = "Verifique os campos destacados antes de enviar.";
      invalidFields[0]?.focus();
      return;
    }

    setSubmitState(true);
    if (formStatus) formStatus.textContent = "Enviando sua solicitação...";

    try {
      const response = await fetch(projectForm.action, {
        method: "POST",
        body: new FormData(projectForm),
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) throw new Error("Form submission failed.");

      if (formStatus) formStatus.textContent = "Recebemos sua mensagem! Retornamos em até 1 dia útil.";
      projectForm.reset();
      setProductChoice("", { autofill: false });
      fields.forEach((field) => {
        delete field.dataset.touched;
        setManualFieldState(field, false);
      });
    } catch (error) {
      if (formStatus) {
        formStatus.textContent = "Não foi possível enviar. Escreva direto para hello.SpaceUnderGround@gmail.com";
      }
    } finally {
      setSubmitState(false);
    }
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

// Modal unico da secao Selected Work. Alimenta dois tipos de conteudo:
//   type: "project" (padrao) — cases reais / conceitos
//   type: "plan"             — niveis de preco, com CTA que rola ate o formulario
// Para adicionar um item, acrescente uma chave em projectPreviews e um [data-project] no HTML.

export function initProjectDialog() {
  const projectDialog = document.querySelector("[data-project-dialog]");
  const projectOpeners = document.querySelectorAll("[data-project]");

  const projectPreviews = {
    ink: {
      index: "001",
      category: "Live Project / Portfolio Website",
      year: "2026",
      title: "INK Tattoo",
      description: "Portfolio website developed for a tattoo studio, focused on a dark, immersive and editorial visual experience.",
      scope: ["TYPE — PORTFOLIO WEBSITE", "TECH — HTML / CSS / JAVASCRIPT", "STATUS — LIVE"],
      code: "INK_001",
      monogram: "INK",
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
    "plan-plus": {
      type: "plan",
      index: "003",
      kind: "Pricing plan",
      category: "PLAN / LANDING PAGES & PORTFOLIOS",
      year: "2026",
      title: "Plano Plus",
      description: "For getting online with clarity — fast, focused, done right.",
      scope: ["SCOPE — LANDING PAGES · PORTFOLIOS", "RANGE — R$ 800 – R$ 2.500", "STATUS — AVAILABLE"],
      code: "PLUS_003",
      included: {
        items: ["Single responsive page", "Contact form integration", "1 revision round"],
        timeline: "1–4 weeks",
      },
      monogram: "P+",
    },
    "plan-pro": {
      type: "plan",
      index: "004",
      kind: "Pricing plan",
      category: "PLAN / INSTITUTIONAL WEBSITES",
      year: "2026",
      title: "Plano Pro",
      description: "For businesses ready to show up as more than a page.",
      scope: ["SCOPE — MULTI-PAGE INSTITUTIONAL SITES", "RANGE — R$ 2.500 – R$ 4.500", "STATUS — AVAILABLE"],
      code: "PRO_004",
      included: {
        items: ["Multi-page structure", "Custom design, no templates", "Basic SEO & performance", "2 revision rounds"],
        timeline: "3–6 weeks",
      },
      monogram: "P•",
    },
    "plan-max": {
      type: "plan",
      index: "005",
      kind: "Pricing plan",
      category: "PLAN / E-COMMERCE & SYSTEMS",
      year: "2026",
      title: "Plano Max",
      description: "For the ones who need the full system behind the front.",
      scope: ["SCOPE — E-COMMERCE · WEB SYSTEMS · CUSTOM BUILDS", "RANGE — FROM R$ 5.000", "STATUS — AVAILABLE"],
      code: "MAX_005",
      included: {
        items: ["Custom e-commerce or web system", "Scalable architecture", "Third-party integrations", "Revisions scoped per project"],
        timeline: "6–12 weeks",
      },
      monogram: "P×",
    },
  };

  const dialogDefaults = {
    project: {
      kind: "Project concept",
      note: "Concept presentation by Space Underground. Ask us about the thinking, system and possibilities behind it.",
      cta: "Discuss This Project",
    },
    plan: {
      kind: "Pricing plan",
      note: "Investment range by project level. The final quote is set once the scope is defined — talk to the studio for a proposal.",
      cta: "Solicitar Proposta",
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
      kind: projectDialog.querySelector("[data-dialog-kind]"),
      note: projectDialog.querySelector("[data-dialog-note]"),
      cta: projectDialog.querySelector("[data-dialog-cta]"),
      included: projectDialog.querySelector("[data-dialog-included]"),
      includedItems: [...projectDialog.querySelectorAll("[data-dialog-included-item]")],
      timeline: projectDialog.querySelector("[data-dialog-timeline]"),
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

        const preset = dialogDefaults[preview.type] || dialogDefaults.project;

        event.preventDefault();
        dialogFields.index.textContent = preview.index;
        dialogFields.kind.textContent = preview.kind || preset.kind;
        dialogFields.note.textContent = preview.note || preset.note;
        dialogFields.cta.textContent = preview.cta || preset.cta;
        dialogFields.category.textContent = preview.category;
        dialogFields.year.textContent = preview.year;
        dialogFields.title.textContent = preview.title;
        dialogFields.description.textContent = preview.description;
        dialogFields.code.textContent = preview.code;
        dialogFields.monogram.textContent = preview.monogram;
        dialogFields.scope.forEach((field, index) => {
          field.textContent = preview.scope[index] || "";
        });

        // Bloco "What's included": so os planos preenchem; li vazio some via li:empty.
        if (dialogFields.included) {
          dialogFields.included.hidden = !preview.included;
          dialogFields.includedItems.forEach((item, index) => {
            item.textContent = preview.included?.items[index] || "";
          });
          if (dialogFields.timeline) dialogFields.timeline.textContent = preview.included?.timeline || "";
        }

        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        if (typeof projectDialog.showModal === "function") projectDialog.showModal();
        else projectDialog.setAttribute("open", "");

        dialogClose?.focus({ preventScroll: true });
      });
    });

    dialogClose?.addEventListener("click", closeProjectDialog);
    dialogContact?.addEventListener("click", (event) => {
      const target = document.querySelector(dialogContact.getAttribute("href") || "");
      closeProjectDialog();
      if (!target) return;
      // scrollIntoView herda o scroll-behavior do CSS (suave, ou direto em reduced-motion).
      event.preventDefault();
      window.requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    });
    projectDialog.addEventListener("close", restoreDialogState);
    projectDialog.addEventListener("click", (event) => {
      if (event.target !== projectDialog) return;
      const bounds = projectDialog.getBoundingClientRect();
      const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      if (!inside) closeProjectDialog();
    });
  }
}

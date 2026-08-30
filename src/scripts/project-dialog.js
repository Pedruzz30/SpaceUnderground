// Modal de preview dos projetos. Para adicionar um projeto novo, acrescente uma chave em projectPreviews e um [data-project] no HTML.

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
}

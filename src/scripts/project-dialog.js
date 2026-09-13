import { t } from "./i18n/index.js";
import { getPublicPlan } from "./public-plan-store.js";

const scopeLines = (plan) => [
  t("commercial.scope", { value: plan.scope }),
  t("commercial.investment", { value: plan.range }),
  t("commercial.status", { value: plan.statusLabel }),
];

export function initProjectDialog() {
  const projectDialog = document.querySelector("[data-project-dialog]");
  if (!projectDialog || projectDialog.dataset.bound === "true") return;
  projectDialog.dataset.bound = "true";

  const dialogFields = {
    index: projectDialog.querySelector("[data-dialog-index]"),
    namespace: projectDialog.querySelector("[data-dialog-namespace]"),
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

  const write = (node, value) => {
    if (node) node.textContent = value;
  };

  const fillDialog = (plan) => {
    const scope = scopeLines(plan);

    write(dialogFields.index, plan.id);
    write(dialogFields.namespace, t("dialog.namespace"));
    write(dialogFields.kind, t("dialog.kind"));
    write(dialogFields.note, t("dialog.note"));
    write(dialogFields.cta, t("dialog.cta"));
    write(dialogFields.category, plan.category);
    write(dialogFields.year, plan.year);
    write(dialogFields.title, plan.name);
    write(dialogFields.description, plan.description);
    write(dialogFields.code, plan.code);
    write(dialogFields.monogram, plan.monogram);
    dialogFields.scope.forEach((field, index) => {
      field.textContent = scope[index] || "";
    });

    if (dialogFields.included) {
      dialogFields.included.hidden = !plan.included?.length;
      const label = dialogFields.included.querySelector(".project-dialog__included-label");
      if (label) label.textContent = t("dialog.included");
      dialogFields.includedItems.forEach((item, index) => {
        item.textContent = plan.included?.[index] || "";
        item.hidden = !plan.included?.[index];
      });
      const timelineLabel = dialogFields.included.querySelector(".project-dialog__timeline");
      if (timelineLabel) {
        timelineLabel.childNodes[0].textContent = `${t("dialog.timeline")} `;
      }
      write(dialogFields.timeline, plan.timeline || "");
    }
  };

  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-project]");
    if (!opener) return;
    const plan = getPublicPlan(opener.dataset.project);
    if (!plan) return;

    event.preventDefault();
    fillDialog(plan);

    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (typeof projectDialog.showModal === "function") projectDialog.showModal();
    else projectDialog.setAttribute("open", "");

    dialogClose?.focus({ preventScroll: true });
  });

  dialogClose?.addEventListener("click", closeProjectDialog);
  dialogContact?.addEventListener("click", (event) => {
    const target = document.querySelector(dialogContact.getAttribute("href") || "");
    closeProjectDialog();
    if (!target) return;
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

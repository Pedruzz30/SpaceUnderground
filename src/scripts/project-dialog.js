// Modal unico da pagina. Quem abre sao os cards da secao 06 / Plans; os cases
// reais nao passam por aqui, eles ficam no PROJECT VIEWER (signal-frame.js).
//
// Os dados moram em plans-registry.js. A camada `commercial` sobrepoe a
// apresentacao comercial sem quebrar o HTML estatico gerado em build time.

import { plans, commercialPlan, planScopeLines } from "./plans-registry.js";

const PLAN_PRESET = {
  namespace: "PLANO",
  kind: "Plano comercial",
  note: "A faixa exibida serve como referência inicial. A proposta final é definida depois que entendemos escopo, integrações e complexidade do projeto.",
  cta: "Solicitar uma Proposta",
};

const previewsByKey = new Map(Object.values(plans).map((plan) => [plan.key, plan]));

export function initProjectDialog() {
  const projectDialog = document.querySelector("[data-project-dialog]");
  const projectOpeners = document.querySelectorAll("[data-project]");

  if (!projectDialog) return;

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

  const fillDialog = (basePlan) => {
    const plan = commercialPlan(basePlan);
    const scope = planScopeLines(plan)
      .map((line) => line.replace("SCOPE —", "ESCOPO —").replace("RANGE —", "INVESTIMENTO —").replace("STATUS —", "STATUS —"));

    write(dialogFields.index, plan.id);
    write(dialogFields.namespace, PLAN_PRESET.namespace);
    write(dialogFields.kind, PLAN_PRESET.kind);
    write(dialogFields.note, PLAN_PRESET.note);
    write(dialogFields.cta, PLAN_PRESET.cta);
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
      if (label) label.textContent = "O que está incluído";
      dialogFields.includedItems.forEach((item, index) => {
        item.textContent = plan.included?.[index] || "";
      });
      const timelineLabel = dialogFields.included.querySelector(".project-dialog__timeline");
      if (timelineLabel) {
        timelineLabel.childNodes[0].textContent = "Prazo típico — ";
      }
      write(dialogFields.timeline, plan.timeline || "");
    }
  };

  projectOpeners.forEach((opener) => {
    opener.addEventListener("click", (event) => {
      const plan = previewsByKey.get(opener.dataset.project);
      if (!plan) return;

      event.preventDefault();
      fillDialog(plan);

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

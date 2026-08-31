// Modal unico da pagina. Quem abre sao os cards da secao 06 / Plans; os cases
// reais nao passam por aqui, eles ficam no PROJECT VIEWER (signal-frame.js).
//
// Os dados NAO moram neste arquivo: preco, prazo, escopo e o que esta incluso
// vem do plans-registry.js, o mesmo que gera os cards. Para mudar um plano,
// mexa la — aqui e so a montagem do modal.

import { plans, planScopeLines } from "./plans-registry.js";

// Textos que valem para qualquer plano, independentes de qual foi aberto.
const PLAN_PRESET = {
  namespace: "PLAN",
  kind: "Pricing plan",
  note: "Investment range by project level. The final quote is set once the scope is defined — talk to the studio for a proposal.",
  cta: "Request a Proposal",
};

// Indexado por [data-project] do HTML, que o plans-renderer escreve a partir
// da chave `key` do registro.
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

  const fillDialog = (plan) => {
    const scope = planScopeLines(plan);

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

    // Bloco "What's included": <li> vazio some via li:empty, entao a lista do
    // HTML pode ser maior que a do plano sem deixar buraco.
    if (dialogFields.included) {
      dialogFields.included.hidden = !plan.included?.length;
      dialogFields.includedItems.forEach((item, index) => {
        item.textContent = plan.included?.[index] || "";
      });
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

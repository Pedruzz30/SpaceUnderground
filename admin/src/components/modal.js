import { t } from "../i18n/index.js";
import { escapeHtml } from "../utils/html.js";

let active = null;

function focusablesOf(container) {
  return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.disabled,
  );
}

export function closeModal() {
  if (!active) return;
  const { overlay, keyHandler, previousFocus, onDismiss, dismissed } = active;
  overlay.remove();
  document.removeEventListener("keydown", keyHandler);
  active = null;
  previousFocus?.focus?.();
  if (dismissed.value) onDismiss?.();
}

export function openModal({ title, body, actions = [], onDismiss }) {
  closeModal();

  const previousFocus = document.activeElement;
  const titleId = "modal-title";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <h2 id="${titleId}">${escapeHtml(title)}</h2>
      <div class="modal__body">${body}</div>
      <div class="modal__actions">
        ${actions
          .map((action, index) => {
            const variant = action.variant === "danger" ? "button--danger" : action.variant === "primary" ? "button--primary" : "";
            // A stable hook per role, so callers and tests can target the
            // confirm or cancel button without matching translated copy.
            const role = action.role ? ` data-modal-${action.role}` : "";
            return `<button type="button" class="button ${variant}" data-modal-action="${index}"${role}>${escapeHtml(action.label)}</button>`;
          })
          .join("")}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  actions.forEach((action, index) => {
    overlay.querySelector(`[data-modal-action="${index}"]`)?.addEventListener("click", () => {
      if (active) active.dismissed.value = false;
      action.onSelect?.();
      closeModal();
    });
  });

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) closeModal();
  });

  const keyHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key === "Tab") {
      const focusables = focusablesOf(overlay);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener("keydown", keyHandler);
  active = { overlay, keyHandler, previousFocus, onDismiss, dismissed: { value: true } };

  window.requestAnimationFrame(() => {
    focusablesOf(overlay)[0]?.focus();
  });
}

export function confirmModal({ title, body, confirmLabel, cancelLabel, danger = true }) {
  // Resolved here rather than in the signature so it follows the active locale.
  const cancel = cancelLabel ?? t("common.cancel");
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openModal({
      title,
      body,
      onDismiss: () => settle(false),
      actions: [
        { label: cancel, role: "cancel", onSelect: () => settle(false) },
        { label: confirmLabel, role: "confirm", variant: danger ? "danger" : "primary", onSelect: () => settle(true) },
      ],
    });
  });
}

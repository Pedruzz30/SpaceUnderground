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

// An action's onSelect may be async. Returning (or resolving to) false keeps the
// dialog open, which is how a form refuses to close on a validation error;
// anything else closes it. While an action runs the dialog is locked: every
// button is disabled and Escape or a click outside does nothing, so the work
// can never finish behind a dialog the user thinks was cancelled. An action
// that throws keeps the dialog open; callers report their own errors.
export function openModal({ title, body, actions = [], onDismiss, className = "" }) {
  closeModal();

  const previousFocus = document.activeElement;
  const titleId = "modal-title";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal${className ? ` ${escapeHtml(className)}` : ""}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
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

  const buttons = [...overlay.querySelectorAll("[data-modal-action]")];
  const state = { pending: false };
  const lock = (pending) => {
    state.pending = pending;
    overlay.classList.toggle("is-pending", pending);
    buttons.forEach((item) => {
      item.disabled = pending;
    });
  };

  actions.forEach((action, index) => {
    const button = overlay.querySelector(`[data-modal-action="${index}"]`);
    button?.addEventListener("click", async () => {
      if (state.pending) return;
      lock(true);
      let result;
      try {
        result = await action.onSelect?.();
      } catch {
        result = false;
      } finally {
        lock(false);
      }
      if (result === false || !overlay.isConnected) return;
      if (active) active.dismissed.value = false;
      closeModal();
    });
  });

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay && !state.pending) closeModal();
  });

  const keyHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!state.pending) closeModal();
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

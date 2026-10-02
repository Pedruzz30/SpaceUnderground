import { t } from "../i18n/index.js";
import { escapeHtml } from "../utils/html.js";
import { openModal } from "./modal.js";

// A confirmation that needs a written reason (suspending, offboarding,
// rejecting a change). Resolves to the trimmed reason, or null when cancelled.
// `optional` accepts an empty answer (an approval comment on a low-risk change).
export function promptReason({ title, body = "", label, confirmLabel, danger = true, optional = false, maxLength = 500 }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    openModal({
      title,
      body: `
        ${body}
        <div class="field">
          <label for="reason-dialog-input">${escapeHtml(label)}</label>
          <textarea id="reason-dialog-input" rows="3" maxlength="${maxLength}" data-reason-input></textarea>
          <p class="field-error" data-reason-error role="alert" hidden></p>
        </div>
      `,
      onDismiss: () => settle(null),
      actions: [
        { label: t("common.cancel"), role: "cancel", onSelect: () => settle(null) },
        {
          label: confirmLabel,
          role: "confirm",
          variant: danger ? "danger" : "primary",
          onSelect: () => {
            const input = document.querySelector("[data-reason-input]");
            const value = input?.value.trim() ?? "";
            if (!value && !optional) {
              const error = document.querySelector("[data-reason-error]");
              error.hidden = false;
              error.textContent = t("security.reasonRequired");
              input?.focus();
              return false;
            }
            settle(value);
            return true;
          },
        },
      ],
    });
  });
}

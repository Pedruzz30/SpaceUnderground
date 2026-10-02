import { t } from "../i18n/index.js";
import { describeError } from "../services/errors.js";
import { stepUp, verifiedTotp } from "../services/mfa-service.js";
import { escapeHtml } from "../utils/html.js";
import { openModal } from "./modal.js";

// Step-up: a fresh MFA verification before a critical action. The database
// asks for it (SU005, or SU006 on a session that never finished MFA); this
// only collects the code and lets Supabase Auth verify it.

function codeField() {
  return `
    <div class="field">
      <label for="step-up-code" data-i18n="security.stepUp.codeLabel">${escapeHtml(t("security.stepUp.codeLabel"))}</label>
      <input id="step-up-code" class="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" data-step-up-code>
      <p class="field-error" data-step-up-error role="alert" hidden></p>
    </div>
  `;
}

export async function openStepUpDialog() {
  let factor = null;
  try {
    factor = await verifiedTotp();
  } catch {
    factor = null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    if (!factor) {
      openModal({
        title: t("security.stepUp.title"),
        body: `<p>${escapeHtml(t("security.stepUp.noFactor"))}</p><p><a href="#/settings" data-step-up-settings>${escapeHtml(t("security.stepUp.openSettings"))}</a></p>`,
        onDismiss: () => settle(false),
        actions: [{ label: t("common.close"), role: "cancel", onSelect: () => settle(false) }],
      });
      return;
    }

    openModal({
      title: t("security.stepUp.title"),
      className: "modal--step-up",
      body: `<p>${escapeHtml(t("security.stepUp.body"))}</p>${codeField()}`,
      onDismiss: () => settle(false),
      actions: [
        { label: t("common.cancel"), role: "cancel", onSelect: () => settle(false) },
        {
          label: t("security.stepUp.verify"),
          role: "confirm",
          variant: "primary",
          onSelect: async () => {
            const input = document.querySelector("[data-step-up-code]");
            const error = document.querySelector("[data-step-up-error]");
            const code = input?.value.trim() ?? "";
            if (!/^\d{6}$/.test(code)) {
              error.hidden = false;
              error.textContent = t("security.stepUp.codeFormat");
              input?.focus();
              return false;
            }
            try {
              await stepUp(code);
              settle(true);
              return true;
            } catch (failure) {
              error.hidden = false;
              error.textContent = describeError(failure, t("errors.security.invalidCode"));
              input.value = "";
              input.focus();
              return false;
            }
          },
        },
      ],
    });
  });
}

// Runs an action; when the database asks for step-up, verifies and runs it once
// more. Any other refusal is the caller's to report.
export async function withStepUp(run) {
  try {
    return await run();
  } catch (error) {
    if (error?.code !== "step_up_required" && error?.code !== "mfa_required") throw error;
    if (!(await openStepUpDialog())) throw error;
    return run();
  }
}

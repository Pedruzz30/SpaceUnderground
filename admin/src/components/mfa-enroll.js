import { t } from "../i18n/index.js";
import { recordMfaState } from "../services/access-service.js";
import { describeError } from "../services/errors.js";
import { enrollTotp, listFactors, removeFactor, verifyTotp } from "../services/mfa-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

// TOTP enrolment through Supabase Auth, used by Settings and by the screen that
// asks a privileged member to enable MFA. The QR code and the secret come from
// Supabase, stay in this form only while it is open, and are never stored or
// sent anywhere else by the Admin.

export function mfaEnrollMarkup() {
  return `
    <div class="mfa-enroll" data-mfa-enroll>
      <ol class="mfa-steps">
        <li data-i18n="security.mfa.stepApp">${escapeHtml(t("security.mfa.stepApp"))}</li>
        <li data-i18n="security.mfa.stepScan">${escapeHtml(t("security.mfa.stepScan"))}</li>
        <li data-i18n="security.mfa.stepCode">${escapeHtml(t("security.mfa.stepCode"))}</li>
      </ol>
      <button class="button button--primary" type="button" data-mfa-start data-i18n="security.mfa.start">${escapeHtml(t("security.mfa.start"))}</button>
      <div class="mfa-enroll__challenge" data-mfa-challenge hidden></div>
      <p class="field-error" data-mfa-error role="alert" hidden></p>
    </div>
  `;
}

function challengeMarkup(enrolment) {
  return `
    <div class="mfa-qr">
      <img src="${escapeAttribute(enrolment.qrCode)}" alt="${escapeAttribute(t("security.mfa.qrAlt"))}" width="176" height="176">
      <div>
        <p class="settings-copy" data-i18n="security.mfa.manual">${escapeHtml(t("security.mfa.manual"))}</p>
        <code class="mfa-secret" data-mfa-secret>${escapeHtml(enrolment.secret)}</code>
      </div>
    </div>
    <form class="mfa-verify" data-mfa-verify novalidate>
      <div class="field">
        <label for="mfa-enroll-code" data-i18n="security.stepUp.codeLabel">${escapeHtml(t("security.stepUp.codeLabel"))}</label>
        <input id="mfa-enroll-code" class="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
      </div>
      <button class="button button--primary" type="submit" data-i18n="security.mfa.confirm">${escapeHtml(t("security.mfa.confirm"))}</button>
    </form>
  `;
}

// onDone runs once the factor is verified and recorded.
export function bindMfaEnroll(root, { onDone } = {}) {
  const container = root.querySelector("[data-mfa-enroll]");
  if (!container) return;
  const start = container.querySelector("[data-mfa-start]");
  const challenge = container.querySelector("[data-mfa-challenge]");
  const error = container.querySelector("[data-mfa-error]");
  let factorId = null;

  const showError = (message) => {
    error.hidden = !message;
    error.textContent = message || "";
  };

  start.addEventListener("click", async () => {
    start.disabled = true;
    showError("");
    try {
      // An enrolment left half-way would block a new one; only unverified
      // factors are cleared, never a working one.
      const stale = (await listFactors()).filter((factor) => factor.type === "totp" && factor.status !== "verified");
      for (const factor of stale) await removeFactor(factor.id).catch(() => null);
      const enrolment = await enrollTotp(`Space Underground ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
      factorId = enrolment.id;
      challenge.innerHTML = challengeMarkup(enrolment);
      challenge.hidden = false;
      start.hidden = true;
      challenge.querySelector("input")?.focus();
    } catch (failure) {
      showError(describeError(failure, t("security.mfa.enrollError")));
      start.disabled = false;
    }
  });

  challenge.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target.closest("[data-mfa-verify]");
    const code = form.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) {
      showError(t("security.stepUp.codeFormat"));
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    showError("");
    try {
      await verifyTotp(factorId, code);
      await recordMfaState();
      // The secret leaves the page with the form.
      challenge.innerHTML = "";
      challenge.hidden = true;
      await onDone?.();
    } catch (failure) {
      showError(describeError(failure, t("errors.security.invalidCode")));
      form.elements.code.value = "";
      form.elements.code.focus();
      button.disabled = false;
    }
  });
}

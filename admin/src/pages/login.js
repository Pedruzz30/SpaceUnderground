import { isSupabaseMode } from "../config/env.js";
import { MOCK_PROFILES } from "../data/team.js";
import { requestPasswordReset } from "../services/access-service.js";
import { login } from "../services/auth-service.js";
import { describeError } from "../services/errors.js";
import { t } from "../i18n/index.js";
import { escapeHtml } from "../utils/html.js";

// Sign-in is email and the person's own password; MFA follows when their
// account has it. There is no sign-up here: access is by invitation only.
// Mock mode adds a profile picker so each role's Admin can be tried locally.

function profilePicker() {
  if (isSupabaseMode()) return "";
  return `
    <div class="field">
      <label for="login-profile" data-i18n="login.mockProfile">${t("login.mockProfile")}</label>
      <select id="login-profile" name="profile" data-login-profile>
        ${MOCK_PROFILES.map((profile) => `<option value="${profile}">${escapeHtml(t(`login.profiles.${profile}`))}</option>`).join("")}
      </select>
    </div>
  `;
}

export const loginPage = {
  title: () => t("login.title"),
  breadcrumb: () => t("login.breadcrumb"),
  render: () => `
    <main class="login-page">
      <section class="login-panel" aria-labelledby="login-title">
        <div class="login-panel__brand">
          <span class="brand-mark" aria-hidden="true">SU</span>
          <div>
            <p>SPACE UNDERGROUND</p>
            <h1 id="login-title" data-i18n="login.heading">${t("login.heading")}</h1>
          </div>
        </div>
        <div class="login-status" aria-label="${t("login.systemStatus")}">
          <span aria-hidden="true"></span>
          ${t("login.systemOnline")}
        </div>
        <p class="login-panel__copy" data-i18n="login.copy">${t("login.copy")}</p>

        <form class="login-form" data-login-form>
          <div class="field">
            <label for="login-email" data-i18n="login.email">${t("login.email")}</label>
            <input id="login-email" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="field">
            <label for="login-password" data-i18n="login.password">${t("login.password")}</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          ${profilePicker()}
          <p class="field-error" data-login-error role="alert" hidden></p>
          <button class="button button--primary" type="submit" data-login-submit data-i18n="login.submit">${t("login.submit")}</button>
        </form>

        <button class="login-forgot" type="button" data-login-forgot data-i18n="login.forgot">${t("login.forgot")}</button>
        <form class="login-form login-reset" data-login-reset hidden novalidate>
          <p class="login-panel__copy" data-i18n="login.resetCopy">${t("login.resetCopy")}</p>
          <div class="field">
            <label for="reset-email" data-i18n="login.email">${t("login.email")}</label>
            <input id="reset-email" name="email" type="email" autocomplete="email" required>
          </div>
          <p class="login-panel__copy" data-login-reset-status role="status" aria-live="polite" hidden></p>
          <button class="button" type="submit" data-login-reset-submit data-i18n="login.resetSubmit">${t("login.resetSubmit")}</button>
        </form>

        <p class="login-panel__foot" data-i18n="login.restricted">${t("login.restricted")}</p>
      </section>
    </main>
  `,
  afterRender: () => {
    const form = document.querySelector("[data-login-form]");
    const submit = document.querySelector("[data-login-submit]");
    const errorEl = document.querySelector("[data-login-error]");
    let pending = false;

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (pending) return;

      pending = true;
      submit.disabled = true;
      form.setAttribute("aria-busy", "true");
      submit.textContent = t("login.signingIn");
      errorEl.hidden = true;

      try {
        await login({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value,
          profile: form.elements.profile?.value,
        });
        window.location.hash = "#/dashboard";
      } catch (error) {
        errorEl.textContent = describeError(error, t("login.error"));
        errorEl.hidden = false;
        submit.disabled = false;
        submit.textContent = t("login.submit");
        form.removeAttribute("aria-busy");
        pending = false;
      }
    });

    const forgot = document.querySelector("[data-login-forgot]");
    const reset = document.querySelector("[data-login-reset]");
    const resetStatus = document.querySelector("[data-login-reset-status]");
    forgot?.addEventListener("click", () => {
      reset.hidden = !reset.hidden;
      if (!reset.hidden) reset.elements.email.value = form.elements.email.value.trim();
    });
    // Whatever Supabase Auth answers, the screen says the same thing, so it
    // never tells anyone which addresses have an account.
    reset?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = reset.elements.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        resetStatus.hidden = false;
        resetStatus.textContent = t("security.invite.emailInvalid");
        return;
      }
      const button = reset.querySelector("[data-login-reset-submit]");
      button.disabled = true;
      await requestPasswordReset(email).catch(() => null);
      resetStatus.hidden = false;
      resetStatus.textContent = t("login.resetSent");
      button.disabled = false;
    });
  },
};

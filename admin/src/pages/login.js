import { login } from "../services/auth-service.js";
import { describeError } from "../services/errors.js";
import { t } from "../i18n/index.js";

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
          <p class="field-error" data-login-error role="alert" hidden></p>
          <button class="button button--primary" type="submit" data-login-submit data-i18n="login.submit">${t("login.submit")}</button>
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
  },
};

import { login } from "../services/auth-service.js";
import { describeError } from "../services/errors.js";

export const loginPage = {
  title: "Admin Access",
  breadcrumb: "ADMIN / ACCESS",
  render: () => `
    <main class="login-page">
      <section class="login-panel" aria-labelledby="login-title">
        <div class="login-panel__brand">
          <span class="brand-mark" aria-hidden="true">SU</span>
          <div>
            <p>SPACE UNDERGROUND</p>
            <h1 id="login-title">ADMIN / ACCESS</h1>
          </div>
        </div>
        <div class="login-status" aria-label="System status">
          <span aria-hidden="true"></span>
          SYSTEM ONLINE
        </div>
        <p class="login-panel__copy">Administrative control system.</p>

        <form class="login-form" data-login-form>
          <div class="field">
            <label for="login-email">EMAIL</label>
            <input id="login-email" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="field">
            <label for="login-password">PASSWORD</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <p class="field-error" data-login-error role="alert" hidden></p>
          <button class="button button--primary" type="submit" data-login-submit>ACCESS CONTROL SYSTEM</button>
        </form>

        <p class="login-panel__foot">RESTRICTED / AUTHORIZED PERSONNEL ONLY</p>
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
      submit.textContent = "SIGNING IN...";
      errorEl.hidden = true;

      try {
        await login({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value,
        });
        window.location.hash = "#/dashboard";
      } catch (error) {
        errorEl.textContent = describeError(error, "Unable to sign in.");
        errorEl.hidden = false;
        submit.disabled = false;
        submit.textContent = "ACCESS CONTROL SYSTEM";
        form.removeAttribute("aria-busy");
        pending = false;
      }
    });
  },
};

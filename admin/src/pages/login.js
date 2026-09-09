import { login } from "../services/session.js";

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
        <p class="login-panel__copy">Administrative environment for managing Space Underground content.</p>

        <form class="login-form" data-login-form>
          <div class="field">
            <label for="login-email">EMAIL</label>
            <input id="login-email" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="field">
            <label for="login-password">PASSWORD</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <button class="button button--primary" type="submit">ACCESS CONTROL SYSTEM</button>
        </form>

        <p class="login-panel__foot">RESTRICTED / AUTHORIZED PERSONNEL ONLY</p>
      </section>
    </main>
  `,
  afterRender: () => {
    document.querySelector("[data-login-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      // MOCK AUTH - substituir futuramente por Supabase Auth.
      login();
      window.location.hash = "#/dashboard";
    });
  },
};

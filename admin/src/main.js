import "./styles/main.css";
import { initRouter } from "./router/router.js";

document.documentElement.classList.add("js");

const root = document.querySelector("#app");

if (!window.location.hash) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/login`);
}

try {
  initRouter(root);
} catch (error) {
  console.error(error);
  if (root) {
    root.innerHTML = `
      <main class="login-page">
        <section class="login-panel" aria-labelledby="admin-error-title">
          <div class="login-panel__brand">
            <span class="brand-mark" aria-hidden="true">SU</span>
            <div>
              <p>SPACE UNDERGROUND</p>
              <h1 id="admin-error-title">ADMIN / ERROR</h1>
            </div>
          </div>
          <p class="login-panel__copy">Nao foi possivel carregar o painel. Recarregue o servidor Vite e tente novamente.</p>
        </section>
      </main>
    `;
  }
}

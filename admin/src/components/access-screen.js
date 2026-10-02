import { escapeHtml } from "../utils/html.js";

// The full-page panel the Admin shows before (or instead of) its shell:
// checking the session, a configuration problem, an account that cannot go
// further, the MFA and invitation steps. `body` is trusted markup built by the
// caller; every text argument is escaped here.
export function accessScreen({ title, heading = "", copy = "", body = "", action = "", tone = "" }) {
  return `
    <main class="login-page">
      <section class="login-panel${tone ? ` login-panel--${tone}` : ""}" aria-labelledby="status-title" data-access-screen>
        <div class="login-panel__brand">
          <span class="brand-mark" aria-hidden="true">SU</span>
          <div>
            <p>SPACE UNDERGROUND</p>
            <h1 id="status-title">${escapeHtml(title)}</h1>
          </div>
        </div>
        ${heading ? `<p class="login-panel__copy"><strong>${escapeHtml(heading)}</strong></p>` : ""}
        ${copy ? `<p class="login-panel__copy">${escapeHtml(copy)}</p>` : ""}
        ${body}
        ${action}
      </section>
    </main>
  `;
}

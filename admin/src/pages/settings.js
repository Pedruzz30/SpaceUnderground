import { showToast } from "../components/toast.js";
import { DATA_SOURCE, isSupabaseConfigured } from "../config/env.js";
import { describeError } from "../services/errors.js";
import { getSiteSettings, saveSiteSettings } from "../services/settings-service.js";
import { logActivity } from "../services/activity-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function field(label, name, value = "", type = "text") {
  return `<div class="field"><label for="settings-${name}">${escapeHtml(label)}</label><input id="settings-${name}" name="${name}" type="${type}" value="${escapeAttribute(value)}"></div>`;
}

export const settingsPage = {
  title: "Settings",
  breadcrumb: "SYSTEM / SETTINGS",
  render: () => `
    <section class="page-heading">
      <span>SETTINGS</span>
      <h2>Public configuration.</h2>
      <p>Safe runtime fields only. Secrets and build keys are not editable here.</p>
    </section>
    <form class="settings-grid" data-settings-form aria-busy="true">
      <section class="panel"><p class="empty-inline">Loading settings...</p></section>
    </form>
  `,
  afterRender: async () => {
    const form = document.querySelector("[data-settings-form]");
    try {
      const settings = await getSiteSettings();
      form.innerHTML = `
        <section class="panel">
          <header class="panel__head"><div><span>GENERAL</span><h3>Site identity</h3></div></header>
          <div class="form-grid">
            ${field("Site Name", "siteName", settings.siteName)}
            ${field("Public URL", "siteUrl", settings.siteUrl, "url")}
            ${field("Contact Email", "contactEmail", settings.contactEmail, "email")}
            ${field("Locale", "locale", settings.locale)}
          </div>
        </section>
        <section class="panel">
          <header class="panel__head"><div><span>SEO</span><h3>Search/social preview</h3></div></header>
          <div class="form-grid">
            ${field("Title", "seoTitle", settings.seoTitle)}
            ${field("Description", "seoDescription", settings.seoDescription)}
            ${field("OG Image path", "ogImagePath", settings.ogImagePath)}
          </div>
          <div class="search-preview">
            <strong>${escapeHtml(settings.seoTitle || settings.siteName || "Space Underground")}</strong>
            <span>${escapeHtml(settings.siteUrl || "https://spaceunderground.dev")}</span>
            <p>${escapeHtml(settings.seoDescription || "Digital studio for sites, systems, automation and AI.")}</p>
          </div>
        </section>
        <section class="panel">
          <header class="panel__head"><div><span>INTEGRATIONS</span><h3>Runtime status</h3></div></header>
          <div class="integration-grid">
            <div><span>Supabase</span><strong>${DATA_SOURCE === "supabase" ? "Enabled" : "Mock mode"}</strong></div>
            <div><span>Database</span><strong>${isSupabaseConfigured() ? "Configured" : "Not configured"}</strong></div>
            <div><span>Storage</span><strong>${isSupabaseConfigured() ? "Project media" : "Local mock"}</strong></div>
            <div><span>Public Site</span><strong>Read-only anon key</strong></div>
          </div>
          <p>No keys or secrets are shown in this interface.</p>
        </section>
        <div class="form-actions"><button class="button button--primary" type="submit">Save Settings</button></div>
      `;
      form.removeAttribute("aria-busy");
    } catch (error) {
      form.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, "Unable to load settings."))}</p></section>`;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await saveSiteSettings(data);
        await logActivity("Settings updated", "Public settings updated", { action: "settings.updated", entityType: "settings", entityId: "public" });
        showToast("Settings saved.");
      } catch (error) {
        showToast(describeError(error, "Unable to save settings."));
      } finally {
        button.disabled = false;
      }
    });
  },
};

import { showToast } from "../components/toast.js";
import { DATA_SOURCE, isSupabaseConfigured } from "../config/env.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { describeError } from "../services/errors.js";
import { getSiteSettings, saveSiteSettings } from "../services/settings-service.js";
import { resolveImageUrl } from "../services/storage-service.js";
import { logActivity } from "../services/activity-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function field(label, name, value = "", type = "text", hint = "") {
  return `
    <div class="field">
      <label for="settings-${name}">${escapeHtml(label)}</label>
      <input id="settings-${name}" name="${name}" type="${type}" value="${escapeAttribute(value || "")}">
      ${hint ? `<p class="field-hint">${escapeHtml(hint)}</p>` : ""}
      <p class="field-error" data-error-for="${escapeAttribute(name)}" hidden></p>
    </div>
  `;
}

function isUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validate(data) {
  const errors = {};
  if (!isUrl(data.siteUrl)) errors.siteUrl = "Use a full http or https URL.";
  if (!isEmail(data.contactEmail)) errors.contactEmail = "Use a valid email address.";
  if (data.ogImagePath && !isUrl(data.ogImagePath) && data.ogImagePath.startsWith("/")) {
    errors.ogImagePath = "Use an absolute URL or a Supabase storage path.";
  }
  return errors;
}

function preview(data, imageUrl = "") {
  return `
    <div class="search-preview">
      <strong>${escapeHtml(data.seoTitle || data.siteName || "Space Underground")}</strong>
      <span>${escapeHtml(data.siteUrl || "https://spaceunderground.dev")}</span>
      <p>${escapeHtml(data.seoDescription || "Digital studio for sites, systems, automation and AI.")}</p>
    </div>
    <div class="og-preview">
      <span>${imageUrl ? `<img src="${escapeAttribute(imageUrl)}" alt="">` : "OG"}</span>
      <div>
        <strong>${escapeHtml(data.seoTitle || data.siteName || "Space Underground")}</strong>
        <p>${escapeHtml(data.seoDescription || "Social card preview uses the public title, description and image.")}</p>
      </div>
    </div>
  `;
}

export const settingsPage = {
  title: "Settings",
  breadcrumb: "SYSTEM / SETTINGS",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>SETTINGS</span>
        <h2>Public configuration.</h2>
        <p>Safe runtime fields only. Secrets and build keys are not editable here.</p>
      </div>
      <strong class="save-state is-saved" data-settings-state>Loading</strong>
    </section>
    <form class="settings-grid" data-settings-form aria-busy="true">
      <section class="panel"><p class="empty-inline">Loading settings...</p></section>
    </form>
  `,
  afterRender: async () => {
    const form = document.querySelector("[data-settings-form]");
    const state = document.querySelector("[data-settings-state]");
    let isDirty = false;

    const setState = (label, dirty = isDirty) => {
      isDirty = dirty;
      state.textContent = label;
      state.classList.toggle("is-unsaved", dirty);
      state.classList.toggle("is-saved", !dirty);
    };

    function readForm() {
      return Object.fromEntries([...new FormData(form).entries()].map(([name, value]) => [name, String(value).trim()]));
    }

    function showErrors(errors) {
      form.querySelectorAll("[data-error-for]").forEach((node) => {
        const message = errors[node.dataset.errorFor];
        node.hidden = !message;
        node.textContent = message || "";
        document.querySelector(`[name="${node.dataset.errorFor}"]`)?.toggleAttribute("aria-invalid", Boolean(message));
      });
    }

    async function renderPreview() {
      const target = form.querySelector("[data-settings-preview]");
      if (!target) return;
      const data = readForm();
      const imageUrl = data.ogImagePath ? await resolveImageUrl(data.ogImagePath) : "";
      if (target.isConnected) target.innerHTML = preview(data, imageUrl || data.ogImagePath);
    }

    try {
      const settings = await getSiteSettings();
      form.innerHTML = `
        <section class="panel">
          <header class="panel__head"><div><span>GENERAL</span><h3>Site identity</h3></div></header>
          <div class="form-grid">
            ${field("Site Name", "siteName", settings.siteName, "text", "Updates public brand labels.")}
            ${field("Public URL", "siteUrl", settings.siteUrl, "url", "Updates canonical and social URLs.")}
            ${field("Contact Email", "contactEmail", settings.contactEmail, "email", "Updates public mail links when present.")}
            ${field("Locale", "locale", settings.locale, "text", "Updates the html lang attribute.")}
          </div>
        </section>
        <section class="panel">
          <header class="panel__head"><div><span>SEO</span><h3>Search and social</h3></div></header>
          <div class="form-grid">
            ${field("Title", "seoTitle", settings.seoTitle, "text", "Updates document title and social title.")}
            ${field("Description", "seoDescription", settings.seoDescription, "text", "Updates meta description and social description.")}
            ${field("OG Image path", "ogImagePath", settings.ogImagePath, "text", "Absolute URL or project-media storage path.")}
          </div>
          <div data-settings-preview>${preview(settings)}</div>
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
      await renderPreview();
      setState("Saved", false);
    } catch (error) {
      form.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, "Unable to load settings."))}</p></section>`;
      setState("Load failed", false);
    }

    setNavigationGuard(() => isDirty);
    form.addEventListener("input", () => {
      setState("Unsaved changes", true);
      renderPreview();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = readForm();
      const errors = validate(data);
      showErrors(errors);
      if (Object.keys(errors).length) {
        setState("Fix fields", true);
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      setState("Saving...", true);
      try {
        await saveSiteSettings(data);
        await logActivity("Settings updated", "Public settings updated", { action: "settings.updated", entityType: "settings", entityId: "public" });
        showToast("Settings saved.");
        setState("Saved", false);
      } catch (error) {
        showToast(describeError(error, "Unable to save settings."));
        setState("Save failed", true);
      } finally {
        button.disabled = false;
      }
    });
  },
  beforeLeave: () => clearNavigationGuard(),
};

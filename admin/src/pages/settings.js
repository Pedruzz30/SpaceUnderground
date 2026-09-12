import { showToast } from "../components/toast.js";
import { DATA_SOURCE, isSupabaseConfigured } from "../config/env.js";
import { t } from "../i18n/index.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { describeError } from "../services/errors.js";
import { getSiteSettings, saveSiteSettings } from "../services/settings-service.js";
import { resolveImageUrl } from "../services/storage-service.js";
import { logActivity } from "../services/activity-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function field(label, name, value = "", type = "text", hint = "") {
  const className = ["seoDescription", "ogImagePath"].includes(name) ? "field field--wide" : "field";

  return `
    <div class="${className}">
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
  if (!isUrl(data.siteUrl)) errors.siteUrl = t("settings.invalidUrl");
  if (!isEmail(data.contactEmail)) errors.contactEmail = t("settings.invalidEmail");
  if (data.ogImagePath && !isUrl(data.ogImagePath) && data.ogImagePath.startsWith("/")) {
    errors.ogImagePath = t("settings.invalidOgPath");
  }
  return errors;
}

function preview(data, imageUrl = "") {
  return `
    <div class="search-preview settings-search-preview">
      <strong>${escapeHtml(data.seoTitle || data.siteName || "Space Underground")}</strong>
      <span>${escapeHtml(data.siteUrl || "https://spaceunderground.dev")}</span>
      <p>${escapeHtml(data.seoDescription || "Digital studio for sites, systems, automation and AI.")}</p>
    </div>
    <div class="og-preview settings-og-preview">
      <span>${imageUrl ? `<img src="${escapeAttribute(imageUrl)}" alt="">` : "OG"}</span>
      <div>
        <strong>${escapeHtml(data.seoTitle || data.siteName || "Space Underground")}</strong>
      <p>${escapeHtml(data.seoDescription || t("settings.socialPreviewFallback"))}</p>
      </div>
    </div>
  `;
}

export const settingsPage = {
  title: () => t("settings.title"),
  breadcrumb: () => t("settings.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>${t("settings.eyebrow")}</span>
        <h2>${t("settings.heading")}</h2>
        <p>${t("settings.intro")}</p>
      </div>
      <strong class="save-state is-saved" data-settings-state>${t("common.loading")}</strong>
    </section>
    <form class="settings-grid" data-settings-form aria-busy="true">
      <section class="panel"><p class="empty-inline">${t("settings.loadingSettings")}</p></section>
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
        <div class="settings-main">
          <section class="panel settings-panel">
            <header class="panel__head"><div><span>${t("settings.general")}</span><h3>${t("settings.siteIdentity")}</h3></div></header>
            <div class="form-grid">
              ${field(t("settings.siteName"), "siteName", settings.siteName, "text", t("settings.siteNameHint"))}
              ${field(t("settings.publicUrl"), "siteUrl", settings.siteUrl, "url", t("settings.publicUrlHint"))}
              ${field(t("settings.contactEmail"), "contactEmail", settings.contactEmail, "email", t("settings.contactEmailHint"))}
              ${field(t("settings.locale"), "locale", settings.locale, "text", t("settings.localeHint"))}
            </div>
          </section>
          <section class="panel settings-panel">
            <header class="panel__head"><div><span>${t("settings.seo")}</span><h3>${t("settings.searchMetadata")}</h3></div></header>
            <div class="form-grid">
              ${field(t("settings.seoTitle"), "seoTitle", settings.seoTitle, "text", t("settings.seoTitleHint"))}
              ${field(t("settings.description"), "seoDescription", settings.seoDescription, "text", t("settings.descriptionHint"))}
              ${field(t("settings.ogImagePath"), "ogImagePath", settings.ogImagePath, "text", t("settings.ogImagePathHint"))}
            </div>
          </section>
        </div>
        <aside class="settings-aside">
          <section class="panel settings-panel settings-panel--preview">
            <header class="panel__head"><div><span>${t("settings.preview")}</span><h3>${t("settings.searchAndSocial")}</h3></div></header>
            <div class="settings-preview" data-settings-preview>${preview(settings)}</div>
          </section>
          <section class="panel settings-panel settings-panel--runtime">
            <header class="panel__head"><div><span>${t("settings.integrations")}</span><h3>${t("settings.runtimeStatus")}</h3></div></header>
            <div class="integration-grid settings-integration-grid">
              <div><span>${t("settings.supabase")}</span><strong>${DATA_SOURCE === "supabase" ? t("common.enabled") : t("common.mockMode")}</strong></div>
              <div><span>${t("settings.database")}</span><strong>${isSupabaseConfigured() ? t("common.configured") : t("common.notConfigured")}</strong></div>
              <div><span>${t("settings.storage")}</span><strong>${isSupabaseConfigured() ? t("common.projectMedia") : t("common.mockMode")}</strong></div>
              <div><span>${t("settings.publicSite")}</span><strong>${t("settings.readOnlyAnonKey")}</strong></div>
            </div>
            <p>${t("settings.noSecrets")}</p>
          </section>
          <div class="form-actions settings-actions"><button class="button button--primary" type="submit">${t("settings.saveSettings")}</button></div>
        </aside>
      `;
      form.removeAttribute("aria-busy");
      await renderPreview();
      setState(t("settings.saved"), false);
    } catch (error) {
      form.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, t("settings.loadError")))}</p></section>`;
      setState(t("settings.loadFailed"), false);
    }

    setNavigationGuard(() => isDirty);
    form.addEventListener("input", () => {
      setState(t("settings.unsaved"), true);
      renderPreview();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = readForm();
      const errors = validate(data);
      showErrors(errors);
      if (Object.keys(errors).length) {
        setState(t("settings.fixFields"), true);
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      setState(t("settings.saving"), true);
      try {
        await saveSiteSettings(data);
        await logActivity("Settings updated", "Public settings updated", { action: "settings.updated", entityType: "settings", entityId: "public" });
        showToast(t("settings.savedToast"));
        setState(t("settings.saved"), false);
      } catch (error) {
        showToast(describeError(error, t("settings.saveError")));
        setState(t("settings.saveFailed"), true);
      } finally {
        button.disabled = false;
      }
    });
  },
  beforeLeave: () => clearNavigationGuard(),
};

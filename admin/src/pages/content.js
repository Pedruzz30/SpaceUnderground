import { showToast } from "../components/toast.js";
import { describeError } from "../services/errors.js";
import { getSiteContent, saveSiteContent } from "../services/content-service.js";
import { logActivity } from "../services/activity-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const SECTIONS = ["hero", "about", "capabilities", "process", "contact", "footer"];

function titleFor(key) {
  return key.replace(/(^|-)([a-z])/g, (_, prefix, char) => `${prefix ? " " : ""}${char.toUpperCase()}`);
}

function heroForm(entry) {
  const content = entry?.content || {};
  const input = (label, name) => `
    <div class="field">
      <label for="content-${name}">${escapeHtml(label)}</label>
      <input id="content-${name}" name="${name}" value="${escapeAttribute(content[name] || "")}">
    </div>
  `;
  return `
    <div class="form-grid">
      ${input("Eyebrow", "eyebrow")}
      ${input("Headline", "headline")}
      ${input("Primary CTA Label", "primaryCtaLabel")}
      ${input("Primary CTA URL", "primaryCtaUrl")}
      ${input("Secondary CTA Label", "secondaryCtaLabel")}
      ${input("Secondary CTA URL", "secondaryCtaUrl")}
      <div class="field field--wide">
        <label for="content-description">Description</label>
        <textarea id="content-description" name="description" rows="4">${escapeHtml(content.description || "")}</textarea>
      </div>
    </div>
  `;
}

function genericForm(entry) {
  const content = entry?.content || {};
  return `
    <div class="form-grid">
      <div class="field">
        <label for="content-title">Title</label>
        <input id="content-title" name="title" value="${escapeAttribute(content.title || "")}">
      </div>
      <div class="field">
        <label for="content-kicker">Kicker</label>
        <input id="content-kicker" name="kicker" value="${escapeAttribute(content.kicker || "")}">
      </div>
      <div class="field field--wide">
        <label for="content-description">Description</label>
        <textarea id="content-description" name="description" rows="5">${escapeHtml(content.description || "")}</textarea>
      </div>
    </div>
  `;
}

function capabilitiesForm(entry) {
  const items = Array.isArray(entry?.content?.items) ? entry.content.items : [];
  return `
    <div class="module-list" data-capability-list>
      ${items.map((item, index) => `
        <article class="module-card">
          <header class="module-card__head"><div><span>CAPABILITY ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title || "Untitled")}</strong></div></header>
          <div class="form-grid">
            <div class="field"><label>Title</label><input data-capability-field="title" value="${escapeAttribute(item.title || "")}"></div>
            <div class="field"><label>Kicker</label><input data-capability-field="kicker" value="${escapeAttribute(item.kicker || "")}"></div>
            <div class="field"><label>Link</label><input data-capability-field="link" value="${escapeAttribute(item.link || "")}"></div>
            <div class="field"><label>Accent</label><input data-capability-field="accent" value="${escapeAttribute(item.accent || "")}"></div>
            <div class="field field--wide"><label>Description</label><textarea rows="3" data-capability-field="description">${escapeHtml(item.description || "")}</textarea></div>
          </div>
        </article>
      `).join("") || '<p class="empty-inline">No capability cards configured.</p>'}
    </div>
  `;
}

function contentFromForm(key, form) {
  if (key === "capabilities") {
    return {
      items: [...form.querySelectorAll(".module-card")].map((card, index) => {
        const get = (field) => card.querySelector(`[data-capability-field="${field}"]`)?.value.trim() || "";
        return { title: get("title"), kicker: get("kicker"), description: get("description"), link: get("link"), accent: get("accent"), position: index };
      }),
    };
  }
  return Object.fromEntries([...new FormData(form).entries()].map(([name, value]) => [name, String(value).trim()]));
}

export const contentPage = {
  title: "Site Content",
  breadcrumb: "CONTENT / SITE CONTENT",
  render: () => `
    <section class="page-heading">
      <span>SITE CONTENT</span>
      <h2>Runtime copy.</h2>
      <p>Edit public content as structured fields, without HTML or JSON.</p>
    </section>
    <section class="panel">
      <div class="tabs" role="tablist" aria-label="Site content sections">
        ${SECTIONS.map((key, index) => `<button type="button" role="tab" data-content-tab="${key}" aria-selected="${index === 0}" tabindex="${index === 0 ? "0" : "-1"}">${titleFor(key)}</button>`).join("")}
      </div>
      <form data-content-form aria-busy="true">
        <p class="empty-inline">Loading content...</p>
      </form>
    </section>
  `,
  afterRender: async () => {
    const tabs = [...document.querySelectorAll("[data-content-tab]")];
    const form = document.querySelector("[data-content-form]");
    let entries = new Map();
    let active = "hero";

    function renderForm() {
      const entry = entries.get(active) || { key: active, content: {} };
      form.innerHTML = `
        <header class="panel__head">
          <div><span>${escapeHtml(active)}</span><h3>${escapeHtml(titleFor(active))}</h3></div>
          <button class="button button--primary" type="submit">Save Section</button>
        </header>
        ${active === "hero" ? heroForm(entry) : active === "capabilities" ? capabilitiesForm(entry) : genericForm(entry)}
      `;
      form.removeAttribute("aria-busy");
    }

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        active = tab.dataset.contentTab;
        tabs.forEach((item) => {
          const selected = item === tab;
          item.setAttribute("aria-selected", String(selected));
          item.tabIndex = selected ? 0 : -1;
        });
        renderForm();
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const saved = await saveSiteContent({ key: active, content: contentFromForm(active, form) });
        entries.set(active, saved);
        await logActivity("Site content updated", `${titleFor(active)} updated`, { action: "site_content.updated", entityType: "site_content", entityId: active });
        showToast("Content saved.");
      } catch (error) {
        showToast(describeError(error, "Unable to save content."));
      } finally {
        button.disabled = false;
      }
    });

    try {
      entries = new Map((await getSiteContent()).map((entry) => [entry.key, entry]));
      renderForm();
    } catch (error) {
      form.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, "Unable to load site content."))}</p>`;
    }
  },
};

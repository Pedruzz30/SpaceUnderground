import { showToast } from "../components/toast.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { describeError } from "../services/errors.js";
import { getSiteContent, saveSiteContent } from "../services/content-service.js";
import { logActivity } from "../services/activity-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const SECTIONS = [
  { key: "hero", label: "Hero", description: "First viewport messaging and calls to action." },
  { key: "about", label: "About", description: "Studio positioning and background copy." },
  { key: "capabilities", label: "Capabilities", description: "Service cards shown near the top of the public site." },
  { key: "process", label: "Process", description: "Timeline title, intro and process steps." },
  { key: "contact", label: "Contact", description: "Final conversion copy and availability line." },
  { key: "footer", label: "Footer", description: "Brand line, legal line and footer note." },
];

function titleFor(key) {
  return SECTIONS.find((section) => section.key === key)?.label || key;
}

function input(label, name, value = "", attrs = "") {
  return `
    <div class="field">
      <label for="content-${name}">${escapeHtml(label)}</label>
      <input id="content-${name}" name="${name}" value="${escapeAttribute(value)}" ${attrs}>
    </div>
  `;
}

function textarea(label, name, value = "", rows = 4) {
  return `
    <div class="field field--wide">
      <label for="content-${name}">${escapeHtml(label)}</label>
      <textarea id="content-${name}" name="${name}" rows="${rows}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

function heroForm(content) {
  return `
    <div class="form-grid">
      ${input("Eyebrow", "eyebrow", content.eyebrow)}
      ${input("Headline", "headline", content.headline)}
      ${input("Primary CTA Label", "primaryCtaLabel", content.primaryCtaLabel)}
      ${input("Primary CTA URL", "primaryCtaUrl", content.primaryCtaUrl)}
      ${input("Secondary CTA Label", "secondaryCtaLabel", content.secondaryCtaLabel)}
      ${input("Secondary CTA URL", "secondaryCtaUrl", content.secondaryCtaUrl)}
      ${textarea("Description", "description", content.description)}
    </div>
  `;
}

function genericForm(content, extra = "") {
  return `
    <div class="form-grid">
      ${input("Kicker", "kicker", content.kicker)}
      ${input("Title", "title", content.title)}
      ${textarea("Description", "description", content.description, 5)}
      ${extra}
    </div>
  `;
}

function repeatableForm(content, kind, fields) {
  const items = Array.isArray(content.items) ? content.items : [];
  return `
    ${genericForm(content)}
    <div class="module-list" data-repeatable-list="${escapeAttribute(kind)}">
      ${items.map((item, index) => repeatableItem(kind, fields, item, index)).join("") || '<p class="empty-inline">No items configured.</p>'}
    </div>
    <button class="button" type="button" data-add-repeatable>Add Item</button>
  `;
}

function repeatableItem(kind, fields, item = {}, index = 0) {
  return `
    <article class="module-card" data-repeatable-item>
      <header class="module-card__head">
        <div><span>${escapeHtml(kind.toUpperCase())} ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title || "Untitled")}</strong></div>
        <button type="button" class="button button--danger" data-remove-repeatable>Remove</button>
      </header>
      <div class="form-grid">
        ${fields.map((field) => field.type === "textarea"
          ? `<div class="field field--wide"><label>${escapeHtml(field.label)}</label><textarea rows="3" data-repeatable-field="${escapeAttribute(field.name)}">${escapeHtml(item[field.name] || "")}</textarea></div>`
          : `<div class="field"><label>${escapeHtml(field.label)}</label><input data-repeatable-field="${escapeAttribute(field.name)}" value="${escapeAttribute(item[field.name] || "")}"></div>`).join("")}
      </div>
    </article>
  `;
}

function formFor(key, content = {}) {
  if (key === "hero") return heroForm(content);
  if (key === "about") {
    return genericForm(content, `
      ${input("Primary note", "notePrimary", content.notePrimary)}
      ${input("Secondary note", "noteSecondary", content.noteSecondary)}
    `);
  }
  if (key === "capabilities") {
    return repeatableForm(content, "capability", [
      { name: "kicker", label: "Kicker" },
      { name: "title", label: "Title" },
      { name: "link", label: "Link" },
      { name: "accent", label: "Accent" },
      { name: "description", label: "Description", type: "textarea" },
    ]);
  }
  if (key === "process") {
    return repeatableForm(content, "step", [
      { name: "title", label: "Title" },
      { name: "description", label: "Description", type: "textarea" },
    ]);
  }
  if (key === "contact") {
    return genericForm(content, `
      ${input("Availability", "availability", content.availability)}
      ${input("Button Label", "buttonLabel", content.buttonLabel)}
    `);
  }
  return genericForm(content, `
    ${input("Brand", "brand", content.brand)}
    ${input("Legal line", "legal", content.legal)}
  `);
}

function readRepeatable(form) {
  return [...form.querySelectorAll("[data-repeatable-item]")].map((card, index) => {
    const item = { position: index };
    card.querySelectorAll("[data-repeatable-field]").forEach((input) => {
      item[input.dataset.repeatableField] = input.value.trim();
    });
    return item;
  }).filter((item) => Object.entries(item).some(([key, value]) => key !== "position" && value));
}

function contentFromForm(key, form) {
  const content = Object.fromEntries([...new FormData(form).entries()].map(([name, value]) => [name, String(value).trim()]));
  if (key === "capabilities" || key === "process") content.items = readRepeatable(form);
  return content;
}

function previewContent(key, content = {}) {
  const title = content.headline || content.title || content.brand || titleFor(key);
  const description = content.description || content.availability || content.legal || "No preview copy yet.";
  const items = Array.isArray(content.items) ? content.items.filter((item) => item.title || item.description).length : 0;
  return `
    <article class="content-preview">
      <span>${escapeHtml(titleFor(key))}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(description)}</p>
      ${items ? `<small>${items} structured item(s)</small>` : ""}
    </article>
  `;
}

function sectionNav(entries, active) {
  return SECTIONS.map((section) => {
    const content = entries.get(section.key)?.content || {};
    const configured = Object.values(content).some((value) => Array.isArray(value) ? value.length : Boolean(String(value || "").trim()));
    return `
      <button type="button" class="${section.key === active ? "is-active" : ""}" data-content-tab="${escapeAttribute(section.key)}" aria-pressed="${section.key === active}">
        <strong>${escapeHtml(section.label)}</strong>
        <span>${configured ? "Configured" : "Fallback copy"}</span>
      </button>
    `;
  }).join("");
}

export const contentPage = {
  title: "Site Content",
  breadcrumb: "CONTENT / CMS / SITE CONTENT",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>SITE CONTENT</span>
        <h2>Structured public copy.</h2>
        <p>Edit runtime content as fields that hydrate the public site without HTML or JSON.</p>
      </div>
      <strong class="save-state is-saved" data-content-state>Loading</strong>
    </section>
    <section class="content-workbench" data-content-root aria-busy="true">
      <div class="panel"><p class="empty-inline">Loading content...</p></div>
    </section>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-content-root]");
    const state = document.querySelector("[data-content-state]");
    let entries = new Map();
    let active = "hero";
    let isDirty = false;

    const setState = (label, dirty = isDirty) => {
      isDirty = dirty;
      state.textContent = label;
      state.classList.toggle("is-unsaved", dirty);
      state.classList.toggle("is-saved", !dirty);
    };

    function render() {
      const entry = entries.get(active) || { key: active, content: {} };
      const section = SECTIONS.find((item) => item.key === active);
      root.innerHTML = `
        <aside class="content-nav">${sectionNav(entries, active)}</aside>
        <form class="panel content-editor" data-content-form>
          <header class="panel__head">
            <div><span>${escapeHtml(active)}</span><h3>${escapeHtml(section.label)}</h3><p>${escapeHtml(section.description)}</p></div>
            <button class="button button--primary" type="submit">Save Section</button>
          </header>
          ${formFor(active, entry.content)}
        </form>
        <section class="panel">
          <header class="panel__head"><div><span>PREVIEW</span><h3>Current payload</h3></div></header>
          ${previewContent(active, entry.content)}
        </section>
      `;

      root.querySelectorAll("[data-content-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          active = button.dataset.contentTab;
          setState("Saved", false);
          render();
        });
      });

      const form = root.querySelector("[data-content-form]");
      form.addEventListener("input", () => setState("Unsaved changes", true));
      form.querySelector("[data-add-repeatable]")?.addEventListener("click", () => {
        const list = form.querySelector("[data-repeatable-list]");
        const fields = active === "process"
          ? [{ name: "title", label: "Title" }, { name: "description", label: "Description", type: "textarea" }]
          : [{ name: "kicker", label: "Kicker" }, { name: "title", label: "Title" }, { name: "link", label: "Link" }, { name: "accent", label: "Accent" }, { name: "description", label: "Description", type: "textarea" }];
        if (list.querySelector(".empty-inline")) list.innerHTML = "";
        list.insertAdjacentHTML("beforeend", repeatableItem(active === "process" ? "step" : "capability", fields, {}, list.querySelectorAll("[data-repeatable-item]").length));
        setState("Unsaved changes", true);
      });
      form.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-repeatable]");
        if (!remove) return;
        remove.closest("[data-repeatable-item]")?.remove();
        setState("Unsaved changes", true);
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        setState("Saving...", true);
        try {
          const saved = await saveSiteContent({ key: active, content: contentFromForm(active, form) });
          entries.set(active, saved);
          await logActivity("Site content updated", `${titleFor(active)} updated`, { action: "site_content.updated", entityType: "site_content", entityId: active });
          showToast("Content saved.");
          setState("Saved", false);
          render();
        } catch (error) {
          showToast(describeError(error, "Unable to save content."));
          setState("Save failed", true);
        } finally {
          button.disabled = false;
        }
      });
    }

    setNavigationGuard(() => isDirty);
    try {
      entries = new Map((await getSiteContent()).map((entry) => [entry.key, entry]));
      if (!root?.isConnected) return;
      render();
      setState("Saved", false);
    } catch (error) {
      root.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, "Unable to load site content."))}</p></section>`;
      setState("Load failed", false);
    } finally {
      root?.removeAttribute("aria-busy");
    }
  },
  beforeLeave: () => clearNavigationGuard(),
};

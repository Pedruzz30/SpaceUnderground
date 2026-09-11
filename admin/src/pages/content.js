import { showToast } from "../components/toast.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { logActivity } from "../services/activity-service.js";
import { getSiteContent, saveSiteContent } from "../services/content-service.js";
import { describeError } from "../services/errors.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const SECTIONS = [
  { key: "hero", label: "Hero", description: "Primary message and calls to action." },
  { key: "about", label: "About", description: "Studio positioning, introductory copy and notes." },
  { key: "capabilities", label: "Capabilities", description: "Public capability cards and links." },
  { key: "process", label: "Process", description: "Process heading, supporting copy and timeline steps." },
  { key: "contact", label: "Contact", description: "Contact section message, availability and call to action." },
  { key: "footer", label: "Footer", description: "Footer identity, legal line and closing statement." },
];

const CAPABILITY_FIELDS = [
  { name: "kicker", label: "Kicker" },
  { name: "title", label: "Title" },
  { name: "link", label: "Link" },
  { name: "accent", label: "Accent" },
  { name: "description", label: "Description", type: "textarea" },
];

const PROCESS_FIELDS = [
  { name: "title", label: "Title" },
  { name: "description", label: "Description", type: "textarea" },
];

function sectionFor(key) {
  return SECTIONS.find((section) => section.key === key) || SECTIONS[0];
}

function titleFor(key) {
  return sectionFor(key).label;
}

function hasConfiguredContent(entry) {
  const content = entry?.content;
  if (!content || typeof content !== "object") return false;
  if (Array.isArray(content.items)) {
    return content.items.some((item) => Object.values(item || {}).some((value) => String(value || "").trim()));
  }
  return Object.values(content).some((value) => String(value || "").trim());
}

function input(label, name, value = "", hint = "") {
  return `
    <div class="field">
      <label for="content-${name}">${escapeHtml(label)}</label>
      <input id="content-${name}" name="${name}" value="${escapeAttribute(value || "")}">
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </div>
  `;
}

function textarea(label, name, value = "", rows = 5, hint = "") {
  return `
    <div class="field field--wide">
      <label for="content-${name}">${escapeHtml(label)}</label>
      <textarea id="content-${name}" name="${name}" rows="${rows}">${escapeHtml(value || "")}</textarea>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </div>
  `;
}

function heroForm(content = {}) {
  return `
    <div class="form-grid">
      ${input("Eyebrow", "eyebrow", content.eyebrow, "Short context line above the main headline.")}
      ${input("Headline", "headline", content.headline, "Primary public message.")}
      ${input("Primary CTA Label", "primaryCtaLabel", content.primaryCtaLabel)}
      ${input("Primary CTA URL", "primaryCtaUrl", content.primaryCtaUrl, "Anchor or absolute URL.")}
      ${input("Secondary CTA Label", "secondaryCtaLabel", content.secondaryCtaLabel)}
      ${input("Secondary CTA URL", "secondaryCtaUrl", content.secondaryCtaUrl, "Anchor or absolute URL.")}
      ${textarea("Description", "description", content.description, 5, "Supporting copy beneath the headline.")}
    </div>
  `;
}

function genericForm(content = {}, extra = "") {
  return `
    <div class="form-grid">
      ${input("Kicker", "kicker", content.kicker, "Small editorial label above the title.")}
      ${input("Title", "title", content.title, "Main heading for this section.")}
      ${textarea("Description", "description", content.description, 6, "Public supporting copy for this section.")}
      ${extra}
    </div>
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

function repeatableForm(content = {}, kind, fields) {
  const items = Array.isArray(content.items) ? content.items : [];
  return `
    ${genericForm(content)}
    <div class="module-list" data-repeatable-list="${escapeAttribute(kind)}">
      ${items.map((item, index) => repeatableItem(kind, fields, item, index)).join("") || '<p class="empty-inline">No items configured.</p>'}
    </div>
    <button class="button" type="button" data-add-repeatable>Add Item</button>
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
  if (key === "capabilities") return repeatableForm(content, "capability", CAPABILITY_FIELDS);
  if (key === "process") return repeatableForm(content, "step", PROCESS_FIELDS);
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
    card.querySelectorAll("[data-repeatable-field]").forEach((inputEl) => {
      item[inputEl.dataset.repeatableField] = inputEl.value.trim();
    });
    return item;
  }).filter((item) => Object.entries(item).some(([key, value]) => key !== "position" && value));
}

function contentFromForm(key, form) {
  const content = Object.fromEntries([...new FormData(form).entries()].map(([name, value]) => [name, String(value).trim()]));
  if (key === "capabilities" || key === "process") content.items = readRepeatable(form);
  return content;
}

function previewFor(key, content = {}) {
  if (key === "hero") {
    return `
      <div class="cms-preview cms-preview--hero">
        <span>${escapeHtml(content.eyebrow || "Independent digital studio")}</span>
        <strong>${escapeHtml(content.headline || "Build what shouldn't exist yet.")}</strong>
        <p>${escapeHtml(content.description || "Supporting hero copy appears here.")}</p>
        <div><b>${escapeHtml(content.primaryCtaLabel || "Primary action")}</b><small>${escapeHtml(content.secondaryCtaLabel || "Secondary action")}</small></div>
      </div>
    `;
  }

  if (key === "capabilities" || key === "process") {
    const items = Array.isArray(content.items) ? content.items : [];
    return `
      <div class="cms-preview">
        <span>${escapeHtml(sectionFor(key).label.toUpperCase())} / PREVIEW</span>
        <strong>${items.length ? `${items.length} structured item${items.length === 1 ? "" : "s"}` : `No ${sectionFor(key).label.toLowerCase()} configured`}</strong>
        <p>${escapeHtml(content.description || "Section copy will appear here.")}</p>
        <div class="cms-preview-list">
          ${items.slice(0, 4).map((item, index) => `<p><i>${String(index + 1).padStart(2, "0")}</i>${escapeHtml(item.title || item.description || "Untitled item")}</p>`).join("") || '<p class="empty-inline">Add items to preview them here.</p>'}
        </div>
      </div>
    `;
  }

  return `
    <div class="cms-preview">
      <span>${escapeHtml(content.kicker || `${sectionFor(key).label.toUpperCase()} / PREVIEW`)}</span>
      <strong>${escapeHtml(content.headline || content.title || content.brand || titleFor(key))}</strong>
      <p>${escapeHtml(content.description || content.availability || content.legal || "Section copy will appear here.")}</p>
    </div>
  `;
}

function stateLabel(entry, dirty, saving, saveError) {
  if (saving) return '<span class="cms-editor-state cms-editor-state--saving">Saving...</span>';
  if (saveError) return '<span class="cms-editor-state cms-editor-state--error">Error saving</span>';
  if (dirty) return '<span class="cms-editor-state cms-editor-state--dirty">Unsaved changes</span>';
  return `<span class="cms-editor-state cms-editor-state--saved">${entry ? "Saved" : "Loaded"}</span>`;
}

export const contentPage = {
  title: "Site Content",
  breadcrumb: "CONTENT / CMS / SITE CONTENT",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>SITE CONTENT</span>
        <h2>Editorial workspace.</h2>
        <p>Edit structured public content with clear save state and contextual preview.</p>
      </div>
      <div class="heading-actions"><a class="button" href="#/cms">Back to CMS</a></div>
    </section>

    <section class="cms-content-shell" data-content-workspace aria-busy="true">
      <aside class="panel cms-content-nav" aria-label="Site content sections">
        <p class="empty-inline">Loading sections...</p>
      </aside>
      <div class="panel cms-content-editor"><p class="empty-inline">Loading content...</p></div>
      <aside class="panel cms-content-preview"><p class="empty-inline">Loading preview...</p></aside>
    </section>
  `,
  afterRender: async () => {
    const workspace = document.querySelector("[data-content-workspace]");
    const nav = workspace?.querySelector(".cms-content-nav");
    const editor = workspace?.querySelector(".cms-content-editor");
    const preview = workspace?.querySelector(".cms-content-preview");
    if (!workspace || !nav || !editor || !preview) return;

    let entries = new Map();
    let active = "hero";
    let dirty = false;
    let saving = false;
    let saveError = false;

    setNavigationGuard(() => dirty);

    function renderNav() {
      nav.innerHTML = `
        <header class="panel__head"><div><span>SECTIONS</span><h3>Public content</h3></div></header>
        <div class="cms-section-list">
          ${SECTIONS.map((section) => {
            const entry = entries.get(section.key);
            const configured = hasConfiguredContent(entry);
            return `
              <button type="button" class="cms-section-button${section.key === active ? " is-active" : ""}" data-content-section="${section.key}" aria-pressed="${section.key === active}">
                <span>${escapeHtml(section.label)}</span>
                <small>${configured ? "Configured" : "Using fallback"}</small>
              </button>
            `;
          }).join("")}
        </div>
      `;

      nav.querySelectorAll("[data-content-section]").forEach((button) => {
        button.addEventListener("click", () => {
          const next = button.dataset.contentSection;
          if (next === active) return;
          if (dirty) {
            showToast("Save or discard the current section before switching.");
            return;
          }
          active = next;
          saveError = false;
          renderWorkspace();
        });
      });
    }

    function renderEditorState() {
      const state = editor.querySelector("[data-content-state]");
      if (state) state.innerHTML = stateLabel(entries.get(active), dirty, saving, saveError);
    }

    function renderPreview() {
      const form = editor.querySelector("[data-content-form]");
      const entry = entries.get(active) || { content: {} };
      const content = form ? contentFromForm(active, form) : entry.content;
      preview.innerHTML = `
        <header class="panel__head"><div><span>PREVIEW</span><h3>Editorial structure</h3></div></header>
        ${previewFor(active, content)}
        <p class="ops-note">Structural preview · the public site keeps its own layout and motion system</p>
      `;
    }

    function addRepeatableItem(form) {
      const list = form.querySelector("[data-repeatable-list]");
      if (!list) return;
      const kind = active === "process" ? "step" : "capability";
      const fields = active === "process" ? PROCESS_FIELDS : CAPABILITY_FIELDS;
      if (list.querySelector(".empty-inline")) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", repeatableItem(kind, fields, {}, list.querySelectorAll("[data-repeatable-item]").length));
      dirty = true;
      saveError = false;
      renderEditorState();
      renderPreview();
    }

    function renderEditor() {
      const entry = entries.get(active) || { key: active, content: {}, updatedAt: null };
      const section = sectionFor(active);
      editor.innerHTML = `
        <form data-content-form>
          <header class="panel__head cms-editor-head">
            <div>
              <span>${escapeHtml(section.label.toUpperCase())}</span>
              <h3>${escapeHtml(section.label)}</h3>
              <p>${escapeHtml(section.description)}</p>
            </div>
            <div class="cms-editor-actions">
              <span data-content-state>${stateLabel(entry, dirty, saving, saveError)}</span>
              <button class="button button--primary" type="submit" ${saving ? "disabled" : ""}>${saving ? "Saving..." : "Save Section"}</button>
            </div>
          </header>
          <div class="cms-editor-meta">
            <span>${hasConfiguredContent(entry) ? "CONFIGURED" : "FALLBACK"}</span>
            <span>${entry.updatedAt ? `UPDATED ${escapeHtml(formatRelativeDay(entry.updatedAt))}` : "NO SAVED REVISION"}</span>
          </div>
          <p class="field-error" data-content-error hidden></p>
          ${formFor(active, entry.content)}
        </form>
      `;

      const form = editor.querySelector("[data-content-form]");
      const error = form.querySelector("[data-content-error]");
      form.addEventListener("input", () => {
        dirty = true;
        saveError = false;
        error.hidden = true;
        renderEditorState();
        renderPreview();
      });
      form.querySelector("[data-add-repeatable]")?.addEventListener("click", () => addRepeatableItem(form));
      form.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-repeatable]");
        if (!remove) return;
        remove.closest("[data-repeatable-item]")?.remove();
        dirty = true;
        saveError = false;
        renderEditorState();
        renderPreview();
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saving) return;
        saving = true;
        saveError = false;
        renderEditorState();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = "Saving...";
        try {
          const saved = await saveSiteContent({ key: active, content: contentFromForm(active, form) });
          entries.set(active, saved);
          dirty = false;
          await logActivity("Site content updated", `${section.label} updated`, {
            action: "site_content.updated",
            entityType: "site_content",
            entityId: active,
          });
          showToast("Content saved.");
          saving = false;
          renderWorkspace();
        } catch (err) {
          saveError = true;
          saving = false;
          const message = describeError(err, "Unable to save content.");
          error.textContent = message;
          error.hidden = false;
          showToast(message);
          renderEditorState();
        } finally {
          if (button?.isConnected) {
            button.disabled = false;
            button.textContent = "Save Section";
          }
        }
      });
    }

    function renderWorkspace() {
      renderNav();
      renderEditor();
      renderPreview();
    }

    try {
      entries = new Map((await getSiteContent()).map((entry) => [entry.key, entry]));
      renderWorkspace();
    } catch (error) {
      editor.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, "Unable to load site content."))}</p>`;
      nav.innerHTML = '<p class="empty-inline">Sections unavailable.</p>';
      preview.innerHTML = '<p class="empty-inline">Preview unavailable.</p>';
    } finally {
      workspace.removeAttribute("aria-busy");
    }
  },
  beforeLeave: () => clearNavigationGuard(),
};

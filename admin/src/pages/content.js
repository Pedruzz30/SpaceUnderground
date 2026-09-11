import { showToast } from "../components/toast.js";
import { logActivity } from "../services/activity-service.js";
import { describeError } from "../services/errors.js";
import { getSiteContent, saveSiteContent } from "../services/content-service.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const SECTIONS = [
  { key: "hero", label: "Hero", description: "Primary message and calls to action." },
  { key: "about", label: "About", description: "Studio positioning and introductory copy." },
  { key: "capabilities", label: "Capabilities", description: "Public capability cards and links." },
  { key: "process", label: "Process", description: "Process heading and supporting copy." },
  { key: "contact", label: "Contact", description: "Contact section message and invitation." },
  { key: "footer", label: "Footer", description: "Footer identity and closing statement." },
];

function sectionFor(key) {
  return SECTIONS.find((section) => section.key === key) || SECTIONS[0];
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
      <input id="content-${name}" name="${name}" value="${escapeAttribute(value)}">
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </div>
  `;
}

function heroForm(entry) {
  const content = entry?.content || {};
  return `
    <div class="form-grid">
      ${input("Eyebrow", "eyebrow", content.eyebrow, "Short context line above the main headline.")}
      ${input("Headline", "headline", content.headline, "Primary public message.")}
      ${input("Primary CTA Label", "primaryCtaLabel", content.primaryCtaLabel)}
      ${input("Primary CTA URL", "primaryCtaUrl", content.primaryCtaUrl, "Anchor or absolute URL.")}
      ${input("Secondary CTA Label", "secondaryCtaLabel", content.secondaryCtaLabel)}
      ${input("Secondary CTA URL", "secondaryCtaUrl", content.secondaryCtaUrl, "Anchor or absolute URL.")}
      <div class="field field--wide">
        <label for="content-description">Description</label>
        <textarea id="content-description" name="description" rows="5">${escapeHtml(content.description || "")}</textarea>
        <small>Supporting copy beneath the headline.</small>
      </div>
    </div>
  `;
}

function genericForm(entry) {
  const content = entry?.content || {};
  return `
    <div class="form-grid">
      ${input("Title", "title", content.title, "Main heading for this section.")}
      ${input("Kicker", "kicker", content.kicker, "Small editorial label above the title.")}
      <div class="field field--wide">
        <label for="content-description">Description</label>
        <textarea id="content-description" name="description" rows="6">${escapeHtml(content.description || "")}</textarea>
        <small>Public supporting copy for this section.</small>
      </div>
    </div>
  `;
}

function capabilityCard(item, index) {
  return `
    <article class="module-card" data-capability-card>
      <header class="module-card__head">
        <div><span>CAPABILITY ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title || "Untitled")}</strong></div>
      </header>
      <div class="form-grid">
        <div class="field"><label>Title</label><input data-capability-field="title" value="${escapeAttribute(item.title || "")}"></div>
        <div class="field"><label>Kicker</label><input data-capability-field="kicker" value="${escapeAttribute(item.kicker || "")}"></div>
        <div class="field"><label>Link</label><input data-capability-field="link" value="${escapeAttribute(item.link || "")}"></div>
        <div class="field"><label>Accent</label><input data-capability-field="accent" value="${escapeAttribute(item.accent || "")}"></div>
        <div class="field field--wide"><label>Description</label><textarea rows="3" data-capability-field="description">${escapeHtml(item.description || "")}</textarea></div>
      </div>
    </article>
  `;
}

function capabilitiesForm(entry) {
  const items = Array.isArray(entry?.content?.items) ? entry.content.items : [];
  return `<div class="module-list" data-capability-list>${items.length ? items.map(capabilityCard).join("") : '<p class="empty-inline">No capability cards configured.</p>'}</div>`;
}

function contentFromForm(key, form) {
  if (key === "capabilities") {
    return {
      items: [...form.querySelectorAll("[data-capability-card]")].map((card, index) => {
        const get = (field) => card.querySelector(`[data-capability-field="${field}"]`)?.value.trim() || "";
        return {
          title: get("title"),
          kicker: get("kicker"),
          description: get("description"),
          link: get("link"),
          accent: get("accent"),
          position: index,
        };
      }),
    };
  }
  return Object.fromEntries([...new FormData(form).entries()].map(([name, value]) => [name, String(value).trim()]));
}

function previewFor(key, content) {
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

  if (key === "capabilities") {
    const items = Array.isArray(content.items) ? content.items : [];
    return `
      <div class="cms-preview">
        <span>CAPABILITIES / PREVIEW</span>
        <strong>${items.length ? `${items.length} public capability${items.length === 1 ? "" : "s"}` : "No capabilities configured"}</strong>
        <div class="cms-preview-list">
          ${items.slice(0, 4).map((item, index) => `<p><i>${String(index + 1).padStart(2, "0")}</i>${escapeHtml(item.title || "Untitled capability")}</p>`).join("") || '<p class="empty-inline">Add capabilities to preview them here.</p>'}
        </div>
      </div>
    `;
  }

  return `
    <div class="cms-preview">
      <span>${escapeHtml(content.kicker || `${sectionFor(key).label.toUpperCase()} / PREVIEW`)}</span>
      <strong>${escapeHtml(content.title || sectionFor(key).label)}</strong>
      <p>${escapeHtml(content.description || "Section copy will appear here.")}</p>
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

    const isDirty = () => dirty;
    setNavigationGuard(isDirty);

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
        button.addEventListener("click", async () => {
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
      if (state) state.outerHTML = `<span data-content-state>${stateLabel(entries.get(active), dirty, saving, saveError)}</span>`;
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
          ${active === "hero" ? heroForm(entry) : active === "capabilities" ? capabilitiesForm(entry) : genericForm(entry)}
        </form>
      `;

      const form = editor.querySelector("[data-content-form]");
      form.addEventListener("input", () => {
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
            action: "content.updated",
            entityType: "content",
            entityId: active,
          });
          showToast("Content saved.");
          renderWorkspace();
        } catch (error) {
          saveError = true;
          showToast(describeError(error, "Unable to save content."));
          renderEditorState();
        } finally {
          saving = false;
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

    window.addEventListener("hashchange", () => {
      if (!dirty) clearNavigationGuard();
    }, { once: true });
  },
};

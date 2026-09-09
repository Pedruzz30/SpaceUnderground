import { badge, badgeType } from "../components/badge.js";
import { showToast } from "../components/toast.js";
import { getProject, saveProject } from "../services/mock-storage.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const field = ({ label, name, value = "", type = "text", attrs = "" }) => `
  <div class="field">
    <label for="${escapeAttribute(name)}">${escapeHtml(label)}</label>
    <input id="${escapeAttribute(name)}" name="${escapeAttribute(name)}" type="${escapeAttribute(type)}" value="${escapeAttribute(value)}" ${attrs}>
  </div>
`;

function formData(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

export const projectEditorPage = {
  title: "Project Editor",
  breadcrumb: "CONTENT / PROJECTS / CASE",
  render: ({ id }) => {
    const project = getProject(id);
    if (!project) {
      return `
        <section class="empty-state">
          <span>CASE / ${escapeHtml(id)}</span>
          <h2>Projeto nao encontrado</h2>
          <a class="button" href="#/projects">Voltar para Projects</a>
        </section>
      `;
    }

    return `
      <section class="page-heading page-heading--split">
        <div>
          <span>PROJECTS / CASE ${escapeHtml(project.caseNumber)}</span>
          <h2>${escapeHtml(project.name)}</h2>
          <p>${escapeHtml(project.client)} / ${escapeHtml(project.category)}</p>
        </div>
        <div class="heading-actions">
          ${badge(project.editorialStatus, badgeType(project.editorialStatus))}
          <a class="button" href="#/projects">All projects</a>
        </div>
      </section>

      <form class="editor-form" data-project-editor data-project-id="${escapeAttribute(project.id)}">
        <section class="editor-grid">
          <article class="panel editor-section">
            <header class="panel__head"><div><span>GENERAL</span><h3>Project metadata</h3></div></header>
            <div class="form-grid">
              ${field({ label: "Case Number", name: "caseNumber", value: project.caseNumber })}
              ${field({ label: "Project Name", name: "name", value: project.name })}
              ${field({ label: "Slug", name: "slug", value: project.slug })}
              ${field({ label: "Client", name: "client", value: project.client })}
              ${field({ label: "Category", name: "category", value: project.category })}
              ${field({ label: "Project Status", name: "status", value: project.status })}
              ${field({ label: "Year", name: "year", value: project.year })}
              ${field({ label: "Accent", name: "accent", value: project.accent, type: "color" })}
              <div class="field field--wide">
                <label for="description">Description</label>
                <textarea id="description" name="description" rows="5">${escapeHtml(project.description)}</textarea>
              </div>
              <div class="field field--wide">
                <label for="techStack">Tech Stack</label>
                <input id="techStack" name="techStack" type="text" value="${escapeAttribute(project.techStack)}">
              </div>
            </div>
          </article>

          <article class="panel editor-section">
            <header class="panel__head"><div><span>MEDIA</span><h3>Preview assets</h3></div></header>
            <div class="media-preview">
              <img data-poster-preview src="${escapeAttribute(project.poster)}" alt="Poster preview for ${escapeAttribute(project.name)}">
            </div>
            <div class="form-grid">
              ${field({ label: "Poster", name: "poster", value: project.poster })}
              ${field({ label: "Project URL", name: "projectUrl", value: project.projectUrl })}
              ${field({ label: "Preview URL", name: "previewUrl", value: project.previewUrl })}
              <div class="field field--wide">
                <label for="localPoster">Local preview image</label>
                <input id="localPoster" data-local-poster type="file" accept="image/*">
              </div>
            </div>
          </article>

          <article class="panel editor-section editor-section--side">
            <header class="panel__head"><div><span>PUBLISHING</span><h3>Mock state</h3></div></header>
            <div class="checks">
              <label><input type="radio" name="editorialStatus" value="PUBLISHED" ${project.editorialStatus === "PUBLISHED" ? "checked" : ""}> Published</label>
              <label><input type="radio" name="editorialStatus" value="DRAFT" ${project.editorialStatus === "DRAFT" ? "checked" : ""}> Draft</label>
              <label><input type="radio" name="editorialStatus" value="ARCHIVED" ${project.editorialStatus === "ARCHIVED" ? "checked" : ""}> Archived</label>
              <label><input type="checkbox" name="featured" value="true" ${project.featured ? "checked" : ""}> Featured</label>
              <label><input type="checkbox" name="visible" value="true" ${project.visible ? "checked" : ""}> Visible in portfolio</label>
            </div>
            <div class="editor-actions">
              <button class="button" type="button" data-save-draft>Save Draft</button>
              <a class="button" href="${escapeAttribute(project.previewUrl)}" target="_blank" rel="noreferrer">Preview</a>
              <button class="button button--primary" type="submit">Publish Changes</button>
            </div>
          </article>
        </section>
      </form>
    `;
  },
  afterRender: ({ id }) => {
    const form = document.querySelector("[data-project-editor]");
    const posterInput = document.querySelector("[data-local-poster]");
    const posterPreview = document.querySelector("[data-poster-preview]");
    if (!form) return;

    posterInput?.addEventListener("change", () => {
      const [file] = posterInput.files || [];
      if (!file || !posterPreview) return;
      posterPreview.src = URL.createObjectURL(file);
      showToast("Local preview updated");
    });

    const save = (editorialStatus) => {
      const current = getProject(id);
      const next = {
        ...current,
        ...formData(form),
        editorialStatus,
        featured: form.elements.featured.checked,
        visible: form.elements.visible.checked,
      };
      saveProject(next);
      showToast(editorialStatus === "DRAFT" ? "Draft updated" : "Project published");
    };

    form.querySelector("[data-save-draft]")?.addEventListener("click", () => save("DRAFT"));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save("PUBLISHED");
    });
  },
};

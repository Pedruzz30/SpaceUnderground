import { badge, badgeType } from "../components/badge.js";
import { showToast } from "../components/toast.js";
import { confirmModal, openModal } from "../components/modal.js";
import { CATEGORIES, EDITORIAL_STATUSES, PROJECT_STATUSES } from "../data/projects.js";
import { logActivity } from "../services/activity-service.js";
import { describeError, toDataError } from "../services/errors.js";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProjectById,
  nextAvailableCaseNumber,
  updateProject,
} from "../services/project-service.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const EDITORIAL_LABELS = { DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" };

const DIACRITIC_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isValidHex(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || "");
}

function normalizeHexForPicker(hex) {
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) return `#${hex.slice(1).split("").map((c) => c + c).join("")}`;
  return "#c6ff00";
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Project name is required.";
  if (!values.slug.trim()) errors.slug = "Slug is required.";
  if (!CATEGORIES.includes(values.category)) errors.category = "Select a category.";

  const year = Number(values.year);
  if (!values.year || Number.isNaN(year) || year < 1990 || year > 2100) errors.year = "Enter a valid year.";
  if (!PROJECT_STATUSES.includes(values.status)) errors.status = "Select a valid project status.";
  if (!EDITORIAL_STATUSES.includes(values.editorialStatus)) errors.editorialStatus = "Select a valid editorial status.";
  if (!isValidUrl(values.projectUrl)) errors.projectUrl = "Enter a valid URL.";
  if (!isValidUrl(values.previewUrl)) errors.previewUrl = "Enter a valid URL.";
  if (values.accent && !isValidHex(values.accent)) errors.accent = "Enter a valid hex color (eg. #baff00).";

  return errors;
}

function fieldMarkup({ label, name, value = "", type = "text", attrs = "" }) {
  return `
    <div class="field" data-field="${name}">
      <label for="field-${name}">${escapeHtml(label)}</label>
      <input id="field-${name}" name="${name}" type="${type}" value="${escapeAttribute(value)}" ${attrs}>
      <p class="field-error" id="field-${name}-error" hidden></p>
    </div>
  `;
}

function selectMarkup({ label, name, value, options }) {
  return `
    <div class="field" data-field="${name}">
      <label for="field-${name}">${escapeHtml(label)}</label>
      <select id="field-${name}" name="${name}">
        ${options.map((option) => `<option value="${escapeAttribute(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
      <p class="field-error" id="field-${name}-error" hidden></p>
    </div>
  `;
}

function blankProject(caseNumber) {
  return {
    id: null,
    dbId: null,
    caseNumber,
    name: "",
    slug: "",
    client: "",
    category: "Website",
    description: "",
    status: "In Development",
    editorialStatus: "DRAFT",
    featured: false,
    visible: false,
    year: String(new Date().getFullYear()),
    accent: "#c6ff00",
    techStack: [],
    poster: "",
    gallery: [],
    projectUrl: "",
    previewUrl: "",
    createdAt: null,
    updatedAt: null,
    publishedAt: null,
  };
}

function renderEditor(project, isCreate) {
  const accentValue = project.accent || "#c6ff00";

  return `
    <section class="page-heading page-heading--split">
      <div>
        <span>${isCreate ? "CONTENT / PROJECTS / NEW" : `CONTENT / PROJECTS / CASE ${escapeHtml(project.caseNumber)}`}</span>
        <h2>Project Editor</h2>
        <div class="editor-identity">
          <strong>CASE ${escapeHtml(project.caseNumber)}</strong>
          <strong class="editor-identity__name">${escapeHtml(project.name || "Untitled project")}</strong>
          <span class="editor-identity__meta">${escapeHtml(project.category)} / ${escapeHtml(project.status)}</span>
          ${badge(project.editorialStatus, badgeType(project.editorialStatus))}
          <span class="save-state is-saved" data-save-state ${isCreate ? "hidden" : ""}>SAVED</span>
        </div>
      </div>
      <div class="heading-actions">
        <a class="button" href="#/projects">All projects</a>
      </div>
    </section>

    <form class="editor-form" data-project-editor data-project-id="${escapeAttribute(project.id || "")}" data-mode="${isCreate ? "create" : "edit"}" novalidate>
      <div class="editor-toolbar">
        ${isCreate
          ? `<button type="submit" class="button button--primary" data-editor-action data-action-create>Create Project</button>`
          : `
            <button type="button" class="button" data-editor-action data-action-preview>Preview</button>
            <button type="submit" class="button" data-editor-action data-action-save>Save Changes</button>
            <button type="button" class="button button--primary" data-editor-action data-action-publish>Publish Changes</button>
          `}
      </div>

      <div class="tabs" role="tablist" aria-label="Project editor sections">
        <button type="button" role="tab" id="tab-general" aria-selected="true" aria-controls="panel-general" data-tab="general" tabindex="0">General</button>
        <button type="button" role="tab" id="tab-media" aria-selected="false" aria-controls="panel-media" data-tab="media" tabindex="-1">Media</button>
        <button type="button" role="tab" id="tab-publishing" aria-selected="false" aria-controls="panel-publishing" data-tab="publishing" tabindex="-1">Publishing</button>
      </div>

      <div class="tab-panel" id="panel-general" role="tabpanel" aria-labelledby="tab-general">
        <div class="form-grid">
          ${fieldMarkup({ label: "Case Number", name: "caseNumber", value: project.caseNumber, attrs: 'readonly aria-readonly="true"' })}
          ${fieldMarkup({ label: "Project Name", name: "name", value: project.name, attrs: "required" })}
          ${fieldMarkup({ label: "Slug", name: "slug", value: project.slug, attrs: "required" })}
          ${fieldMarkup({ label: "Client", name: "client", value: project.client })}
          ${selectMarkup({ label: "Category", name: "category", value: project.category, options: CATEGORIES })}
          ${selectMarkup({ label: "Project Status", name: "status", value: project.status, options: PROJECT_STATUSES })}
          ${fieldMarkup({ label: "Year", name: "year", value: project.year, type: "number", attrs: 'min="1990" max="2100"' })}
          <div class="field" data-field="accent">
            <label for="field-accent">Accent</label>
            <div class="accent-field">
              <input type="color" value="${escapeAttribute(normalizeHexForPicker(accentValue))}" data-accent-picker aria-label="Pick accent color">
              <input id="field-accent" name="accent" type="text" value="${escapeAttribute(accentValue)}" data-accent-text>
            </div>
            <p class="field-error" id="field-accent-error" hidden></p>
          </div>
          <div class="field field--wide" data-field="description">
            <label for="field-description">Description</label>
            <textarea id="field-description" name="description" rows="5">${escapeHtml(project.description)}</textarea>
          </div>
          <div class="field field--wide" data-field="techStack">
            <span class="field-label" id="tech-stack-label">Tech Stack</span>
            <div class="chip-field">
              <div class="chip-list" data-tech-list aria-labelledby="tech-stack-label"></div>
              <div class="chip-input-row">
                <input type="text" data-tech-input placeholder="Add technology" aria-label="Add technology">
                <button type="button" class="button" data-tech-add>+ Add Technology</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-panel" id="panel-media" role="tabpanel" aria-labelledby="tab-media" hidden>
        <div class="media-block">
          <span class="field-label">Project Poster</span>
          <div class="media-preview">
            <img data-poster-preview src="${escapeAttribute(project.poster || "")}" alt="Poster preview for ${escapeAttribute(project.name || "project")}" ${project.poster ? "" : "hidden"}>
            <p class="media-preview__empty" data-poster-empty ${project.poster ? "hidden" : ""}>No poster set.</p>
          </div>
          <div class="media-actions">
            <button type="button" class="button" data-replace-poster>Replace Image</button>
            <input type="file" accept="image/*" data-poster-file hidden>
          </div>
        </div>

        <div class="form-grid">
          ${fieldMarkup({ label: "Project URL", name: "projectUrl", value: project.projectUrl, type: "url" })}
          ${fieldMarkup({ label: "Preview URL", name: "previewUrl", value: project.previewUrl, type: "url" })}
        </div>

        <div class="media-block">
          <span class="field-label">Gallery</span>
          <div class="gallery-grid" data-gallery></div>
          <button type="button" class="button" data-gallery-add>+ Add Image</button>
          <input type="file" accept="image/*" data-gallery-file hidden>
        </div>
      </div>

      <div class="tab-panel" id="panel-publishing" role="tabpanel" aria-labelledby="tab-publishing" hidden>
        <div class="form-grid">
          <fieldset class="field field--wide" data-field="editorialStatus">
            <legend>Editorial Status</legend>
            <div class="checks">
              ${EDITORIAL_STATUSES.map((status) => `
                <label>
                  <input type="radio" name="editorialStatus" value="${status}" ${project.editorialStatus === status ? "checked" : ""}>
                  ${EDITORIAL_LABELS[status]}
                </label>
              `).join("")}
            </div>
          </fieldset>

          <fieldset class="field field--wide">
            <legend>Visibility</legend>
            <div class="checks">
              <label><input type="checkbox" name="visible" ${project.visible ? "checked" : ""}> Show in portfolio</label>
              <label><input type="checkbox" name="featured" ${project.featured ? "checked" : ""}> Featured project</label>
            </div>
          </fieldset>
        </div>

        <div class="meta-grid">
          <div><span>Created</span><strong>${formatDate(project.createdAt)}</strong></div>
          <div><span>Last modified</span><strong>${formatDate(project.updatedAt)}</strong></div>
          <div><span>Published</span><strong>${formatDate(project.publishedAt)}</strong></div>
        </div>
      </div>
    </form>

    ${isCreate ? "" : `
      <section class="panel danger-zone">
        <header class="panel__head">
          <div>
            <span>DANGER ZONE</span>
            <h3>Irreversible actions</h3>
          </div>
        </header>
        <p>These actions take effect immediately and cannot be undone from the UI.</p>
        <div class="danger-zone__actions">
          <button type="button" class="button" data-editor-action data-action-archive>Archive Project</button>
          <button type="button" class="button button--danger" data-editor-action data-action-delete>Delete Project</button>
        </div>
      </section>
    `}
  `;
}

function bindTabs(form) {
  const tabs = [...form.querySelectorAll('[role="tab"]')];
  const panels = [...form.querySelectorAll('[role="tabpanel"]')];

  function activate(tab) {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== tab.getAttribute("aria-controls");
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;

      if (nextIndex !== null) {
        event.preventDefault();
        tabs[nextIndex].focus();
        activate(tabs[nextIndex]);
      }
    });
  });
}

// Serializes editor actions: while one is running every action button is
// disabled, so a double click can never fire two saves or two deletes.
function createActionRunner() {
  let running = false;

  return async function run(button, busyLabel, task) {
    if (running) return;
    running = true;

    const actions = [...document.querySelectorAll("[data-editor-action]")];
    const originalLabel = button?.textContent;
    actions.forEach((action) => {
      action.disabled = true;
    });
    if (button) button.textContent = busyLabel;

    try {
      await task();
    } finally {
      running = false;
      actions.forEach((action) => {
        if (action.isConnected) action.disabled = false;
      });
      if (button?.isConnected) button.textContent = originalLabel;
    }
  };
}

function mount(project, isCreate) {
  const form = document.querySelector("[data-project-editor]");
  if (!form) return;

  const id = project.id;
  let techStack = [...(project.techStack || [])];
  let gallery = [...(project.gallery || [])];
  let posterUrl = project.poster || "";
  let slugTouched = Boolean(project.slug);
  let isDirty = false;

  const run = createActionRunner();

  function collectFormValues() {
    const data = Object.fromEntries(new FormData(form).entries());
    return {
      name: (data.name || "").trim(),
      slug: (data.slug || "").trim(),
      client: (data.client || "").trim(),
      category: data.category,
      description: data.description || "",
      status: data.status,
      year: data.year,
      accent: (data.accent || "").trim(),
      projectUrl: (data.projectUrl || "").trim(),
      previewUrl: (data.previewUrl || "").trim(),
      editorialStatus: data.editorialStatus,
      visible: form.elements.visible.checked,
      featured: form.elements.featured.checked,
      techStack: [...techStack],
      gallery: [...gallery],
      poster: posterUrl,
    };
  }

  function updateSaveState() {
    const stateEl = document.querySelector("[data-save-state]");
    if (!stateEl) return;
    // In create mode the editorial badge already reads DRAFT; only surface
    // the save-state pill once there is something that could be lost.
    stateEl.hidden = isCreate && !isDirty;
    stateEl.textContent = isDirty ? "UNSAVED CHANGES" : "SAVED";
    stateEl.classList.toggle("is-unsaved", isDirty);
    stateEl.classList.toggle("is-saved", !isDirty);
  }

  function fieldContainer(name) {
    return form.querySelector(`[data-field="${name}"]`);
  }

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  }

  function clearFieldError(name) {
    const container = fieldContainer(name);
    if (!container) return;
    const errorEl = container.querySelector(".field-error");
    const input = container.querySelector("[aria-invalid]");
    if (errorEl) errorEl.hidden = true;
    input?.removeAttribute("aria-invalid");
  }

  function showErrors(errors, toastMessage = "Fix the highlighted fields.") {
    clearErrors();
    let firstInvalid = null;

    Object.entries(errors).forEach(([name, message]) => {
      const container = fieldContainer(name);
      const errorEl = container?.querySelector(".field-error");
      const input = container?.querySelector("input, select, textarea");
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
      }
      if (input) {
        input.setAttribute("aria-invalid", "true");
        if (errorEl) input.setAttribute("aria-describedby", errorEl.id);
        if (!firstInvalid) firstInvalid = input;
      }
    });

    firstInvalid?.focus();
    showToast(toastMessage);
  }

  // Database rejections (a duplicate slug, for instance) belong next to the
  // field that caused them; everything else is a toast.
  function reportFailure(error, fallbackMessage) {
    const dataError = toDataError(error, fallbackMessage);
    if (dataError.field && fieldContainer(dataError.field)) {
      showErrors({ [dataError.field]: dataError.message }, dataError.message);
      return;
    }
    showToast(dataError.message);
  }

  const baselineSnapshot = JSON.stringify(collectFormValues());

  function markDirty() {
    isDirty = JSON.stringify(collectFormValues()) !== baselineSnapshot;
    updateSaveState();
  }

  bindTabs(form);

  // Slug auto-generation from the project name until manually edited.
  form.elements.slug.addEventListener("input", () => {
    slugTouched = true;
  });
  form.elements.name.addEventListener("input", () => {
    if (!slugTouched) form.elements.slug.value = slugify(form.elements.name.value);
  });

  // Accent color picker <-> hex text field.
  const accentPicker = form.querySelector("[data-accent-picker]");
  const accentText = form.querySelector("[data-accent-text]");
  accentPicker?.addEventListener("input", () => {
    accentText.value = accentPicker.value;
  });
  accentText?.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(accentText.value)) accentPicker.value = accentText.value;
  });

  // Tech stack chip editor.
  function renderChips() {
    const list = form.querySelector("[data-tech-list]");
    if (!list) return;
    list.innerHTML = techStack.length
      ? techStack
          .map(
            (tech, index) => `
              <span class="chip">${escapeHtml(tech)}<button type="button" data-remove-tech="${index}" aria-label="Remove ${escapeAttribute(tech)}">&times;</button></span>
            `,
          )
          .join("")
      : '<p class="empty-inline">No technologies added.</p>';

    list.querySelectorAll("[data-remove-tech]").forEach((btn) => {
      btn.addEventListener("click", () => {
        techStack.splice(Number(btn.dataset.removeTech), 1);
        renderChips();
        markDirty();
      });
    });
  }

  const techInput = form.querySelector("[data-tech-input]");
  const techAddBtn = form.querySelector("[data-tech-add]");

  function addTech() {
    const value = techInput.value.trim();
    if (!value || techStack.some((tech) => tech.toLowerCase() === value.toLowerCase())) {
      techInput.value = "";
      return;
    }
    techStack = [...techStack, value];
    techInput.value = "";
    renderChips();
    markDirty();
  }

  techAddBtn?.addEventListener("click", addTech);
  techInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTech();
    }
  });
  renderChips();

  // Poster replace (local preview only, never uploaded).
  const posterPreview = form.querySelector("[data-poster-preview]");
  const posterEmpty = form.querySelector("[data-poster-empty]");
  const replacePosterBtn = form.querySelector("[data-replace-poster]");
  const posterFileInput = form.querySelector("[data-poster-file]");

  replacePosterBtn?.addEventListener("click", () => posterFileInput.click());
  posterFileInput?.addEventListener("change", () => {
    const [file] = posterFileInput.files || [];
    if (!file) return;
    posterUrl = URL.createObjectURL(file);
    if (posterPreview) {
      posterPreview.src = posterUrl;
      posterPreview.hidden = false;
    }
    if (posterEmpty) posterEmpty.hidden = true;
    showToast("Local preview updated.");
    markDirty();
  });

  // Gallery (local metadata only; Supabase Storage comes later).
  function renderGallery() {
    const grid = form.querySelector("[data-gallery]");
    if (!grid) return;
    grid.innerHTML = gallery
      .map(
        (item) => `
          <figure class="gallery-item">
            <img src="${escapeAttribute(item.url)}" alt="">
            <button type="button" data-remove-gallery="${escapeAttribute(item.id)}" aria-label="Remove image">&times;</button>
          </figure>
        `,
      )
      .join("");

    grid.querySelectorAll("[data-remove-gallery]").forEach((btn) => {
      btn.addEventListener("click", () => {
        gallery = gallery.filter((item) => item.id !== btn.dataset.removeGallery);
        renderGallery();
        markDirty();
      });
    });
  }

  const galleryAddBtn = form.querySelector("[data-gallery-add]");
  const galleryFileInput = form.querySelector("[data-gallery-file]");
  galleryAddBtn?.addEventListener("click", () => galleryFileInput.click());
  galleryFileInput?.addEventListener("change", () => {
    const [file] = galleryFileInput.files || [];
    if (!file) return;
    gallery = [...gallery, { id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url: URL.createObjectURL(file) }];
    galleryFileInput.value = "";
    renderGallery();
    markDirty();
  });
  renderGallery();

  form.addEventListener("input", (event) => {
    const container = event.target.closest("[data-field]");
    if (container?.dataset.field) clearFieldError(container.dataset.field);
    markDirty();
  });
  form.addEventListener("change", markDirty);

  updateSaveState();
  setNavigationGuard(() => isDirty);

  async function handleCreate() {
    const values = collectFormValues();
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    try {
      const created = await createProject({ ...values, caseNumber: form.elements.caseNumber.value });
      showToast("Project created.");
      isDirty = false;
      clearNavigationGuard();
      window.location.hash = `#/projects/${created.id}`;
    } catch (error) {
      reportFailure(error, "Unable to create project.");
    }
  }

  async function handleSave() {
    const values = collectFormValues();
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    try {
      const updated = await updateProject(id, values);
      await logActivity("Project updated", `${updated.name || "Untitled project"} updated`);
      showToast("Changes saved.");
      await loadEditor(updated.id);
    } catch (error) {
      reportFailure(error, "Unable to save changes.");
    }
  }

  async function handlePublish() {
    const values = { ...collectFormValues(), editorialStatus: "PUBLISHED" };
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    try {
      const updated = await updateProject(id, values);
      await logActivity("Project published", `CASE ${updated.caseNumber} published`);
      showToast("Project published.");
      await loadEditor(updated.id);
    } catch (error) {
      reportFailure(error, "Unable to publish project.");
    }
  }

  async function handleArchive() {
    const confirmed = await confirmModal({
      title: `ARCHIVE CASE ${project.caseNumber}?`,
      body: "<p>The project will be marked as archived and hidden from published filters.</p>",
      confirmLabel: "Archive Project",
      danger: false,
    });
    if (!confirmed) return;

    try {
      await archiveProject(id);
      showToast("Project archived.");
      await loadEditor(id);
    } catch (error) {
      reportFailure(error, "Unable to archive project.");
    }
  }

  async function handleDelete() {
    const confirmed = await confirmModal({
      title: `DELETE CASE ${project.caseNumber}?`,
      body: "<p>This permanently removes the project. This cannot be undone.</p>",
      confirmLabel: "Delete Project",
    });
    if (!confirmed) return;

    try {
      await deleteProject(id);
      showToast("Project deleted.");
      isDirty = false;
      clearNavigationGuard();
      window.location.hash = "#/projects";
    } catch (error) {
      reportFailure(error, "Unable to delete project.");
    }
  }

  function handlePreview() {
    const values = collectFormValues();
    openModal({
      title: `PREVIEW / CASE ${form.elements.caseNumber.value}`,
      body: `
        <div class="preview-card">
          ${values.poster ? `<img src="${escapeAttribute(values.poster)}" alt="">` : ""}
          <h3>${escapeHtml(values.name || "Untitled project")}</h3>
          <p>${escapeHtml(values.description || "No description yet.")}</p>
          <dl>
            <div><dt>Category</dt><dd>${escapeHtml(values.category)}</dd></div>
            <div><dt>Status</dt><dd>${escapeHtml(values.status)}</dd></div>
            <div><dt>Tech Stack</dt><dd>${values.techStack.map((tech) => escapeHtml(tech)).join(", ") || "—"}</dd></div>
          </dl>
        </div>
      `,
      actions: [{ label: "Close" }],
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isCreate) {
      run(form.querySelector("[data-action-create]"), "Creating...", handleCreate);
    } else {
      run(form.querySelector("[data-action-save]"), "Saving...", handleSave);
    }
  });

  const publishBtn = form.querySelector("[data-action-publish]");
  publishBtn?.addEventListener("click", () => run(publishBtn, "Publishing...", handlePublish));

  form.querySelector("[data-action-preview]")?.addEventListener("click", handlePreview);

  const archiveBtn = document.querySelector("[data-action-archive]");
  archiveBtn?.addEventListener("click", () => run(archiveBtn, "Archiving...", handleArchive));

  const deleteBtn = document.querySelector("[data-action-delete]");
  deleteBtn?.addEventListener("click", () => run(deleteBtn, "Deleting...", handleDelete));
}

function loadingMarkup() {
  return `
    <section class="empty-state" aria-busy="true">
      <span>PROJECT</span>
      <h2>Loading project...</h2>
    </section>
  `;
}

function notFoundMarkup(id) {
  return `
    <section class="empty-state">
      <span>CASE / ${escapeHtml(id)}</span>
      <h2>Project not found</h2>
      <p>This project is no longer available.</p>
      <a class="button" href="#/projects">Back to Projects</a>
    </section>
  `;
}

function errorMarkup(message) {
  return `
    <section class="empty-state">
      <span>ERROR</span>
      <h2>${escapeHtml(message)}</h2>
      <button class="button" type="button" data-retry-editor>Try again</button>
    </section>
  `;
}

async function loadEditor(id) {
  const root = document.querySelector("[data-editor-root]");
  if (!root) return;

  const isCreate = id === "new";
  root.innerHTML = loadingMarkup();

  try {
    let project;

    if (isCreate) {
      project = blankProject(await nextAvailableCaseNumber());
    } else {
      project = await getProjectById(id);
      if (!root.isConnected) return;
      if (!project) {
        clearNavigationGuard();
        root.innerHTML = notFoundMarkup(id);
        return;
      }
    }

    if (!root.isConnected) return;
    root.innerHTML = renderEditor(project, isCreate);
    mount(project, isCreate);
  } catch (error) {
    if (!root.isConnected) return;
    clearNavigationGuard();
    root.innerHTML = errorMarkup(describeError(error, "Unable to load project."));
    root.querySelector("[data-retry-editor]")?.addEventListener("click", () => loadEditor(id));
  }
}

export const projectEditorPage = {
  title: "Project Editor",
  breadcrumb: "CONTENT / PROJECTS / CASE",
  render: () => `<div data-editor-root>${loadingMarkup()}</div>`,
  afterRender: ({ id }) => loadEditor(id),
};

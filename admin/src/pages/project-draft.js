import { confirmModal } from "../components/modal.js";
import { showToast, showToastAfterNavigation } from "../components/toast.js";
import { CATEGORIES, PROJECT_STATUSES } from "../data/projects.js";
import { plural, statusLabel, t } from "../i18n/index.js";
import { getAccess, hasProjectAccess } from "../security/access.js";
import { cancelRequest, openDraftFor, rebaseRequest, saveDraft, submitRequest } from "../services/approval-service.js";
import { describeError } from "../services/errors.js";
import { getProjectById } from "../services/project-service.js";
import { resolveImageUrl, uploadProjectImage } from "../services/storage-service.js";
import { changedCount, diffProposal, draftFields, projectColumns } from "../utils/change-diff.js";
import { escapeAttribute, escapeHtml, safeHexColor } from "../utils/html.js";
import { projectKey } from "./approvals.js";

// The project screen for members who propose changes instead of making them
// (projects.draft on an assigned project): edit, save the draft as often as
// needed, then ask for review. Nothing here touches the live project; the
// database only applies a draft when a reviewer approves it, against the
// version it started from.

function field(name, labelKey, value, { type = "text", attrs = "" } = {}) {
  return `
    <div class="field">
      <label for="draft-${name}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      <input id="draft-${name}" name="${name}" type="${type}" value="${escapeAttribute(value ?? "")}" ${attrs}>
    </div>
  `;
}

function select(name, labelKey, options, value) {
  return `
    <div class="field">
      <label for="draft-${name}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      <select id="draft-${name}" name="${name}">
        ${options.map((option) => `<option value="${escapeAttribute(option)}"${option === value ? " selected" : ""}>${escapeHtml(statusLabel(option))}</option>`).join("")}
      </select>
    </div>
  `;
}

function formMarkup(values, { editable, posterUrl }) {
  const disabled = editable ? "" : "disabled";
  return `
    <form class="draft-form panel settings-panel" data-draft-form novalidate>
      <fieldset ${disabled}>
        ${field("name", "security.fields.name", values.name, { attrs: 'maxlength="500" required' })}
        ${field("client", "security.fields.client", values.client, { attrs: 'maxlength="500"' })}
        <div class="draft-form__row">
          ${select("category", "security.fields.category", CATEGORIES, values.category)}
          ${select("status", "security.fields.status", PROJECT_STATUSES, values.status)}
          ${field("year", "security.fields.year", values.year ?? "", { type: "number", attrs: 'min="1990" max="2100"' })}
        </div>
        <div class="field">
          <label for="draft-description" data-i18n="security.fields.description">${escapeHtml(t("security.fields.description"))}</label>
          <textarea id="draft-description" name="description" rows="6" maxlength="8000">${escapeHtml(values.description ?? "")}</textarea>
        </div>
        ${field("tech_stack", "security.fields.tech_stack", (values.tech_stack ?? []).join(", "), { attrs: 'maxlength="800"' })}
        ${field("project_url", "security.fields.project_url", values.project_url, { type: "url", attrs: 'maxlength="500"' })}
        <div class="draft-form__row">
          ${field("accent", "security.fields.accent", safeHexColor(values.accent), { type: "color" })}
          <div class="field">
            <span class="field-label" data-i18n="security.fields.poster_url">${escapeHtml(t("security.fields.poster_url"))}</span>
            <div class="draft-poster">
              ${posterUrl ? `<img src="${escapeAttribute(posterUrl)}" alt="" data-draft-poster-preview>` : `<span class="draft-poster__empty" data-draft-poster-preview>${escapeHtml(t("security.draft.noPoster"))}</span>`}
              <label class="button button--compact">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" data-draft-poster hidden>
                <span data-i18n="security.draft.uploadPoster">${escapeHtml(t("security.draft.uploadPoster"))}</span>
              </label>
            </div>
          </div>
        </div>
        <label class="settings-toggle">
          <input type="checkbox" name="publish"${values.publish ? " checked" : ""}>
          <span data-i18n="security.draft.requestPublish">${escapeHtml(t("security.draft.requestPublish"))}</span>
        </label>
        <div class="field">
          <label for="draft-message" data-i18n="security.draft.message">${escapeHtml(t("security.draft.message"))}</label>
          <textarea id="draft-message" name="message" rows="2" maxlength="2000">${escapeHtml(values.message ?? "")}</textarea>
        </div>
      </fieldset>
      <p class="ops-count" data-draft-count aria-live="polite"></p>
      <p class="field-error" data-draft-error role="alert" hidden></p>
      ${
        editable
          ? `<div class="settings-password__actions">
              <button class="button" type="button" data-draft-save>${escapeHtml(t("security.draft.save"))}</button>
              <button class="button button--primary" type="submit" data-draft-submit>${escapeHtml(t("security.draft.submit"))}</button>
            </div>`
          : ""
      }
    </form>
  `;
}

export const projectDraftPage = {
  title: () => t("security.draft.title"),
  breadcrumb: () => t("security.draft.breadcrumb"),
  render: () => `
    <section class="page-heading" data-draft-heading>
      <div>
        <a class="back-link" href="#/projects" data-i18n="security.draft.back">${escapeHtml(t("security.draft.back"))}</a>
        <p class="empty-inline">${escapeHtml(t("common.loading"))}</p>
      </div>
    </section>
    <div data-draft-body></div>
  `,
  afterRender: async ({ id }) => {
    const heading = document.querySelector("[data-draft-heading]");
    const body = document.querySelector("[data-draft-body]");
    const me = getAccess()?.member?.userId ?? null;
    let project = null;
    let request = null;
    let posterPath = null;

    const paintHeading = (note = "") => {
      heading.innerHTML = `
        <div>
          <a class="back-link" href="#/projects" data-i18n="security.draft.back">${escapeHtml(t("security.draft.back"))}</a>
          <span>CASE ${escapeHtml(project.caseNumber)}</span>
          <h2>${escapeHtml(project.name)}</h2>
          <p>${escapeHtml(note)}</p>
        </div>
      `;
    };

    const load = async () => {
      project = await getProjectById(decodeURIComponent(id ?? ""));
      if (!project) {
        heading.innerHTML = `<div><a class="back-link" href="#/projects">${escapeHtml(t("security.draft.back"))}</a><h2>${escapeHtml(t("security.draft.notFound"))}</h2></div>`;
        body.innerHTML = "";
        return;
      }
      const key = projectKey(project);
      const editable = hasProjectAccess(key, { write: true });
      request = editable ? await openDraftFor(key, me) : null;
      const current = projectColumns(project);

      if (request?.status === "PENDING") {
        paintHeading(t("security.draft.pendingNote"));
        body.innerHTML = `
          <section class="panel settings-panel">
            <p>${escapeHtml(t("security.draft.pendingBody", { number: request.number }))}</p>
            <div class="settings-password__actions">
              <a class="button button--primary" href="#/approvals/${encodeURIComponent(request.id)}">${escapeHtml(t("security.approvals.open"))}</a>
              <button class="button" type="button" data-draft-cancel>${escapeHtml(t("security.draft.cancel"))}</button>
            </div>
          </section>
        `;
        return;
      }

      const values = { ...current, ...(request?.proposed ?? {}), publish: request?.action === "project.publish", message: request?.requestMessage ?? "" };
      posterPath = values.poster_url || null;
      paintHeading(editable ? t(request ? "security.draft.editingNote" : "security.draft.newNote") : t("security.draft.viewOnly"));
      const conflict = request && project.version != null && request.baseVersion !== project.version;
      body.innerHTML = `
        ${conflict ? `<p class="review-conflict" role="alert">${escapeHtml(t("security.review.conflictMine", { base: request.baseVersion, current: project.version }))} <button class="button button--compact" type="button" data-draft-rebase>${escapeHtml(t("security.draft.rebase"))}</button></p>` : ""}
        ${formMarkup(values, { editable, posterUrl: await resolveImageUrl(posterPath) })}
      `;
      if (editable) bindForm(current);
    };

    const readFields = (form, current) => {
      const values = {
        name: form.elements.name.value,
        client: form.elements.client.value,
        category: form.elements.category.value,
        status: form.elements.status.value,
        year: form.elements.year.value,
        description: form.elements.description.value,
        tech_stack: form.elements.tech_stack.value,
        project_url: form.elements.project_url.value,
        // A colour input always holds a colour; an unset accent stays unset
        // unless the member picks one.
        accent: form.elements.accent.value === safeHexColor(current.accent) ? current.accent : form.elements.accent.value,
        poster_url: posterPath ?? "",
      };
      return draftFields(values, current);
    };

    const bindForm = (current) => {
      const form = body.querySelector("[data-draft-form]");
      const count = form.querySelector("[data-draft-count]");
      const error = form.querySelector("[data-draft-error]");
      const paintCount = () => {
        const fields = readFields(form, current);
        const changes = changedCount(diffProposal(fields, current)) + (form.elements.publish.checked && current.editorial_status !== "PUBLISHED" ? 1 : 0);
        count.textContent = plural("security.draft.changeCount", changes);
      };
      paintCount();
      form.addEventListener("input", paintCount);

      form.querySelector("[data-draft-poster]")?.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        error.hidden = true;
        try {
          posterPath = await uploadProjectImage({ projectId: project.dbId || project.id, kind: "poster", file });
          const url = await resolveImageUrl(posterPath);
          const preview = form.querySelector("[data-draft-poster-preview]");
          preview.outerHTML = `<img src="${escapeAttribute(url)}" alt="" data-draft-poster-preview>`;
          paintCount();
        } catch (failure) {
          error.hidden = false;
          error.textContent = describeError(failure, t("security.draft.uploadError"));
        }
      });

      const save = async ({ submit }) => {
        error.hidden = true;
        const fields = readFields(form, current);
        const publish = form.elements.publish.checked;
        if (!Object.keys(fields).length && !publish) {
          error.hidden = false;
          error.textContent = t("security.draft.nothingChanged");
          return;
        }
        const buttons = form.querySelectorAll("button");
        buttons.forEach((button) => {
          button.disabled = true;
        });
        try {
          const saved = await saveDraft(projectKey(project), fields, { publish, message: form.elements.message.value.trim() || null });
          if (submit) {
            await submitRequest(saved.id, form.elements.message.value.trim() || null);
            showToastAfterNavigation(t("security.draft.submitted"));
            window.location.hash = `#/approvals/${encodeURIComponent(saved.id)}`;
            return;
          }
          showToast(t("security.draft.saved"));
          await load();
        } catch (failure) {
          error.hidden = false;
          error.textContent = describeError(failure, t("security.draft.saveError"));
          buttons.forEach((button) => {
            button.disabled = false;
          });
        }
      };

      form.querySelector("[data-draft-save]")?.addEventListener("click", () => save({ submit: false }));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        save({ submit: true });
      });
    };

    body.addEventListener("click", async (event) => {
      if (event.target.closest("[data-draft-cancel]")) {
        const ok = await confirmModal({ title: t("security.draft.cancelTitle"), body: `<p>${escapeHtml(t("security.draft.cancelBody"))}</p>`, confirmLabel: t("security.draft.cancel") });
        if (!ok) return;
        try {
          await cancelRequest(request.id);
          showToast(t("security.draft.cancelled"));
          await load();
        } catch (failure) {
          showToast(describeError(failure, t("security.draft.cancelError")));
        }
      }
      if (event.target.closest("[data-draft-rebase]")) {
        try {
          await rebaseRequest(request.id);
          showToast(t("security.draft.rebased"));
          await load();
        } catch (failure) {
          showToast(describeError(failure, t("security.draft.rebaseError")));
        }
      }
    });

    try {
      await load();
    } catch (error) {
      body.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("security.draft.loadError")))}</p>`;
    }
  },
};

import { badge, badgeType, healthBadge } from "../components/badge.js";
import { confirmModal } from "../components/modal.js";
import { bindTabs } from "../components/tabs.js";
import { showToast } from "../components/toast.js";
import { onLocaleChange, plural, statusLabel, t } from "../i18n/index.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import {
  CLIENT_STATUSES,
  archiveClient,
  createClient,
  getClient,
  getClientActivity,
  getClientProjects,
  linkProjectToClient,
  newClientDefaults,
  unarchiveClient,
  unlinkProjectFromClient,
  updateClient,
  validateClient,
} from "../services/client-service.js";
import { describeError, toDataError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { clientHealth } from "../utils/client-health.js";
import { projectSummary } from "../utils/client-metrics.js";
import { formatFullDate, formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const FORM_FIELDS = ["code", "name", "company", "email", "phone", "status", "notes"];

function tabsFor(isCreate) {
  // Projects and activity hang off a saved record, so a new client starts on
  // the two tabs it can actually fill in.
  return isCreate
    ? [
        ["general", "clientEditor.tabGeneral"],
        ["notes", "clientEditor.tabNotes"],
      ]
    : [
        ["overview", "clientEditor.tabOverview"],
        ["general", "clientEditor.tabGeneral"],
        ["notes", "clientEditor.tabNotes"],
        ["projects", "clientEditor.tabProjects"],
        ["activity", "clientEditor.tabActivity"],
      ];
}

/* ----------------------------------------------------------------- markup */

function fieldMarkup({ labelKey, name, value = "", type = "text", attrs = "", hintKey = "", rows = 6 }) {
  const id = `field-${name}`;
  const control =
    type === "textarea"
      ? `<textarea id="${id}" name="${name}" rows="${rows}" ${attrs}>${escapeHtml(value)}</textarea>`
      : `<input id="${id}" name="${name}" type="${type}" value="${escapeAttribute(value)}" ${attrs}>`;
  return `
    <div class="field${type === "textarea" ? " field--wide" : ""}" data-field="${name}">
      <label for="${id}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      ${control}
      ${hintKey ? `<p class="field-hint" data-i18n="${hintKey}">${escapeHtml(t(hintKey))}</p>` : ""}
      <p class="field-error" id="${id}-error" hidden></p>
    </div>
  `;
}

function statusSelect(value) {
  return `
    <div class="field" data-field="status">
      <label for="field-status" data-i18n="clientEditor.status">${escapeHtml(t("clientEditor.status"))}</label>
      <select id="field-status" name="status">
        ${CLIENT_STATUSES.map(
          (status) =>
            `<option value="${status}" data-status-label="${status}" ${status === value ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`,
        ).join("")}
      </select>
      <p class="field-error" id="field-status-error" hidden></p>
    </div>
  `;
}

function figure(labelKey, value, accent = false) {
  return `
    <div>
      <span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span>
      <strong${accent ? ' class="is-accent"' : ""}>${escapeHtml(value)}</strong>
    </div>
  `;
}

function healthCard(client) {
  const health = clientHealth(client);
  return `
    <strong>${escapeHtml(t("clientHealth.score", { score: health.score, total: health.total }))}</strong>
    ${healthBadge(health.status, `clientHealth.status.${health.status}`)}
    <div class="health-checks">
      ${health.checks
        .map(
          (check) => `
            <div class="health-check health-check--${check.ok ? "ok" : check.severity}">
              <span aria-hidden="true">${check.ok ? "OK" : "!"}</span>
              <strong data-i18n="clientHealth.checks.${check.key}">${escapeHtml(t(`clientHealth.checks.${check.key}`))}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function metaItem(labelKey, value) {
  return `<div><span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span><strong>${escapeHtml(value || "—")}</strong></div>`;
}

// The raw ISO string rides on the node so applyLocaleFormatting() re-reads the
// date in the new locale without re-rendering.
function dateItem(labelKey, value) {
  const stamp = value ? ` data-full-date="${escapeAttribute(value)}"` : "";
  return `<div><span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span><strong${stamp}>${escapeHtml(formatFullDate(value))}</strong></div>`;
}

function detailsGrid(client) {
  return `
    <div class="meta-grid">
      ${metaItem("clientEditor.email", client.email)}
      ${metaItem("clientEditor.phone", client.phone)}
      ${metaItem("clientEditor.company", client.company)}
      ${dateItem("clientEditor.clientSince", client.createdAt)}
      ${dateItem("clientEditor.lastUpdate", client.updatedAt)}
      ${client.archivedAt ? dateItem("clientEditor.archivedOn", client.archivedAt) : ""}
    </div>
  `;
}

function overviewMarkup(client, projects) {
  const summary = projectSummary(projects);
  const archived = client.status === "ARCHIVED";
  return `
    <div class="project-overview client-overview">
      <section class="overview-grid">
        <article class="overview-card">
          <span data-i18n="clientEditor.projectsSummary">${escapeHtml(t("clientEditor.projectsSummary"))}</span>
          <div class="ops-figures">
            ${figure("clientEditor.projectsActive", String(summary.active), true)}
            ${figure("clientEditor.projectsDelivered", String(summary.delivered))}
            ${figure("clientEditor.projectsTotal", String(summary.total))}
          </div>
        </article>
        <article class="overview-card">
          <span data-i18n="clientHealth.title">${escapeHtml(t("clientHealth.title"))}</span>
          <div data-client-health>${healthCard(client)}</div>
        </article>
      </section>
      ${detailsGrid(client)}
      <div class="overview-actions">
        <button type="button" class="button" data-client-lifecycle="${archived ? "unarchive" : "archive"}">${escapeHtml(
          archived ? t("clients.actionUnarchive") : t("clients.actionArchive"),
        )}</button>
      </div>
    </div>
  `;
}

function projectRow(project) {
  return `
    <div class="ops-row" data-client-project="${escapeAttribute(project.id)}">
      <span class="ops-row__primary">
        <a href="#/projects/${encodeURIComponent(project.id)}"><strong>${escapeHtml(project.name || t("projects.untitled"))}</strong></a>
        <small>CASE ${escapeHtml(project.caseNumber)} · <span data-status-label="${escapeAttribute(project.category)}">${escapeHtml(statusLabel(project.category))}</span></small>
      </span>
      <span data-label="${escapeAttribute(t("clientEditor.projectStatus"))}">${badge(project.status, badgeType(project.status))}</span>
      <span data-label="${escapeAttribute(t("clientEditor.projectEditorial"))}">${badge(project.editorialStatus, badgeType(project.editorialStatus))}</span>
      <span class="ops-meta" data-label="${escapeAttribute(t("common.updated"))}" data-relative-date="${escapeAttribute(project.updatedAt ?? "")}">${escapeHtml(formatRelativeDay(project.updatedAt))}</span>
      <span class="client-projects__actions">
        <a class="button button--compact" href="#/projects/${encodeURIComponent(project.id)}">${escapeHtml(t("clientEditor.openProject"))}</a>
        <button type="button" class="button button--compact" data-unlink-project="${escapeAttribute(project.id)}">${escapeHtml(t("clientEditor.unlinkProject"))}</button>
      </span>
    </div>
  `;
}

function linkControl(candidates) {
  if (!candidates.length) {
    return `<p class="field-hint" data-i18n="clientEditor.noProjectsToLink">${escapeHtml(t("clientEditor.noProjectsToLink"))}</p>`;
  }
  return `
    <div class="client-link-project">
      <label class="sort-field">
        <span data-i18n="clientEditor.linkProjectLabel">${escapeHtml(t("clientEditor.linkProjectLabel"))}</span>
        <select data-link-project-select>
          ${candidates
            .map((project) => `<option value="${escapeAttribute(project.id)}">CASE ${escapeHtml(project.caseNumber)} · ${escapeHtml(project.name)}</option>`)
            .join("")}
        </select>
      </label>
      <button type="button" class="button" data-link-project>${escapeHtml(t("clientEditor.linkProject"))}</button>
    </div>
  `;
}

function projectsMarkup(state) {
  if (!state.projectsOk) {
    return `<p class="empty-inline">${escapeHtml(state.projectsError)}</p>`;
  }
  const summary = projectSummary(state.projects);
  return `
    <div class="ops-figures">
      ${figure("clientEditor.projectsActive", String(summary.active), true)}
      ${figure("clientEditor.projectsDelivered", String(summary.delivered))}
      ${figure("clientEditor.projectsTotal", String(summary.total))}
    </div>
    ${
      state.projects.length
        ? `<div class="ops-table client-projects">${state.projects.map(projectRow).join("")}</div>`
        : `<p class="empty-inline" data-i18n="clientEditor.noProjectsLinked">${escapeHtml(t("clientEditor.noProjectsLinked"))}</p>`
    }
    ${linkControl(state.linkCandidates)}
    <p class="ops-note" data-i18n="clientEditor.linkNote">${escapeHtml(t("clientEditor.linkNote"))}</p>
  `;
}

// Log titles and details are written by the system as it records events, the
// same as on the Logs screen, so they are shown as recorded.
function activityMarkup(entries) {
  if (!entries.length) {
    return `<p class="empty-inline" data-i18n="clientEditor.noActivity">${escapeHtml(t("clientEditor.noActivity"))}</p>`;
  }
  return `
    <div class="activity-list">
      ${entries
        .map(
          (entry) => `
            <div>
              <span></span>
              <strong>${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.detail || entry.action || "")}</p>
              <small data-relative-date="${escapeAttribute(entry.time ?? "")}">${escapeHtml(formatRelativeDay(entry.time))}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function identityMeta(client) {
  return `
    <strong class="editor-identity__name" data-client-identity-name>${escapeHtml(client.name || t("clientEditor.untitled"))}</strong>
    <span class="editor-identity__meta">${escapeHtml(client.code || t("clientEditor.codePending"))}</span>
    ${badge(client.status, badgeType(client.status))}
  `;
}

function renderEditor(state) {
  const { client, isCreate } = state;
  const tabs = tabsFor(isCreate);
  const panel = (id, content) => {
    const index = tabs.findIndex(([tab]) => tab === id);
    return `<div class="tab-panel" id="client-panel-${id}" role="tabpanel" aria-labelledby="client-tab-${id}"${index === 0 ? "" : " hidden"}>${content}</div>`;
  };

  return `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="${isCreate ? "clientEditor.newBreadcrumb" : "clientEditor.recordBreadcrumb"}">${escapeHtml(
          t(isCreate ? "clientEditor.newBreadcrumb" : "clientEditor.recordBreadcrumb"),
        )}</span>
        <h2 data-i18n="${isCreate ? "clientEditor.newHeading" : "clientEditor.heading"}">${escapeHtml(t(isCreate ? "clientEditor.newHeading" : "clientEditor.heading"))}</h2>
        <div class="editor-identity">
          <span class="client-identity" data-client-identity>${identityMeta(client)}</span>
          <span class="save-state is-saved" data-save-state ${isCreate ? "hidden" : ""}>${escapeHtml(t("common.saved"))}</span>
        </div>
      </div>
      <div class="heading-actions">
        <a class="button" href="#/clients" data-i18n="clientEditor.allClients">${escapeHtml(t("clientEditor.allClients"))}</a>
      </div>
    </section>

    <form class="editor-form" data-client-editor data-mode="${isCreate ? "create" : "edit"}" novalidate>
      <div class="editor-toolbar">
        <button type="submit" class="button button--primary" data-client-save data-i18n="${isCreate ? "clientEditor.createClient" : "clientEditor.saveChanges"}">${escapeHtml(
          t(isCreate ? "clientEditor.createClient" : "clientEditor.saveChanges"),
        )}</button>
      </div>

      <div class="tabs" role="tablist" aria-label="${escapeAttribute(t("clientEditor.sections"))}" data-i18n-aria-label="clientEditor.sections">
        ${tabs
          .map(
            ([id, key], index) =>
              `<button type="button" role="tab" id="client-tab-${id}" data-tab="${id}" aria-selected="${index === 0}" aria-controls="client-panel-${id}" tabindex="${index === 0 ? 0 : -1}" data-i18n="${key}">${escapeHtml(t(key))}</button>`,
          )
          .join("")}
      </div>

      ${isCreate ? "" : panel("overview", `<div data-client-overview>${overviewMarkup(client, state.projects)}</div>`)}
      ${panel(
        "general",
        `
          <div class="form-grid">
            ${fieldMarkup({ labelKey: "clientEditor.code", name: "code", value: client.code, hintKey: "clientEditor.codeHint", attrs: 'autocomplete="off" spellcheck="false"' })}
            ${fieldMarkup({ labelKey: "clientEditor.name", name: "name", value: client.name, attrs: "required" })}
            ${fieldMarkup({ labelKey: "clientEditor.company", name: "company", value: client.company })}
            ${fieldMarkup({ labelKey: "clientEditor.email", name: "email", value: client.email, type: "email", attrs: 'autocomplete="off"' })}
            ${fieldMarkup({ labelKey: "clientEditor.phone", name: "phone", value: client.phone, type: "tel", attrs: 'autocomplete="off"' })}
            ${statusSelect(client.status)}
          </div>
        `,
      )}
      ${panel(
        "notes",
        `
          <div class="form-grid">
            ${fieldMarkup({ labelKey: "clientEditor.notes", name: "notes", value: client.notes, type: "textarea", hintKey: "clientEditor.notesHint", rows: 10 })}
          </div>
        `,
      )}
      ${isCreate ? "" : panel("projects", `<div data-client-projects>${projectsMarkup(state)}</div>`)}
      ${isCreate ? "" : panel("activity", `<div data-client-activity>${activityMarkup(state.activity)}</div>`)}
    </form>
  `;
}

function renderMissing(id) {
  return `
    <section class="empty-state">
      <span>${escapeHtml(id ?? "—")}</span>
      <h2 data-i18n="clientEditor.notFound">${escapeHtml(t("clientEditor.notFound"))}</h2>
      <p data-i18n="clientEditor.notFoundBody">${escapeHtml(t("clientEditor.notFoundBody"))}</p>
      <a class="button" href="#/clients" data-i18n="clientEditor.allClients">${escapeHtml(t("clientEditor.allClients"))}</a>
    </section>
  `;
}

/* ------------------------------------------------------------------- data */

async function loadState(id) {
  if (id === "new") {
    return { client: newClientDefaults(), isCreate: true, projects: [], projectsOk: true, linkCandidates: [], activity: [] };
  }

  const client = await getClient(id);
  if (!client) return null;

  // Projects and activity only enrich the record; either failing leaves the
  // client itself editable.
  const [linked, all, activity] = await Promise.allSettled([getClientProjects(client.id), getProjects(), getClientActivity(client.id)]);
  const projectsOk = linked.status === "fulfilled";

  return {
    client,
    isCreate: false,
    projects: projectsOk ? linked.value : [],
    projectsOk,
    projectsError: projectsOk ? "" : describeError(linked.reason, t("clientEditor.projectsLoadError")),
    // Only unowned projects are offered, so linking never silently moves a
    // project away from another client.
    linkCandidates: all.status === "fulfilled" ? all.value.filter((project) => !project.clientId) : [],
    activity: activity.status === "fulfilled" ? activity.value : [],
  };
}

/* ------------------------------------------------------------------ mount */

function mount(page, state, { tab } = {}) {
  page.innerHTML = renderEditor(state);
  const form = page.querySelector("[data-client-editor]");
  const saveState = page.querySelector("[data-save-state]");
  const saveButton = form.querySelector("[data-client-save]");
  const { isCreate } = state;

  bindTabs(form);
  if (tab) form.querySelector(`[data-tab="${tab}"]`)?.click();

  const collect = () =>
    Object.fromEntries(FORM_FIELDS.map((field) => [field, String(form.elements[field]?.value ?? "").trim()]));

  let savedSnapshot = JSON.stringify(collect());
  let dirty = false;
  let saving = false;
  let failed = false;

  function paintSaveState() {
    if (!saveState) return;
    const [key, cls] = saving
      ? ["clientEditor.saving", "is-saving"]
      : failed
        ? ["clientEditor.saveFailed", "is-error"]
        : dirty
          ? ["shell.unsavedChanges", "is-unsaved"]
          : ["common.saved", "is-saved"];
    saveState.hidden = isCreate && !dirty && !saving && !failed;
    saveState.textContent = t(key);
    saveState.className = `save-state ${cls}`;
  }

  function paintIdentity() {
    const values = { ...state.client, ...collect() };
    const identity = page.querySelector("[data-client-identity]");
    if (identity) identity.innerHTML = identityMeta({ ...values, code: values.code || state.client.code });
    const health = page.querySelector("[data-client-health]");
    if (health) health.innerHTML = healthCard(values);
  }

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  function showErrors(errors) {
    clearErrors();
    let first = null;
    Object.entries(errors).forEach(([field, message]) => {
      const container = form.querySelector(`[data-field="${field}"]`);
      const input = container?.querySelector("input, select, textarea");
      const error = container?.querySelector(".field-error");
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
      input?.setAttribute("aria-invalid", "true");
      first ??= input;
    });
    // A field on a hidden tab cannot take focus, so open its tab first.
    const panelId = first?.closest("[role='tabpanel']")?.id;
    if (panelId) form.querySelector(`[aria-controls="${panelId}"]`)?.click();
    first?.focus();
    showToast(t("clientEditor.fixHighlighted"));
  }

  function markDirty() {
    dirty = JSON.stringify(collect()) !== savedSnapshot;
    failed = false;
    paintSaveState();
    paintIdentity();
  }

  async function save() {
    if (saving) return;
    const values = collect();
    const errors = validateClient(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    saving = true;
    saveButton.disabled = true;
    paintSaveState();
    try {
      const saved = isCreate ? await createClient(values) : await updateClient(state.client.id, values);
      dirty = false;
      clearNavigationGuard();
      showToast(isCreate ? t("clientEditor.clientCreated") : t("clientEditor.clientSaved"));
      if (isCreate) {
        window.location.hash = `#/clients/${encodeURIComponent(saved.id)}`;
        return;
      }
      await reload(page, saved.id, { tab: activeTab(form) });
    } catch (error) {
      const dataError = toDataError(error, t("clientEditor.saveError"));
      failed = true;
      if (dataError.field && FORM_FIELDS.includes(dataError.field)) showErrors({ [dataError.field]: dataError.message });
      else showToast(dataError.message);
    } finally {
      saving = false;
      if (saveButton.isConnected) saveButton.disabled = false;
      if (saveState?.isConnected) paintSaveState();
    }
  }

  async function changeLifecycle(archive) {
    if (dirty) {
      showToast(t("clientEditor.saveBeforeArchive"));
      return;
    }
    const confirmed = await confirmModal({
      title: archive ? t("clients.archiveTitle") : t("clients.unarchiveTitle"),
      body: `<p>${escapeHtml(archive ? t("clients.archiveBody") : t("clients.unarchiveBody"))}</p>`,
      confirmLabel: archive ? t("clients.actionArchive") : t("clients.actionUnarchive"),
      danger: archive,
    });
    if (!confirmed) return;
    try {
      if (archive) await archiveClient(state.client.id);
      else await unarchiveClient(state.client.id);
      showToast(archive ? t("clients.clientArchived") : t("clients.clientUnarchived"));
      await reload(page, state.client.id, { tab: activeTab(form) });
    } catch (error) {
      showToast(describeError(error, t("clients.archiveError")));
    }
  }

  // Keep whatever the user typed in the form: only the side panels reload.
  async function refreshPanels() {
    const fresh = await loadState(state.client.id);
    if (!fresh || !form.isConnected) return;
    Object.assign(state, { projects: fresh.projects, projectsOk: fresh.projectsOk, projectsError: fresh.projectsError, linkCandidates: fresh.linkCandidates, activity: fresh.activity });
    paintPanels();
  }

  async function changeLink(projectId, link) {
    try {
      if (link) await linkProjectToClient(state.client.id, projectId);
      else await unlinkProjectFromClient(state.client.id, projectId);
      showToast(link ? t("clientEditor.projectLinked") : t("clientEditor.projectUnlinked"));
      await refreshPanels();
    } catch (error) {
      showToast(describeError(error, t("clientEditor.linkError")));
      // Another tab changed the link first: show what is true now.
      if (error?.code === "conflict") await refreshPanels().catch(() => {});
    }
  }

  function paintPanels() {
    const overview = page.querySelector("[data-client-overview]");
    if (overview) overview.innerHTML = overviewMarkup({ ...state.client, ...collect(), code: state.client.code }, state.projects);
    const projects = page.querySelector("[data-client-projects]");
    if (projects) projects.innerHTML = projectsMarkup(state);
    const activity = page.querySelector("[data-client-activity]");
    if (activity) activity.innerHTML = activityMarkup(state.activity);
  }

  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
  });
  form.addEventListener("click", (event) => {
    const lifecycle = event.target.closest("[data-client-lifecycle]");
    if (lifecycle) changeLifecycle(lifecycle.dataset.clientLifecycle === "archive");

    if (event.target.closest("[data-link-project]")) {
      const select = form.querySelector("[data-link-project-select]");
      if (select?.value) changeLink(select.value, true);
    }

    const unlink = event.target.closest("[data-unlink-project]");
    if (unlink) changeLink(unlink.dataset.unlinkProject, false);
  });

  // Every static label carries data-i18n; the pieces built from dictionary
  // lookups (badges, health, figures, relative dates) are repainted from the
  // live form values, so typed text and the open tab survive a locale switch.
  onLocaleChange(form, () => {
    paintPanels();
    paintIdentity();
    paintSaveState();
  });

  paintSaveState();
  setNavigationGuard(() => dirty);
}

function activeTab(form) {
  return form.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab;
}

async function reload(page, id, options) {
  const state = await loadState(id);
  if (!page.isConnected) return;
  if (!state) {
    page.innerHTML = renderMissing(id);
    return;
  }
  mount(page, state, options);
}

export const clientDetailPage = {
  title: () => t("clientEditor.title"),
  breadcrumb: () => t("clientEditor.breadcrumb"),
  render: () => `<section class="empty-state" aria-busy="true"><span data-i18n="clientEditor.loading">${escapeHtml(t("clientEditor.loading"))}</span></section>`,
  afterRender: async ({ id }) => {
    const page = document.querySelector(".page");
    try {
      await reload(page, id);
    } catch (error) {
      if (!page.isConnected) return;
      page.innerHTML = `<section class="empty-state"><p>${escapeHtml(describeError(error, t("clientEditor.loadError")))}</p><a class="button" href="#/clients" data-i18n="clientEditor.allClients">${escapeHtml(t("clientEditor.allClients"))}</a></section>`;
    }
  },
};

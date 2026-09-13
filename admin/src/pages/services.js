import { badge } from "../components/badge.js";
import { showToast } from "../components/toast.js";
import { publicSiteUrl } from "../config/public-site.js";
import { onLocaleChange, plural, statusLabel, t } from "../i18n/index.js";
import { logActivity } from "../services/activity-service.js";
import { describeError } from "../services/errors.js";
import { archivePlan, duplicatePlan, getPlans, SERVICE_STATUSES, unarchivePlan } from "../services/plan-service.js";
import { contentCompleteness, normalizeServiceStatus, serviceHealth } from "../utils/service-health.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function formatUpdated(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(document.documentElement.lang || undefined, { month: "short", day: "2-digit" });
}

function optionMarkup(value, label = value) {
  return `<option value="${escapeAttribute(value)}">${escapeHtml(label)}</option>`;
}

function filterMarkup({ labelKey, name, options }) {
  return `
    <label class="sort-field">
      <span>${escapeHtml(t(labelKey))}</span>
      <select data-service-filter="${escapeAttribute(name)}" disabled>
        ${options.map(([value, label]) => optionMarkup(value, label)).join("")}
      </select>
    </label>
  `;
}

function healthBadge(status) {
  const type = status === "healthy" ? "success" : status === "attention" ? "warning" : "muted";
  return `<span class="badge badge--${type}">${escapeHtml(t(`serviceHealth.status.${status}`)).toUpperCase()}</span>`;
}

function metricsMarkup(plans) {
  const enriched = plans.map((plan) => ({ plan, health: serviceHealth(plan) }));
  const metrics = [
    ["services.metricTotal", plans.length],
    ["services.metricVisible", plans.filter((plan) => plan.visible).length],
    ["services.metricHidden", plans.filter((plan) => !plan.visible).length],
    ["services.metricAvailable", plans.filter((plan) => normalizeServiceStatus(plan.status) === "AVAILABLE").length],
    ["services.metricArchived", plans.filter((plan) => normalizeServiceStatus(plan.status) === "ARCHIVED").length],
    ["services.metricAttention", enriched.filter((item) => item.health.status !== "healthy").length],
  ];

  return metrics
    .map(
      ([key, value]) => `
        <div class="project-metric service-metric">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(t(key))}</span>
        </div>
      `,
    )
    .join("");
}

function serviceRow(plan) {
  const health = serviceHealth(plan);
  const completeness = contentCompleteness(plan);
  const status = normalizeServiceStatus(plan.status);
  const archiveLabel = status === "ARCHIVED" ? t("services.actionUnarchive") : t("services.actionArchive");
  const archiveAction = status === "ARCHIVED" ? "unarchive" : "archive";
  const publicHref = publicSiteUrl("#plans");

  return `
    <article class="project-row service-row" data-service-id="${escapeAttribute(plan.id)}">
      <span class="project-row__project">
        <strong>${escapeHtml(plan.name || t("services.untitledPlan"))}</strong>
        <small>${escapeHtml(plan.slug || "-")}</small>
      </span>
      <span data-label="${escapeAttribute(t("services.range"))}">${escapeHtml(plan.range || "-")}</span>
      <span data-label="${escapeAttribute(t("services.timeline"))}">${escapeHtml(plan.timeline || "-")}</span>
      <span data-label="${escapeAttribute(t("services.status"))}">${badge(status, status === "AVAILABLE" ? "success" : status === "ARCHIVED" ? "muted" : "warning")}</span>
      <span data-label="${escapeAttribute(t("services.visibility"))}">${escapeHtml(plan.visible ? t("common.visible") : t("common.hidden"))}</span>
      <span data-label="${escapeAttribute(t("services.content"))}">${escapeHtml(t("serviceHealth.content.compact", { pt: completeness.pt.percent, en: completeness.en.percent }))}</span>
      <span data-label="${escapeAttribute(t("services.features"))}">${escapeHtml(plural("services.featureCount", (plan.features || []).length))}</span>
      <span data-label="${escapeAttribute(t("serviceHealth.title"))}">${healthBadge(health.status)}</span>
      <span data-label="${escapeAttribute(t("common.updated"))}">${escapeHtml(formatUpdated(plan.updatedAt))}</span>
      <span class="project-row__actions">
        <button class="button button--compact" type="button" data-service-open="${escapeAttribute(plan.id)}">${escapeHtml(t("services.actionEdit"))}</button>
        <span class="row-menu" data-row-menu>
          <button class="button button--compact row-menu__toggle" type="button" data-row-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="${escapeAttribute(t("services.actions"))}">...</button>
          <span class="row-menu__panel" role="menu" hidden>
            <a role="menuitem" href="${escapeAttribute(publicHref)}" target="_blank" rel="noreferrer">${escapeHtml(t("services.actionViewPublic"))}</a>
            <button type="button" role="menuitem" data-service-duplicate="${escapeAttribute(plan.id)}">${escapeHtml(t("services.actionDuplicate"))}</button>
            <button type="button" role="menuitem" data-service-archive="${escapeAttribute(plan.id)}" data-archive-action="${archiveAction}">${escapeHtml(archiveLabel)}</button>
          </span>
        </span>
      </span>
    </article>
  `;
}

function closeRowMenus(root = document) {
  root.querySelectorAll("[data-row-menu] .row-menu__panel").forEach((panel) => {
    panel.hidden = true;
  });
  root.querySelectorAll("[data-row-menu-toggle]").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "false");
  });
}

export const servicesPage = {
  title: () => t("services.title"),
  breadcrumb: () => t("services.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="services.eyebrow">${escapeHtml(t("services.eyebrow"))}</span>
        <h2 data-i18n="services.heading">${escapeHtml(t("services.heading"))}</h2>
        <p data-i18n="services.intro">${escapeHtml(t("services.intro"))}</p>
      </div>
      <div class="heading-actions">
        <button class="button button--primary" type="button" data-new-service data-i18n="services.newService">${escapeHtml(t("services.newService"))}</button>
      </div>
    </section>

    <section class="panel projects-panel services-panel">
      <div class="project-metrics service-metrics" data-service-metrics aria-live="polite"></div>
      <div class="toolbar toolbar--filters service-filters">
        <label class="search-field">
          <span data-i18n="services.searchServices">${escapeHtml(t("services.searchServices"))}</span>
          <input data-search-services type="search" placeholder="${escapeAttribute(t("services.searchPlaceholder"))}" disabled>
        </label>
        <div class="toolbar__controls">
          ${filterMarkup({ labelKey: "services.status", name: "status", options: [["ALL", t("common.all")], ...SERVICE_STATUSES.map((item) => [item, statusLabel(item)])] })}
          ${filterMarkup({ labelKey: "services.visibility", name: "visibility", options: [["ALL", t("common.all")], ["VISIBLE", t("common.visible")], ["HIDDEN", t("common.hidden")]] })}
          ${filterMarkup({ labelKey: "serviceHealth.title", name: "health", options: [["ALL", t("common.all")], ["HEALTHY", t("serviceHealth.status.healthy")], ["ATTENTION", t("serviceHealth.status.attention")], ["INCOMPLETE", t("serviceHealth.status.incomplete")]] })}
        </div>
      </div>
      <div class="projects-table-scroll services-table-scroll">
        <div class="project-table service-table" data-service-list aria-live="polite" aria-busy="true">
          <div class="project-row project-row--skeleton"></div>
          <div class="project-row project-row--skeleton"></div>
          <div class="project-row project-row--skeleton"></div>
        </div>
      </div>
    </section>
  `,
  afterRender: async () => {
    document.querySelector("[data-new-service]")?.addEventListener("click", () => {
      window.location.hash = "#/services/new";
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-row-menu]")) closeRowMenus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeRowMenus();
    });

    const search = document.querySelector("[data-search-services]");
    const list = document.querySelector("[data-service-list]");
    const metricRoot = document.querySelector("[data-service-metrics]");
    const filters = [...document.querySelectorAll("[data-service-filter]")];
    let plans = [];

    const renderList = () => {
      const query = search.value.trim().toLowerCase();
      const filterState = Object.fromEntries(filters.map((filter) => [filter.dataset.serviceFilter, filter.value]));
      const visible = plans.filter((plan) => {
        const health = serviceHealth(plan).status.toUpperCase();
        const matchesQuery = [plan.name, plan.slug, plan.scope, plan.scopeShort, plan.description].some((value) =>
          String(value || "").toLowerCase().includes(query),
        );
        const status = normalizeServiceStatus(plan.status);
        const matchesStatus = filterState.status === "ALL" || status === filterState.status;
        const matchesVisibility = filterState.visibility === "ALL" || (filterState.visibility === "VISIBLE" ? plan.visible : !plan.visible);
        const matchesHealth = filterState.health === "ALL" || health === filterState.health;
        return matchesQuery && matchesStatus && matchesVisibility && matchesHealth;
      });

      if (metricRoot) metricRoot.innerHTML = metricsMarkup(plans);
      list.innerHTML = `
        <div class="project-table__head service-table__head" aria-hidden="true">
          <span>${t("services.plan").toUpperCase()}</span><span>${t("services.range").toUpperCase()}</span><span>${t("services.timeline").toUpperCase()}</span><span>${t("services.status").toUpperCase()}</span><span>${t("services.visibility").toUpperCase()}</span><span>${t("services.content").toUpperCase()}</span><span>${t("services.features").toUpperCase()}</span><span>${t("serviceHealth.title").toUpperCase()}</span><span>${t("common.updated").toUpperCase()}</span><span>${t("services.actions").toUpperCase()}</span>
        </div>
        ${visible.length ? visible.map(serviceRow).join("") : `<p class="empty-inline">${escapeHtml(plans.length ? t("services.noMatch") : t("services.noPlans"))}</p>`}
      `;

      list.querySelectorAll("[data-service-open]").forEach((button) => {
        button.addEventListener("click", () => {
          window.location.hash = `#/services/${button.dataset.serviceOpen}`;
        });
      });
      list.querySelectorAll("[data-row-menu-toggle]").forEach((toggle) => {
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          const panel = toggle.nextElementSibling;
          const willOpen = panel?.hidden;
          closeRowMenus();
          if (panel && willOpen) {
            panel.hidden = false;
            toggle.setAttribute("aria-expanded", "true");
          }
        });
      });
      list.querySelectorAll("[data-service-duplicate]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            const copy = await duplicatePlan(button.dataset.serviceDuplicate);
            await logActivity("Plan duplicated", `${copy.name} created from an existing plan.`, { action: "plan.duplicated", entityType: "plan", entityId: copy.id });
            plans = await getPlans();
            renderList();
            showToast(t("services.planDuplicated"));
          } catch (error) {
            showToast(describeError(error, t("services.duplicateError")));
          }
        });
      });
      list.querySelectorAll("[data-service-archive]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            const action = button.dataset.archiveAction;
            const changed = action === "unarchive" ? await unarchivePlan(button.dataset.serviceArchive) : await archivePlan(button.dataset.serviceArchive);
            await logActivity(action === "unarchive" ? "Plan unarchived" : "Plan archived", `${changed.name} lifecycle updated.`, {
              action: action === "unarchive" ? "plan.unarchived" : "plan.archived",
              entityType: "plan",
              entityId: changed.id,
            });
            plans = await getPlans();
            renderList();
            showToast(action === "unarchive" ? t("services.planUnarchived") : t("services.planArchived"));
          } catch (error) {
            showToast(describeError(error, t("services.archiveError")));
          }
        });
      });
    };

    filters.forEach((filter) => filter.addEventListener("change", renderList));
    search.addEventListener("input", renderList);
    onLocaleChange(list, () => renderList());

    try {
      plans = await getPlans();
      if (!list.isConnected) return;
      list.removeAttribute("aria-busy");
      search.disabled = false;
      filters.forEach((filter) => {
        filter.disabled = false;
      });
      renderList();
    } catch (error) {
      list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("services.loadError")))}</p>`;
    }
  },
};

import { badge } from "../components/badge.js";
import { showToast } from "../components/toast.js";
import { publicSiteUrl } from "../config/public-site.js";
import { onLocaleChange, plural, statusLabel, t } from "../i18n/index.js";
import { logActivity } from "../services/activity-service.js";
import { describeError } from "../services/errors.js";
import { archivePlan, duplicatePlan, getPlans, SERVICE_STATUSES, unarchivePlan } from "../services/plan-service.js";
import { contentCompleteness, normalizeServiceStatus, serviceHealth } from "../utils/service-health.js";
import { escapeAttribute, escapeHtml, safeHexColor } from "../utils/html.js";

function formatUpdated(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return t("services.noUpdateDate");
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

function statusBadge(status) {
  return badge(status, status === "AVAILABLE" ? "success" : status === "ARCHIVED" ? "muted" : "warning");
}

function metricsMarkup(plans) {
  const attention = plans.filter((plan) => serviceHealth(plan).status !== "healthy").length;
  const metrics = [
    ["services.metricTotal", plans.length],
    ["services.metricVisible", plans.filter((plan) => plan.visible).length],
    ["services.metricHidden", plans.filter((plan) => !plan.visible).length],
    ["services.metricAvailable", plans.filter((plan) => normalizeServiceStatus(plan.status) === "AVAILABLE").length],
    ["services.metricArchived", plans.filter((plan) => normalizeServiceStatus(plan.status) === "ARCHIVED").length],
    ["services.metricAttention", attention],
  ];

  return metrics
    .map(([key, value]) => {
      const warn = key === "services.metricAttention" && value > 0;
      return `
        <div class="project-metric${warn ? " is-warn" : ""}">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(t(key))}</span>
        </div>
      `;
    })
    .join("");
}

// One meter per locale: the bar is the fastest way to spot a missing
// translation across a handful of plans.
function meterMarkup(label, percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="content-meter${value < 100 ? " content-meter--partial" : ""}">
      <span>${escapeHtml(label)}</span>
      <i aria-hidden="true"><b style="width:${value}%"></b></i>
      <em>${value}%</em>
    </div>
  `;
}

function pendingMarkup(health) {
  const failing = health.checks.filter((check) => !check.ok);
  if (!failing.length) return "";
  const labels = failing.map((check) => t(`serviceHealth.checks.${check.key}`)).join(" · ");
  return `
    <p class="pending-note pending-note--${health.status}">
      <span>${escapeHtml(t("services.pendingChecks"))}</span>
      ${escapeHtml(labels)}
    </p>
  `;
}

function serviceCard(plan) {
  const health = serviceHealth(plan);
  const completeness = contentCompleteness(plan);
  const status = normalizeServiceStatus(plan.status);
  const archiveLabel = status === "ARCHIVED" ? t("services.actionUnarchive") : t("services.actionArchive");
  const archiveAction = status === "ARCHIVED" ? "unarchive" : "archive";
  const publicHref = publicSiteUrl("#plans");
  const position = Number.isFinite(Number(plan.position)) ? Number(plan.position) + 1 : null;
  const featureCount = (plan.features || []).filter((feature) => String(feature.text || "").trim()).length;
  const muted = status === "ARCHIVED" || !plan.visible;

  return `
    <article class="service-card${muted ? " service-card--muted" : ""}" data-service-id="${escapeAttribute(plan.id)}" style="--service-accent:${safeHexColor(plan.accent)}">
      <header class="service-card__top">
        <span class="service-card__index">${position ? String(position).padStart(2, "0") : "—"}</span>
        <span class="service-card__badges">${statusBadge(status)}${healthBadge(health.status)}</span>
      </header>

      <div class="service-card__identity">
        <span class="service-card__eyebrow">${escapeHtml(plan.scopeShort || t("services.plan"))}</span>
        <h3 class="service-card__name">${escapeHtml(plan.name || t("services.untitledPlan"))}</h3>
        <small>${escapeHtml(plan.slug || "—")}</small>
      </div>

      <p class="service-card__range${plan.range ? "" : " is-pending"}">${escapeHtml(plan.range || t("services.rangePending"))}</p>

      <dl class="service-card__facts">
        <div><dt>${escapeHtml(t("services.timeline"))}</dt><dd>${escapeHtml(plan.timeline || "—")}</dd></div>
        <div><dt>${escapeHtml(t("services.visibility"))}</dt><dd class="${plan.visible ? "" : "is-off"}">${escapeHtml(plan.visible ? t("common.visible") : t("common.hidden"))}</dd></div>
        <div><dt>${escapeHtml(t("services.features"))}</dt><dd>${escapeHtml(plural("services.featureCount", featureCount))}</dd></div>
        <div><dt>${escapeHtml(t("common.updated"))}</dt><dd>${escapeHtml(formatUpdated(plan.updatedAt))}</dd></div>
      </dl>

      <div class="service-card__content">
        <span>${escapeHtml(t("services.content"))}</span>
        ${meterMarkup("PT", completeness.pt.percent)}
        ${meterMarkup("EN", completeness.en.percent)}
      </div>

      ${pendingMarkup(health)}

      <footer class="service-card__actions">
        <button class="button service-card__edit" type="button" data-service-open="${escapeAttribute(plan.id)}">${escapeHtml(t("services.actionEdit"))} <span aria-hidden="true">→</span></button>
        <span class="row-menu" data-row-menu>
          <button class="button button--compact row-menu__toggle" type="button" data-row-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="${escapeAttribute(t("services.actions"))}">...</button>
          <span class="row-menu__panel" role="menu" hidden>
            <a role="menuitem" href="${escapeAttribute(publicHref)}" target="_blank" rel="noreferrer">${escapeHtml(t("services.actionViewPublic"))}</a>
            <button type="button" role="menuitem" data-service-duplicate="${escapeAttribute(plan.id)}">${escapeHtml(t("services.actionDuplicate"))}</button>
            <button type="button" role="menuitem" data-service-archive="${escapeAttribute(plan.id)}" data-archive-action="${archiveAction}">${escapeHtml(archiveLabel)}</button>
          </span>
        </span>
      </footer>
    </article>
  `;
}

// The last tile of the grid is a shortcut to create a plan, so the grid never
// ends on a dead edge.
function newServiceTile() {
  return `
    <a class="service-card service-card--new" href="#/services/new">
      <span aria-hidden="true">+</span>
      <strong>${escapeHtml(t("services.newService"))}</strong>
    </a>
  `;
}

function skeletonCards() {
  return Array.from({ length: 3 }, () => `<div class="service-card service-card--skeleton skeleton-card"></div>`).join("");
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

    <div class="metric-strip" data-service-metrics aria-live="polite"></div>

    <div class="service-filters">
      <label class="search-field">
        <span data-i18n="services.searchServices">${escapeHtml(t("services.searchServices"))}</span>
        <input data-search-services type="search" placeholder="${escapeAttribute(t("services.searchPlaceholder"))}" disabled>
      </label>
      ${filterMarkup({ labelKey: "services.status", name: "status", options: [["ALL", t("common.all")], ...SERVICE_STATUSES.map((item) => [item, statusLabel(item)])] })}
      ${filterMarkup({ labelKey: "services.visibility", name: "visibility", options: [["ALL", t("common.all")], ["VISIBLE", t("common.visible")], ["HIDDEN", t("common.hidden")]] })}
      ${filterMarkup({ labelKey: "serviceHealth.title", name: "health", options: [["ALL", t("common.all")], ["HEALTHY", t("serviceHealth.status.healthy")], ["ATTENTION", t("serviceHealth.status.attention")], ["INCOMPLETE", t("serviceHealth.status.incomplete")]] })}
    </div>

    <div class="service-grid" data-service-list aria-live="polite" aria-busy="true">
      ${skeletonCards()}
    </div>
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
      list.innerHTML = visible.length
        ? `${visible.map(serviceCard).join("")}${newServiceTile()}`
        : `<p class="empty-inline service-grid__empty">${escapeHtml(plans.length ? t("services.noMatch") : t("services.noPlans"))}</p>${plans.length ? "" : newServiceTile()}`;

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
      list.removeAttribute("aria-busy");
      list.innerHTML = `<p class="empty-inline service-grid__empty">${escapeHtml(describeError(error, t("services.loadError")))}</p>`;
    }
  },
};

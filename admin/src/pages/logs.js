import { serviceStatusMarkup, serviceStateNote } from "../components/automation-panel.js";
import { eventLabel, openRunDetail, runTableMarkup } from "../components/automation-runs.js";
import { bindTabs } from "../components/tabs.js";
import { showToast } from "../components/toast.js";
import { getActivityWithStatus } from "../services/activity-service.js";
import { getCachedSession } from "../services/auth-service.js";
import { getAutomationRuns, isAutomationApiAvailable, retryAutomationRun } from "../services/automation-api.js";
import { FORBIDDEN, LOADING, NOT_CONFIGURED, SUCCESS, stateForError } from "../utils/automation-state.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { downloadCsv } from "../utils/csv.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import {
  actionKey,
  channelFor,
  CHANNELS,
  DAY,
  domainFor,
  DOMAINS,
  entityHref,
  entryTime,
  matchesDomain,
  matchesPeriod,
  matchesQuery,
  PERIODS,
  sortByNewest,
  startOfDay,
  toCsv,
} from "../utils/log-entries.js";

const PAGE_SIZE = 100;

// Stored titles are written in English by the code that records the event.
// A known action code gets a localized label; anything else shows the stored
// title untouched, so rows from older builds still read correctly.
function actionLabel(entry) {
  const key = actionKey(entry.action);
  const label = t(key);
  return label && label !== key ? label : entry.title || entry.action || t("logs.untitledEvent");
}

function formatClock(time, locale) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(time));
}

function formatDay(time, locale, now = Date.now()) {
  const today = startOfDay(now);
  if (time >= today) return t("logs.today");
  if (time >= today - DAY) return t("logs.yesterday");
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "short" }).format(new Date(time));
}

function formatFull(time, locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(time));
}

function entryMarkup(entry, locale) {
  const channel = channelFor(entry);
  const domain = domainFor(entry);
  const time = entryTime(entry);
  const href = entityHref(entry);
  const label = actionLabel(entry);
  const showStoredTitle = entry.title && entry.title !== label;
  const meta = [
    ["logs.fieldAction", entry.action || "—"],
    ["logs.fieldEntity", entry.entityType || "—"],
    ["logs.fieldEntityId", entry.entityId || "—"],
    ["logs.fieldUser", entry.adminUserId || "—"],
    ["logs.fieldTime", time === null ? "—" : formatFull(time, locale)],
  ];

  return `
    <details class="log-entry log-entry--${channel.toLowerCase()}" data-log-channel="${escapeAttribute(channel)}">
      <summary>
        <span class="log-entry__time">${time === null ? "—" : escapeHtml(formatClock(time, locale))}</span>
        <span class="log-entry__dot" aria-hidden="true"></span>
        <span class="log-entry__main">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(entry.detail || t("logs.noDetail"))}</span>
        </span>
        <span class="log-entry__tags">
          ${domain !== "All" ? `<span class="log-tag">${escapeHtml(t(`logs.domains.${domain}`))}</span>` : ""}
          <span class="log-tag log-tag--${channel.toLowerCase()}">${escapeHtml(t(`logs.channels.${channel}`))}</span>
        </span>
        <span class="log-entry__chevron" aria-hidden="true">›</span>
      </summary>
      <div class="log-entry__details">
        ${showStoredTitle ? `<p class="log-entry__stored"><span>${escapeHtml(t("logs.fieldStoredTitle"))}</span>${escapeHtml(entry.title)}</p>` : ""}
        <dl>
          ${meta.map(([key, value]) => `<div><dt>${escapeHtml(t(key))}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
        </dl>
        ${href ? `<a class="button button--compact" href="${escapeAttribute(href)}">${escapeHtml(t("logs.openRecord"))} <span aria-hidden="true">→</span></a>` : ""}
      </div>
    </details>
  `;
}

function timelineMarkup(entries, locale) {
  const groups = [];
  for (const entry of entries) {
    const time = entryTime(entry);
    const key = time === null ? "unknown" : String(startOfDay(time));
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, label: time === null ? t("logs.unknownDate") : formatDay(time, locale), entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }

  return groups
    .map(
      (group) => `
        <section class="log-day">
          <header class="log-day__head">
            <h3>${escapeHtml(group.label)}</h3>
            <span>${escapeHtml(plural("logs.dayCount", group.entries.length))}</span>
          </header>
          <div class="log-day__entries">
            ${group.entries.map((entry) => entryMarkup(entry, locale)).join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function metricsMarkup(entries) {
  const now = Date.now();
  const metrics = [
    ["logs.metricTotal", entries.length, false],
    ["logs.metricToday", entries.filter((entry) => matchesPeriod(entry, "today", now)).length, false],
    ["logs.metricWeek", entries.filter((entry) => matchesPeriod(entry, "week", now)).length, false],
    ["logs.metricSystem", entries.filter((entry) => channelFor(entry) === "SYSTEM").length, false],
    ["logs.metricSecurity", entries.filter((entry) => channelFor(entry) === "SECURITY").length, true],
  ];
  return metrics
    .map(
      ([key, value, warnWhenSet]) => `
        <div class="project-metric${warnWhenSet && value > 0 ? " is-warn" : ""}">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(t(key))}</span>
        </div>
      `,
    )
    .join("");
}

function selectMarkup({ labelKey, name, options, keyPrefix }) {
  return `
    <label class="sort-field">
      <span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span>
      <select data-log-${name}>
        ${options.map((option) => `<option value="${escapeAttribute(option)}">${escapeHtml(t(`${keyPrefix}.${option}`))}</option>`).join("")}
      </select>
    </label>
  `;
}

/* ------------------------------------------------------- automation runs */

// What the automation service ran, read from its own history through the
// service (which checks logs.read in the database). Kept apart from the
// activity log on purpose: that one records what a person did ("Pedro
// published CASE 006"), this one what the engine did ("project.published
// SUCCESS in 843 ms"). Folding one into the other would make both harder to
// read and neither trustworthy as an audit trail.

const RUN_LIMIT = 100;
const RUN_STATUSES = ["SUCCESS", "FAILED", "RUNNING", "SKIPPED"];

function runStatusOptions() {
  return [
    `<option value="">${escapeHtml(t("automation.runs.allStatuses"))}</option>`,
    ...RUN_STATUSES.map((status) => `<option value="${status}">${escapeHtml(t(`automation.runStatus.${status}`))}</option>`),
  ].join("");
}

function runEventOptions(runs, selected) {
  const events = [...new Set(runs.map((run) => run.event).filter(Boolean))].sort();
  return [
    `<option value="">${escapeHtml(t("automation.runs.allEvents"))}</option>`,
    ...events.map((event) => `<option value="${escapeAttribute(event)}"${event === selected ? " selected" : ""}>${escapeHtml(eventLabel(event))}</option>`),
  ].join("");
}

function automationPanelMarkup() {
  return `
    <div class="automation-runs">
      <header class="automation-runs__head">
        <div>
          <span class="automation-runs__eyebrow" data-i18n="automation.runs.eyebrow">${escapeHtml(t("automation.runs.eyebrow"))}</span>
          <h3 data-i18n="automation.runs.title">${escapeHtml(t("automation.runs.title"))}</h3>
          <p data-i18n="automation.runs.intro">${escapeHtml(t("automation.runs.intro"))}</p>
        </div>
        <div class="heading-actions">
          <span data-runs-service>${serviceStatusMarkup(isAutomationApiAvailable() ? LOADING : NOT_CONFIGURED)}</span>
          <button class="button" type="button" data-runs-refresh data-i18n="automation.runs.refresh">${escapeHtml(t("automation.runs.refresh"))}</button>
        </div>
      </header>
      <div class="automation-filters">
        <label class="sort-field">
          <span data-i18n="automation.runs.filterStatus">${escapeHtml(t("automation.runs.filterStatus"))}</span>
          <select data-runs-status>${runStatusOptions()}</select>
        </label>
        <label class="sort-field">
          <span data-i18n="automation.runs.filterEvent">${escapeHtml(t("automation.runs.filterEvent"))}</span>
          <select data-runs-event>${runEventOptions([], "")}</select>
        </label>
        <p class="ops-count" data-runs-count></p>
      </div>
      <div data-runs-body aria-live="polite" aria-busy="true">
        <p class="empty-inline" data-i18n="automation.runs.loading">${escapeHtml(t("automation.runs.loading"))}</p>
      </div>
    </div>
  `;
}

function channelTabsMarkup(entries, active) {
  return CHANNELS.map((channel) => {
    const count = channel === "ALL" ? entries.length : entries.filter((entry) => channelFor(entry) === channel).length;
    const isActive = channel === active;
    return `
      <button type="button" class="log-channel log-channel--${channel.toLowerCase()}${isActive ? " is-active" : ""}" data-log-channel-filter="${escapeAttribute(channel)}" aria-pressed="${isActive}">
        <span>${escapeHtml(t(`logs.channels.${channel}`))}</span>
        <b>${escapeHtml(count)}</b>
      </button>
    `;
  }).join("");
}

// Mounted beside the activity timeline and resolved on its own: the
// activity log renders whether or not the automation service answers, and the
// service is only asked once its tab is opened.
function mountAutomationRuns({ openNow = false } = {}) {
  const tabs = document.querySelector("[data-logs-tabs]");
  const panel = document.querySelector("[data-logs-automation]");
  if (!tabs || !panel) return;

  const heading = document.querySelector(".page-heading .heading-actions");
  const body = panel.querySelector("[data-runs-body]");
  const count = panel.querySelector("[data-runs-count]");
  const statusFilter = panel.querySelector("[data-runs-status]");
  const eventFilter = panel.querySelector("[data-runs-event]");
  const refresh = panel.querySelector("[data-runs-refresh]");
  const service = panel.querySelector("[data-runs-service]");

  let state = { status: isAutomationApiAvailable() ? LOADING : NOT_CONFIGURED, data: null, error: null };
  let loaded = false;

  const runs = () => (Array.isArray(state.data?.runs) ? state.data.runs : []);

  function paint() {
    if (!body.isConnected) return;
    service.innerHTML = serviceStatusMarkup(state.status);
    refresh.disabled = state.status === LOADING || state.status === NOT_CONFIGURED;
    body.setAttribute("aria-busy", String(state.status === LOADING));

    const all = runs();
    eventFilter.innerHTML = runEventOptions(all, eventFilter.value);
    const visible = all.filter((run) => (!statusFilter.value || run.status === statusFilter.value) && (!eventFilter.value || run.event === eventFilter.value));
    count.textContent = state.status === SUCCESS ? plural("automation.runs.count", visible.length) : "";

    if (state.status === LOADING) {
      body.innerHTML = `<p class="empty-inline">${escapeHtml(t("automation.runs.loading"))}</p>`;
    } else if (state.status !== SUCCESS) {
      body.innerHTML = serviceStateNote(state.status, "empty-inline");
    } else if (state.data?.storage_available === false) {
      // "Nothing has run" and "the history could not be read" look the same
      // in an empty list; the service says which one it is.
      body.innerHTML = `<p class="empty-inline log-timeline__error">${escapeHtml(t("automation.runs.storageUnavailable"))}</p>`;
    } else if (!all.length) {
      body.innerHTML = `<p class="empty-inline">${escapeHtml(t("automation.runs.empty"))}</p>`;
    } else if (!visible.length) {
      body.innerHTML = `<p class="empty-inline">${escapeHtml(t("automation.runs.noMatch"))}</p>`;
    } else {
      body.innerHTML = runTableMarkup(visible);
    }
  }

  async function load({ toast = false } = {}) {
    if (!isAutomationApiAvailable()) {
      state = { status: NOT_CONFIGURED, data: null, error: null };
      paint();
      return;
    }
    state = { ...state, status: LOADING };
    paint();
    try {
      state = { status: SUCCESS, data: await getAutomationRuns({ limit: RUN_LIMIT }), error: null };
      if (toast) showToast(t("automation.runs.refreshed"));
    } catch (error) {
      state = { status: stateForError(error), data: null, error };
    }
    loaded = true;
    paint();
  }

  async function retry(run) {
    try {
      const next = await retryAutomationRun(run.run_id);
      showToast(t("automation.detail.retryDone", { status: t(`automation.runStatus.${next.stale ? "STALE" : next.status}`) }));
      await load();
    } catch (error) {
      showToast(stateForError(error) === FORBIDDEN ? t("automation.forbiddenHint") : t("automation.detail.retryFailed"));
    }
  }

  body.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-run-open]");
    const run = trigger && runs().find((item) => item.run_id === trigger.dataset.runOpen);
    if (run) openRunDetail(run, { onRetry: retry, currentUserId: getCachedSession()?.user?.id ?? "" });
  });
  statusFilter.addEventListener("change", paint);
  eventFilter.addEventListener("change", paint);
  refresh.addEventListener("click", () => load({ toast: true }));

  // The page heading's refresh and export act on the activity log only.
  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    const automation = tab.dataset.tab === "automation";
    if (heading) heading.hidden = automation;
    if (automation && !loaded) load();
  });
  bindTabs(tabs.parentElement);

  onLocaleChange(body, () => {
    statusFilter.innerHTML = runStatusOptions().replace(`value="${statusFilter.value}"`, `value="${statusFilter.value}" selected`);
    paint();
  });

  paint();
  if (openNow) tabs.querySelector('[data-tab="automation"]')?.click();
}

export const logsPage = {
  title: () => t("logs.title"),
  breadcrumb: () => t("logs.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="logs.eyebrow">${t("logs.eyebrow")}</span>
        <h2 data-i18n="logs.heading">${t("logs.heading")}</h2>
        <p data-i18n="logs.intro">${t("logs.intro")}</p>
      </div>
      <div class="heading-actions">
        <button class="button" type="button" data-log-refresh data-i18n="logs.refresh">${t("logs.refresh")}</button>
        <button class="button button--primary" type="button" data-log-export data-requires="data.export" disabled data-i18n="logs.export">${t("logs.export")}</button>
      </div>
    </section>

    <div class="tabs logs-tabs" role="tablist" aria-label="${escapeAttribute(t("logs.heading"))}" data-logs-tabs>
      <button type="button" role="tab" id="logs-tab-activity" data-tab="activity" aria-selected="true" aria-controls="logs-panel-activity" tabindex="0" data-i18n="automation.runs.activityTab">${t("automation.runs.activityTab")}</button>
      <button type="button" role="tab" id="logs-tab-automation" data-tab="automation" aria-selected="false" aria-controls="logs-panel-automation" tabindex="-1" data-i18n="automation.runs.tab">${t("automation.runs.tab")}</button>
    </div>

    <section class="logs-tabpanel" id="logs-panel-automation" role="tabpanel" aria-labelledby="logs-tab-automation" hidden data-logs-automation>
      ${automationPanelMarkup()}
    </section>

    <section class="logs-tabpanel" id="logs-panel-activity" role="tabpanel" aria-labelledby="logs-tab-activity" data-logs-activity>
    <div class="metric-strip log-metrics" data-log-metrics aria-live="polite"></div>

    <div class="log-filters">
      <label class="search-field">
        <span data-i18n="logs.search">${t("logs.search")}</span>
        <input type="search" data-log-search placeholder="${escapeAttribute(t("logs.searchPlaceholder"))}">
      </label>
      ${selectMarkup({ labelKey: "logs.period", name: "period", options: PERIODS, keyPrefix: "logs.periods" })}
      ${selectMarkup({ labelKey: "logs.domain", name: "domain", options: DOMAINS, keyPrefix: "logs.domains" })}
    </div>

    <div class="log-channels" role="group" aria-label="${escapeAttribute(t("logs.filterByChannel"))}" data-i18n-aria-label="logs.filterByChannel" data-log-channels></div>

    <div class="log-status">
      <p class="ops-count" data-log-count></p>
      <button class="text-link log-status__clear" type="button" data-log-clear hidden data-i18n="logs.clearFilters">${t("logs.clearFilters")}</button>
    </div>

    <div class="log-timeline" data-log-table aria-live="polite" aria-busy="true">
      <p class="empty-inline" data-i18n="logs.loading">${t("logs.loading")}</p>
    </div>

    <div class="log-more">
      <button class="button" type="button" data-log-more hidden data-i18n="logs.loadMore">${t("logs.loadMore")}</button>
    </div>
    </section>
  `,
  afterRender: async (params = {}) => {
    mountAutomationRuns({ openNow: params.id === "automation" });

    const table = document.querySelector("[data-log-table]");
    const count = document.querySelector("[data-log-count]");
    const metricRoot = document.querySelector("[data-log-metrics]");
    const channelRoot = document.querySelector("[data-log-channels]");
    const search = document.querySelector("[data-log-search]");
    const period = document.querySelector("[data-log-period]");
    const domain = document.querySelector("[data-log-domain]");
    const refreshButton = document.querySelector("[data-log-refresh]");
    const exportButton = document.querySelector("[data-log-export]");
    const moreButton = document.querySelector("[data-log-more]");
    const clearButton = document.querySelector("[data-log-clear]");

    let activeChannel = "ALL";
    let entries = [];
    let visible = [];
    let limit = PAGE_SIZE;
    let loadFailed = false;

    const filtersActive = () =>
      activeChannel !== "ALL" || domain.value !== "All" || period.value !== "all" || search.value.trim() !== "";

    function render() {
      const locale = document.documentElement.lang || undefined;
      const query = search.value.trim().toLowerCase();
      const now = Date.now();
      // Channel counts reflect the other filters, so each tab says how many
      // rows it would show.
      const scoped = entries.filter(
        (entry) => matchesDomain(entry, domain.value) && matchesPeriod(entry, period.value, now) && matchesQuery(entry, query, [actionLabel(entry)]),
      );
      visible = scoped.filter((entry) => activeChannel === "ALL" || channelFor(entry) === activeChannel);

      metricRoot.innerHTML = metricsMarkup(entries);
      channelRoot.innerHTML = channelTabsMarkup(scoped, activeChannel);

      if (loadFailed) {
        table.innerHTML = `<p class="empty-inline log-timeline__error">${escapeHtml(t("logs.loadError"))}</p>`;
      } else if (!entries.length) {
        table.innerHTML = `<p class="empty-inline">${escapeHtml(t("logs.empty"))}</p>`;
      } else if (!visible.length) {
        table.innerHTML = `<p class="empty-inline">${escapeHtml(t("logs.noEvents"))}</p>`;
      } else {
        table.innerHTML = timelineMarkup(visible, locale);
      }

      count.textContent = plural("logs.countLabel", entries.length, { visible: visible.length, total: entries.length });
      clearButton.hidden = !filtersActive();
      exportButton.disabled = !visible.length;
    }

    async function load() {
      table.setAttribute("aria-busy", "true");
      refreshButton.disabled = true;
      const { items, ok } = await getActivityWithStatus({ limit });
      if (!table.isConnected) return;
      loadFailed = !ok;
      entries = sortByNewest(items);
      // A full page means the log may hold more rows than were asked for.
      moreButton.hidden = !ok || items.length < limit;
      refreshButton.disabled = false;
      table.removeAttribute("aria-busy");
      render();
    }

    channelRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-log-channel-filter]");
      if (!button) return;
      activeChannel = button.dataset.logChannelFilter;
      render();
    });

    search.addEventListener("input", render);
    period.addEventListener("change", render);
    domain.addEventListener("change", render);

    clearButton.addEventListener("click", () => {
      activeChannel = "ALL";
      search.value = "";
      period.value = "all";
      domain.value = "All";
      render();
      search.focus();
    });

    refreshButton.addEventListener("click", async () => {
      await load();
      showToast(t("logs.refreshed"));
    });

    moreButton.addEventListener("click", async () => {
      limit += PAGE_SIZE;
      moreButton.disabled = true;
      await load();
      moreButton.disabled = false;
    });

    exportButton.addEventListener("click", () => {
      if (!visible.length) return;
      downloadCsv(`space-underground-logs-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(visible));
      showToast(plural("logs.exported", visible.length));
    });

    // Re-renders from the rows already in memory. Switching locale never asks
    // the activity log for data again, and the active filters are preserved.
    onLocaleChange(table, () => {
      [...period.options].forEach((option) => {
        option.textContent = t(`logs.periods.${option.value}`);
      });
      [...domain.options].forEach((option) => {
        option.textContent = t(`logs.domains.${option.value}`);
      });
      search.placeholder = t("logs.searchPlaceholder");
      render();
    });

    await load();
  },
};

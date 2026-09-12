import { getActivity } from "../services/activity-service.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { escapeHtml } from "../utils/html.js";

// Channel and domain values are the filter identity and stay in English; only
// their labels are localized, through logs.channels.* / logs.domains.*.
const CHANNELS = ["ALL", "ACTIVITY", "SYSTEM", "SECURITY"];
const DOMAINS = ["All", "Projects", "Media", "Publishing", "Content", "Plans", "Settings"];

const SECURITY_HINTS = ["auth", "login", "logout", "session", "permission", "denied", "security"];
const SYSTEM_HINTS = ["storage", "settings", "system", "migration", "upload", "failed", "error"];

function formatTime(iso, locale) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(date);
}

function signature(entry) {
  return `${entry.action || ""} ${entry.entityType || ""}`.toLowerCase();
}

// Domain = what the event touched. Kept from the Activity screen so existing
// activity_log rows keep grouping exactly as they did.
function domainFor(entry) {
  const value = signature(entry);
  if (value.includes("project") || value.includes("publish")) return "Projects";
  if (value.includes("media")) return "Media";
  if (value.includes("plan")) return "Plans";
  if (value.includes("content")) return "Content";
  if (value.includes("settings")) return "Settings";
  return "All";
}

// Channel = why an operator would be reading the log. Security and system
// events are the ones you go looking for after something breaks.
function channelFor(entry) {
  const value = signature(entry);
  if (SECURITY_HINTS.some((hint) => value.includes(hint))) return "SECURITY";
  if (SYSTEM_HINTS.some((hint) => value.includes(hint))) return "SYSTEM";
  return "ACTIVITY";
}

function matchesDomain(entry, domain) {
  if (domain === "All") return true;
  if (domain === "Publishing") return String(entry.action || "").includes("publish");
  return domainFor(entry) === domain;
}

function channelLabel(channel) {
  return t(`logs.channels.${channel}`);
}

// Log titles and details are written by the system as it records events, so
// they are shown exactly as stored.
function row(entry, locale) {
  const channel = channelFor(entry);
  return `
    <div class="activity-row" data-log-channel="${escapeHtml(channel)}">
      <span>${escapeHtml(formatTime(entry.time, locale))}</span>
      <strong>${escapeHtml(entry.title)}</strong>
      <p>${escapeHtml(entry.detail || entry.action || t("logs.noDetail"))}</p>
      <small>${escapeHtml(channelLabel(channel))}${entry.entityType ? ` · ${escapeHtml(entry.entityType)}` : ""}</small>
    </div>
  `;
}

function filterGroup({ labelKey, name, options, activeOption, ariaKey, optionKeyPrefix }) {
  return `
    <div class="ops-filters__group">
      <span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span>
      <div class="segmented" role="group" aria-label="${escapeHtml(t(ariaKey))}" data-i18n-aria-label="${ariaKey}">
        ${options
          .map(
            (option) => `
              <button type="button" class="${option === activeOption ? "is-active" : ""}" data-log-${name}="${escapeHtml(option)}" aria-pressed="${option === activeOption}" data-i18n="${optionKeyPrefix}.${option}">${escapeHtml(t(`${optionKeyPrefix}.${option}`))}</button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

export const logsPage = {
  title: () => t("logs.title"),
  breadcrumb: () => t("logs.breadcrumb"),
  render: () => `
    <section class="page-heading">
      <span data-i18n="logs.eyebrow">${t("logs.eyebrow")}</span>
      <h2 data-i18n="logs.heading">${t("logs.heading")}</h2>
      <p data-i18n="logs.intro">${t("logs.intro")}</p>
    </section>

    <section class="panel">
      <div class="ops-filters">
        ${filterGroup({
          labelKey: "logs.channel",
          name: "channel-filter",
          options: CHANNELS,
          activeOption: "ALL",
          ariaKey: "logs.filterByChannel",
          optionKeyPrefix: "logs.channels",
        })}
        ${filterGroup({
          labelKey: "logs.domain",
          name: "domain-filter",
          options: DOMAINS,
          activeOption: "All",
          ariaKey: "logs.filterByDomain",
          optionKeyPrefix: "logs.domains",
        })}
      </div>

      <p class="ops-count" data-log-count></p>

      <div class="activity-table" data-log-table aria-live="polite" aria-busy="true">
        <p class="empty-inline" data-i18n="logs.loading">${t("logs.loading")}</p>
      </div>
    </section>
  `,
  afterRender: async () => {
    const table = document.querySelector("[data-log-table]");
    const count = document.querySelector("[data-log-count]");
    const channelButtons = [...document.querySelectorAll("[data-log-channel-filter]")];
    const domainButtons = [...document.querySelectorAll("[data-log-domain-filter]")];
    let activeChannel = "ALL";
    let activeDomain = "All";
    let entries = [];

    function render() {
      const locale = document.documentElement.lang || undefined;
      const visible = entries.filter(
        (entry) =>
          (activeChannel === "ALL" || channelFor(entry) === activeChannel) && matchesDomain(entry, activeDomain),
      );

      table.innerHTML = visible.length
        ? visible.map((entry) => row(entry, locale)).join("")
        : `<p class="empty-inline" data-i18n="logs.noEvents">${t("logs.noEvents")}</p>`;
      count.textContent = plural("logs.countLabel", entries.length, {
        visible: visible.length,
        total: entries.length,
      });
    }

    function bindGroup(buttons, onSelect) {
      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          buttons.forEach((item) => {
            const isActive = item === button;
            item.classList.toggle("is-active", isActive);
            item.setAttribute("aria-pressed", String(isActive));
          });
          onSelect(button);
          render();
        });
      });
    }

    bindGroup(channelButtons, (button) => {
      activeChannel = button.dataset.logChannelFilter;
    });
    bindGroup(domainButtons, (button) => {
      activeDomain = button.dataset.logDomainFilter;
    });

    // Re-renders from the rows already in memory. Switching locale never asks
    // the activity log for data again, and the active filters are preserved.
    onLocaleChange(table, () => {
      if (entries.length) render();
    });

    try {
      entries = await getActivity({ limit: 60 });
      if (!table.isConnected) return;
      render();
    } finally {
      table?.removeAttribute("aria-busy");
    }
  },
};

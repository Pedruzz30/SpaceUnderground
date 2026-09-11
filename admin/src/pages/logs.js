import { getActivity } from "../services/activity-service.js";
import { escapeHtml } from "../utils/html.js";

const CHANNELS = ["ALL", "ACTIVITY", "SYSTEM", "SECURITY"];
const DOMAINS = ["All", "Projects", "Media", "Publishing", "Content", "Plans", "Settings"];

const SECURITY_HINTS = ["auth", "login", "logout", "session", "permission", "denied", "security"];
const SYSTEM_HINTS = ["storage", "settings", "system", "migration", "upload", "failed", "error"];

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" });
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

function row(entry) {
  const channel = channelFor(entry);
  return `
    <div class="activity-row" data-log-channel="${escapeHtml(channel)}">
      <span>${escapeHtml(formatTime(entry.time))}</span>
      <strong>${escapeHtml(entry.title)}</strong>
      <p>${escapeHtml(entry.detail || entry.action || "No detail.")}</p>
      <small>${escapeHtml(channel)}${entry.entityType ? ` · ${escapeHtml(entry.entityType)}` : ""}</small>
    </div>
  `;
}

function filterGroup(label, name, options, activeOption) {
  return `
    <div class="ops-filters__group">
      <span>${escapeHtml(label)}</span>
      <div class="segmented" role="group" aria-label="Filter logs by ${escapeHtml(label.toLowerCase())}">
        ${options
          .map(
            (option) => `
              <button type="button" class="${option === activeOption ? "is-active" : ""}" data-log-${name}="${escapeHtml(option)}" aria-pressed="${option === activeOption}">${escapeHtml(option)}</button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

export const logsPage = {
  title: "Logs",
  breadcrumb: "SYSTEM / LOGS",
  render: () => `
    <section class="page-heading">
      <span>LOGS</span>
      <h2>Administrative log.</h2>
      <p>Trace administrative, system and security events.</p>
    </section>

    <section class="panel">
      <div class="ops-filters">
        ${filterGroup("Channel", "channel-filter", CHANNELS, "ALL")}
        ${filterGroup("Domain", "domain-filter", DOMAINS, "All")}
      </div>

      <p class="ops-count" data-log-count></p>

      <div class="activity-table" data-log-table aria-live="polite" aria-busy="true">
        <p class="empty-inline">Loading log...</p>
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
      const visible = entries.filter(
        (entry) =>
          (activeChannel === "ALL" || channelFor(entry) === activeChannel) && matchesDomain(entry, activeDomain),
      );

      table.innerHTML = visible.length
        ? visible.map(row).join("")
        : '<p class="empty-inline">No events for this filter.</p>';
      count.textContent = `${visible.length} of ${entries.length} events`;
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

    try {
      entries = await getActivity({ limit: 60 });
      if (!table.isConnected) return;
      render();
    } finally {
      table?.removeAttribute("aria-busy");
    }
  },
};

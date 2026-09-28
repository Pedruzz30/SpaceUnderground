// Pure rules behind the Logs screen: how an activity_log row is classified,
// filtered, linked and exported. No DOM and no i18n, so they are unit tested.

import { csvCell, csvText } from "./csv.js";

export { csvCell };

// Channel and domain values are the filter identity and stay in English; the
// page localizes their labels.
export const CHANNELS = ["ALL", "ACTIVITY", "SYSTEM", "SECURITY"];
export const DOMAINS = ["All", "Projects", "Clients", "Commercial", "Financial", "Plans", "Media", "Publishing", "Content", "Settings"];
export const PERIODS = ["all", "today", "week", "month"];

const SECURITY_HINTS = ["auth", "login", "logout", "session", "permission", "denied", "security"];
const SYSTEM_HINTS = ["storage", "settings", "system", "migration", "upload", "failed", "error"];

export const DAY = 24 * 60 * 60 * 1000;

function signature(entry) {
  return `${entry.action || ""} ${entry.entityType || ""}`.toLowerCase();
}

// Domain = what the event touched. Kept from the Activity screen so existing
// rows keep grouping exactly as they did. Financial and clients are checked
// first: their details and action codes also mention clients and projects
// (client.project_linked).
export function domainFor(entry) {
  const value = signature(entry);
  if (value.includes("financial")) return "Financial";
  if (value.includes("commercial") || value.includes("opportunity")) return "Commercial";
  if (value.includes("client")) return "Clients";
  if (value.includes("project") || value.includes("publish")) return "Projects";
  if (value.includes("media")) return "Media";
  if (value.includes("plan")) return "Plans";
  if (value.includes("content")) return "Content";
  if (value.includes("settings")) return "Settings";
  return "All";
}

// Channel = why an operator would be reading the log. Security and system
// events are the ones you go looking for after something breaks.
export function channelFor(entry) {
  const value = signature(entry);
  if (SECURITY_HINTS.some((hint) => value.includes(hint))) return "SECURITY";
  if (SYSTEM_HINTS.some((hint) => value.includes(hint))) return "SYSTEM";
  return "ACTIVITY";
}

export function matchesDomain(entry, domain) {
  if (domain === "All") return true;
  if (domain === "Publishing") return String(entry.action || "").includes("publish");
  return domainFor(entry) === domain;
}

export function entryTime(entry) {
  const time = new Date(entry?.time ?? NaN).getTime();
  return Number.isNaN(time) ? null : time;
}

export function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function matchesPeriod(entry, period, now = Date.now()) {
  if (period === "all") return true;
  const time = entryTime(entry);
  if (time === null) return false;
  if (period === "today") return time >= startOfDay(now);
  if (period === "week") return time >= now - 7 * DAY;
  if (period === "month") return time >= now - 30 * DAY;
  return true;
}

// `extra` carries text the page derives, such as the localized action label,
// so a search in either language finds the row.
export function matchesQuery(entry, query, extra = []) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [entry.title, entry.detail, entry.action, entry.entityType, entry.entityId, ...extra]
    .some((value) => String(value || "").toLowerCase().includes(needle));
}

// i18n key for an action code: "client.project_linked" -> logs.actions.client_project_linked.
export function actionKey(action) {
  return `logs.actions.${String(action || "").replaceAll(".", "_")}`;
}

// Where the event can be opened. Deleted records have nowhere to go.
export function entityHref(entry) {
  const id = String(entry.entityId || "").trim();
  if (String(entry.action || "").endsWith(".deleted")) return "";
  switch (entry.entityType) {
    case "project":
    case "media":
      return id ? `#/projects/${encodeURIComponent(id)}` : "";
    case "client":
      return id ? `#/clients/${encodeURIComponent(id)}` : "";
    case "plan":
      return id ? `#/services/${encodeURIComponent(id)}` : "";
    case "site_content":
      return "#/content";
    case "settings":
      return "#/settings";
    case "financial":
      return "#/financial";
    case "opportunity":
      return "#/commercial";
    default:
      return "";
  }
}

// Newest first; rows with no readable time sink to the end.
export function sortByNewest(entries) {
  return [...entries].sort((a, b) => (entryTime(b) ?? -Infinity) - (entryTime(a) ?? -Infinity));
}

export const CSV_HEADER = ["time", "channel", "domain", "action", "title", "detail", "entity_type", "entity_id", "admin_user_id"];

export function toCsv(entries) {
  const rows = entries.map((entry) =>
    [
      entry.time,
      channelFor(entry),
      domainFor(entry),
      entry.action,
      entry.title,
      entry.detail,
      entry.entityType,
      entry.entityId,
      entry.adminUserId,
    ].map(csvCell),
  );
  return csvText(CSV_HEADER, rows);
}

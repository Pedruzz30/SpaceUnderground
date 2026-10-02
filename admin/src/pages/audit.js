import { onLocaleChange, t } from "../i18n/index.js";
import { hasPermission } from "../security/access.js";
import { roleLabelKey } from "../security/catalog.js";
import { resolveMembers } from "../services/access-service.js";
import { listAuditEntries } from "../services/audit-service.js";
import { describeError } from "../services/errors.js";
import { formatFullDate } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

// The security audit trail. The database writes every line (sign-ins, MFA,
// invitations, access changes, lifecycle, approvals, publications); no
// application role can edit or delete one, and this page only reads. Members
// see the events they took part in; audit.read_all sees everything.

export const AUDIT_ACTIONS = [
  "LOGIN_SUCCESS",
  "MFA_ENROLLED",
  "MFA_REMOVED",
  "USER_INVITED",
  "INVITATION_CANCELLED",
  "INVITATION_FAILED",
  "USER_ACTIVATED",
  "USER_SUSPENDED",
  "USER_REACTIVATED",
  "USER_EXPIRED",
  "USER_OFFBOARDED",
  "ROLE_ASSIGNED",
  "ROLE_REMOVED",
  "PROJECT_ACCESS_GRANTED",
  "PROJECT_ACCESS_CHANGED",
  "PROJECT_ACCESS_REVOKED",
  "ACCESS_UPDATED",
  "PERMISSION_CHANGED",
  "SESSION_REVOKED",
  "SECURITY_SETTING_CHANGED",
  "BOOTSTRAP_GRANT",
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_PUBLISHED",
  "PROJECT_UNPUBLISHED",
  "PROJECT_ARCHIVED",
  "PROJECT_DELETED",
  "APPROVAL_DRAFTED",
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "APPROVAL_CANCELLED",
  "APPROVAL_EXPIRED",
  "APPROVAL_REBASED",
];

const TONE = {
  USER_SUSPENDED: "danger",
  USER_OFFBOARDED: "danger",
  SESSION_REVOKED: "warning",
  PERMISSION_CHANGED: "warning",
  SECURITY_SETTING_CHANGED: "warning",
  BOOTSTRAP_GRANT: "warning",
  APPROVAL_REJECTED: "warning",
  APPROVAL_APPROVED: "success",
  PROJECT_PUBLISHED: "success",
  MFA_REMOVED: "warning",
};

const actionLabel = (action) => t(`security.auditActions.${action}`);

function who(id, people) {
  if (!id) return t("security.audit.system");
  const person = people.get(id);
  return person ? `${person.displayName} · ${person.ru}` : `${String(id).slice(0, 8)}…`;
}

// A short, readable summary of the metadata the database kept. Only known,
// harmless keys are shown; the database already dropped anything secret.
function detail(entry) {
  const meta = entry.metadata ?? {};
  const parts = [];
  if (meta.role) parts.push(t(roleLabelKey(meta.role)));
  if (Array.isArray(meta.roles)) parts.push(meta.roles.map((role) => t(roleLabelKey(role))).join(", "));
  if (meta.permission) parts.push(meta.permission);
  if (meta.number) parts.push(`#${meta.number}`);
  if (meta.reason) parts.push(`“${meta.reason}”`);
  if (meta.access_level) parts.push(t(`security.projectLevel.${String(meta.access_level).toLowerCase()}`));
  if (Array.isArray(meta.fields) && meta.fields.length) parts.push(meta.fields.join(", "));
  if (meta.cause) parts.push(t(`security.audit.cause.${meta.cause}`));
  return parts.join(" · ");
}

export function auditLine(entry, people = new Map()) {
  const tone = TONE[entry.action] ?? "neutral";
  const summary = detail(entry);
  return `
    <li class="audit-line" data-audit-line data-audit-action="${escapeAttribute(entry.action)}">
      <time datetime="${escapeAttribute(entry.createdAt)}">${escapeHtml(formatFullDate(entry.createdAt))} ${escapeHtml(new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time>
      <span class="badge badge--${tone}">${escapeHtml(actionLabel(entry.action))}</span>
      <span class="audit-line__who">${escapeHtml(who(entry.actorUserId, people))}${entry.targetUserId && entry.targetUserId !== entry.actorUserId ? ` → ${escapeHtml(who(entry.targetUserId, people))}` : ""}</span>
      ${summary ? `<small>${escapeHtml(summary)}</small>` : ""}
      ${entry.aal ? `<small class="audit-line__aal">${escapeHtml(entry.aal.toUpperCase())}</small>` : ""}
    </li>
  `;
}

export const auditPage = {
  title: () => t("security.audit.title"),
  breadcrumb: () => t("security.audit.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="security.audit.eyebrow">${escapeHtml(t("security.audit.eyebrow"))}</span>
        <h2 data-i18n="security.audit.heading">${escapeHtml(t("security.audit.heading"))}</h2>
        <p>${escapeHtml(t(hasPermission("audit.read_all") ? "security.audit.introAll" : "security.audit.introOwn"))}</p>
      </div>
    </section>
    <div class="clients-toolbar">
      <label class="sort-field">
        <span data-i18n="security.audit.filterAction">${escapeHtml(t("security.audit.filterAction"))}</span>
        <select data-audit-action>
          <option value="">${escapeHtml(t("common.all"))}</option>
          ${AUDIT_ACTIONS.map((action) => `<option value="${action}">${escapeHtml(actionLabel(action))}</option>`).join("")}
        </select>
      </label>
    </div>
    <ol class="audit-list" data-audit-list aria-live="polite" aria-busy="true"><li class="empty-inline">${escapeHtml(t("common.loading"))}</li></ol>
    <div class="audit-more"><button class="button" type="button" data-audit-more hidden data-i18n="security.audit.more">${escapeHtml(t("security.audit.more"))}</button></div>
  `,
  afterRender: async () => {
    const list = document.querySelector("[data-audit-list]");
    const filter = document.querySelector("[data-audit-action]");
    const more = document.querySelector("[data-audit-more]");
    const PAGE = 100;
    let entries = [];
    let people = new Map();

    const paint = () => {
      list.removeAttribute("aria-busy");
      list.innerHTML = entries.length ? entries.map((entry) => auditLine(entry, people)).join("") : `<li class="empty-inline">${escapeHtml(t("security.audit.empty"))}</li>`;
    };

    const load = async ({ append = false } = {}) => {
      try {
        const page = await listAuditEntries({ action: filter.value || null, before: append ? entries.at(-1)?.id ?? null : null, limit: PAGE });
        entries = append ? [...entries, ...page] : page;
        people = await resolveMembers(entries.flatMap((entry) => [entry.actorUserId, entry.targetUserId]));
        more.hidden = page.length < PAGE;
        paint();
      } catch (error) {
        list.removeAttribute("aria-busy");
        list.innerHTML = `<li class="empty-inline">${escapeHtml(describeError(error, t("security.audit.loadError")))}</li>`;
      }
    };

    filter.addEventListener("change", () => load());
    more.addEventListener("click", () => load({ append: true }));
    onLocaleChange(list, paint);
    await load();
  },
};

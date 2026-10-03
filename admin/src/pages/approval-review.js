import { confirmModal } from "../components/modal.js";
import { promptReason } from "../components/reason-dialog.js";
import { withStepUp } from "../components/step-up.js";
import { showToast } from "../components/toast.js";
import { onLocaleChange, statusLabel, t } from "../i18n/index.js";
import { getAccess, hasPermission } from "../security/access.js";
import { resolveMembers } from "../services/access-service.js";
import { approveRequest, cancelRequest, getRequest, invalidatePendingCount, rebaseRequest, rejectRequest, submitRequest } from "../services/approval-service.js";
import { dispatchAfterCommit } from "../services/automation-events.js";
import { describeError } from "../services/errors.js";
import { getProjectById } from "../services/project-service.js";
import { resolveImageUrl } from "../services/storage-service.js";
import { changedCount, diffProposal, displayValue, projectColumns } from "../utils/change-diff.js";
import { formatFullDate, formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { actionLabel, requestStatusBadge, riskBadge } from "./approvals.js";

// One change request, field by field. The reviewer sees exactly what would
// change (before and after, images side by side) and decides; the database
// applies an approval atomically, refuses a self-approval, and turns a stale
// base version into a conflict instead of overwriting newer work.

const fieldLabel = (column) => t(`security.fields.${column}`);

// Stored enums (category, status, publication) read as their labels.
const LABELLED = new Set(["category", "status", "editorial_status"]);
const valueText = (column, value) => (LABELLED.has(column) && value ? statusLabel(value) : displayValue(value));

function diffRows(diff, urls) {
  return diff
    .map((entry) => {
      const before = entry.kind === "asset" ? assetCell(urls.get(entry.before), entry.before) : `<pre>${escapeHtml(valueText(entry.column, entry.before))}</pre>`;
      const after = entry.kind === "asset" ? assetCell(urls.get(entry.after), entry.after) : `<pre>${escapeHtml(valueText(entry.column, entry.after))}</pre>`;
      return `
        <tr class="${entry.changed ? "is-changed" : "is-same"}" data-diff-field="${escapeAttribute(entry.column)}">
          <th scope="row">${escapeHtml(fieldLabel(entry.column))}${entry.changed ? "" : `<small>${escapeHtml(t("security.review.unchanged"))}</small>`}</th>
          <td class="diff-old">${before}</td>
          <td class="diff-new">${after}</td>
        </tr>
      `;
    })
    .join("");
}

function assetCell(url, value) {
  if (!value) return `<pre>—</pre>`;
  return url
    ? `<img class="diff-asset" src="${escapeAttribute(url)}" alt="${escapeAttribute(t("security.review.assetAlt"))}" loading="lazy">`
    : `<pre>${escapeHtml(displayValue(value))}</pre>`;
}

// For an applied request the record of what changed wins over today's values.
function effectiveDiff(request, current) {
  if (request.status === "APPROVED" && request.appliedChanges) {
    return Object.entries(request.appliedChanges).map(([column, change]) => ({
      column,
      kind: column === "poster_url" ? "asset" : "text",
      before: change.old,
      after: change.new,
      changed: true,
    }));
  }
  const diff = diffProposal(request.proposed, current);
  if (request.action === "project.publish") {
    diff.push({ column: "editorial_status", kind: "text", before: current.editorial_status, after: "PUBLISHED", changed: current.editorial_status !== "PUBLISHED" });
  }
  return diff;
}

function personLabel(id, people, me) {
  if (!id) return "—";
  if (id === me) return t("security.team.you");
  const person = people.get(id);
  return person ? `${person.displayName} · ${person.ru}` : "—";
}

function actionsMarkup(request, { me, conflict }) {
  const mine = request.requesterId === me;
  const buttons = [];
  if (!mine && request.status === "PENDING" && hasPermission("approvals.approve")) {
    buttons.push(
      `<button class="button button--primary" type="button" data-review-approve${conflict ? " disabled" : ""}>${escapeHtml(t(request.action === "project.publish" ? "security.review.approvePublish" : "security.review.approve"))}</button>`,
    );
  }
  if (!mine && request.status === "PENDING" && hasPermission("approvals.reject")) {
    buttons.push(`<button class="button button--danger" type="button" data-review-reject>${escapeHtml(t("security.review.reject"))}</button>`);
  }
  if (mine && request.status === "DRAFT") {
    buttons.push(`<button class="button button--primary" type="button" data-review-submit>${escapeHtml(t("security.draft.submit"))}</button>`);
  }
  if (mine && (request.status === "DRAFT" || request.status === "PENDING") && conflict) {
    buttons.push(`<button class="button" type="button" data-review-rebase>${escapeHtml(t("security.draft.rebase"))}</button>`);
  }
  if (mine && (request.status === "DRAFT" || request.status === "PENDING")) {
    buttons.push(`<button class="button" type="button" data-review-cancel>${escapeHtml(t("security.draft.cancel"))}</button>`);
  }
  return buttons.join("");
}

export const approvalReviewPage = {
  title: () => t("security.review.title"),
  breadcrumb: () => t("security.approvals.breadcrumb"),
  render: () => `
    <section class="page-heading" data-review-heading>
      <div>
        <a class="back-link" href="${hasPermission("approvals.read_all") ? "#/approvals" : "#/my-changes"}">${escapeHtml(t("security.review.back"))}</a>
        <p class="empty-inline">${escapeHtml(t("common.loading"))}</p>
      </div>
    </section>
    <div data-review-body></div>
  `,
  afterRender: async ({ id }) => {
    const heading = document.querySelector("[data-review-heading]");
    const body = document.querySelector("[data-review-body]");
    const requestId = decodeURIComponent(id ?? "");
    const me = getAccess()?.member?.userId ?? null;
    const back = hasPermission("approvals.read_all") ? "#/approvals" : "#/my-changes";
    let request = null;
    let project = null;
    let people = new Map();
    let urls = new Map();

    const paint = () => {
      const current = project ? projectColumns(project) : {};
      const currentVersion = project?.version ?? null;
      const conflict = ["DRAFT", "PENDING"].includes(request.status) && currentVersion !== null && request.baseVersion > 0 && currentVersion !== request.baseVersion;
      const diff = effectiveDiff(request, current);
      heading.innerHTML = `
        <div>
          <a class="back-link" href="${back}">${escapeHtml(t("security.review.back"))}</a>
          <span>${escapeHtml(t("security.approvals.requestNumber", { number: request.number }))}</span>
          <h2>${escapeHtml(project ? `${project.name} · CASE ${project.caseNumber}` : t("security.approvals.unknownProject"))}</h2>
          <p class="member-heading__badges">${requestStatusBadge(request.status)} ${riskBadge(request.riskLevel)} <span class="badge badge--neutral">${escapeHtml(actionLabel(request.action))}</span></p>
        </div>
      `;
      body.innerHTML = `
        <section class="panel settings-panel review-meta">
          <dl class="settings-facts">
            <div><dt>${escapeHtml(t("security.approvals.requester"))}</dt><dd>${escapeHtml(personLabel(request.requesterId, people, me))}</dd></div>
            <div><dt>${escapeHtml(t("security.review.submitted"))}</dt><dd>${escapeHtml(request.submittedAt ? `${formatFullDate(request.submittedAt)} · ${formatRelativeDay(request.submittedAt)}` : t("security.review.notSubmitted"))}</dd></div>
            <div><dt>${escapeHtml(t("security.review.changed"))}</dt><dd>${escapeHtml(String(changedCount(diff)))}</dd></div>
            <div><dt>${escapeHtml(t("security.review.version"))}</dt><dd>${escapeHtml(t("security.review.versionValue", { base: request.baseVersion, current: currentVersion ?? "—" }))}</dd></div>
            ${request.expiresAt && request.status === "PENDING" ? `<div><dt>${escapeHtml(t("security.review.expires"))}</dt><dd>${escapeHtml(formatFullDate(request.expiresAt))}</dd></div>` : ""}
            ${request.reviewerId ? `<div><dt>${escapeHtml(t("security.review.reviewer"))}</dt><dd>${escapeHtml(personLabel(request.reviewerId, people, me))} · ${escapeHtml(formatFullDate(request.reviewedAt))}</dd></div>` : ""}
          </dl>
          ${request.requestMessage ? `<blockquote class="review-message"><strong>${escapeHtml(t("security.review.requestMessage"))}</strong><p>${escapeHtml(request.requestMessage)}</p></blockquote>` : ""}
          ${request.reviewMessage ? `<blockquote class="review-message"><strong>${escapeHtml(t("security.review.reviewMessage"))}</strong><p>${escapeHtml(request.reviewMessage)}</p></blockquote>` : ""}
          ${conflict ? `<p class="review-conflict" role="alert">${escapeHtml(t(request.requesterId === me ? "security.review.conflictMine" : "security.review.conflict", { base: request.baseVersion, current: currentVersion }))}</p>` : ""}
        </section>
        <section class="panel settings-panel">
          <h3>${escapeHtml(t("security.review.diffTitle"))}</h3>
          <div class="diff-scroll">
            <table class="diff-table">
              <thead><tr><th scope="col">${escapeHtml(t("security.review.field"))}</th><th scope="col">${escapeHtml(t("security.review.before"))}</th><th scope="col">${escapeHtml(t("security.review.after"))}</th></tr></thead>
              <tbody>${diff.length ? diffRows(diff, urls) : `<tr><td colspan="3">${escapeHtml(t("security.review.noChanges"))}</td></tr>`}</tbody>
            </table>
          </div>
        </section>
        <div class="review-actions" data-review-actions>${actionsMarkup(request, { me, conflict })}</div>
      `;
    };

    const load = async () => {
      request = await getRequest(requestId);
      if (!request) {
        heading.innerHTML = `<div><a class="back-link" href="${back}">${escapeHtml(t("security.review.back"))}</a><h2>${escapeHtml(t("security.review.notFound"))}</h2></div>`;
        body.innerHTML = "";
        return false;
      }
      project = await getProjectById(request.resourceId).catch(() => null);
      people = await resolveMembers([request.requesterId, request.reviewerId]);
      const assets = [request.proposed?.poster_url, project?.poster, ...Object.values(request.appliedChanges ?? {}).flatMap((change) => [change?.old, change?.new])]
        .filter((value) => typeof value === "string" && value);
      urls = new Map(await Promise.all(assets.map(async (value) => [value, await resolveImageUrl(value)])));
      paint();
      return true;
    };

    const act = async (run, success) => {
      try {
        await run();
        invalidatePendingCount();
        if (success) showToast(success);
        await load();
      } catch (error) {
        showToast(describeError(error, t("security.review.actionError")));
        if (error?.code === "version_conflict") await load();
      }
    };

    body.addEventListener("click", async (event) => {
      if (event.target.closest("[data-review-approve]")) {
        const needsComment = ["HIGH", "CRITICAL"].includes(request.riskLevel);
        const comment = await promptReason({
          title: t("security.review.approveTitle", { number: request.number }),
          body: `<p>${escapeHtml(t(request.action === "project.publish" ? "security.review.approvePublishBody" : "security.review.approveBody"))}</p>`,
          label: t(needsComment ? "security.review.commentRequired" : "security.review.commentOptional"),
          confirmLabel: t(request.action === "project.publish" ? "security.review.approvePublish" : "security.review.approve"),
          danger: false,
          optional: !needsComment,
        });
        if (comment === null) return;
        await act(
          async () => {
            const outcome = await withStepUp(() => approveRequest(request.id, comment || null));
            // Applied by the database: the project is published now. The
            // publication check follows, keyed by the request, so approving
            // (or retrying) this request is one run however often it repeats.
            if (request.action === "project.publish") {
              void dispatchAfterCommit("project.published", {
                entityType: "project",
                entityId: request.resourceId,
                payload: { project_id: request.resourceId, change_request_id: request.id },
                operationId: `approval:${request.id}`,
              });
            }
            const statusChange = outcome?.changes?.status;
            if (statusChange?.old !== "Live" && statusChange?.new === "Live") {
              void dispatchAfterCommit("project.completed", {
                entityType: "project",
                entityId: request.resourceId,
                payload: { project_id: request.resourceId, change_request_id: request.id },
                operationId: `approval:${request.id}:completed`,
              });
            }
            return outcome;
          },
          t(request.action === "project.publish" ? "security.review.approvedPublished" : "security.review.approved"),
        );
      } else if (event.target.closest("[data-review-reject]")) {
        const reason = await promptReason({
          title: t("security.review.rejectTitle", { number: request.number }),
          label: t("security.review.rejectReason"),
          confirmLabel: t("security.review.reject"),
        });
        if (reason === null) return;
        await act(() => withStepUp(() => rejectRequest(request.id, reason)), t("security.review.rejected"));
      } else if (event.target.closest("[data-review-submit]")) {
        await act(() => submitRequest(request.id), t("security.draft.submitted"));
      } else if (event.target.closest("[data-review-rebase]")) {
        const ok = await confirmModal({
          title: t("security.draft.rebaseTitle"),
          body: `<p>${escapeHtml(t("security.draft.rebaseBody"))}</p>`,
          confirmLabel: t("security.draft.rebase"),
          danger: false,
        });
        if (ok) await act(() => rebaseRequest(request.id), t("security.draft.rebased"));
      } else if (event.target.closest("[data-review-cancel]")) {
        const ok = await confirmModal({
          title: t("security.draft.cancelTitle"),
          body: `<p>${escapeHtml(t("security.draft.cancelBody"))}</p>`,
          confirmLabel: t("security.draft.cancel"),
        });
        if (ok) await act(() => cancelRequest(request.id), t("security.draft.cancelled"));
      }
    });

    try {
      if (await load()) onLocaleChange(body, paint);
    } catch (error) {
      body.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("security.approvals.loadError")))}</p>`;
    }
  },
};

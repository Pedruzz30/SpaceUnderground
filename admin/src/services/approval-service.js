import { t } from "../i18n/index.js";
import { toDataError } from "./errors.js";
import { getApprovalRepository } from "./repositories/index.js";

// Drafts and their review. A draft never changes the live project; only an
// approval does, inside the database, against the version the draft started
// from.

async function call(method, fallbackKey, ...args) {
  try {
    return await (await getApprovalRepository())[method](...args);
  } catch (error) {
    throw toDataError(error, t(fallbackKey));
  }
}

export const listRequests = (filters) => call("list", "security.approvals.loadError", filters);
export const getRequest = (id) => call("get", "security.approvals.loadError", id);
export const openDraftFor = (resourceId, requesterId) => call("openFor", "security.approvals.loadError", resourceId, requesterId);
export const saveDraft = (resourceId, fields, options) => call("saveDraft", "security.draft.saveError", resourceId, fields, options);
export const submitRequest = (id, message) => call("submit", "security.draft.submitError", id, message);
export const cancelRequest = (id) => call("cancel", "security.draft.cancelError", id);
export const rebaseRequest = (id) => call("rebase", "security.draft.rebaseError", id);
export const approveRequest = (id, comment) => call("approve", "security.review.approveError", id, comment);
export const rejectRequest = (id, reason) => call("reject", "security.review.rejectError", id, reason);

// The sidebar badge: one head-only count, reused for a minute, so moving
// around the Admin never turns into polling.
const BADGE_TTL = 60_000;
let badge = { value: null, at: 0, pending: null };

export async function pendingApprovalCount({ force = false } = {}) {
  if (!force && badge.value !== null && Date.now() - badge.at < BADGE_TTL) return badge.value;
  if (badge.pending) return badge.pending;
  badge.pending = call("pendingCount", "security.approvals.loadError")
    .then((value) => {
      badge = { value, at: Date.now(), pending: null };
      return value;
    })
    .catch(() => {
      badge.pending = null;
      return null;
    });
  return badge.pending;
}

export function invalidatePendingCount() {
  badge = { value: null, at: 0, pending: null };
}

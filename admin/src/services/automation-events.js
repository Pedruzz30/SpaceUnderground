import { isSupabaseMode } from "../config/env.js";
import { dispatchAutomation, isAutomationApiAvailable, newOperationId } from "./automation-api.js";

// Business events, dispatched to the automation service *after* the change
// they describe is committed to Supabase:
//
//   updateProject() succeeds  ->  project.published / project.completed
//   approval applied          ->  project.published
//   winOpportunity() closes   ->  commercial.opportunity.won
//
// Never the other way round. The save is the Admin's and is already done; the
// automation is additional work that may be late, fail or be switched off,
// and none of that can undo or block what was saved. So this never throws.
//
// Mock mode dispatches nothing: the service reads the real database, and the
// record on screen lives in localStorage.

/**
 * Resolves to { run, error, skipped } and never rejects.
 *
 * `operationId` identifies the deliberate action (one click, one approval).
 * A network retry of the same dispatch reuses it, so the service records it
 * once; a later, deliberate action gets a new one.
 */
export async function dispatchAfterCommit(event, { entityType, entityId, payload = {}, operationId = newOperationId() } = {}) {
  const id = String(entityId ?? "").trim();
  if (!isAutomationApiAvailable() || !isSupabaseMode() || !id) return { run: null, error: null, skipped: true };

  try {
    const run = await dispatchAutomation(event, { entityType, entityId: id, operationId, payload });
    return { run, error: null, skipped: false };
  } catch (error) {
    return { run: null, error, skipped: false };
  }
}

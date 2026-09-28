// How the Admin should offer an action, from who is asking, the permission,
// the resource and the risk:
//
//   execute           allowed; LOW and MEDIUM run straight away
//   confirm           allowed; HIGH asks for confirmation first
//   step_up           allowed; CRITICAL needs a fresh MFA verification first
//   request_approval  not allowed, but can be sent for review
//   deny              neither
//
// The database makes the same decision again, and its answer wins: a step-up
// it asks for (SU005) is honoured even when this said "execute".

import { getAccess, getRiskLevel, hasPermission, hasProjectAccess, requiresApproval } from "./access.js";

export const OUTCOMES = ["execute", "confirm", "step_up", "request_approval", "deny"];

// A fresh MFA verification, read from the amr entries of the current session
// (Supabase Auth: [{ method, timestamp }]).
export function stepUpFresh(methods = [], maxAgeSeconds = 600, now = Date.now()) {
  return methods.some(
    (entry) => ["totp", "phone", "webauthn"].includes(entry?.method) && now / 1000 - Number(entry.timestamp) <= maxAgeSeconds,
  );
}

export function decide(permission, { projectId = null, access = getAccess(), methods = null, now = Date.now() } = {}) {
  const risk = getRiskLevel(permission);
  if (!risk || !access || access.blockedReason) return { outcome: "deny", risk };

  const projectScoped = projectId && permission.startsWith("projects.");
  const allowed = projectScoped
    ? hasPermission(permission, access) && hasProjectAccess(projectId, { write: permission !== "projects.read", access })
    : hasPermission(permission, access);

  if (allowed) {
    if (risk === "CRITICAL") {
      const fresh = methods ? stepUpFresh(methods, access.settings.stepUpMaxAgeSeconds, now) : access.mfa.stepUp;
      return { outcome: fresh ? "confirm" : "step_up", risk };
    }
    return { outcome: risk === "HIGH" ? "confirm" : "execute", risk };
  }
  if (requiresApproval(permission, { projectId, access })) return { outcome: "request_approval", risk };
  return { outcome: "deny", risk };
}

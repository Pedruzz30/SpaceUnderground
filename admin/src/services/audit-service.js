import { t } from "../i18n/index.js";
import { toDataError } from "./errors.js";
import { getAuditRepository } from "./repositories/index.js";

// The security audit log, read-only: the database writes every line itself.

export async function listAuditEntries(filters = {}) {
  try {
    return await (await getAuditRepository()).list(filters);
  } catch (error) {
    throw toDataError(error, t("security.audit.loadError"));
  }
}

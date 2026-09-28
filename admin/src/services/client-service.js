import { t } from "../i18n/index.js";
import { CLIENT_STATUSES, isClientStatus, isValidEmail, normalizeClientStatus } from "../utils/client-health.js";
import { getActivity, logActivity } from "./activity-service.js";
import { DataError, toDataError } from "./errors.js";
import { normalizeClientCode, normalizeContactTimestamp } from "./mappers/client-mapper.js";
import { getClientRepository, getProjectRepository } from "./repositories/index.js";
import { CONTACT_CHANNELS, contactTimestampForDay } from "../utils/client-relationship.js";
import { todayKey } from "../utils/financial-metrics.js";

// Async contract used by the Client Hub and the Client Editor. Pages call these
// functions and never learn whether the data came from localStorage or
// Supabase. Every rule lives here once, so both repositories receive the same
// already-validated values.

// Unarchiving never claims an active relationship on the user's behalf.
const RESTORED_STATUS = "INACTIVE";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

const CLIENT_DEFAULTS = {
  code: "",
  name: "",
  company: "",
  email: "",
  phone: "",
  status: "LEAD",
  notes: "",
};

const EDITABLE_FIELDS = Object.keys(CLIENT_DEFAULTS);

// A contact date a little ahead of the server clock is still "now"; anything
// further is a typo, not a contact that already happened.
const CONTACT_CLOCK_SKEW_MS = 5 * 60 * 1000;

function clientMeta(action, client) {
  return { action, entityType: "client", entityId: client?.id ?? null };
}

function label(client) {
  return `${client.code} ${client.name}`.trim();
}

// Keeps only fields the editor may write, trimmed, with status and code in
// their stored casing. id, timestamps and archived_at never pass through.
// lastContactAt is set by a person: it is only ever what the caller sent,
// never inferred from the edit itself.
export function sanitizeClient(values = {}) {
  const clean = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (values[field] === undefined) return;
    clean[field] = String(values[field] ?? "").trim();
  });
  if (clean.status !== undefined) clean.status = normalizeClientStatus(clean.status);
  if (clean.code !== undefined) clean.code = normalizeClientCode(clean.code);
  if (values.lastContactAt !== undefined) clean.lastContactAt = normalizeContactTimestamp(values.lastContactAt);
  return clean;
}

// Field -> message. Used by the editor for inline errors and by the service
// itself, so a caller that skips the form still cannot store an invalid row.
export function validateClient(values = {}) {
  const errors = {};
  if (!String(values.name ?? "").trim()) errors.name = t("clients.validation.nameRequired");
  if (values.status !== undefined && !isClientStatus(values.status)) errors.status = t("clients.validation.statusValid");
  const email = String(values.email ?? "").trim();
  if (email && !isValidEmail(email)) errors.email = t("clients.validation.emailValid");
  const code = normalizeClientCode(values.code);
  if (code && !CODE_PATTERN.test(code)) errors.code = t("clients.validation.codeFormat");
  const contact = normalizeContactTimestamp(values.lastContactAt);
  if (contact !== null) {
    const time = new Date(contact).getTime();
    if (Number.isNaN(time)) errors.lastContactAt = t("clients.validation.lastContactValid");
    else if (time > Date.now() + CONTACT_CLOCK_SKEW_MS) errors.lastContactAt = t("clients.validation.lastContactFuture");
  }
  return errors;
}

function assertValid(values) {
  const errors = validateClient(values);
  const [field] = Object.keys(errors);
  if (field) throw new DataError(errors[field], { code: "validation", field });
}

export function newClientDefaults() {
  return { ...CLIENT_DEFAULTS };
}

export async function getClients() {
  try {
    return await (await getClientRepository()).list();
  } catch (error) {
    throw toDataError(error, t("errors.data.loadClients"));
  }
}

export async function getClient(id) {
  try {
    return await (await getClientRepository()).getById(id);
  } catch (error) {
    throw toDataError(error, t("errors.data.loadClient"));
  }
}

export async function createClient(data = {}) {
  try {
    const values = sanitizeClient({ ...CLIENT_DEFAULTS, ...data });
    assertValid(values);
    const created = await (await getClientRepository()).create(values);
    await logActivity("Client created", `${label(created)} created`, clientMeta("client.created", created));
    return created;
  } catch (error) {
    throw toDataError(error, t("errors.data.createClient"));
  }
}

// A status change made from the editor is logged as the lifecycle event it is,
// so the log reads "archived", not a generic "updated".
function lifecycleEvent(before, after) {
  if (before?.status !== "ARCHIVED" && after.status === "ARCHIVED") {
    return { action: "client.archived", title: "Client archived", verb: "archived" };
  }
  if (before?.status === "ARCHIVED" && after.status !== "ARCHIVED") {
    return { action: "client.unarchived", title: "Client unarchived", verb: "restored" };
  }
  return { action: "client.updated", title: "Client updated", verb: "updated" };
}

export async function updateClient(id, patch = {}) {
  try {
    const repository = await getClientRepository();
    const before = await repository.getById(id);
    if (!before) throw new DataError(t("errors.notFound"), { code: "not_found" });

    const values = sanitizeClient(patch);
    assertValid({ ...before, ...values });

    const updated = await repository.update(id, values);
    if (!updated) throw new DataError(t("errors.notFound"), { code: "not_found" });
    const event = lifecycleEvent(before, updated);
    await logActivity(event.title, `${label(updated)} ${event.verb}`, clientMeta(event.action, updated));
    return updated;
  } catch (error) {
    throw toDataError(error, t("errors.data.saveClient"));
  }
}

export async function archiveClient(id) {
  return updateClient(id, { status: "ARCHIVED" });
}

export async function unarchiveClient(id) {
  return updateClient(id, { status: RESTORED_STATUS });
}

/* -------------------------------------------------------------- projects */

// Read through the project repository: a client never keeps its own copy of
// project data.
export async function getClientProjects(clientId) {
  try {
    return await (await getProjectRepository()).listByClient(clientId);
  } catch (error) {
    throw toDataError(error, t("errors.data.loadProjects"));
  }
}

export async function linkProjectToClient(clientId, projectId) {
  try {
    const client = await getClient(clientId);
    if (!client) throw new DataError(t("errors.notFound"), { code: "not_found" });
    // Conditional in the repository: refused if the project already has a
    // client, even one assigned by another tab a moment ago.
    const project = await (await getProjectRepository()).assignClient(projectId, client.id);
    if (!project) throw new DataError(t("errors.notFound"), { code: "not_found" });
    await logActivity("Project linked to client", `CASE ${project.caseNumber} linked to ${label(client)}`, clientMeta("client.project_linked", client));
    return project;
  } catch (error) {
    throw toDataError(error, t("errors.data.linkProject"));
  }
}

export async function unlinkProjectFromClient(clientId, projectId) {
  try {
    const client = await getClient(clientId);
    if (!client) throw new DataError(t("errors.notFound"), { code: "not_found" });
    // Refused unless the project still belongs to this client.
    const project = await (await getProjectRepository()).releaseClient(projectId, client.id);
    if (!project) throw new DataError(t("errors.notFound"), { code: "not_found" });
    await logActivity("Project unlinked from client", `CASE ${project.caseNumber} unlinked from ${label(client)}`, clientMeta("client.project_unlinked", client));
    return project;
  } catch (error) {
    throw toDataError(error, t("errors.data.linkProject"));
  }
}

/* --------------------------------------------------------------- contact */

const MAX_CONTACT_NOTE = 1000;

// A real conversation with the client: it moves lastContactAt and leaves a
// line in the client's activity, which is the contact history. Editing the
// record never does this on its own.
export async function recordContact(clientId, { channel = "OTHER", note = "", day = null } = {}) {
  try {
    const repository = await getClientRepository();
    const client = await repository.getById(clientId);
    if (!client) throw new DataError(t("errors.notFound"), { code: "not_found" });

    const kind = String(channel).toUpperCase();
    if (!CONTACT_CHANNELS.includes(kind)) throw new DataError(t("clientEditor.contact.channelValid"), { code: "validation", field: "channel" });
    const text = String(note ?? "").trim();
    if (text.length > MAX_CONTACT_NOTE) throw new DataError(t("clientEditor.contact.noteTooLong", { max: MAX_CONTACT_NOTE }), { code: "validation", field: "note" });

    const chosen = day || todayKey();
    const at = contactTimestampForDay(chosen);
    if (!at) throw new DataError(t("clients.validation.lastContactValid"), { code: "validation", field: "day" });
    if (new Date(at).getTime() > Date.now() + CONTACT_CLOCK_SKEW_MS) {
      throw new DataError(t("clients.validation.lastContactFuture"), { code: "validation", field: "day" });
    }

    // Only moves forward: logging an older conversation keeps a newer date.
    const newest = client.lastContactAt && new Date(client.lastContactAt).getTime() > new Date(at).getTime() ? client.lastContactAt : at;
    const updated = newest === client.lastContactAt ? client : await repository.update(client.id, { lastContactAt: newest });
    if (!updated) throw new DataError(t("errors.notFound"), { code: "not_found" });

    const detail = `${kind}${text ? `: ${text}` : ""}`;
    await logActivity("Contact recorded", `${label(updated)} · ${detail}`, clientMeta("client.contacted", updated));
    return updated;
  } catch (error) {
    throw toDataError(error, t("clientEditor.contact.saveError"));
  }
}

/* -------------------------------------------------------------- activity */

// Informational, like the rest of the activity log: an outage reads as an
// empty history instead of breaking the editor.
export async function getClientActivity(clientId, { limit = 20 } = {}) {
  return getActivity({ entityType: "client", entityId: clientId, limit });
}

export { CLIENT_STATUSES };

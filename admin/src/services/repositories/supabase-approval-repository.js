import { getSupabaseClient } from "../../lib/supabase.js";
import { mapChangeRequest } from "../mappers/team-mapper.js";

// Change requests are read through RLS (your own, or everyone's submitted ones
// with approvals.read_all) and move only through the security functions:
// drafting, submitting, cancelling, re-basing, approving and rejecting all
// run in the database, which also applies an approved change.

async function rpc(name, args) {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw error;
  return data;
}

// A function returning a row comes back as an object (or a one-row list).
const single = (data) => mapChangeRequest(Array.isArray(data) ? data[0] : data);

export const supabaseApprovalRepository = {
  async list({ requesterId = null, statuses = null, limit = 200 } = {}) {
    let query = getSupabaseClient().from("change_requests").select("*");
    if (requesterId) query = query.eq("requester_id", requesterId);
    if (statuses?.length) query = query.in("status", statuses);
    const { data, error } = await query.order("updated_at", { ascending: false }).order("number", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map(mapChangeRequest);
  },

  async get(id) {
    const { data, error } = await getSupabaseClient().from("change_requests").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return mapChangeRequest(data);
  },

  // Head-only count: the sidebar badge never downloads the requests.
  async pendingCount() {
    const { count, error } = await getSupabaseClient().from("change_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING");
    if (error) throw error;
    return count ?? 0;
  },

  async openFor(resourceId, requesterId) {
    const { data, error } = await getSupabaseClient()
      .from("change_requests")
      .select("*")
      .eq("resource_id", resourceId)
      .eq("requester_id", requesterId)
      .in("status", ["DRAFT", "PENDING"])
      .limit(1);
    if (error) throw error;
    return mapChangeRequest(data?.[0] ?? null);
  },

  saveDraft: async (resourceId, fields, { publish = false, message = null } = {}) =>
    single(await rpc("save_project_draft", { p_project: resourceId, p_fields: fields, p_publish: publish, p_message: message })),
  submit: async (id, message = null) => single(await rpc("submit_change_request", { p_request: id, p_message: message })),
  cancel: async (id) => single(await rpc("cancel_change_request", { p_request: id })),
  rebase: async (id) => single(await rpc("rebase_change_request", { p_request: id })),
  approve: (id, comment = null) => rpc("approve_change_request", { p_request: id, p_comment: comment }),
  reject: async (id, reason) => single(await rpc("reject_change_request", { p_request: id, p_reason: reason })),
};

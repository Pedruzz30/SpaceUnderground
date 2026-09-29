import { getSupabaseClient } from "../../lib/supabase.js";
import { mapAuditEntry } from "../mappers/team-mapper.js";

// The security audit log, read-only. RLS shows your own events with
// audit.read and everything with audit.read_all; no application role can
// change a line.

// The member filter is written into a PostgREST expression, so only a real
// uuid gets there; RLS would still hold, but a crafted id must not even shape
// the query.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const supabaseAuditRepository = {
  async list({ action = null, userId = null, requestId = null, resourceId = null, before = null, limit = 100 } = {}) {
    let query = getSupabaseClient().from("security_audit_log").select("*");
    if (action) query = query.eq("action", action);
    if (userId) {
      if (!UUID.test(String(userId))) return [];
      query = query.or(`actor_user_id.eq.${userId},target_user_id.eq.${userId}`);
    }
    if (requestId) query = query.eq("request_id", requestId);
    if (resourceId) query = query.eq("resource_id", resourceId);
    if (before) query = query.lt("id", before);
    const { data, error } = await query.order("id", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map(mapAuditEntry);
  },
};

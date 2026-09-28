// The access matrix of an admin-only table, read the way PostgREST would run
// each request: every role tries every verb, and the answer is summarized as
//   "denied"  refused outright (no grant, or a row RLS rejects on insert)
//   "none"    allowed to ask, but no row is visible or touched
//   "ok"      the row is read or written
// so a test states the whole policy as one expected table.

import { ADMIN_ID, USER_ID, asRole } from "./supabase-db.mjs";

async function attempt(db, role, uid, sql, params) {
  try {
    const { rows } = await asRole(db, role, uid, () => db.query(sql, params));
    return rows.length ? "ok" : "none";
  } catch (error) {
    if (error.code === "42501") return "denied";
    throw error;
  }
}

const ROLES = [
  ["anon", "anon", null],
  ["nonAdmin", "authenticated", USER_ID],
  ["admin", "authenticated", ADMIN_ID],
];

// seed() inserts a row with no JWT context (like the SQL editor) and returns
// its id. insertSql inserts one row and returns it. The admin deletes the seed
// row last, so each run starts from a fresh one.
export async function policyMatrix(db, { table, seed, insertSql, insertParams = [], updateSet }) {
  const matrix = {};
  for (const [label, role, uid] of ROLES) {
    const id = await seed();
    matrix[label] = {
      select: await attempt(db, role, uid, `select id from public.${table} where id = $1`, [id]),
      insert: await attempt(db, role, uid, insertSql, insertParams),
      update: await attempt(db, role, uid, `update public.${table} set ${updateSet} where id = $1 returning id`, [id]),
      delete: await attempt(db, role, uid, `delete from public.${table} where id = $1 returning id`, [id]),
    };
  }
  return matrix;
}

export const ADMIN_ONLY = {
  anon: { select: "denied", insert: "denied", update: "denied", delete: "denied" },
  nonAdmin: { select: "none", insert: "denied", update: "none", delete: "none" },
  admin: { select: "ok", insert: "ok", update: "ok", delete: "ok" },
};

export async function tableGrants(db, table, grantee) {
  const { rows } = await db.query(
    "select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee = $2 order by privilege_type",
    [table, grantee],
  );
  return rows.map((row) => row.privilege_type);
}

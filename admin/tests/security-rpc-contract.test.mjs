// PostgREST calls a function by the names of its arguments, so an RPC whose
// argument names drift from the SQL signature fails only in production. This
// reads every rpc("name", { args }) the Admin and the team-invite Edge
// Function make and checks each against the functions the security migration
// defines, and that authenticated can actually execute them.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { readMigration } from "./helpers/migration-files.mjs";
import { createSecurityDb } from "./helpers/security-fixture.mjs";

const SQL = readMigration("security_rbac_approval_foundation");

// name -> { params: [...], defaults: count }
const SIGNATURES = new Map();
for (const match of SQL.matchAll(/create or replace function public\.([a-z_]+)\(([\s\S]*?)\)\s*returns/g)) {
  const params = match[2]
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ name: part.split(/\s+/)[0], optional: /\bdefault\b/i.test(part) }));
  SIGNATURES.set(match[1], params);
}

const SOURCES = [
  ...readdirSync(new URL("../src/services/repositories/", import.meta.url)).map((name) => new URL(`../src/services/repositories/${name}`, import.meta.url)),
  new URL("../../supabase/functions/team-invite/handler.js", import.meta.url),
];

// rpc("name") or rpc("name", { p_a: ..., p_b: ... }) — the object literal is
// read up to its closing brace at depth zero.
function rpcCalls(text) {
  const calls = [];
  for (const match of text.matchAll(/rpc\(\s*"([a-z_]+)"\s*(?:,\s*\{)?/g)) {
    const keys = [];
    if (match[0].endsWith("{")) {
      let depth = 1;
      let index = match.index + match[0].length;
      let body = "";
      while (depth && index < text.length) {
        const char = text[index++];
        if (char === "{" || char === "[" || char === "(") depth += 1;
        if (char === "}" || char === "]" || char === ")") depth -= 1;
        if (depth) body += depth === 1 ? char : " ";
      }
      for (const key of body.matchAll(/(?:^|,)\s*(p_[a-z_]+)\s*(?::|,|$)/g)) keys.push(key[1]);
    }
    calls.push({ name: match[1], keys });
  }
  return calls;
}

const CALLS = SOURCES.flatMap((url) => rpcCalls(readFileSync(url, "utf8")).map((call) => ({ ...call, file: url.pathname.split("/").pop() })));

let db;
before(async () => {
  db = await createSecurityDb();
});
after(async () => {
  await db?.close();
});

describe("RPC contract", () => {
  it("finds the calls to check", () => {
    assert.ok(CALLS.length >= 20, `only ${CALLS.length} rpc calls found`);
  });

  it("calls only functions the migration defines, with its argument names", () => {
    const problems = [];
    for (const call of CALLS) {
      const params = SIGNATURES.get(call.name);
      if (!params) {
        problems.push(`${call.file}: ${call.name} is not defined`);
        continue;
      }
      const names = params.map((param) => param.name);
      for (const key of call.keys) if (!names.includes(key)) problems.push(`${call.file}: ${call.name} has no argument ${key}`);
      for (const param of params) if (!param.optional && !call.keys.includes(param.name)) problems.push(`${call.file}: ${call.name} misses ${param.name}`);
    }
    assert.deepEqual(problems, []);
  });

  it("lets the right role execute each function the Admin calls", async () => {
    const serviceOnly = new Set(["complete_invitation", "fail_invitation"]);
    for (const name of new Set(CALLS.map((call) => call.name))) {
      const role = serviceOnly.has(name) ? "service_role" : "authenticated";
      const { rows } = await db.query(
        "select bool_or(has_function_privilege($2, p.oid, 'execute')) as ok from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1",
        [name, role],
      );
      assert.equal(rows[0].ok, true, `${role} cannot execute ${name}`);
    }
  });
});

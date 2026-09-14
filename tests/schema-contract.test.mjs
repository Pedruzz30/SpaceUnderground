import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// Guards the seam where this project has actually broken: the public site asks
// Supabase for a column that no migration creates. Unit tests, mock E2E and the
// build all pass in that state, and the failure only appears in production as
// PostgREST 42703 -- which takes the whole Selected Work section down, because
// one unknown column fails the entire select.
//
// The check is local and reads the two sources of truth as written: the column
// list the public query sends, and the migrations that are supposed to create
// those columns. It deliberately does not connect to a database, so it can run
// on every `npm test`.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const MIGRATIONS_DIR = join(root, "supabase", "migrations");
const PUBLIC_CLIENT = join(root, "src", "scripts", "supabase-public.js");

const publicSource = readFileSync(PUBLIC_CLIENT, "utf8");

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSql = migrationFiles
  .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
  .join("\n");

/** Column names in a `const NAME = [ "a", "b" ].join(",")` list. */
function selectedColumns(constantName) {
  const match = publicSource.match(new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\]`));
  assert.ok(match, `${constantName} not found in supabase-public.js`);

  return [...match[1].matchAll(/"([^"]+)"/g)]
    .map((entry) => entry[1])
    // Embedded resources like `project_gallery(url,alt)` are their own tables.
    .filter((column) => !column.includes("("));
}

/** Embedded resources: `project_modules(code,title)` -> { table, columns }. */
function embeddedResources(constantName) {
  const match = publicSource.match(new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\]`));
  return [...match[1].matchAll(/"([a-z_]+)\(([^)]*)\)"/g)].map((entry) => ({
    table: entry[1],
    columns: entry[2].split(",").map((column) => column.trim()).filter(Boolean),
  }));
}

/**
 * Whether the migrations create this column. Covers both shapes the project
 * uses: a column inside `create table`, and `alter table ... add column`.
 */
function migrationsDefine(column) {
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Reserved words are quoted in the DDL, e.g. `"position" integer not null`.
  const quoted = `"?${name}"?`;
  const addColumn = new RegExp(`add column\\s+(?:if not exists\\s+)?${quoted}\\b`, "i");
  const inCreateTable = new RegExp(`^\\s*${quoted}\\s+(?:uuid|text|boolean|integer|bigint|smallint|numeric|jsonb|json|date|timestamptz|timestamp|serial)\\b`, "im");

  return addColumn.test(migrationSql) || inCreateTable.test(migrationSql);
}

describe("public query is backed by the migration chain", () => {
  it("finds the migrations and the public client", () => {
    assert.ok(migrationFiles.length > 0, "no migrations found");
    assert.ok(publicSource.includes("PROJECT_COLUMNS"), "public client has no column list");
  });

  it("creates every project column the public site selects", () => {
    const missing = selectedColumns("PROJECT_COLUMNS").filter((column) => !migrationsDefine(column));

    assert.deepEqual(
      missing,
      [],
      `these columns are selected by the public site but no migration creates them: ${missing.join(", ")}`,
    );
  });

  it("creates every plan column the public site selects", () => {
    const missing = selectedColumns("PLAN_COLUMNS").filter((column) => !migrationsDefine(column));
    assert.deepEqual(missing, []);
  });

  it("creates every column of every embedded resource", () => {
    const missing = [];

    for (const resource of [...embeddedResources("PROJECT_COLUMNS"), ...embeddedResources("PLAN_COLUMNS")]) {
      for (const column of resource.columns) {
        if (!migrationsDefine(column)) missing.push(`${resource.table}.${column}`);
      }
    }

    assert.deepEqual(missing, []);
  });
});

describe("live preview contract", () => {
  it("ships a migration that adds live_preview_enabled", () => {
    const file = migrationFiles.find((name) => name.includes("live_preview"));
    assert.ok(file, "no migration adds the live preview flag");

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    assert.match(sql, /add column\s+(?:if not exists\s+)?live_preview_enabled/i);
    assert.match(sql, /boolean/i, "the flag must be a boolean");
    assert.match(sql, /not null/i, "the flag must be not null");
    // Defaulting to true would silently frame every project that happens to
    // have a preview_url, which is the behaviour this flag exists to stop.
    assert.match(sql, /default\s+false/i, "the flag must default to false");
  });

  it("only enables the two approved cases", () => {
    const file = migrationFiles.find((name) => name.includes("live_preview"));
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    assert.match(sql, /set live_preview_enabled\s*=\s*true/i, "the backfill must enable the approved cases");
    assert.match(sql, /case_number in \(1, 2\)/i, "only CASE 001 and 002 are approved for a live demo");
  });

  it("keeps the flag in the public query", () => {
    assert.ok(
      selectedColumns("PROJECT_COLUMNS").includes("live_preview_enabled"),
      "the public site must read the flag rather than inferring a demo",
    );
  });

  it("keeps preview_url and the flag independent", () => {
    const columns = selectedColumns("PROJECT_COLUMNS");

    assert.ok(columns.includes("preview_url"), "preview_url is still selected");
    assert.ok(columns.includes("project_url"), "project_url is still selected");

    const resolver = readFileSync(join(root, "src", "scripts", "public-projects.js"), "utf8");
    assert.match(
      resolver,
      /live_preview_enabled\s*===\s*true/,
      "a demo must require the flag, not just a URL",
    );
    // project_url is the external link; it must never be framed.
    assert.doesNotMatch(
      resolver,
      /preview_url\s*\|\|\s*row\.project_url|row\.preview_url\s*\|\|\s*row\.project_url/,
      "project_url must never stand in for preview_url",
    );
  });

  it("has no hardcoded list of approved cases", () => {
    const resolver = readFileSync(join(root, "src", "scripts", "public-projects.js"), "utf8");

    assert.doesNotMatch(resolver, /APPROVED_LIVE_PREVIEWS/, "the approved list must come from the database");
    assert.doesNotMatch(
      resolver,
      /case-00\d"\s*[,:]/,
      "no case number may be hardcoded as demo-approved",
    );
  });
});

describe("modern publishable keys", () => {
  // A `sb_publishable_...` key sent as a bearer token fails before RLS is even
  // evaluated, which takes the public site down.
  it("only sends Authorization for legacy JWT keys", () => {
    assert.match(publicSource, /apikey: PUBLISHABLE_KEY/, "apikey header is always sent");
    assert.match(
      publicSource,
      /\/\^eyJ\[A-Za-z0-9_-\]\*\\\.\/\.test\(PUBLISHABLE_KEY\)/,
      "the bearer header must be gated behind a JWT check",
    );

    const bearerLine = publicSource.match(/result\.Authorization = `Bearer \$\{PUBLISHABLE_KEY\}`/);
    assert.ok(bearerLine, "bearer assignment not found");

    // The assignment must sit inside the JWT guard, not at the top level.
    const guardIndex = publicSource.indexOf("test(PUBLISHABLE_KEY)");
    assert.ok(guardIndex !== -1 && publicSource.indexOf(bearerLine[0]) > guardIndex, "bearer must be conditional");
  });
});

describe("plan status normalization migration", () => {
  it("ships migration 010 for every canonical plan status", () => {
    const file = migrationFiles.find((name) => name === "010_normalize_plan_status.sql");
    assert.ok(file, "migration 010_normalize_plan_status.sql is missing");

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    assert.match(sql, /update\s+public\.plans/i, "migration must be limited to public.plans data");
    for (const status of ["AVAILABLE", "LIMITED", "ON_REQUEST", "WAITLIST", "UNAVAILABLE", "ARCHIVED"]) {
      assert.match(sql, new RegExp(`'${status}'`, "i"), `migration must normalize ${status}`);
    }
    assert.doesNotMatch(sql, /create\s+type/i, "status stays text in this phase");
    assert.doesNotMatch(sql, /alter\s+table\s+(?!public\.plans)/i, "migration must not alter unrelated tables");
  });
});

// The same failure mode as the public query, one layer over: the automation
// service selects and writes named columns of `automation_runs`, and a column
// it names that no migration creates fails only in production, as PostgREST
// 42703. This reads both sources as written and refuses the mismatch here.
describe("automation run storage contract", () => {
  const storePath = join(root, "services", "automation-api", "app", "services", "run_store.py");
  const migrationFile = migrationFiles.find((name) => name.includes("automation_runs"));

  it("ships a migration that creates the run history table", () => {
    assert.ok(migrationFile, "no migration creates automation_runs");

    const sql = readFileSync(join(MIGRATIONS_DIR, migrationFile), "utf8");
    assert.match(sql, /create table if not exists public\.automation_runs/i);
    // Enabled with no policy: history is reached through the API, never by the
    // Admin querying Supabase directly.
    assert.match(sql, /alter table public\.automation_runs enable row level security/i);
    assert.doesNotMatch(sql, /create policy[\s\S]*automation_runs/i);
    assert.doesNotMatch(
      sql,
      /grant\s+[a-z, ]*\s+on\s+public\.automation_runs\s+to\s+(anon|authenticated)/i,
      "run history must not be granted to admin clients",
    );
  });

  it("creates every column the run store reads", () => {
    const source = readFileSync(storePath, "utf8");
    const match = source.match(/RUN_COLUMNS = ",".join\(\s*\[([\s\S]*?)\]/);
    assert.ok(match, "RUN_COLUMNS not found in run_store.py");

    const columns = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
    assert.ok(columns.length > 5, "expected a real column list");

    const missing = columns.filter((column) => !migrationsDefine(column));
    assert.deepEqual(missing, [], `selected by the run store but created by no migration: ${missing.join(", ")}`);
  });

  it("creates every column the engine writes", () => {
    const engine = readFileSync(
      join(root, "services", "automation-api", "app", "automations", "engine.py"),
      "utf8",
    );

    // The keys the engine puts into store.create()/store.update() payloads.
    const written = [
      "event",
      "status",
      "source",
      "entity_type",
      "entity_id",
      "payload",
      "steps",
      "result",
      "error",
      "started_at",
      "finished_at",
      "duration_ms",
      "idempotency_key",
      "retry_of",
    ];

    for (const column of written) {
      assert.ok(engine.includes(`"${column}"`), `engine no longer writes ${column}; update this list`);
      assert.ok(migrationsDefine(column), `engine writes ${column} but no migration creates it`);
    }
  });

  it("writes only to the explicit automation and handoff tables", () => {
    const supabase = readFileSync(
      join(root, "services", "automation-api", "app", "services", "supabase_service.py"),
      "utf8",
    );

    assert.match(
      supabase,
      /WRITABLE_TABLES = \{"automation_runs", "projects", "commercial_project_handoffs"\}/,
    );
  });
});

// Applies 002_project_media_storage.sql to a real Postgres engine and verifies
// that access to project images follows the state of the owning project.
//
// Supabase's storage schema is not part of the migration, so the pieces the
// policies rely on (buckets, objects, storage.foldername) are shimmed here with
// the same shapes Supabase uses.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)), "utf8");

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PUBLISHED_PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_PROJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PUBLISHED_POSTER = `projects/${PUBLISHED_PROJECT}/poster/one.png`;
const DRAFT_POSTER = `projects/${DRAFT_PROJECT}/poster/two.png`;
const STRAY_OBJECT = "loose-file.png";

let db;

async function asRole(role, uid, fn) {
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

async function failure(sql, params = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error;
  }
}

const readableObjects = async () => (await db.query("select name from storage.objects order by name")).rows.map((row) => row.name);

before(async () => {
  db = new PGlite();

  await db.exec(`
    create role anon;
    create role authenticated;
    grant usage on schema public to anon, authenticated;
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    -- Supabase storage shim
    create schema if not exists storage;
    grant usage on schema storage to anon, authenticated;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets (id),
      name text not null,
      owner uuid
    );
    grant select, insert, update, delete on storage.objects to anon, authenticated;

    -- Same implementation Supabase ships: split on "/" and drop the filename.
    create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end
    $$;
    alter table storage.objects enable row level security;
  `);

  await db.query("insert into auth.users (id, email) values ($1,$2), ($3,$4)", [
    ADMIN_ID,
    "admin@space.local",
    USER_ID,
    "someone@space.local",
  ]);

  await db.exec(migration("001_admin_foundation.sql"));
  await db.exec(migration("002_project_media_storage.sql"));

  await db.query("insert into public.admins (user_id, role) values ($1,'owner')", [ADMIN_ID]);

  await db.query(
    `insert into public.projects (id, case_number, name, slug, category, status, editorial_status, visible)
     values ($1, 1, 'Published', 'published', 'Website', 'Live', 'PUBLISHED', true),
            ($2, 2, 'Draft', 'draft', 'Website', 'Live', 'DRAFT', true)`,
    [PUBLISHED_PROJECT, DRAFT_PROJECT],
  );

  await db.query(
    `insert into storage.objects (bucket_id, name) values ('project-media',$1), ('project-media',$2), ('project-media',$3)`,
    [PUBLISHED_POSTER, DRAFT_POSTER, STRAY_OBJECT],
  );
});

after(async () => {
  await db?.close();
});

describe("media bucket", () => {
  it("is private and constrained to images", async () => {
    const { rows } = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'project-media'");

    assert.equal(rows[0].public, false, "a public bucket would expose draft images to anyone with the URL");
    assert.equal(Number(rows[0].file_size_limit), 5242880);
    assert.ok(rows[0].allowed_mime_types.includes("image/png"));
    assert.equal(rows[0].allowed_mime_types.includes("application/pdf"), false);
  });

  it("re-applies without error", async () => {
    await db.exec(migration("002_project_media_storage.sql"));
  });
});

describe("path helper", () => {
  it("extracts the project uuid from an object path", async () => {
    const { rows } = await db.query("select public.media_project_id($1) as id", [PUBLISHED_POSTER]);
    assert.equal(rows[0].id, PUBLISHED_PROJECT);
  });

  it("returns null for paths that do not match the layout", async () => {
    for (const name of [STRAY_OBJECT, "projects/not-a-uuid/poster/x.png", "other/aaaa/poster/x.png"]) {
      const { rows } = await db.query("select public.media_project_id($1) as id", [name]);
      assert.equal(rows[0].id, null, `${name} must not resolve to a project`);
    }
  });
});

describe("storage row level security", () => {
  it("lets anonymous visitors read images of published projects only", async () => {
    const names = await asRole("anon", null, readableObjects);

    assert.deepEqual(names, [PUBLISHED_POSTER], "draft images and stray objects stay hidden");
  });

  it("treats an authenticated non-admin like the public", async () => {
    const names = await asRole("authenticated", USER_ID, readableObjects);

    assert.deepEqual(names, [PUBLISHED_POSTER]);
  });

  it("hides an image as soon as its project is unpublished", async () => {
    await db.query("update public.projects set editorial_status = 'DRAFT' where id = $1", [PUBLISHED_PROJECT]);
    const whileDraft = await asRole("anon", null, readableObjects);

    await db.query("update public.projects set editorial_status = 'PUBLISHED', visible = false where id = $1", [PUBLISHED_PROJECT]);
    const whileHidden = await asRole("anon", null, readableObjects);

    await db.query("update public.projects set visible = true where id = $1", [PUBLISHED_PROJECT]);

    assert.deepEqual(whileDraft, [], "unpublishing hides the image");
    assert.deepEqual(whileHidden, [], "hiding the project hides the image");
  });

  it("blocks anonymous writes", async () => {
    const insert = await asRole("anon", null, () =>
      failure("insert into storage.objects (bucket_id, name) values ('project-media', $1)", ["projects/x/poster/hack.png"]),
    );
    const remove = await asRole("anon", null, () => failure("delete from storage.objects where name = $1", [PUBLISHED_POSTER]));

    assert.equal(insert?.code, "42501");
    assert.equal((await db.query("select count(*)::int as n from storage.objects where name = $1", [PUBLISHED_POSTER])).rows[0].n, 1);
    assert.equal(remove, null, "delete is filtered to zero rows rather than erroring");
  });

  it("blocks writes from an authenticated non-admin", async () => {
    const insert = await asRole("authenticated", USER_ID, () =>
      failure("insert into storage.objects (bucket_id, name) values ('project-media', $1)", ["projects/x/poster/hack.png"]),
    );

    assert.equal(insert?.code, "42501");
  });

  it("gives admins full control over the bucket", async () => {
    const names = await asRole("authenticated", ADMIN_ID, readableObjects);
    assert.deepEqual(names, [STRAY_OBJECT, DRAFT_POSTER, PUBLISHED_POSTER].sort(), "admins see every object");

    await asRole("authenticated", ADMIN_ID, async () => {
      await db.query("insert into storage.objects (bucket_id, name) values ('project-media', $1)", [
        `projects/${PUBLISHED_PROJECT}/gallery/new.png`,
      ]);
      await db.query("delete from storage.objects where name = $1", [DRAFT_POSTER]);
    });

    assert.equal((await db.query("select count(*)::int as n from storage.objects where name = $1", [DRAFT_POSTER])).rows[0].n, 0);
  });
});

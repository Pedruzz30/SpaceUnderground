// The Supabase project repository must put the link condition inside the
// UPDATE it sends, not in a read done beforehand: only then does Postgres
// decide atomically, and a second tab racing for the same project matches no
// row instead of overwriting client_id.
//
// No network: supabase-js runs for real against a stubbed fetch, so these
// tests see the exact PostgREST requests the Admin would send.
//
//   npm test

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

globalThis.__SPACE_ADMIN_ENV__ = {
  VITE_ADMIN_DATA_SOURCE: "supabase",
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_test",
};

const PROJECT_ID = "6f1c9d0e-6d38-4b0f-8f0a-0b0f9a1b2c3d";
const CLIENT_A = "11111111-aaaa-4aaa-8aaa-111111111111";
const CLIENT_B = "22222222-bbbb-4bbb-8bbb-222222222222";

let requests = [];
let patchMatches = true;
let currentClient = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ method, url, body });

  if (!url.pathname.endsWith("/rest/v1/projects")) return json([]);
  if (method === "PATCH") {
    if (!patchMatches) return json([]);
    currentClient = body.client_id;
    return json([{ id: PROJECT_ID }]);
  }
  return json([{ id: PROJECT_ID, case_number: 3, name: "Orbital", slug: "orbital", client_id: currentClient }]);
};

const { supabaseProjectRepository } = await import("../src/services/repositories/supabase-project-repository.js");

const patches = () => requests.filter((request) => request.method === "PATCH");

beforeEach(() => {
  requests = [];
  patchMatches = true;
  currentClient = null;
});

describe("supabase project link (conditional UPDATE)", () => {
  it("links only when the project has no client, in the same statement", async () => {
    const project = await supabaseProjectRepository.assignClient(PROJECT_ID, CLIENT_A);

    const [patch] = patches();
    assert.equal(patches().length, 1);
    assert.equal(patch.url.searchParams.get("id"), `eq.${PROJECT_ID}`);
    assert.equal(patch.url.searchParams.get("client_id"), "is.null", "the UPDATE itself requires an unowned project");
    assert.deepEqual(patch.body, { client_id: CLIENT_A });
    assert.equal(project.clientId, CLIENT_A);
  });

  it("refuses a link when the conditional UPDATE matches no row", async () => {
    patchMatches = false;
    await assert.rejects(
      () => supabaseProjectRepository.assignClient(PROJECT_ID, CLIENT_B),
      (error) => error.code === "conflict",
    );
  });

  it("unlinks only from the expected client, in the same statement", async () => {
    currentClient = CLIENT_A;
    const project = await supabaseProjectRepository.releaseClient(PROJECT_ID, CLIENT_A);

    const [patch] = patches();
    assert.equal(patch.url.searchParams.get("client_id"), `eq.${CLIENT_A}`, "the UPDATE itself requires the expected owner");
    assert.deepEqual(patch.body, { client_id: null });
    assert.equal(project.clientId, null);
  });

  it("refuses an unlink when the project now belongs to someone else", async () => {
    patchMatches = false;
    await assert.rejects(
      () => supabaseProjectRepository.releaseClient(PROJECT_ID, CLIENT_A),
      (error) => error.code === "conflict",
    );
  });

  it("returns null for a project that does not exist, without writing", async () => {
    globalThis.fetch = ((original) => async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        requests.push({ method: "GET", url });
        return json([]);
      }
      return original(input, init);
    })(globalThis.fetch);

    assert.equal(await supabaseProjectRepository.assignClient(PROJECT_ID, CLIENT_A), null);
    assert.equal(patches().length, 0);
  });
});

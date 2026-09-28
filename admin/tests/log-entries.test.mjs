// Pure rules behind the Logs screen. No DOM and no browser.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import en from "../src/i18n/locales/en.js";
import ptBR from "../src/i18n/locales/pt-BR.js";
import {
  actionKey,
  channelFor,
  CSV_HEADER,
  csvCell,
  DAY,
  domainFor,
  entityHref,
  matchesDomain,
  matchesPeriod,
  matchesQuery,
  sortByNewest,
  startOfDay,
  toCsv,
} from "../src/utils/log-entries.js";

const NOW = new Date("2026-09-20T15:00:00").getTime();

describe("log classification", () => {
  it("files client events under Clients, including project links", () => {
    assert.equal(domainFor({ action: "client.created", entityType: "client" }), "Clients");
    assert.equal(domainFor({ action: "client.project_linked", entityType: "client" }), "Clients");
  });

  it("keeps the existing domains for projects, plans, media, content and settings", () => {
    assert.equal(domainFor({ action: "project.updated", entityType: "project" }), "Projects");
    assert.equal(domainFor({ action: "plan.duplicated", entityType: "plan" }), "Plans");
    assert.equal(domainFor({ action: "media.uploaded", entityType: "media" }), "Media");
    assert.equal(domainFor({ action: "site_content.updated", entityType: "site_content" }), "Content");
    assert.equal(domainFor({ action: "settings.updated", entityType: "settings" }), "Settings");
    assert.equal(domainFor({ action: "admin.event", entityType: "system" }), "All");
  });

  it("files ledger events under Financial, even when they name a client", () => {
    assert.equal(domainFor({ action: "financial.paid", entityType: "financial" }), "Financial");
    assert.equal(channelFor({ action: "financial.paid", entityType: "financial" }), "ACTIVITY");
  });

  it("files pipeline events under Commercial and links them to the board", () => {
    assert.equal(domainFor({ action: "commercial.won", entityType: "opportunity" }), "Commercial");
    assert.equal(entityHref({ action: "commercial.won", entityType: "opportunity", entityId: "o1" }), "#/commercial");
    assert.equal(entityHref({ action: "commercial.deleted", entityType: "opportunity", entityId: "o1" }), "");
  });

  it("routes security and system hints to their channels", () => {
    assert.equal(channelFor({ action: "auth.login_failed" }), "SECURITY");
    assert.equal(channelFor({ action: "media.uploaded", entityType: "media" }), "SYSTEM");
    assert.equal(channelFor({ action: "project.created", entityType: "project" }), "ACTIVITY");
  });

  it("matches Publishing on the action, not the domain", () => {
    assert.equal(matchesDomain({ action: "project.published" }, "Publishing"), true);
    assert.equal(matchesDomain({ action: "project.updated" }, "Publishing"), false);
    assert.equal(matchesDomain({ action: "anything" }, "All"), true);
  });
});

describe("log filters", () => {
  const at = (offset) => ({ time: new Date(NOW - offset).toISOString() });

  it("limits today to events since local midnight", () => {
    const midnight = startOfDay(NOW);
    assert.equal(matchesPeriod({ time: new Date(midnight + 1000).toISOString() }, "today", NOW), true);
    assert.equal(matchesPeriod({ time: new Date(midnight - 1000).toISOString() }, "today", NOW), false);
  });

  it("uses rolling 7 and 30 day windows", () => {
    assert.equal(matchesPeriod(at(6 * DAY), "week", NOW), true);
    assert.equal(matchesPeriod(at(8 * DAY), "week", NOW), false);
    assert.equal(matchesPeriod(at(29 * DAY), "month", NOW), true);
    assert.equal(matchesPeriod(at(31 * DAY), "month", NOW), false);
  });

  it("keeps undated rows only when no period is chosen", () => {
    assert.equal(matchesPeriod({ time: null }, "all", NOW), true);
    assert.equal(matchesPeriod({ time: "not a date" }, "week", NOW), false);
  });

  it("searches stored fields and page-supplied text, case-insensitively", () => {
    const entry = { title: "Client created", detail: "CLIENT-004 Orbital", action: "client.created", entityId: "c-9" };
    assert.equal(matchesQuery(entry, "orbital"), true);
    assert.equal(matchesQuery(entry, "C-9"), true);
    assert.equal(matchesQuery(entry, "cliente criado"), false);
    assert.equal(matchesQuery(entry, "cliente criado", ["Cliente criado"]), true);
    assert.equal(matchesQuery(entry, "   "), true);
  });

  it("orders newest first and sinks undated rows", () => {
    const sorted = sortByNewest([
      { id: "old", time: "2026-09-01T00:00:00Z" },
      { id: "none", time: null },
      { id: "new", time: "2026-09-19T00:00:00Z" },
    ]);
    assert.deepEqual(sorted.map((entry) => entry.id), ["new", "old", "none"]);
  });
});

describe("log links", () => {
  it("opens the record each entity type points at", () => {
    assert.equal(entityHref({ entityType: "project", entityId: "001" }), "#/projects/001");
    assert.equal(entityHref({ entityType: "media", entityId: "7b1c" }), "#/projects/7b1c");
    assert.equal(entityHref({ entityType: "client", entityId: "c 1" }), "#/clients/c%201");
    assert.equal(entityHref({ entityType: "plan", entityId: "plan-pro" }), "#/services/plan-pro");
    assert.equal(entityHref({ entityType: "site_content", entityId: "hero" }), "#/content");
    assert.equal(entityHref({ entityType: "settings", entityId: "public" }), "#/settings");
    assert.equal(entityHref({ action: "financial.paid", entityType: "financial", entityId: "tx-1" }), "#/financial");
    assert.equal(entityHref({ action: "financial.deleted", entityType: "financial", entityId: "tx-1" }), "");
  });

  it("does not link deleted records, missing ids or unknown types", () => {
    assert.equal(entityHref({ action: "project.deleted", entityType: "project", entityId: "001" }), "");
    assert.equal(entityHref({ entityType: "client", entityId: "" }), "");
    assert.equal(entityHref({ entityType: "system", entityId: "x" }), "");
  });
});

describe("log export", () => {
  it("quotes cells and doubles embedded quotes", () => {
    assert.equal(csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
    assert.equal(csvCell(null), '""');
  });

  it("neutralises cells a spreadsheet would run as a formula", () => {
    for (const value of ["=HYPERLINK(1)", "+1", "-2", "@SUM(A1)"]) {
      assert.ok(csvCell(value).startsWith(`"'`), `${value} is prefixed`);
    }
  });

  it("writes a BOM, a header and one CRLF line per entry", () => {
    const csv = toCsv([
      { time: "2026-09-20T10:00:00Z", action: "client.created", entityType: "client", entityId: "c1", title: "Client created", detail: "Orbital" },
    ]);
    assert.ok(csv.startsWith("﻿"));
    const [header, line, extra] = csv.slice(1).split("\r\n");
    assert.equal(header, CSV_HEADER.join(","));
    assert.equal(extra, undefined);
    assert.match(line, /"ACTIVITY","Clients","client\.created","Client created","Orbital","client","c1"/);
  });
});

describe("log action labels", () => {
  const ACTIONS = [
    "project.created", "project.updated", "project.published", "project.unpublished", "project.archived", "project.deleted",
    "client.created", "client.updated", "client.archived", "client.unarchived", "client.project_linked", "client.project_unlinked",
    "plan.created", "plan.updated", "plan.duplicated", "plan.archived", "plan.unarchived",
    "media.uploaded", "site_content.updated", "settings.updated",
    "financial.created", "financial.installments_created", "financial.updated", "financial.paid",
    "financial.reopened", "financial.cancelled", "financial.deleted",
    "commercial.created", "commercial.updated", "commercial.stage_changed", "commercial.won",
    "commercial.lost", "commercial.reopened", "commercial.deleted",
  ];

  const read = (dictionary, key) => key.split(".").reduce((node, part) => node?.[part], dictionary);

  it("has a label in both locales for every action the Admin records", () => {
    for (const action of ACTIONS) {
      const key = actionKey(action);
      assert.equal(typeof read(ptBR, key), "string", `pt-BR ${key}`);
      assert.equal(typeof read(en, key), "string", `en ${key}`);
    }
  });
});

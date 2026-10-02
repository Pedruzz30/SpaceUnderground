import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { setLocale } from "../src/i18n/index.js";
import {
  formatCurrency,
  formatDayMonth,
  formatFullDate,
  formatRelativeAge,
  formatRelativeDay,
  formatSignedCurrency,
} from "../src/utils/format.js";

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => setLocale("pt-BR", { persist: false }));

describe("relative day formatting", () => {
  it("never mixes English units into a Portuguese page", () => {
    setLocale("pt-BR", { persist: false });
    const threeDaysAgo = new Date(Date.now() - 3 * DAY);

    const label = formatRelativeDay(threeDaysAgo);
    assert.ok(!/ago/i.test(label), `expected no English relative unit, got "${label}"`);
    assert.match(label, /3/);
  });

  it("reads naturally in each locale", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * DAY);

    setLocale("pt-BR", { persist: false });
    assert.equal(formatRelativeDay(new Date()), "hoje");
    assert.equal(formatRelativeDay(new Date(Date.now() - 1.5 * DAY)), "ontem");
    assert.equal(formatRelativeDay(threeDaysAgo), "há 3 dias");

    setLocale("en", { persist: false });
    assert.equal(formatRelativeDay(new Date()), "today");
    assert.equal(formatRelativeDay(new Date(Date.now() - 1.5 * DAY)), "yesterday");
    assert.equal(formatRelativeDay(threeDaysAgo), "3 days ago");
  });

  it("returns an em dash for unusable values", () => {
    assert.equal(formatRelativeDay("not-a-date"), "—");
    assert.equal(formatRelativeDay(null), "—");
  });
});

describe("relative age formatting", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const ago = (ms) => new Date(now - ms);
  const MINUTE = 60 * 1000;

  it("keeps counting where the lists switch to a date", () => {
    setLocale("pt-BR", { persist: false });
    assert.equal(formatRelativeAge(ago(2 * 60 * MINUTE), { now }), "hoje");
    assert.equal(formatRelativeAge(ago(1.5 * DAY), { now }), "ontem");
    assert.equal(formatRelativeAge(ago(9 * DAY), { now }), "há 9 dias");
    assert.equal(formatRelativeAge(ago(59 * DAY), { now }), "há 59 dias");
    assert.equal(formatRelativeAge(ago(125 * DAY), { now }), "há 4 meses");
    assert.equal(formatRelativeAge(ago(800 * DAY), { now }), "há 2 anos");

    setLocale("en", { persist: false });
    assert.equal(formatRelativeAge(ago(2 * 60 * MINUTE), { now }), "today");
    assert.equal(formatRelativeAge(ago(9 * DAY), { now }), "9 days ago");
    assert.equal(formatRelativeAge(ago(125 * DAY), { now }), "4 months ago");
  });

  it("reads the first day in minutes and hours for events", () => {
    setLocale("pt-BR", { persist: false });
    assert.equal(formatRelativeAge(ago(10 * 1000), { time: true, now }), "agora");
    assert.equal(formatRelativeAge(ago(15 * MINUTE), { time: true, now }), "há 15 minutos");
    assert.equal(formatRelativeAge(ago(3 * 60 * MINUTE), { time: true, now }), "há 3 horas");
    assert.equal(formatRelativeAge(ago(1.5 * DAY), { time: true, now }), "ontem");

    setLocale("en", { persist: false });
    assert.equal(formatRelativeAge(ago(10 * 1000), { time: true, now }), "now");
    assert.equal(formatRelativeAge(ago(15 * MINUTE), { time: true, now }), "15 minutes ago");
  });

  it("returns an em dash for unusable values and a date for the future", () => {
    setLocale("pt-BR", { persist: false });
    assert.equal(formatRelativeAge("not-a-date"), "—");
    assert.equal(formatRelativeAge(null), "—");
    assert.equal(formatRelativeAge(new Date(now + 3 * DAY), { now }), formatDayMonth(new Date(now + 3 * DAY)));
  });
});

describe("date formatting", () => {
  it("orders day and month per locale", () => {
    const date = new Date("2026-09-11T12:00:00Z");

    setLocale("pt-BR", { persist: false });
    assert.match(formatDayMonth(date), /^11 SET/);

    setLocale("en", { persist: false });
    assert.match(formatDayMonth(date), /^SEP 11/);
  });

  it("localizes full dates without changing the underlying value", () => {
    const date = new Date("2026-09-11T12:00:00Z");

    setLocale("pt-BR", { persist: false });
    const pt = formatFullDate(date);
    setLocale("en", { persist: false });
    const en = formatFullDate(date);

    assert.notEqual(pt, en);
    assert.match(pt, /2026/);
    assert.match(en, /2026/);
  });
});

describe("currency formatting", () => {
  it("keeps BRL in both locales and only changes the grouping", () => {
    setLocale("pt-BR", { persist: false });
    const pt = formatCurrency(2750);
    setLocale("en", { persist: false });
    const en = formatCurrency(2750);

    assert.match(pt, /R\$/);
    assert.match(en, /R\$/);
    assert.ok(pt.includes("2.750"), `expected pt-BR grouping, got "${pt}"`);
    assert.ok(en.includes("2,750"), `expected en grouping, got "${en}"`);
  });

  it("keeps the sign outside the currency token", () => {
    setLocale("pt-BR", { persist: false });
    assert.match(formatSignedCurrency(1750), /^\+ R\$/);
    assert.match(formatSignedCurrency(-1750), /^- R\$/);
  });
});

import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { setLocale } from "../src/i18n/index.js";
import {
  formatCurrency,
  formatDayMonth,
  formatFullDate,
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

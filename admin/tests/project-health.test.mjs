import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  contentCompleteness,
  goesPublic,
  isLivePreviewUrl,
  liveDemoState,
  projectHealth,
  publishReadiness,
  yearError,
} from "../src/utils/project-health.js";

const completeProject = (overrides = {}) => ({
  name: "INK Tattoo",
  client: "INK Tattoo",
  category: "Website",
  description: "Site editorial.",
  editorialStatus: "PUBLISHED",
  visible: true,
  poster: "projects/ink/poster.png",
  projectUrl: "https://example.com",
  previewUrl: "https://example.com/embed",
  livePreviewEnabled: true,
  presentation: {
    system: "SYSTEM / 01",
    label: "PORTFOLIO",
    address: "INK / LIVE",
    type: "WEBSITE",
  },
  translations: {
    en: {
      description: "Editorial site.",
      presentation_system: "SYSTEM / 01",
      presentation_label: "PORTFOLIO",
      presentation_address: "INK / LIVE",
      presentation_type: "WEBSITE",
    },
  },
  modules: [
    {
      title: "Direction",
      description: "Depth",
      translations: { en: { title: "Direction", description: "Depth" } },
    },
  ],
  ...overrides,
});

describe("project health", () => {
  it("marks a complete published project as healthy", () => {
    assert.equal(projectHealth(completeProject()).status, "healthy");
  });

  it("treats published hidden as attention", () => {
    assert.equal(projectHealth(completeProject({ visible: false })).status, "attention");
  });

  it("marks a draft with missing essentials as incomplete", () => {
    assert.equal(projectHealth(completeProject({ description: "", poster: "", modules: [] })).status, "incomplete");
  });

  it("allows a healthy project with no demo", () => {
    const health = projectHealth(completeProject({ livePreviewEnabled: false, previewUrl: "" }));
    assert.equal(health.demo, "none");
    assert.equal(health.status, "healthy");
  });
});

describe("content completeness", () => {
  it("calculates PT-BR and English progress from translatable fields only", () => {
    const completeness = contentCompleteness(completeProject({
      translations: { en: { description: "Editorial site." } },
      modules: [{ title: "Direction", description: "Depth", translations: {} }],
    }));

    assert.equal(completeness.pt.percent, 100);
    assert.equal(completeness.en.percent, 14);
  });
});

describe("live demo validation", () => {
  it("reports enabled and valid preview as live", () => {
    assert.equal(liveDemoState(completeProject()), "live");
  });

  it("reports disabled and valid preview as none", () => {
    assert.equal(liveDemoState(completeProject({ livePreviewEnabled: false })), "none");
  });

  it("reports enabled and invalid preview as invalid", () => {
    assert.equal(liveDemoState(completeProject({ previewUrl: "javascript:alert(1)" })), "invalid");
  });

  it("reports no demo when preview_url is missing, and never falls back to project_url", () => {
    assert.equal(liveDemoState(completeProject({ previewUrl: "", projectUrl: "https://example.com" })), "none");
  });

  it("keeps invalid for a URL that was entered but cannot be framed", () => {
    assert.equal(liveDemoState(completeProject({ previewUrl: "file:///etc/passwd" })), "invalid");
  });

  it("accepts only http and https iframe URLs", () => {
    assert.equal(isLivePreviewUrl("https://example.com"), true);
    assert.equal(isLivePreviewUrl("http://example.com"), true);
    assert.equal(isLivePreviewUrl("data:text/html,test"), false);
    assert.equal(isLivePreviewUrl("file:///tmp/demo.html"), false);
  });
});

describe("poster: warning for health, blocking for publish", () => {
  // The live cases predate the poster requirement and have none stored. Marking
  // them "incomplete" would invalidate working projects, so health warns while
  // the publish action still refuses to ship something new without one.
  const posterless = () => completeProject({ poster: "" });

  it("does not mark an existing published case incomplete for a missing poster", () => {
    assert.equal(projectHealth(posterless()).status, "attention");
  });

  it("still blocks publishing without a poster, and says why", () => {
    const readiness = publishReadiness(posterless());

    assert.equal(readiness.canPublish, false);
    assert.deepEqual(readiness.blocking.map((item) => item.key), ["poster"]);
  });

  it("allows publishing once the poster is there", () => {
    assert.equal(publishReadiness(completeProject()).canPublish, true);
  });

  it("keeps a genuinely missing essential field blocking and incomplete", () => {
    const noName = completeProject({ name: "" });

    assert.equal(projectHealth(noName).status, "incomplete");
    assert.ok(publishReadiness(noName).blocking.some((item) => item.key === "name"));
  });
});

describe("project URL is optional", () => {
  // CASE 003 to 005 are published cases with no external link. Requiring one
  // would mark working projects incomplete.
  const noUrl = () => completeProject({ projectUrl: "" });

  it("does not mark a published project incomplete for having no external URL", () => {
    assert.notEqual(projectHealth(noUrl()).status, "incomplete");
  });

  it("can be fully healthy with no external URL and no demo", () => {
    const bare = completeProject({ projectUrl: "", livePreviewEnabled: false, previewUrl: "" });
    assert.equal(projectHealth(bare).status, "healthy");
  });

  it("does not block publishing", () => {
    const readiness = publishReadiness(noUrl());

    assert.equal(readiness.canPublish, true);
    assert.ok(!readiness.blocking.some((item) => item.key === "projectUrl"));
  });

  it("still flags a URL that was entered but is not a valid link", () => {
    const health = projectHealth(completeProject({ projectUrl: "javascript:alert(1)" }));

    assert.equal(health.status, "attention");
    assert.ok(health.checks.some((item) => item.key === "projectUrl" && !item.ok));
  });

  it("accepts a valid external URL", () => {
    assert.equal(projectHealth(completeProject({ projectUrl: "https://example.com" })).status, "healthy");
  });
});

describe("English completeness covers every field the editor can translate", () => {
  // The helper used to count presentation_address while the editor offered no
  // way to translate it, so English could never reach 100%.
  const TRANSLATABLE = [
    "description",
    "presentation_system",
    "presentation_label",
    "presentation_address",
    "presentation_type",
  ];

  const withTranslations = (translations) =>
    completeProject({
      presentation: { system: "s", label: "l", address: "a", type: "t" },
      modules: [{ title: "t", description: "d", translations: { en: { title: "T", description: "D" } } }],
      translations: { en: translations },
    });

  it("reaches 100% once every translatable field is filled", () => {
    const full = Object.fromEntries(TRANSLATABLE.map((field) => [field, "value"]));
    assert.equal(contentCompleteness(withTranslations(full)).en.percent, 100);
  });

  it("drops below 100% when the address translation is missing", () => {
    const missing = Object.fromEntries(
      TRANSLATABLE.filter((field) => field !== "presentation_address").map((field) => [field, "value"]),
    );
    const percent = contentCompleteness(withTranslations(missing)).en.percent;

    assert.ok(percent < 100, `expected under 100%, got ${percent}%`);
  });

  it("counts the address translation when it is provided", () => {
    const without = contentCompleteness(withTranslations({ description: "d" })).en.done;
    const with_ = contentCompleteness(withTranslations({ description: "d", presentation_address: "a" })).en.done;

    assert.equal(with_, without + 1);
  });
});

// The year rule, which the commercial handoff forced into the open: a project
// created by an automation arrives as a hidden draft with no year, and had to
// become editable without loosening what publishing requires.

describe("year requirement", () => {
  const draft = { editorialStatus: "DRAFT", visible: false };
  const published = { editorialStatus: "PUBLISHED", visible: true };

  it("lets a hidden draft carry no year at all", () => {
    // Exactly the shape the commercial handoff writes.
    assert.equal(yearError({ ...draft, name: "phase4-project", year: "" }), "");
    assert.equal(yearError({ ...draft, year: null }), "");
    assert.equal(yearError({ ...draft, year: undefined }), "");
  });

  it("still refuses a year that could not be one, draft or not", () => {
    for (const year of ["1889", "3000", "not-a-year", "0"]) {
      assert.equal(yearError({ ...draft, year }), "invalid", `draft ${year}`);
      assert.equal(yearError({ ...published, year }), "invalid", `published ${year}`);
    }
  });

  it("accepts a real year on a draft", () => {
    assert.equal(yearError({ ...draft, year: "2026" }), "");
    assert.equal(yearError({ ...draft, year: 2026 }), "");
    assert.equal(yearError({ ...draft, year: " 2026 " }), "");
  });

  it("requires a year before a project can be published", () => {
    assert.equal(yearError({ editorialStatus: "PUBLISHED", visible: true, year: "" }), "required");
    assert.equal(yearError({ editorialStatus: "PUBLISHED", visible: false, year: "" }), "required");
  });

  it("requires a year before a project can be made visible", () => {
    // Visibility is the public surface even while the editorial status lags.
    assert.equal(yearError({ editorialStatus: "DRAFT", visible: true, year: "" }), "required");
  });

  it("leaves a published project that already has a year alone", () => {
    assert.equal(yearError({ ...published, year: "2024" }), "");
    assert.equal(yearError({ ...published, year: 1990 }), "");
    assert.equal(yearError({ ...published, year: 2100 }), "");
  });

  it("treats going public the same way the publish action does", () => {
    assert.equal(goesPublic({ editorialStatus: "PUBLISHED", visible: false }), true);
    assert.equal(goesPublic({ editorialStatus: "DRAFT", visible: true }), true);
    assert.equal(goesPublic({ editorialStatus: "DRAFT", visible: false }), false);
    assert.equal(goesPublic({}), false);
  });

  it("does not change how a legacy published project is scored", () => {
    // publishReadiness is untouched by the year rule: a live case keeps the
    // exact blocking set it had before.
    const legacy = {
      name: "JARVIS",
      client: "Space Underground",
      category: "System",
      description: "A published case.",
      poster: "poster.png",
      modules: [{ title: "Overview", description: "..." }],
      editorialStatus: "PUBLISHED",
      visible: true,
      year: "2024",
    };

    const readiness = publishReadiness(legacy);
    assert.equal(readiness.canPublish, true);
    assert.equal(readiness.blocking.length, 0);
    assert.ok(!readiness.health.checks.some((item) => item.key === "year"));
  });
});

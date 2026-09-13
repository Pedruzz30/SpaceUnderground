import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { contentCompleteness, isLivePreviewUrl, liveDemoState, projectHealth } from "../src/utils/project-health.js";

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

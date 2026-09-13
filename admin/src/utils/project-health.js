const PRESENTATION_FIELDS = ["system", "label", "address", "type"];
const TRANSLATION_FIELDS = ["description", "presentation_system", "presentation_label", "presentation_address", "presentation_type"];

const text = (value) => (typeof value === "string" ? value.trim() : "");

export function isLivePreviewUrl(value) {
  const raw = text(value);
  if (!raw) return false;

  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

// "none" means there is simply no demo configured, which is a valid state for a
// project: a missing preview URL is not a misconfiguration. "invalid" is
// reserved for a URL that was actually entered but cannot be framed, which is
// the case worth flagging. project_url never stands in for preview_url.
export function liveDemoState(project = {}) {
  const previewUrl = text(project.previewUrl);
  if (!previewUrl) return "none";
  if (!project.livePreviewEnabled) return "none";
  return isLivePreviewUrl(previewUrl) ? "live" : "invalid";
}

function moduleCount(modules = [], field, locale = "base") {
  return modules.reduce((count, module) => {
    const value = locale === "en" ? module.translations?.en?.[field] : module[field];
    return count + (text(value) ? 1 : 0);
  }, 0);
}

export function contentCompleteness(project = {}) {
  const modules = Array.isArray(project.modules) ? project.modules : [];
  const baseTotal = 5 + modules.length * 2;
  const baseDone = [
    project.description,
    project.presentation?.system,
    project.presentation?.label,
    project.presentation?.address,
    project.presentation?.type,
  ].filter(text).length + moduleCount(modules, "title") + moduleCount(modules, "description");

  const translations = project.translations?.en ?? {};
  const enDone = TRANSLATION_FIELDS.filter((field) => text(translations[field])).length
    + moduleCount(modules, "title", "en")
    + moduleCount(modules, "description", "en");

  const percent = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 100);

  return {
    pt: { done: baseDone, total: baseTotal, percent: percent(baseDone, baseTotal) },
    en: { done: enDone, total: baseTotal, percent: percent(enDone, baseTotal) },
  };
}

function check(key, ok, severity = "required") {
  return { key, ok: Boolean(ok), severity };
}

export function projectHealth(project = {}) {
  const completeness = contentCompleteness(project);
  const demo = liveDemoState(project);
  const checks = [
    check("name", text(project.name)),
    check("client", text(project.client)),
    check("category", text(project.category)),
    check("descriptionPt", text(project.description)),
    // A poster blocks publishing, but a live case that predates the requirement
    // is not "incomplete" for lacking one -- it reads as attention instead.
    check("poster", text(project.poster), "publish"),
    check("modules", Array.isArray(project.modules) && project.modules.length > 0),
    // An external link is optional: JARVIS, Despensa Digital and Termo Digital
    // are published cases with no public URL. Only a URL that was actually
    // entered has to be valid.
    check("projectUrl", !text(project.projectUrl) || isLivePreviewUrl(project.projectUrl), "warning"),
  ];

  const publicationConsistent =
    (project.editorialStatus === "PUBLISHED" && project.visible)
    || (project.editorialStatus !== "PUBLISHED" && !project.visible);
  checks.push(check("publicationConsistency", publicationConsistent, "warning"));

  if (project.livePreviewEnabled) {
    checks.push(check("liveDemoUrl", demo === "live"));
  }

  checks.push(check("englishCompleteness", completeness.en.percent === 100, "warning"));

  const required = checks.filter((item) => item.severity === "required");
  const requiredOk = required.every((item) => item.ok);
  // "publish" checks gate the publish action but only warn in the hub.
  const warnings = checks.filter((item) => item.severity !== "required" && !item.ok);
  const status = requiredOk ? (warnings.length ? "attention" : "healthy") : "incomplete";

  return {
    status,
    score: required.filter((item) => item.ok).length,
    total: required.length,
    checks,
    completeness,
    demo,
  };
}

// Publishing is stricter than health: a case already on the site may be missing
// a poster, but nothing new should go out without one.
export function publishReadiness(project = {}) {
  const health = projectHealth({ ...project, editorialStatus: "PUBLISHED" });
  const blocks = (item) => item.severity === "required" || item.severity === "publish";

  return {
    canPublish: health.checks.filter(blocks).every((item) => item.ok),
    blocking: health.checks.filter((item) => blocks(item) && !item.ok),
    warnings: health.checks.filter((item) => item.severity === "warning" && !item.ok),
    health,
  };
}

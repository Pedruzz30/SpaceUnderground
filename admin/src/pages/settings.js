import { BASE_LOCALE, TRANSLATION_LOCALE, localeHint, localeTabs } from "../components/locale-fields.js";
import { confirmModal } from "../components/modal.js";
import { bindTabs } from "../components/tabs.js";
import { showToast } from "../components/toast.js";
import { DATA_SOURCE, isSupabaseConfigured } from "../config/env.js";
import { getLocale, onLocaleChange, plural, t } from "../i18n/index.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { logActivity } from "../services/activity-service.js";
import { changePassword, getAdminRoster, getCachedSession, getSession, signOutEverywhere } from "../services/auth-service.js";
import { resetMockData } from "../services/dev-tools.js";
import { describeError } from "../services/errors.js";
import { getSiteSettings, saveSiteSettings } from "../services/settings-service.js";
import { resolveImageUrl } from "../services/storage-service.js";
import { checkModules, exportBackup } from "../services/system-service.js";
import { initials } from "../utils/client-relationship.js";
import { bindMfaEnroll, mfaEnrollMarkup } from "../components/mfa-enroll.js";
import { getAccess, hasAnyPermission, hasPermission, isSecurityModelActive } from "../security/access.js";
import { roleLabelKey } from "../security/catalog.js";
import { loadAccess, recordMfaState } from "../services/access-service.js";
import { listFactors, removeFactor } from "../services/mfa-service.js";
import { formatFullDate } from "../utils/format.js";
import { mfaState } from "../utils/team-view.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import {
  PASSWORD_MIN,
  SEO_LIMITS,
  SITE_LOCALES,
  backupFilename,
  clipForPreview,
  healthSummary,
  lengthState,
  ogImageState,
  passwordChecks,
  shareReadiness,
  validateSiteSettings,
} from "../utils/settings-checks.js";

// Four tabs. "Site público" is the public configuration the site reads with
// the anon key; "Conta" is the signed-in member; "Sistema" reads every module
// live; "Dados" exports them. Only the first one has unsaved state, and the
// other three load the first time they are opened.
//
// Each tab names the permissions that show it (none: every member, since
// everyone manages their own password and MFA). The database refuses the
// data behind a hidden tab anyway.

const TABS = [
  ["site", "settings.tabs.site", ["settings.read", "seo.read"]],
  ["account", "settings.tabs.account", null],
  ["system", "settings.tabs.system", ["settings.read"]],
  ["data", "settings.tabs.data", ["data.export"]],
];

const visibleTabs = () => TABS.filter(([, , any]) => !any || hasAnyPermission(any));

// Identity fields belong to settings.edit, search and sharing to seo.edit;
// the database checks the same split per column.
const IDENTITY_FIELDS = ["siteName", "siteUrl", "contactEmail", "locale"];
const SEARCH_FIELDS = ["seoTitle", "seoDescription", "ogImagePath"];

const MODULE_LABELS = {
  projects: "settings.system.modules.projects",
  clients: "settings.system.modules.clients",
  commercial: "settings.system.modules.commercial",
  financial: "settings.system.modules.financial",
  services: "settings.system.modules.services",
  content: "settings.system.modules.content",
  settings: "settings.system.modules.settings",
  activity: "settings.system.modules.activity",
};

const STATUS_LABELS = {
  ok: "settings.system.status.ok",
  schema: "settings.system.status.schema",
  unauthorized: "settings.system.status.unauthorized",
  network: "settings.system.status.network",
  error: "settings.system.status.error",
};

const LENGTH_LABELS = {
  empty: "settings.lengthStates.empty",
  short: "settings.lengthStates.short",
  long: "settings.lengthStates.long",
  ok: "settings.lengthStates.ok",
};

const ROLE_LABELS = {
  owner: "settings.account.roles.owner",
  admin: "settings.account.roles.admin",
  editor: "settings.account.roles.editor",
};

const CHECK_LABELS = {
  siteUrl: "settings.readiness.checks.siteUrl",
  title: "settings.readiness.checks.title",
  description: "settings.readiness.checks.description",
  ogImage: "settings.readiness.checks.ogImage",
  english: "settings.readiness.checks.english",
  contactEmail: "settings.readiness.checks.contactEmail",
};

const HEALTH_STATES = {
  ok: "settings.system.states.ok",
  degraded: "settings.system.states.degraded",
  down: "settings.system.states.down",
};

const RULE_LABELS = {
  length: "settings.account.rules.length",
  mix: "settings.account.rules.mix",
  email: "settings.account.rules.email",
  match: "settings.account.rules.match",
};

// The field a readiness check sends the user to, and the language it is in.
const CHECK_TARGETS = {
  siteUrl: ["siteUrl", BASE_LOCALE],
  title: ["seoTitle", BASE_LOCALE],
  description: ["seoDescription", BASE_LOCALE],
  ogImage: ["ogImagePath", BASE_LOCALE],
  english: ["seoDescription", TRANSLATION_LOCALE],
  contactEmail: ["contactEmail", BASE_LOCALE],
};

// Only the two SEO copy fields are translatable. Site name, URL, contact
// email and the OG image path are single values, and the canonical URL is
// never affected by the selected language.
const SEO_FIELDS = { seoTitle: "seo_title", seoDescription: "seo_description" };
const SITE_FIELDS = ["siteName", "siteUrl", "contactEmail", "locale", "ogImagePath"];

const BRAND_FALLBACK = "Space Underground";
const URL_FALLBACK = "https://spaceunderground.dev";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatTime(value) {
  return new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function panelHead(eyebrowKey, titleKey, aside = "") {
  return `
    <header class="panel__head">
      <div><span data-i18n="${eyebrowKey}">${escapeHtml(t(eyebrowKey))}</span><h3 data-i18n="${titleKey}">${escapeHtml(t(titleKey))}</h3></div>
      ${aside}
    </header>
  `;
}

/* ------------------------------------------------------------ site: form */

function field({ labelKey, hintKey = "", name, value = "", type = "text", wide = false, counter = false, attrs = "" }) {
  const control =
    type === "textarea"
      ? `<textarea id="settings-${name}" name="${name}" rows="3" ${attrs}>${escapeHtml(value ?? "")}</textarea>`
      : `<input id="settings-${name}" name="${name}" type="${type}" value="${escapeAttribute(value ?? "")}" ${attrs}>`;

  return `
    <div class="field${wide ? " field--wide" : ""}">
      <div class="settings-label-row">
        <label for="settings-${name}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
        ${counter ? `<span class="settings-counter" data-counter-for="${name}"></span>` : ""}
      </div>
      ${control}
      ${hintKey ? `<p class="field-hint" data-i18n="${hintKey}">${escapeHtml(t(hintKey))}</p>` : ""}
      <p class="field-error" data-error-for="${name}" hidden></p>
    </div>
  `;
}

// A locale the site does not ship (an old "pt_BR", say) stays visible as the
// current value, so saving without touching the field never rewrites it
// silently; validation asks for a supported one instead.
function localeField(value = "") {
  const options = [
    ["", "settings.localeDefault"],
    ["pt-BR", "settings.localePt"],
    ["en", "settings.localeEn"],
  ];
  const unknown = value && !SITE_LOCALES.includes(value);
  return `
    <div class="field">
      <div class="settings-label-row"><label for="settings-locale" data-i18n="settings.locale">${escapeHtml(t("settings.locale"))}</label></div>
      <select id="settings-locale" name="locale">
        ${options
          .map(([option, key]) => `<option value="${option}"${option === (value || "") ? " selected" : ""} data-i18n="${key}">${escapeHtml(t(key))}</option>`)
          .join("")}
        ${unknown ? `<option value="${escapeAttribute(value)}" selected>${escapeHtml(t("settings.localeUnknown", { value }))}</option>` : ""}
      </select>
      <p class="field-hint" data-i18n="settings.localeHint">${escapeHtml(t("settings.localeHint"))}</p>
      <p class="field-error" data-error-for="locale" hidden></p>
    </div>
  `;
}

function siteFormMarkup(settings) {
  return `
    <div class="settings-toolbar">
      <div class="settings-toolbar__status">
        <strong class="save-state is-saved" data-settings-state>${escapeHtml(t("settings.saved"))}</strong>
        <small data-settings-updated></small>
      </div>
      <div class="settings-toolbar__actions">
        <button class="button" type="button" data-settings-discard disabled data-i18n="settings.discard">${escapeHtml(t("settings.discard"))}</button>
        <button class="button button--primary" type="submit" data-settings-save data-i18n="settings.saveSettings">${escapeHtml(t("settings.saveSettings"))}</button>
      </div>
    </div>
    <div class="settings-main">
      <section class="panel settings-panel">
        ${panelHead("settings.general", "settings.siteIdentity")}
        <div class="form-grid">
          ${field({ labelKey: "settings.siteName", hintKey: "settings.siteNameHint", name: "siteName", value: settings.siteName, attrs: 'autocomplete="off"' })}
          ${field({ labelKey: "settings.publicUrl", hintKey: "settings.publicUrlHint", name: "siteUrl", value: settings.siteUrl, type: "url", attrs: 'inputmode="url" spellcheck="false"' })}
          ${field({ labelKey: "settings.contactEmail", hintKey: "settings.contactEmailHint", name: "contactEmail", value: settings.contactEmail, type: "email", attrs: 'autocomplete="off"' })}
          ${localeField(settings.locale)}
        </div>
      </section>
      <section class="panel settings-panel">
        ${panelHead("settings.seo", "settings.searchMetadata")}
        <div class="form-grid">
          <div class="field field--wide editor-locale-row">
            <span class="field-label" data-i18n="settings.editorialCopy">${escapeHtml(t("settings.editorialCopy"))}</span>
            ${localeTabs("settings-seo")}
            ${localeHint("settings-seo")}
          </div>
          ${field({ labelKey: "settings.seoTitle", hintKey: "settings.seoTitleHint", name: "seoTitle", wide: true, counter: true })}
          ${field({ labelKey: "settings.description", hintKey: "settings.descriptionHint", name: "seoDescription", type: "textarea", wide: true, counter: true })}
          <div class="field field--wide">
            <div class="settings-label-row"><label for="settings-ogImagePath" data-i18n="settings.ogImagePath">${escapeHtml(t("settings.ogImagePath"))}</label></div>
            <input id="settings-ogImagePath" name="ogImagePath" type="text" value="${escapeAttribute(settings.ogImagePath ?? "")}" spellcheck="false" autocomplete="off">
            <p class="field-hint" data-i18n="settings.ogImagePathHint">${escapeHtml(t("settings.ogImagePathHint"))}</p>
            <p class="settings-og-status" data-og-status aria-live="polite"></p>
            <p class="field-error" data-error-for="ogImagePath" hidden></p>
          </div>
          <p class="locale-hint field--wide" data-i18n="settings.seoSharedNote">${escapeHtml(t("settings.seoSharedNote"))}</p>
        </div>
      </section>
    </div>
    <aside class="settings-aside">
      <section class="panel settings-panel settings-panel--preview">
        ${panelHead("settings.preview", "settings.searchAndSocial")}
        <div class="settings-preview" data-settings-preview></div>
      </section>
      <section class="panel settings-panel settings-readiness" data-settings-readiness aria-live="polite"></section>
    </aside>
  `;
}

// The site name and URL are identity, not copy, so they keep their literal
// fallbacks. Only the description sentence is localized.
function previewMarkup(data, imageUrl = "") {
  const title = data.seoTitle || data.siteName || BRAND_FALLBACK;
  const siteUrl = data.siteUrl || URL_FALLBACK;
  let host = siteUrl;
  try {
    host = new URL(siteUrl).host;
  } catch {
    // An unfinished URL still previews as typed.
  }
  const brand = data.siteName || BRAND_FALLBACK;

  return `
    <div class="settings-preview__block">
      <small data-i18n="settings.previewSearch">${escapeHtml(t("settings.previewSearch"))}</small>
      <div class="search-preview settings-search-preview">
        <div class="settings-serp__site">
          <i aria-hidden="true">${escapeHtml(brand.trim().charAt(0).toUpperCase() || "S")}</i>
          <div><b>${escapeHtml(brand)}</b><span>${escapeHtml(siteUrl)}</span></div>
        </div>
        <strong>${escapeHtml(clipForPreview(title, SEO_LIMITS.seoTitle.max))}</strong>
        <p>${escapeHtml(clipForPreview(data.seoDescription || t("settings.previewDescriptionFallback"), SEO_LIMITS.seoDescription.max))}</p>
      </div>
    </div>
    <div class="settings-preview__block">
      <small data-i18n="settings.previewSocial">${escapeHtml(t("settings.previewSocial"))}</small>
      <div class="og-preview settings-og-preview">
        <span>${imageUrl ? `<img src="${escapeAttribute(imageUrl)}" alt="">` : "OG"}</span>
        <div>
          <em>${escapeHtml(host.toUpperCase())}</em>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(data.seoDescription || t("settings.socialPreviewFallback"))}</p>
        </div>
      </div>
    </div>
  `;
}

function readinessMarkup(readiness, { ogPending = false } = {}) {
  const params = {
    title: SEO_LIMITS.seoTitle,
    description: SEO_LIMITS.seoDescription,
  };
  const items = readiness.checks
    .map((check) => {
      const pending = check.key === "ogImage" && ogPending;
      const state = pending ? "is-pending" : check.ok ? "is-ok" : check.severity === "required" ? "is-required" : "is-advice";
      const severity = check.severity === "required" ? "settings.readiness.required" : "settings.readiness.advice";
      return `
        <li class="settings-check ${state}">
          <i aria-hidden="true"></i>
          <span>${escapeHtml(t(CHECK_LABELS[check.key], params[check.key] ?? {}))}${check.ok || pending ? "" : `<small>${escapeHtml(t(severity))}</small>`}</span>
          ${
            check.ok || pending
              ? ""
              : `<button class="text-link" type="button" data-check-target="${check.key}">${escapeHtml(t("settings.readiness.review"))}</button>`
          }
        </li>
      `;
    })
    .join("");
  const percent = Math.round((readiness.score / readiness.total) * 100);
  const blocked = readiness.checks.some((check) => !check.ok && check.severity === "required");

  return `
    ${panelHead(
      "settings.readiness.eyebrow",
      "settings.readiness.title",
      `<strong class="settings-score${blocked ? " is-blocked" : readiness.score === readiness.total ? " is-complete" : ""}">${escapeHtml(
        t("settings.readiness.score", { score: readiness.score, total: readiness.total }),
      )}</strong>`,
    )}
    <div class="settings-meter" aria-hidden="true"><i style="width: ${percent}%"></i></div>
    <ul class="settings-checks">${items}</ul>
  `;
}

function ogStatusText(state, image) {
  if (state === "pending") return ["is-pending", t("settings.og.checking")];
  const size = { width: image?.width ?? 0, height: image?.height ?? 0 };
  const text = {
    missing: t("settings.og.missing"),
    unreadable: t("settings.og.unreadable"),
    small: t("settings.og.small", size),
    ratio: t("settings.og.ratio", size),
    ok: t("settings.og.ok", size),
  }[state];
  return [state === "ok" ? "is-ok" : state === "missing" ? "is-muted" : "is-warning", text];
}

// Resolves with the image's natural size, or null when it never loads.
function measureImage(url, timeout = 8000) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const image = new Image();
    const timer = setTimeout(() => finish(null), timeout);
    function finish(value) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    }
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(null);
    image.src = url;
  });
}

/* --------------------------------------------------------- account panel */

function accountMarkup() {
  return `
    <div class="settings-columns">
      <div class="settings-stack">
        <section class="panel settings-panel">
          ${panelHead("settings.account.eyebrow", "settings.account.sessionTitle")}
          <div data-account-session><p class="empty-inline" data-i18n="common.loading">${escapeHtml(t("common.loading"))}</p></div>
        </section>
        <section class="panel settings-panel">
          ${panelHead("security.team.eyebrow", "settings.account.accessTitle")}
          <div data-account-access aria-live="polite"></div>
          ${
            isSecurityModelActive()
              ? ""
              : `<p class="settings-copy" data-i18n="settings.account.teamCopy">${escapeHtml(t("settings.account.teamCopy"))}</p>
          <ul class="settings-team" data-account-team aria-live="polite"></ul>
          <p class="settings-note" data-i18n="settings.account.teamHowTo">${escapeHtml(t("settings.account.teamHowTo"))}</p>`
          }
        </section>
      </div>
      <div class="settings-stack">
        <section class="panel settings-panel">
          ${panelHead("settings.account.securityEyebrow", "settings.account.passwordTitle")}
          <form class="settings-password" data-password-form novalidate>
            <div class="field">
              <label for="settings-password" data-i18n="settings.account.newPassword">${escapeHtml(t("settings.account.newPassword"))}</label>
              <input id="settings-password" name="password" type="password" autocomplete="new-password">
              <p class="field-error" data-error-for="password" hidden></p>
            </div>
            <div class="field">
              <label for="settings-passwordConfirm" data-i18n="settings.account.confirmPassword">${escapeHtml(t("settings.account.confirmPassword"))}</label>
              <input id="settings-passwordConfirm" name="confirmation" type="password" autocomplete="new-password">
              <p class="field-error" data-error-for="confirmation" hidden></p>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" data-password-reveal>
              <span data-i18n="settings.account.showPasswords">${escapeHtml(t("settings.account.showPasswords"))}</span>
            </label>
            <ul class="settings-rules" data-password-rules></ul>
            <div class="settings-password__actions">
              <button class="button button--primary" type="submit" data-password-submit data-i18n="settings.account.passwordSubmit">${escapeHtml(t("settings.account.passwordSubmit"))}</button>
            </div>
            <p class="settings-note" data-i18n="settings.account.passwordNote">${escapeHtml(t("settings.account.passwordNote"))}</p>
          </form>
        </section>
        <section class="panel settings-panel" data-account-mfa-panel>
          ${panelHead("settings.account.securityEyebrow", "security.mfa.title")}
          <div data-account-mfa aria-live="polite"><p class="empty-inline">${escapeHtml(t("common.loading"))}</p></div>
        </section>
        <section class="panel settings-panel settings-panel--danger">
          ${panelHead("settings.account.sessionsEyebrow", "settings.account.sessionsTitle")}
          <p class="settings-copy" data-i18n="settings.account.sessionsCopy">${escapeHtml(t("settings.account.sessionsCopy"))}</p>
          <button class="button button--danger" type="button" data-sign-out-everywhere data-i18n="settings.account.signOutEverywhere">${escapeHtml(t("settings.account.signOutEverywhere"))}</button>
        </section>
      </div>
    </div>
  `;
}

function sessionMarkup(session) {
  const user = session?.user ?? {};
  const email = user.email ?? "";
  const role = session?.role ?? null;
  const access = getAccess();
  const roles = access?.source === "legacy" ? [] : access?.roles ?? [];
  const facts = [
    ["settings.account.lastSignIn", formatDateTime(user.lastSignInAt)],
    ["settings.account.expires", formatDateTime(session?.expiresAt)],
    ["settings.account.createdAt", formatDateTime(user.createdAt)],
  ];

  return `
    <div class="settings-identity">
      <div class="client-avatar client-avatar--large client-avatar--active" aria-hidden="true">${escapeHtml(initials(email.split("@")[0]))}</div>
      <div>
        <strong>${escapeHtml(email || "—")}</strong>
        ${
          roles.length
            ? roles.map((item) => `<span class="badge badge--success">${escapeHtml(t(roleLabelKey(item.key)))}</span>`).join(" ")
            : role
              ? `<span class="badge badge--success">${escapeHtml(t(ROLE_LABELS[role] ?? ROLE_LABELS.admin))}</span>`
              : ""
        }
        ${access?.member?.ru ? `<code class="team-ru">${escapeHtml(access.member.ru)}</code>` : ""}
      </div>
    </div>
    <dl class="settings-facts">
      ${facts.map(([key, value]) => `<div><dt>${escapeHtml(t(key))}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
    </dl>
    ${DATA_SOURCE === "supabase" ? "" : `<p class="settings-note settings-note--mock">${escapeHtml(t("settings.account.mockSession"))}</p>`}
  `;
}

function teamMarkup(roster, currentUserId) {
  if (!roster.length) return `<li class="empty-inline">${escapeHtml(t("settings.account.teamEmpty"))}</li>`;
  return roster
    .map((member) => {
      const isYou = member.userId === currentUserId;
      return `
        <li class="settings-team__row${isYou ? " is-you" : ""}">
          <code title="${escapeAttribute(member.userId)}">${escapeHtml(String(member.userId).slice(0, 8))}…</code>
          <span class="badge${member.role === "owner" ? " badge--success" : ""}">${escapeHtml(t(ROLE_LABELS[member.role] ?? ROLE_LABELS.admin))}</span>
          <small>${isYou ? `${escapeHtml(t("settings.account.teamYou"))} · ` : ""}${escapeHtml(
            member.createdAt ? t("settings.account.teamSince", { date: formatDateTime(member.createdAt) }) : "—",
          )}</small>
        </li>
      `;
    })
    .join("");
}

function accessMarkup(access) {
  if (!access) return "";
  const member = access.member ?? {};
  const facts = [
    ["security.member.validity", member.accessExpiresAt ? t("security.team.until", { date: formatFullDate(member.accessExpiresAt) }) : t("security.team.permanent")],
    ["security.member.projectsCount", access.permissions.has("projects.read") ? t("security.team.allProjects") : String(access.projects.length)],
  ];
  return `
    <dl class="settings-facts">
      ${facts.map(([key, value]) => `<div><dt>${escapeHtml(t(key))}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
    </dl>
    ${hasPermission("team.read", access) && isSecurityModelActive(access) ? `<p><a class="button button--compact" href="#/team">${escapeHtml(t("settings.account.manageTeam"))}</a></p>` : ""}
  `;
}

function mfaStatusMarkup(access, factor) {
  const state = factor ? "enabled" : mfaState({ roles: (access?.roles ?? []).map((role) => role.key), mfaEnrolledAt: null, mfaGraceUntil: access?.mfa.graceUntil });
  const tone = { enabled: "success", grace: "warning", required: "danger", optional: "neutral" }[state];
  return `
    <p class="mfa-status"><span class="badge badge--${tone}">${escapeHtml(t(`security.mfaState.${state}`))}</span>
    ${state === "grace" ? `<small>${escapeHtml(t("security.mfa.graceUntil", { date: formatFullDate(access.mfa.graceUntil) }))}</small>` : ""}</p>
    <p class="settings-copy">${escapeHtml(t(factor ? "security.mfa.enabledCopy" : state === "optional" ? "security.mfa.optionalCopy" : "security.mfa.requiredCopy"))}</p>
    ${
      factor
        ? `<dl class="settings-facts"><div><dt>${escapeHtml(t("security.mfa.factor"))}</dt><dd>${escapeHtml(factor.name || "TOTP")} · ${escapeHtml(formatFullDate(factor.createdAt))}</dd></div></dl>
           <button class="button button--danger" type="button" data-mfa-remove="${escapeAttribute(factor.id)}">${escapeHtml(t("security.mfa.remove"))}</button>`
        : mfaEnrollMarkup()
    }
  `;
}

function rulesMarkup(form, email) {
  const password = form.elements.password.value;
  const confirmation = form.elements.confirmation.value;
  const idle = !password && !confirmation;
  return passwordChecks(password, confirmation, email)
    .map(
      (check) =>
        `<li class="${idle ? "" : check.ok ? "is-ok" : "is-missing"}"><i aria-hidden="true"></i>${escapeHtml(t(RULE_LABELS[check.key], { min: PASSWORD_MIN }))}</li>`,
    )
    .join("");
}

/* ---------------------------------------------------------- system panel */

function systemMarkup() {
  return `
    <div class="metric-strip settings-health-strip" data-health-metrics aria-live="polite">${healthMetricsMarkup(null)}</div>
    <section class="panel settings-panel">
      ${panelHead(
        "settings.system.eyebrow",
        "settings.system.title",
        `<div class="settings-health__actions"><small data-health-checked></small><button class="button" type="button" data-health-recheck data-i18n="settings.system.recheck">${escapeHtml(t("settings.system.recheck"))}</button></div>`,
      )}
      <p class="settings-copy" data-i18n="settings.system.intro">${escapeHtml(t("settings.system.intro"))}</p>
      <ul class="settings-health" data-health-list aria-busy="true"></ul>
    </section>
    <section class="settings-pending" data-health-pending hidden></section>
    <section class="panel settings-panel settings-panel--runtime">
      ${panelHead("settings.integrations", "settings.runtimeStatus")}
      <div class="integration-grid settings-integration-grid" data-runtime-grid>${runtimeMarkup()}</div>
      <p class="settings-note" data-i18n="settings.noSecrets">${escapeHtml(t("settings.noSecrets"))}</p>
    </section>
  `;
}

function sourceLabel() {
  return DATA_SOURCE === "supabase" ? t("settings.system.sources.supabase") : t("settings.system.sources.mock");
}

function runtimeMarkup() {
  const configured = isSupabaseConfigured();
  const rows = [
    ["settings.system.metrics.source", sourceLabel()],
    ["settings.database", configured ? t("common.configured") : t("common.notConfigured")],
    ["settings.storage", configured ? t("common.projectMedia") : t("common.mockMode")],
    ["settings.publicSite", t("settings.readOnlyAnonKey")],
    ["settings.system.build", import.meta.env?.PROD ? t("settings.system.buildProd") : t("settings.system.buildDev")],
  ];
  return rows.map(([key, value]) => `<div><span>${escapeHtml(t(key))}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function healthMetricsMarkup(results) {
  const summary = results ? healthSummary(results) : null;
  const answered = results?.filter((result) => result.status === "ok") ?? [];
  const latency = answered.length ? Math.round(answered.reduce((total, result) => total + result.latency, 0) / answered.length) : null;
  const stateClass = !summary ? "" : summary.state === "ok" ? "is-ok" : summary.state === "down" ? "is-danger" : "is-warn";
  const metrics = [
    ["settings.system.metrics.state", summary ? t(HEALTH_STATES[summary.state]) : "—", stateClass],
    ["settings.system.metrics.modules", summary ? `${summary.ok}/${summary.total}` : "—", summary && summary.ok < summary.total ? "is-warn" : ""],
    ["settings.system.metrics.latency", latency === null ? "—" : `${latency} ms`, ""],
    ["settings.system.metrics.source", sourceLabel(), ""],
  ];
  return metrics
    .map(([key, value, className]) => `<div class="project-metric ${className}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(t(key))}</span></div>`)
    .join("");
}

function healthRowsMarkup(results) {
  if (!results) {
    return Object.values(MODULE_LABELS)
      .map((key) => `<li class="settings-health__row is-pending"><i aria-hidden="true"></i><strong>${escapeHtml(t(key))}</strong><span class="badge badge--muted">${escapeHtml(t("settings.system.checking"))}</span></li>`)
      .join("");
  }
  const slowest = Math.max(1, ...results.map((result) => result.latency));
  return results
    .map((result) => {
      const ok = result.status === "ok";
      const badge = ok ? "badge--success" : result.status === "schema" ? "badge--warning" : "badge--danger";
      return `
        <li class="settings-health__row ${ok ? "is-ok" : "is-failing"}" data-health-module="${result.key}" data-health-status="${result.status}">
          <i aria-hidden="true"></i>
          <strong>${escapeHtml(t(MODULE_LABELS[result.key]))}</strong>
          <span class="badge ${badge}">${escapeHtml(t(STATUS_LABELS[result.status]))}</span>
          <span class="settings-health__count">${ok ? escapeHtml(plural("settings.system.records", result.count)) : "—"}</span>
          <span class="settings-health__latency" title="${escapeAttribute(`${result.latency} ms`)}"><b style="width: ${Math.max(4, Math.round((result.latency / slowest) * 100))}%"></b><em>${result.latency} ms</em></span>
          ${ok ? "" : `<p>${escapeHtml(result.message ?? "")}${result.status === "schema" && result.migration ? ` <code>${escapeHtml(result.migration)}</code>` : ""}</p>`}
        </li>
      `;
    })
    .join("");
}

function pendingMarkup(migrations) {
  return `
    <strong data-i18n="settings.system.pendingTitle">${escapeHtml(t("settings.system.pendingTitle"))}</strong>
    <p data-i18n="settings.system.pendingCopy">${escapeHtml(t("settings.system.pendingCopy"))}</p>
    <ol>${[...migrations].sort().map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ol>
  `;
}

/* ------------------------------------------------------------ data panel */

function dataMarkup() {
  return `
    <div class="settings-columns">
      <section class="panel settings-panel">
        ${panelHead("settings.data.eyebrow", "settings.data.backupTitle")}
        <p class="settings-copy" data-i18n="settings.data.backupCopy">${escapeHtml(t("settings.data.backupCopy"))}</p>
        <p class="settings-note settings-note--warning" data-i18n="settings.data.backupExcludes">${escapeHtml(t("settings.data.backupExcludes"))}</p>
        <button class="button button--primary" type="button" data-backup-export data-requires="data.export" data-i18n="settings.data.export">${escapeHtml(t("settings.data.export"))}</button>
        <p class="settings-backup-result" data-backup-result aria-live="polite" hidden></p>
      </section>
      <section class="panel settings-panel">
        ${panelHead("settings.data.eyebrow", "settings.data.countsTitle")}
        <dl class="settings-counts" data-backup-counts aria-live="polite"><p class="empty-inline">${escapeHtml(t("settings.data.countsLoading"))}</p></dl>
      </section>
    </div>
    ${
      DATA_SOURCE === "supabase"
        ? `<p class="settings-note" data-i18n="settings.data.supabaseRestore">${escapeHtml(t("settings.data.supabaseRestore"))}</p>`
        : `
          <section class="panel settings-panel settings-panel--danger settings-reset">
            ${panelHead("settings.data.resetEyebrow", "settings.data.resetTitle")}
            <p class="settings-copy" data-i18n="settings.data.resetCopy">${escapeHtml(t("settings.data.resetCopy"))}</p>
            <button class="button button--danger" type="button" data-mock-reset data-i18n="settings.data.reset">${escapeHtml(t("settings.data.reset"))}</button>
          </section>
        `
    }
  `;
}

function countsMarkup(results) {
  const rows = results
    .map((result) => {
      const ok = result.status === "ok";
      return `<div class="${ok ? "" : "is-missing"}"><dt>${escapeHtml(t(MODULE_LABELS[result.key]))}</dt><dd>${ok ? result.count : escapeHtml(t("settings.data.unavailable"))}</dd></div>`;
    })
    .join("");
  const total = results.filter((result) => result.status === "ok").reduce((sum, result) => sum + result.count, 0);
  return `${rows}<div class="settings-counts__total"><dt>${escapeHtml(t("settings.data.total"))}</dt><dd>${total}</dd></div>`;
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ------------------------------------------------------------------ page */

export const settingsPage = {
  title: () => t("settings.title"),
  breadcrumb: () => t("settings.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="settings.eyebrow">${t("settings.eyebrow")}</span>
        <h2 data-i18n="settings.heading">${t("settings.heading")}</h2>
        <p data-i18n="settings.intro">${t("settings.intro")}</p>
      </div>
      <strong class="settings-source${DATA_SOURCE === "supabase" ? " is-live" : ""}" data-settings-source>${escapeHtml(sourceLabel())}</strong>
    </section>
    <div class="settings-shell" data-settings>
      <div class="tabs settings-tabs" role="tablist" aria-label="${escapeAttribute(t("settings.sections"))}" data-i18n-aria-label="settings.sections">
        ${visibleTabs().map(
          ([id, key], index) =>
            `<button type="button" role="tab" id="settings-tab-${id}" data-tab="${id}" aria-selected="${index === 0}" aria-controls="settings-panel-${id}" tabindex="${index === 0 ? 0 : -1}" data-i18n="${key}">${escapeHtml(t(key))}</button>`,
        ).join("")}
      </div>
      <section class="settings-tabpanel" id="settings-panel-site" role="tabpanel" aria-labelledby="settings-tab-site"${visibleTabs()[0]?.[0] === "site" ? "" : " hidden"}>
        <form class="settings-grid" data-settings-form aria-busy="true" novalidate>
          <section class="panel"><p class="empty-inline" data-i18n="settings.loadingSettings">${t("settings.loadingSettings")}</p></section>
        </form>
      </section>
      <section class="settings-tabpanel" id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account"${visibleTabs()[0]?.[0] === "account" ? "" : " hidden"} data-settings-account></section>
      <section class="settings-tabpanel" id="settings-panel-system" role="tabpanel" aria-labelledby="settings-tab-system" hidden data-settings-system></section>
      <section class="settings-tabpanel" id="settings-panel-data" role="tabpanel" aria-labelledby="settings-tab-data" hidden data-settings-data></section>
    </div>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-settings]");
    const form = root.querySelector("[data-settings-form]");
    const loaded = new Set();
    const state = {
      saved: null,
      baseline: "",
      seoLocale: BASE_LOCALE,
      seoBase: {},
      seoTranslation: {},
      og: { path: null, state: "missing", image: null, pending: false, url: "" },
      ogToken: 0,
      health: null,
      healthAt: null,
      checking: null,
    };

    /* ---- tabs: each panel mounts the first time it is shown */

    bindTabs(root);
    const tablist = root.querySelector('[role="tablist"]');
    const openActiveTab = () => {
      const active = tablist.querySelector('[aria-selected="true"]')?.dataset.tab;
      if (active && !loaded.has(active)) {
        loaded.add(active);
        ({ account: mountAccount, system: mountSystem, data: mountData })[active]?.();
      }
    };
    tablist.addEventListener("click", openActiveTab);
    tablist.addEventListener("keydown", openActiveTab);
    const siteVisible = visibleTabs().some(([id]) => id === "site");
    if (siteVisible) loaded.add("site");

    /* ---- site: drafts per language */

    function captureSeoDraft() {
      Object.entries(SEO_FIELDS).forEach(([control, column]) => {
        const input = form.elements[control];
        if (!input) return;
        if (state.seoLocale === BASE_LOCALE) state.seoBase[control] = input.value;
        else state.seoTranslation[column] = input.value;
      });
    }

    function paintSeoLocale() {
      const showingBase = state.seoLocale === BASE_LOCALE;
      Object.entries(SEO_FIELDS).forEach(([control, column]) => {
        const input = form.elements[control];
        if (!input) return;
        input.value = showingBase ? state.seoBase[control] ?? "" : state.seoTranslation[column] ?? "";
        input.placeholder = showingBase ? "" : state.seoBase[control] ?? "";
        input.classList.toggle("is-translation", !showingBase);
      });
      form.querySelectorAll("[data-locale-edit]").forEach((button) => {
        const active = button.dataset.localeEdit === state.seoLocale;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      form.querySelectorAll("[data-locale-hint]").forEach((hint) => {
        hint.hidden = showingBase;
      });
    }

    function switchSeoLocale(next) {
      if (next === state.seoLocale) return;
      captureSeoDraft();
      state.seoLocale = next;
      paintSeoLocale();
      paintSite();
    }

    // Always reports the pt-BR values, whichever language the form shows.
    function readForm() {
      captureSeoDraft();
      const data = Object.fromEntries(SITE_FIELDS.map((name) => [name, String(form.elements[name]?.value ?? "").trim()]));
      Object.keys(SEO_FIELDS).forEach((control) => {
        data[control] = String(state.seoBase[control] ?? "").trim();
      });
      return data;
    }

    // A blank English field is dropped rather than stored, so the public site
    // falls back to the pt-BR value for it. Other locales are kept as found.
    function readTranslations() {
      const translation = Object.fromEntries(
        Object.values(SEO_FIELDS)
          .map((column) => [column, String(state.seoTranslation[column] ?? "").trim()])
          .filter(([, value]) => value !== ""),
      );
      const translations = { ...(state.saved?.translations ?? {}) };
      if (Object.keys(translation).length) translations[TRANSLATION_LOCALE] = translation;
      else delete translations[TRANSLATION_LOCALE];
      return translations;
    }

    const snapshot = () => JSON.stringify({ ...readForm(), translations: readTranslations()[TRANSLATION_LOCALE] ?? {} });
    const isDirty = () => Boolean(state.saved) && snapshot() !== state.baseline;

    function setSaveState(kind) {
      const node = form.querySelector("[data-settings-state]");
      if (!node) return;
      const labels = {
        saved: "settings.saved",
        unsaved: "settings.unsaved",
        saving: "settings.saving",
        invalid: "settings.fixFields",
        failed: "settings.saveFailed",
      };
      node.dataset.kind = kind;
      node.textContent = t(labels[kind]);
      node.classList.toggle("is-saved", kind === "saved");
      node.classList.toggle("is-unsaved", kind === "unsaved" || kind === "invalid");
      node.classList.toggle("is-saving", kind === "saving");
      node.classList.toggle("is-error", kind === "failed");
      const discard = form.querySelector("[data-settings-discard]");
      if (discard) discard.disabled = kind === "saved" || kind === "saving";
    }

    const hasVisibleErrors = () => Boolean(form.querySelector("[data-error-for]:not([hidden])"));

    function refreshSaveState() {
      if (form.querySelector("[data-settings-state]")?.dataset.kind === "saving") return;
      setSaveState(!isDirty() ? "saved" : hasVisibleErrors() ? "invalid" : "unsaved");
    }

    function paintUpdated() {
      const node = form.querySelector("[data-settings-updated]");
      if (!node) return;
      node.textContent = state.saved?.updatedAt ? t("settings.lastUpdated", { date: formatDateTime(state.saved.updatedAt) }) : t("settings.neverUpdated");
    }

    function showErrors(errors) {
      form.querySelectorAll("[data-error-for]").forEach((node) => {
        const key = errors[node.dataset.errorFor];
        node.hidden = !key;
        node.textContent = key ? t(key) : "";
        form.elements[node.dataset.errorFor]?.toggleAttribute("aria-invalid", Boolean(key));
      });
    }

    // The counters read what the field shows, so on the English tab they
    // measure the English copy.
    function paintCounters() {
      Object.keys(SEO_FIELDS).forEach((name) => {
        const counter = form.querySelector(`[data-counter-for="${name}"]`);
        const input = form.elements[name];
        if (!counter || !input) return;
        const limits = SEO_LIMITS[name];
        const length = input.value.trim().length;
        const lengthKind = lengthState(input.value, limits);
        counter.className = `settings-counter is-${lengthKind}`;
        counter.textContent = `${length}/${limits.max} · ${t(LENGTH_LABELS[lengthKind])}`;
      });
    }

    function paintOg() {
      const node = form.querySelector("[data-og-status]");
      if (!node) return;
      const [className, text] = ogStatusText(state.og.pending ? "pending" : state.og.state, state.og.image);
      node.className = `settings-og-status ${className}`;
      node.textContent = text;
    }

    // What the public site would render for the language being edited: the
    // English tab previews English copy, falling back to pt-BR like the site.
    function previewData() {
      const data = readForm();
      if (state.seoLocale === TRANSLATION_LOCALE) {
        data.seoTitle = String(state.seoTranslation.seo_title ?? "").trim() || data.seoTitle;
        data.seoDescription = String(state.seoTranslation.seo_description ?? "").trim() || data.seoDescription;
      }
      return data;
    }

    function paintSite() {
      if (!state.saved) return;
      const preview = form.querySelector("[data-settings-preview]");
      if (preview) preview.innerHTML = previewMarkup(previewData(), state.og.url);
      const readiness = form.querySelector("[data-settings-readiness]");
      if (readiness) {
        const data = { ...readForm(), translations: readTranslations() };
        readiness.innerHTML = readinessMarkup(shareReadiness(data, state.og.image), { ogPending: state.og.pending });
      }
      paintCounters();
      paintOg();
      paintUpdated();
    }

    let ogTimer = null;
    function scheduleOgProbe(delay = 400) {
      clearTimeout(ogTimer);
      ogTimer = setTimeout(probeOg, delay);
    }

    async function probeOg() {
      const path = String(form.elements.ogImagePath?.value ?? "").trim();
      if (path === state.og.path) return;
      const token = ++state.ogToken;
      state.og = { path, state: "missing", image: null, pending: Boolean(path), url: "" };
      paintSite();
      if (!path) return;
      const url = (await resolveImageUrl(path)) || "";
      const image = await measureImage(url);
      if (token !== state.ogToken || !form.isConnected) return;
      state.og = { path, state: ogImageState(path, image), image, pending: false, url: image ? url : "" };
      paintSite();
    }

    function mountSite(settings) {
      state.saved = settings;
      state.seoLocale = BASE_LOCALE;
      state.seoBase = { seoTitle: settings.seoTitle ?? "", seoDescription: settings.seoDescription ?? "" };
      state.seoTranslation = { ...(settings.translations?.[TRANSLATION_LOCALE] ?? {}) };
      state.og = { ...state.og, path: null };
      form.innerHTML = siteFormMarkup(settings);
      const lock = (names, permission) =>
        names.forEach((name) => {
          if (form.elements[name] && !hasPermission(permission)) form.elements[name].disabled = true;
        });
      lock(IDENTITY_FIELDS, "settings.edit");
      lock(SEARCH_FIELDS, "seo.edit");
      form.querySelector("[data-settings-save]")?.setAttribute("data-requires", "settings.edit|seo.edit");
      form.querySelector("[data-settings-discard]")?.setAttribute("data-requires", "settings.edit|seo.edit");
      paintSeoLocale();
      state.baseline = snapshot();
      setSaveState("saved");
      paintSite();
      probeOg();
    }

    if (siteVisible) {
      try {
        mountSite(await getSiteSettings());
        form.removeAttribute("aria-busy");
      } catch (error) {
        form.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, t("settings.loadError")))}</p></section>`;
        form.removeAttribute("aria-busy");
      }

      setNavigationGuard(() => isDirty());
    }

    form.addEventListener("input", (event) => {
      if (!state.saved) return;
      if (event.target.name === "ogImagePath") scheduleOgProbe();
      // Once a save has flagged fields, each edit re-checks them, so a fixed
      // field clears its message without another save attempt.
      if (hasVisibleErrors()) showErrors(validateSiteSettings(readForm()));
      refreshSaveState();
      paintSite();
    });

    form.addEventListener("click", async (event) => {
      const localeButton = event.target.closest("[data-locale-edit]");
      if (localeButton) {
        switchSeoLocale(localeButton.dataset.localeEdit);
        return;
      }

      const check = event.target.closest("[data-check-target]");
      if (check) {
        const [name, locale] = CHECK_TARGETS[check.dataset.checkTarget] ?? [];
        if (!name) return;
        switchSeoLocale(locale);
        form.elements[name]?.focus();
        return;
      }

      if (event.target.closest("[data-settings-discard]")) {
        const confirmed = await confirmModal({
          title: t("settings.discardTitle"),
          body: `<p>${escapeHtml(t("settings.discardBody"))}</p>`,
          confirmLabel: t("settings.discardConfirm"),
        });
        if (!confirmed || !state.saved) return;
        mountSite(state.saved);
        showToast(t("settings.discardedToast"));
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.saved) return;
      const data = readForm();
      const errors = validateSiteSettings(data);
      showErrors(errors);
      const [firstError] = Object.keys(errors);
      if (firstError) {
        setSaveState("invalid");
        form.elements[firstError]?.focus();
        return;
      }
      const button = form.querySelector("[data-settings-save]");
      button.disabled = true;
      setSaveState("saving");
      try {
        const saved = await saveSiteSettings({ ...data, translations: readTranslations() });
        await logActivity("Settings updated", "Public settings updated", { action: "settings.updated", entityType: "settings", entityId: "public" });
        state.saved = { ...state.saved, ...data, translations: readTranslations(), ...(saved ?? {}) };
        state.baseline = snapshot();
        setSaveState("saved");
        paintSite();
        showToast(t("settings.savedToast"));
      } catch (error) {
        showToast(describeError(error, t("settings.saveError")));
        setSaveState("failed");
      } finally {
        button.disabled = false;
      }
    });

    /* ---- account */

    let paintAccount = () => {};
    let paintTeam = () => {};

    async function mountAccount() {
      const panel = root.querySelector("[data-settings-account]");
      panel.innerHTML = accountMarkup();
      const session = getCachedSession() ?? (await getSession());
      const email = session?.user?.email ?? "";
      const passwordForm = panel.querySelector("[data-password-form]");
      paintAccount = () => {
        panel.querySelector("[data-account-session]").innerHTML = sessionMarkup(session);
        panel.querySelector("[data-password-rules]").innerHTML = rulesMarkup(passwordForm, email);
      };
      paintAccount();

      const accessBox = panel.querySelector("[data-account-access]");
      const paintAccessBox = () => {
        accessBox.innerHTML = accessMarkup(getAccess());
      };
      paintAccessBox();

      // Before the security migration the legacy roster is all there is. Not
      // awaited: a slow roster never holds up the password form.
      const team = panel.querySelector("[data-account-team]");
      if (team) {
        getAdminRoster()
          .then((roster) => {
            paintTeam = () => {
              team.innerHTML = teamMarkup(roster, session?.user?.id);
              paintAccessBox();
            };
            paintTeam();
          })
          .catch((error) => {
            team.innerHTML = `<li class="empty-inline">${escapeHtml(describeError(error, t("settings.account.teamError")))}</li>`;
          });
      } else {
        paintTeam = paintAccessBox;
      }

      // MFA through Supabase Auth: enrol, or remove the enrolled factor.
      const mfaBox = panel.querySelector("[data-account-mfa]");
      const paintMfa = async () => {
        try {
          const factor = (await listFactors()).find((item) => item.type === "totp" && item.status === "verified") ?? null;
          mfaBox.innerHTML = mfaStatusMarkup(getAccess(), factor);
          if (!factor) {
            bindMfaEnroll(mfaBox, {
              onDone: async () => {
                await loadAccess(getCachedSession(), { force: true }).catch(() => null);
                showToast(t("security.mfa.enabled"));
                await paintMfa();
              },
            });
          }
        } catch (error) {
          mfaBox.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("security.mfa.loadError")))}</p>`;
        }
      };
      paintMfa();
      mfaBox.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-mfa-remove]");
        if (!button) return;
        const confirmed = await confirmModal({
          title: t("security.mfa.removeTitle"),
          body: `<p>${escapeHtml(t(getAccess()?.mfa.required ? "security.mfa.removeRequiredBody" : "security.mfa.removeBody"))}</p>`,
          confirmLabel: t("security.mfa.remove"),
        });
        if (!confirmed) return;
        button.disabled = true;
        try {
          await removeFactor(button.dataset.mfaRemove);
          await recordMfaState();
          await loadAccess(getCachedSession(), { force: true }).catch(() => null);
          showToast(t("security.mfa.removed"));
          await paintMfa();
        } catch (error) {
          showToast(describeError(error, t("security.mfa.removeError")));
          button.disabled = false;
        }
      });

      const clearPasswordErrors = () =>
        passwordForm.querySelectorAll("[data-error-for]").forEach((node) => {
          node.hidden = true;
          node.textContent = "";
          passwordForm.elements[node.dataset.errorFor]?.removeAttribute("aria-invalid");
        });

      passwordForm.addEventListener("input", (event) => {
        if (event.target.matches("[data-password-reveal]")) return;
        panel.querySelector("[data-password-rules]").innerHTML = rulesMarkup(passwordForm, email);
        clearPasswordErrors();
      });
      passwordForm.querySelector("[data-password-reveal]").addEventListener("change", (event) => {
        const type = event.target.checked ? "text" : "password";
        passwordForm.elements.password.type = type;
        passwordForm.elements.confirmation.type = type;
      });
      passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearPasswordErrors();
        const button = passwordForm.querySelector("[data-password-submit]");
        button.disabled = true;
        button.textContent = t("settings.account.passwordSaving");
        try {
          await changePassword(passwordForm.elements.password.value, passwordForm.elements.confirmation.value);
          passwordForm.reset();
          passwordForm.elements.password.type = "password";
          passwordForm.elements.confirmation.type = "password";
          panel.querySelector("[data-password-rules]").innerHTML = rulesMarkup(passwordForm, email);
          showToast(DATA_SOURCE === "supabase" ? t("settings.account.passwordChanged") : t("settings.account.passwordChangedMock"));
        } catch (error) {
          const target = passwordForm.querySelector(`[data-error-for="${error?.field}"]`);
          if (target) {
            target.hidden = false;
            target.textContent = error.message;
            passwordForm.elements[error.field]?.setAttribute("aria-invalid", "true");
            passwordForm.elements[error.field]?.focus();
          } else {
            showToast(describeError(error, t("settings.account.passwordError")));
          }
        } finally {
          button.disabled = false;
          button.textContent = t("settings.account.passwordSubmit");
        }
      });

      panel.querySelector("[data-sign-out-everywhere]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const confirmed = await confirmModal({
          title: t("settings.account.signOutTitle"),
          body: `<p>${escapeHtml(t("settings.account.signOutBody"))}</p>`,
          confirmLabel: t("settings.account.signOutConfirm"),
        });
        if (!confirmed) return;
        button.disabled = true;
        try {
          await signOutEverywhere();
          // The user asked to leave; unsaved site edits go with the session.
          clearNavigationGuard();
          window.location.hash = "#/login";
        } catch (error) {
          showToast(describeError(error, t("settings.account.signOutError")));
          button.disabled = false;
        }
      });
    }

    /* ---- system */

    // One read of every module at a time; the Data tab reuses the answer.
    function runChecks() {
      if (!state.checking) {
        state.checking = checkModules()
          .then((results) => {
            state.health = results;
            state.healthAt = new Date();
            return results;
          })
          .finally(() => {
            state.checking = null;
          });
      }
      return state.checking;
    }

    function paintSystem() {
      const panel = root.querySelector("[data-settings-system]");
      if (!panel?.childElementCount) return;
      const results = state.health;
      panel.querySelector("[data-health-metrics]").innerHTML = healthMetricsMarkup(results);
      const list = panel.querySelector("[data-health-list]");
      list.innerHTML = healthRowsMarkup(results);
      list.setAttribute("aria-busy", String(!results));
      panel.querySelector("[data-health-checked]").textContent = state.healthAt ? t("settings.system.checkedAt", { time: formatTime(state.healthAt) }) : "";
      panel.querySelector("[data-runtime-grid]").innerHTML = runtimeMarkup();
      const pending = panel.querySelector("[data-health-pending]");
      const migrations = results ? healthSummary(results).pendingMigrations : [];
      pending.hidden = !migrations.length;
      pending.innerHTML = migrations.length ? pendingMarkup(migrations) : "";
    }

    async function recheck() {
      const button = root.querySelector("[data-health-recheck]");
      if (button) {
        button.disabled = true;
        button.textContent = t("settings.system.checking");
      }
      state.health = null;
      paintSystem();
      await runChecks();
      paintSystem();
      paintData();
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = t("settings.system.recheck");
      }
    }

    function mountSystem() {
      const panel = root.querySelector("[data-settings-system]");
      panel.innerHTML = systemMarkup();
      panel.querySelector("[data-health-recheck]").addEventListener("click", recheck);
      if (state.health) paintSystem();
      else recheck();
    }

    /* ---- data */

    function paintData() {
      const counts = root.querySelector("[data-backup-counts]");
      if (counts && state.health) counts.innerHTML = countsMarkup(state.health);
    }

    function mountData() {
      const panel = root.querySelector("[data-settings-data]");
      panel.innerHTML = dataMarkup();
      if (state.health) paintData();
      else runChecks().then(paintData);

      panel.querySelector("[data-backup-export]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const result = panel.querySelector("[data-backup-result]");
        button.disabled = true;
        button.textContent = t("settings.data.exporting");
        try {
          const generatedAt = new Date();
          const { backup, results } = await exportBackup({ generatedAt: generatedAt.toISOString() });
          downloadJson(backupFilename(generatedAt), backup);
          state.health = results;
          state.healthAt = generatedAt;
          paintData();
          paintSystem();
          const missing = backup.missing.map((key) => t(MODULE_LABELS[key])).join(", ");
          result.hidden = false;
          result.classList.toggle("is-partial", Boolean(missing));
          result.textContent = missing ? t("settings.data.exportedPartial", { modules: missing }) : t("settings.data.exported");
          showToast(result.textContent);
        } catch (error) {
          showToast(describeError(error, t("settings.data.exportError")));
        } finally {
          button.disabled = false;
          button.textContent = t("settings.data.export");
        }
      });

      panel.querySelector("[data-mock-reset]")?.addEventListener("click", async () => {
        const confirmed = await confirmModal({
          title: t("settings.data.resetConfirmTitle"),
          body: `<p>${escapeHtml(t("settings.data.resetConfirmBody"))}</p>`,
          confirmLabel: t("settings.data.resetConfirm"),
        });
        if (!confirmed) return;
        resetMockData();
        showToast(t("settings.data.resetDone"));
        state.health = null;
        await runChecks();
        paintData();
        paintSystem();
      });
    }

    /* ---- language switch: generated markup is re-worded from what is on screen */

    onLocaleChange(root, () => {
      if (state.saved) paintSite();
      const kind = form.querySelector("[data-settings-state]")?.dataset.kind;
      if (kind) setSaveState(kind);
      paintAccount();
      paintTeam();
      paintSystem();
      paintData();
      const source = document.querySelector("[data-settings-source]");
      if (source) source.textContent = sourceLabel();
    });

    // Members without the site tab start on the first tab they do see.
    if (!siteVisible) openActiveTab();

  },
  beforeLeave: () => clearNavigationGuard(),
};

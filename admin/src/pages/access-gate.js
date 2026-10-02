import { accessScreen } from "../components/access-screen.js";
import { bindMfaEnroll, mfaEnrollMarkup } from "../components/mfa-enroll.js";
import { t } from "../i18n/index.js";
import { activateMembership, loadAccess, recordMfaState, setOwnPassword } from "../services/access-service.js";
import { getCachedSession, logout } from "../services/auth-service.js";
import { describeError } from "../services/errors.js";
import { verifiedTotp, verifyTotp } from "../services/mfa-service.js";
import { formatFullDate } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";
import { passwordChecks, PASSWORD_MIN, validateNewPassword } from "../utils/settings-checks.js";

// What a signed-in person sees when the database says they cannot go further
// yet: a suspended, expired or offboarded account, an invitation still to
// accept, MFA still to enable or to verify. Each screen explains the state in
// plain words and offers the one way forward, or signing out. None of them is
// a security boundary: the database refuses the data either way.

const signOutButton = () => `<button class="button" type="button" data-gate-sign-out data-i18n="shell.signOut">${escapeHtml(t("shell.signOut"))}</button>`;

async function signOut() {
  await logout().catch(() => {});
  window.location.hash = "#/login";
  window.location.reload();
}

function passwordForm(prefix) {
  return `
    <form class="login-form" data-gate-password novalidate>
      <div class="field">
        <label for="${prefix}-password" data-i18n="settings.account.newPassword">${escapeHtml(t("settings.account.newPassword"))}</label>
        <input id="${prefix}-password" name="password" type="password" autocomplete="new-password" required>
      </div>
      <div class="field">
        <label for="${prefix}-confirmation" data-i18n="settings.account.confirmPassword">${escapeHtml(t("settings.account.confirmPassword"))}</label>
        <input id="${prefix}-confirmation" name="confirmation" type="password" autocomplete="new-password" required>
      </div>
      <ul class="settings-rules" data-gate-rules></ul>
      <p class="field-error" data-gate-error role="alert" hidden></p>
      <button class="button button--primary" type="submit" data-gate-submit>${escapeHtml(t("security.welcome.activate"))}</button>
    </form>
  `;
}

// The same rules and wording as the password form in Settings.
const RULE_LABELS = {
  length: "settings.account.rules.length",
  mix: "settings.account.rules.mix",
  email: "settings.account.rules.email",
  match: "settings.account.rules.match",
};

// Choose a password, then activate: the database refuses activation without one.
export function bindPasswordStep(root, { email = "", submitLabel, onSubmit }) {
  const form = root.querySelector("[data-gate-password]");
  if (!form) return;
  const rules = form.querySelector("[data-gate-rules]");
  const error = form.querySelector("[data-gate-error]");
  const submit = form.querySelector("[data-gate-submit]");
  if (submitLabel) submit.textContent = submitLabel;
  const paintRules = () => {
    rules.innerHTML = passwordChecks(form.elements.password.value, form.elements.confirmation.value, email)
      .map((check) => `<li class="${check.ok ? "is-ok" : "is-missing"}"><i aria-hidden="true"></i>${escapeHtml(t(RULE_LABELS[check.key], { min: PASSWORD_MIN }))}</li>`)
      .join("");
  };
  paintRules();
  form.addEventListener("input", paintRules);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errors = validateNewPassword(form.elements.password.value, form.elements.confirmation.value, email);
    const [field] = Object.keys(errors);
    if (field) {
      error.hidden = false;
      error.textContent = t(errors[field], { min: PASSWORD_MIN });
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(form.elements.password.value);
    } catch (failure) {
      error.hidden = false;
      error.textContent = describeError(failure, t("security.welcome.activateError"));
      submit.disabled = false;
    }
  });
}

async function continueToAdmin(rerender) {
  await loadAccess(getCachedSession(), { force: true });
  if (window.location.hash === "#/dashboard") rerender();
  else window.location.hash = "#/dashboard";
}

const SCREENS = {
  NOT_MEMBER: () => ({ title: t("shell.deniedTitle"), heading: t("shell.accessDenied"), copy: t("shell.accountNotAdmin") }),
  UNAUTHENTICATED: () => ({ title: t("shell.deniedTitle"), heading: t("shell.accessDenied"), copy: t("shell.accountNotAdmin") }),
  SUSPENDED: () => ({ title: t("security.states.suspendedTitle"), heading: t("security.states.suspendedHeading"), copy: t("security.states.suspendedCopy"), tone: "danger" }),
  EXPIRED: (access) => ({
    title: t("security.states.expiredTitle"),
    heading: t("security.states.expiredHeading"),
    copy: access.member?.accessExpiresAt ? t("security.states.expiredOn", { date: formatFullDate(access.member.accessExpiresAt) }) : t("security.states.expiredCopy"),
    tone: "danger",
  }),
  OFFBOARDED: () => ({ title: t("security.states.offboardedTitle"), heading: t("security.states.offboardedHeading"), copy: t("security.states.offboardedCopy"), tone: "danger" }),
  SESSION_REVOKED: () => ({
    title: t("security.states.sessionRevokedTitle"),
    heading: t("security.states.sessionRevokedHeading"),
    copy: t("security.states.sessionRevokedCopy"),
    signInAgain: true,
  }),
  NOT_STARTED: (access) => ({
    title: t("security.states.notStartedTitle"),
    heading: t("security.states.notStartedHeading"),
    copy: t("security.states.notStartedCopy", { date: formatFullDate(access.member?.accessStartsAt) }),
  }),
};

// Returns the markup and the binder for a blocked member.
export function blockedScreen(access, rerender) {
  const reason = access?.blockedReason ?? "NOT_MEMBER";

  if (reason === "INVITED") {
    return {
      html: accessScreen({
        title: t("security.welcome.title"),
        heading: t("security.welcome.activateHeading", { name: access.member?.displayName ?? "" }),
        copy: t("security.welcome.activateCopy"),
        body: passwordForm("gate"),
        action: signOutButton(),
      }),
      bind: (root) =>
        bindPasswordStep(root, {
          email: access.member?.email ?? "",
          onSubmit: async (password) => {
            await setOwnPassword(password);
            await activateMembership();
            await continueToAdmin(rerender);
          },
        }),
    };
  }

  if (reason === "MFA_ENROLL_REQUIRED") {
    return {
      html: accessScreen({
        title: t("security.states.mfaTitle"),
        heading: t("security.states.mfaEnrollHeading"),
        copy: t("security.states.mfaEnrollCopy"),
        body: mfaEnrollMarkup(),
        action: signOutButton(),
      }),
      bind: (root) => bindMfaEnroll(root, { onDone: () => continueToAdmin(rerender) }),
    };
  }

  if (reason === "MFA_CHALLENGE_REQUIRED") {
    return {
      html: accessScreen({
        title: t("security.states.mfaTitle"),
        heading: t("security.states.mfaChallengeHeading"),
        copy: t("security.states.mfaChallengeCopy"),
        body: `
          <form class="login-form" data-gate-mfa novalidate>
            <div class="field">
              <label for="gate-mfa-code" data-i18n="security.stepUp.codeLabel">${escapeHtml(t("security.stepUp.codeLabel"))}</label>
              <input id="gate-mfa-code" class="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
            </div>
            <p class="field-error" data-gate-error role="alert" hidden></p>
            <button class="button button--primary" type="submit" data-i18n="security.stepUp.verify">${escapeHtml(t("security.stepUp.verify"))}</button>
          </form>
        `,
        action: signOutButton(),
      }),
      bind: (root) => {
        const form = root.querySelector("[data-gate-mfa]");
        const error = form.querySelector("[data-gate-error]");
        form.elements.code.focus();
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const code = form.elements.code.value.trim();
          const button = form.querySelector("button");
          if (!/^\d{6}$/.test(code)) {
            error.hidden = false;
            error.textContent = t("security.stepUp.codeFormat");
            return;
          }
          button.disabled = true;
          try {
            const factor = await verifiedTotp();
            await verifyTotp(factor?.id, code);
            await recordMfaState();
            await continueToAdmin(rerender);
          } catch (failure) {
            error.hidden = false;
            error.textContent = describeError(failure, t("errors.security.invalidCode"));
            form.elements.code.value = "";
            button.disabled = false;
          }
        });
      },
    };
  }

  const { signInAgain, ...screen } = (SCREENS[reason] ?? SCREENS.NOT_MEMBER)(access);
  const action = signInAgain
    ? `<button class="button button--primary" type="button" data-gate-sign-out data-i18n="security.states.signInAgain">${escapeHtml(t("security.states.signInAgain"))}</button>`
    : signOutButton();
  return { html: accessScreen({ ...screen, action }), bind: () => {} };
}

export function bindGateSignOut(root) {
  root.querySelector("[data-gate-sign-out]")?.addEventListener("click", signOut);
}

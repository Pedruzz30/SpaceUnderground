import { accessScreen } from "../components/access-screen.js";
import { t } from "../i18n/index.js";
import { takeAuthLink } from "../security/auth-link.js";
import { activateMembership, loadAccess, sessionFromLink, setOwnPassword } from "../services/access-service.js";
import { getSession } from "../services/auth-service.js";
import { describeError } from "../services/errors.js";
import { escapeHtml } from "../utils/html.js";
import { bindPasswordStep } from "./access-gate.js";

// Where invitation and password-recovery emails land. The link's session was
// already taken out of the address bar at boot (security/auth-link.js); this
// screen opens it once, then asks for the person's own password: for an
// invitation, choosing it is what activates the account.

const LINK_ERRORS = new Set(["otp_expired", "access_denied", "otp_disabled", "flow_state_expired", "flow_state_not_found"]);

function passwordScreen(heading, copy) {
  return accessScreen({
    title: t("security.welcome.title"),
    heading,
    copy,
    body: `
      <form class="login-form" data-gate-password novalidate>
        <div class="field">
          <label for="welcome-password" data-i18n="settings.account.newPassword">${escapeHtml(t("settings.account.newPassword"))}</label>
          <input id="welcome-password" name="password" type="password" autocomplete="new-password" required>
        </div>
        <div class="field">
          <label for="welcome-confirmation" data-i18n="settings.account.confirmPassword">${escapeHtml(t("settings.account.confirmPassword"))}</label>
          <input id="welcome-confirmation" name="confirmation" type="password" autocomplete="new-password" required>
        </div>
        <ul class="settings-rules" data-gate-rules></ul>
        <p class="field-error" data-gate-error role="alert" hidden></p>
        <button class="button button--primary" type="submit" data-gate-submit></button>
      </form>
    `,
  });
}

function problemScreen(copy) {
  return accessScreen({
    title: t("security.welcome.title"),
    heading: t("security.welcome.linkProblem"),
    copy,
    action: `<a class="button button--primary" href="#/login" data-i18n="security.welcome.backToLogin">${escapeHtml(t("security.welcome.backToLogin"))}</a>`,
    tone: "danger",
  });
}

export const welcomePage = {
  title: () => t("security.welcome.title"),
  breadcrumb: () => t("security.welcome.title"),
  render: () => accessScreen({ title: t("security.welcome.title"), heading: t("shell.verifyingSession"), copy: t("security.welcome.opening") }),
  afterRender: async () => {
    const root = document.querySelector("#app");
    const link = takeAuthLink();

    if (link?.error) {
      root.innerHTML = problemScreen(LINK_ERRORS.has(link.error) ? t("security.welcome.linkExpired") : t("security.welcome.linkInvalid"));
      return;
    }

    if (link) {
      try {
        await sessionFromLink(link);
      } catch (error) {
        root.innerHTML = problemScreen(describeError(error, t("security.welcome.linkInvalid")));
        return;
      }
    }

    const session = await getSession();
    if (!session) {
      window.location.hash = "#/login";
      return;
    }

    let access;
    try {
      access = await loadAccess(session, { force: true });
    } catch (error) {
      root.innerHTML = problemScreen(describeError(error, t("security.welcome.linkInvalid")));
      return;
    }

    const recovering = link?.type === "recovery";
    const invited = access?.blockedReason === "INVITED";
    if (!recovering && !invited) {
      window.location.hash = "#/dashboard";
      return;
    }

    root.innerHTML = recovering
      ? passwordScreen(t("security.welcome.recoveryHeading"), t("security.welcome.recoveryCopy"))
      : passwordScreen(t("security.welcome.activateHeading", { name: access.member?.displayName ?? "" }), t("security.welcome.activateCopy"));

    bindPasswordStep(root, {
      email: session.user?.email ?? "",
      submitLabel: recovering ? t("security.welcome.savePassword") : t("security.welcome.activate"),
      onSubmit: async (password) => {
        await setOwnPassword(password);
        if (invited) await activateMembership();
        await loadAccess(session, { force: true });
        window.location.hash = "#/dashboard";
      },
    });
  },
};

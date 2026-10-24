import { accessScreen } from "../components/access-screen.js";
import { paintNavBadge, sidebar } from "../components/sidebar.js";
import { bindTopbar, topbar } from "../components/topbar.js";
import { flushPendingToast, toastRegion } from "../components/toast.js";
import { loginPage } from "../pages/login.js";
import { welcomePage } from "../pages/welcome.js";
import { bindGateSignOut, blockedScreen } from "../pages/access-gate.js";
import { databaseUpdatePage, forbiddenPage } from "../pages/forbidden.js";
import { getCachedSession, getSession, hasResolvedSession, logout } from "../services/auth-service.js";
import { forgetAccess, loadAccess } from "../services/access-service.js";
import { pendingApprovalCount } from "../services/approval-service.js";
import { confirmModal } from "../components/modal.js";
import { adminConfigurationErrorMessage, hasAdminConfigurationError } from "../config/env.js";
import { escapeHtml } from "../utils/html.js";
import { initI18n, t } from "../i18n/index.js";
import { getAccess, hasAnyPermission, hasPermission, isSecurityModelActive } from "../security/access.js";
import { watchPermissionGates } from "../security/gates.js";

// `any` names the permissions that open a route (none: any active member).
// `security` routes need the security migration applied. Checking here is the
// interface's courtesy; the database authorizes every request behind a route.
const pages = [
  { test: (route) => route === "/login", page: loginPage },
  { test: (route) => route === "/welcome", page: welcomePage },
  { test: (route) => route === "/dashboard" || route === "/", load: () => import("../pages/dashboard.js").then((module) => module.dashboardPage) },
  { test: (route) => route === "/projects", load: () => import("../pages/projects.js").then((module) => module.projectsPage), any: ["projects.read", "projects.read_assigned"] },
  { test: (route) => route === "/projects/new", load: () => import("../pages/project-editor.js").then((module) => module.projectEditorPage), any: ["projects.create"] },
  // Editors get the editor; members who may only propose changes get drafts.
  {
    test: (route) => /^\/projects\/[^/]+$/.test(route),
    load: (access) => hasPermission("projects.edit", access)
      ? import("../pages/project-editor.js").then((module) => module.projectEditorPage)
      : import("../pages/project-draft.js").then((module) => module.projectDraftPage),
    any: ["projects.edit", "projects.read_assigned"],
  },
  { test: (route) => route === "/clients", load: () => import("../pages/clients.js").then((module) => module.clientsPage), any: ["clients.read"] },
  { test: (route) => /^\/clients\/[^/]+$/.test(route), load: () => import("../pages/client-detail.js").then((module) => module.clientDetailPage), any: ["clients.read"] },
  { test: (route) => route === "/commercial", load: () => import("../pages/commercial.js").then((module) => module.commercialPage), any: ["commercial.read"] },
  { test: (route) => route === "/financial", load: () => import("../pages/financial.js").then((module) => module.financialPage), any: ["finance.read"] },
  { test: (route) => route === "/media", load: () => import("../pages/media.js").then((module) => module.mediaPage), any: ["cms.read"] },
  { test: (route) => route === "/services", load: () => import("../pages/services.js").then((module) => module.servicesPage), any: ["services.read"] },
  { test: (route) => /^\/services\/[^/]+$/.test(route), load: () => import("../pages/service-editor.js").then((module) => module.serviceEditorPage), any: ["services.read"] },
  { test: (route) => route === "/content", load: () => import("../pages/content.js").then((module) => module.contentPage), any: ["cms.read"] },
  { test: (route) => route === "/cms", load: () => import("../pages/cms.js").then((module) => module.cmsPage), any: ["cms.read"] },
  // #/activity is the pre-Lab name for this screen; keep the old link working.
  { test: (route) => route === "/logs" || route === "/logs/automation" || route === "/activity", load: () => import("../pages/logs.js").then((module) => module.logsPage), any: ["logs.read"] },
  { test: (route) => route === "/settings", load: () => import("../pages/settings.js").then((module) => module.settingsPage) },
  { test: (route) => route === "/team", load: () => import("../pages/team.js").then((module) => module.teamPage), any: ["team.read"], security: true },
  { test: (route) => route === "/team/invite", load: () => import("../pages/team-invite.js").then((module) => module.teamInvitePage), any: ["team.invite"], security: true },
  { test: (route) => /^\/team\/[^/]+$/.test(route), load: () => import("../pages/team-member.js").then((module) => module.teamMemberPage), any: ["team.read"], security: true },
  { test: (route) => route === "/approvals", load: () => import("../pages/approvals.js").then((module) => module.approvalsPage), any: ["approvals.read_all"], security: true },
  { test: (route) => /^\/approvals\/[^/]+$/.test(route), load: () => import("../pages/approval-review.js").then((module) => module.approvalReviewPage), any: ["approvals.read"], security: true },
  { test: (route) => route === "/my-changes", load: () => import("../pages/approvals.js").then((module) => module.myChangesPage), any: ["approvals.read"], security: true },
  { test: (route) => route === "/audit", load: () => import("../pages/audit.js").then((module) => module.auditPage), any: ["audit.read"], security: true },
];

async function resolvePage(entry, access) {
  if (entry.security && !isSecurityModelActive(access)) return databaseUpdatePage;
  if (entry.any && !hasAnyPermission(entry.any, access)) return forbiddenPage;
  return entry.load ? entry.load(access) : entry.page;
}

function currentRoute() {
  return window.location.hash.replace("#", "") || "/login";
}

function routeParams(route) {
  const [, section, id] = route.split("/");
  return { section, id };
}

function notFoundPage(route) {
  return {
    title: t("errors.routeNotFoundTitle"),
    breadcrumb: t("errors.routeNotFoundBreadcrumb"),
    render: () => `
      <section class="empty-state">
        <span>404</span>
        <h2 data-i18n="errors.routeNotFoundHeading">${t("errors.routeNotFoundHeading")}</h2>
        <p>${t("errors.routeNotFoundBody", { route: `<code>${escapeHtml(route)}</code>` })}</p>
        <a class="button" href="#/dashboard" data-i18n="common.backToDashboard">${t("common.backToDashboard")}</a>
      </section>
    `,
  };
}

const statusScreen = accessScreen;

function shell(page, route, params, session, access) {
  const title = typeof page.title === "function" ? page.title() : page.title;
  const breadcrumb = typeof page.breadcrumb === "function" ? page.breadcrumb() : page.breadcrumb;
  return `
    <div class="admin-shell">
      ${sidebar(route, access)}
      <div class="drawer-backdrop" data-drawer-backdrop></div>
      <div class="admin-main">
        ${topbar({ title, breadcrumb, session, access })}
        <main class="page" tabindex="-1">${page.render(params)}</main>
      </div>
      ${toastRegion()}
    </div>
  `;
}

// At most one head-only count a minute; never a polling loop.
function refreshApprovalsBadge(access) {
  if (!isSecurityModelActive(access) || !hasPermission("approvals.read_all", access)) return;
  pendingApprovalCount().then((count) => paintNavBadge("approvals", count));
}

function bindShell() {
  const shellNode = document.querySelector(".admin-shell");
  const sidebarNode = document.querySelector("[data-sidebar]");
  const menuButton = document.querySelector("[data-menu-toggle]");
  const backdrop = document.querySelector("[data-drawer-backdrop]");

  if (sidebarNode) sidebarNode.id = "admin-sidebar";
  bindTopbar(document);

  const setOpen = (isOpen) => {
    shellNode?.classList.toggle("is-sidebar-open", isOpen);
    menuButton?.setAttribute("aria-expanded", String(isOpen));
  };

  menuButton?.addEventListener("click", () => setOpen(!shellNode?.classList.contains("is-sidebar-open")));
  backdrop?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  document.querySelector("[data-logout]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await logout();
    } finally {
      window.location.hash = "#/login";
    }
  });
}

let navigationGuard = null;
let navigationCleanup = null;
let activeRoute = null;
let activePage = null;
let renderToken = 0;

// Lets a page block navigation while it has unsaved changes. The cleanup runs
// once the page is actually left, which also lets editors discard temporary
// uploads that never made it into a saved record.
export function setNavigationGuard(hasUnsavedChanges, onLeave = null) {
  navigationGuard = hasUnsavedChanges;
  navigationCleanup = onLeave;
}

export function clearNavigationGuard() {
  navigationGuard = null;
  navigationCleanup = null;
}

async function runNavigationCleanup() {
  const cleanup = navigationCleanup;
  navigationGuard = null;
  navigationCleanup = null;
  try {
    await cleanup?.();
  } catch (error) {
    console.warn("Navigation cleanup failed", error);
  }
}

export function initRouter(root) {
  if (!root) return;
  initI18n();

  function refreshRouteChrome() {
    const titleNode = root.querySelector("[data-page-title]");
    const breadcrumbNode = root.querySelector("[data-page-breadcrumb]");
    if (!titleNode && !breadcrumbNode) return;
    const requestedRoute = currentRoute();
    const page = requestedRoute === activeRoute ? activePage : null;
    if (!page) return;
    const title = typeof page.title === "function" ? page.title() : page.title;
    const breadcrumb = typeof page.breadcrumb === "function" ? page.breadcrumb() : page.breadcrumb;
    if (titleNode) titleNode.textContent = title || "";
    if (breadcrumbNode) breadcrumbNode.textContent = breadcrumb || "";
  }

  const render = async () => {
    const requestedRoute = currentRoute();
    const token = ++renderToken;

    if (hasAdminConfigurationError()) {
      activeRoute = requestedRoute;
      root.innerHTML = statusScreen({
        title: t("shell.configurationTitle"),
        heading: t("shell.configurationError"),
        copy: adminConfigurationErrorMessage(),
      });
      return;
    }

    if (navigationGuard && requestedRoute !== activeRoute) {
      if (navigationGuard()) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${activeRoute}`);
        confirmModal({
          title: t("shell.unsavedChanges"),
          body: `<p>${escapeHtml(t("shell.unsavedBody"))}</p>`,
          confirmLabel: t("shell.discardChanges"),
          cancelLabel: t("shell.stay"),
        }).then(async (discard) => {
          if (discard) {
            await runNavigationCleanup();
            window.location.hash = `#${requestedRoute}`;
          }
        });
        return;
      }
      await runNavigationCleanup();
    }

    // A route chunk may still be downloading. Remove the previous page so its
    // controls and headings cannot be mistaken for the destination.
    if (activeRoute && requestedRoute !== activeRoute) {
      root.innerHTML = statusScreen({
        title: t("shell.sessionTitle"),
        heading: t("common.loading"),
        copy: "",
      });
    }

    const params = routeParams(requestedRoute);
    const match = pages.find((entry) => entry.test(requestedRoute));

    // The welcome screen opens the session an email link carries, so it runs
    // before there is any session to check.
    if (match?.page === welcomePage) {
      activeRoute = requestedRoute;
      root.innerHTML = welcomePage.render(params);
      await welcomePage.afterRender(params);
      return;
    }

    // Authentication is asynchronous once Supabase is in play. Show an explicit
    // state instead of flashing the dashboard before we know who the user is.
    if (!hasResolvedSession()) {
      root.innerHTML = statusScreen({
        title: t("shell.sessionTitle"),
        heading: t("shell.verifyingSession"),
        copy: t("shell.checkingAccess"),
      });
    }

    const session = hasResolvedSession() ? getCachedSession() : await getSession();
    if (token !== renderToken) return;

    if (requestedRoute !== "/login" && !session) {
      window.location.hash = "#/login";
      return;
    }

    if (requestedRoute === "/login" && session) {
      window.location.hash = "#/dashboard";
      return;
    }

    if (match?.page === loginPage) {
      activeRoute = requestedRoute;
      root.innerHTML = loginPage.render(params);
      await loginPage.afterRender?.(params);
      return;
    }

    // Being signed in is not being let in: the database says what this member
    // may do right now (a suspension or an expiry applies at once) and
    // enforces it again on every query.
    let access = null;
    try {
      access = await loadAccess(session);
    } catch (error) {
      if (token !== renderToken) return;
      activeRoute = requestedRoute;
      root.innerHTML = statusScreen({
        title: t("shell.sessionTitle"),
        heading: t("security.states.accessErrorHeading"),
        copy: error?.message ?? t("errors.generic"),
        action: `<button class="button" type="button" data-access-retry data-i18n="security.states.retry">${t("security.states.retry")}</button>`,
      });
      root.querySelector("[data-access-retry]")?.addEventListener("click", () => render());
      return;
    }
    if (token !== renderToken) return;

    if (!access || access.blockedReason) {
      activeRoute = requestedRoute;
      const screen = blockedScreen(access, render);
      root.innerHTML = screen.html;
      bindGateSignOut(root);
      screen.bind(root);
      return;
    }

    let page;
    try {
      page = match ? await resolvePage(match, access) : notFoundPage(requestedRoute);
    } catch (error) {
      if (token !== renderToken) return;
      activeRoute = requestedRoute;
      activePage = null;
      root.innerHTML = statusScreen({
        title: t("errors.generic"),
        heading: t("errors.generic"),
        copy: error?.message ?? t("errors.generic"),
        action: `<button class="button" type="button" data-route-retry>${t("security.states.retry")}</button>`,
      });
      root.querySelector("[data-route-retry]")?.addEventListener("click", () => render());
      return;
    }
    if (token !== renderToken) return;
    root.innerHTML = shell(page, requestedRoute, params, session, access);
    bindShell();
    flushPendingToast();
    watchPermissionGates(root.querySelector(".page"));
    refreshApprovalsBadge(access);

    activeRoute = requestedRoute;
    activePage = page;
    await page.afterRender?.(params);
    if (token !== renderToken) return;
    document.querySelector(".page")?.focus({ preventScroll: true });
  };

  window.addEventListener("hashchange", () => {
    render();
  });
  // A request answered that this session was ended (SU013): ask the database
  // again at once, and let the access screen say what happened.
  window.addEventListener("space-admin:session-ended", () => {
    forgetAccess();
    render();
  });
  // This session changed what the member may do (removing its own MFA
  // factor, say): render again from the database's current answer.
  window.addEventListener("space-admin:access-changed", () => {
    forgetAccess();
    render();
  });
  window.addEventListener("localechange", refreshRouteChrome);
  render();
}

import { accessScreen } from "../components/access-screen.js";
import { paintNavBadge, sidebar } from "../components/sidebar.js";
import { bindTopbar, topbar } from "../components/topbar.js";
import { flushPendingToast, toastRegion } from "../components/toast.js";
import { loginPage } from "../pages/login.js";
import { welcomePage } from "../pages/welcome.js";
import { bindGateSignOut, blockedScreen } from "../pages/access-gate.js";
import { databaseUpdatePage, forbiddenPage } from "../pages/forbidden.js";
import { dashboardPage } from "../pages/dashboard.js";
import { projectsPage } from "../pages/projects.js";
import { projectEditorPage } from "../pages/project-editor.js";
import { projectDraftPage } from "../pages/project-draft.js";
import { clientsPage } from "../pages/clients.js";
import { clientDetailPage } from "../pages/client-detail.js";
import { commercialPage } from "../pages/commercial.js";
import { financialPage } from "../pages/financial.js";
import { mediaPage } from "../pages/media.js";
import { servicesPage } from "../pages/services.js";
import { serviceEditorPage } from "../pages/service-editor.js";
import { contentPage } from "../pages/content.js";
import { cmsPage } from "../pages/cms.js";
import { logsPage } from "../pages/logs.js";
import { settingsPage } from "../pages/settings.js";
import { teamPage } from "../pages/team.js";
import { teamInvitePage } from "../pages/team-invite.js";
import { teamMemberPage } from "../pages/team-member.js";
import { approvalsPage, myChangesPage } from "../pages/approvals.js";
import { approvalReviewPage } from "../pages/approval-review.js";
import { auditPage } from "../pages/audit.js";
import { getCachedSession, getSession, hasResolvedSession, logout } from "../services/auth-service.js";
import { loadAccess } from "../services/access-service.js";
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
  { test: (route) => route === "/dashboard" || route === "/", page: dashboardPage },
  { test: (route) => route === "/projects", page: projectsPage, any: ["projects.read", "projects.read_assigned"] },
  // Editors get the editor; members who may only propose changes get drafts.
  {
    test: (route) => /^\/projects\/[^/]+$/.test(route),
    page: () => (hasPermission("projects.edit") ? projectEditorPage : projectDraftPage),
    any: ["projects.edit", "projects.read_assigned"],
  },
  { test: (route) => route === "/clients", page: clientsPage, any: ["clients.read"] },
  { test: (route) => /^\/clients\/[^/]+$/.test(route), page: clientDetailPage, any: ["clients.read"] },
  { test: (route) => route === "/commercial", page: commercialPage, any: ["commercial.read"] },
  { test: (route) => route === "/financial", page: financialPage, any: ["finance.read"] },
  { test: (route) => route === "/media", page: mediaPage, any: ["cms.read"] },
  { test: (route) => route === "/services", page: servicesPage, any: ["services.read"] },
  { test: (route) => /^\/services\/[^/]+$/.test(route), page: serviceEditorPage, any: ["services.read"] },
  { test: (route) => route === "/content", page: contentPage, any: ["cms.read"] },
  { test: (route) => route === "/cms", page: cmsPage, any: ["cms.read"] },
  // #/activity is the pre-Lab name for this screen; keep the old link working.
  { test: (route) => route === "/logs" || route === "/activity", page: logsPage, any: ["logs.read"] },
  { test: (route) => route === "/settings", page: settingsPage },
  { test: (route) => route === "/team", page: teamPage, any: ["team.read"], security: true },
  { test: (route) => route === "/team/invite", page: teamInvitePage, any: ["team.invite"], security: true },
  { test: (route) => /^\/team\/[^/]+$/.test(route), page: teamMemberPage, any: ["team.read"], security: true },
  { test: (route) => route === "/approvals", page: approvalsPage, any: ["approvals.read_all"], security: true },
  { test: (route) => /^\/approvals\/[^/]+$/.test(route), page: approvalReviewPage, any: ["approvals.read"], security: true },
  { test: (route) => route === "/my-changes", page: myChangesPage, any: ["approvals.read"], security: true },
  { test: (route) => route === "/audit", page: auditPage, any: ["audit.read"], security: true },
];

function resolvePage(entry, access) {
  if (entry.security && !isSecurityModelActive(access)) return databaseUpdatePage;
  if (entry.any && !hasAnyPermission(entry.any, access)) return forbiddenPage;
  return typeof entry.page === "function" ? entry.page(access) : entry.page;
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
    const match = pages.find((entry) => entry.test(requestedRoute));
    const page = match ? resolvePage(match, getAccess()) : notFoundPage(requestedRoute);
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

    const page = match ? resolvePage(match, access) : notFoundPage(requestedRoute);
    root.innerHTML = shell(page, requestedRoute, params, session, access);
    bindShell();
    flushPendingToast();
    watchPermissionGates(root.querySelector(".page"));
    refreshApprovalsBadge(access);

    activeRoute = requestedRoute;
    await page.afterRender?.(params);
    if (token !== renderToken) return;
    document.querySelector(".page")?.focus({ preventScroll: true });
  };

  window.addEventListener("hashchange", () => {
    render();
  });
  window.addEventListener("localechange", refreshRouteChrome);
  render();
}

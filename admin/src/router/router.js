import { sidebar } from "../components/sidebar.js";
import { topbar } from "../components/topbar.js";
import { toastRegion } from "../components/toast.js";
import { loginPage } from "../pages/login.js";
import { dashboardPage } from "../pages/dashboard.js";
import { projectsPage } from "../pages/projects.js";
import { projectEditorPage } from "../pages/project-editor.js";
import { clientsPage } from "../pages/clients.js";
import { clientDetailPage } from "../pages/client-detail.js";
import { commercialPage } from "../pages/commercial.js";
import { financialPage } from "../pages/financial.js";
import { mediaPage } from "../pages/media.js";
import { servicesPage } from "../pages/services.js";
import { contentPage } from "../pages/content.js";
import { cmsPage } from "../pages/cms.js";
import { logsPage } from "../pages/logs.js";
import { settingsPage } from "../pages/settings.js";
import { getCachedSession, getSession, hasResolvedSession, logout } from "../services/auth-service.js";
import { confirmModal } from "../components/modal.js";
import { escapeHtml } from "../utils/html.js";

const pages = [
  { test: (route) => route === "/login", page: loginPage },
  { test: (route) => route === "/dashboard" || route === "/", page: dashboardPage },
  { test: (route) => route === "/projects", page: projectsPage },
  { test: (route) => /^\/projects\/[^/]+$/.test(route), page: projectEditorPage },
  { test: (route) => route === "/clients", page: clientsPage },
  { test: (route) => /^\/clients\/[^/]+$/.test(route), page: clientDetailPage },
  { test: (route) => route === "/commercial", page: commercialPage },
  { test: (route) => route === "/financial", page: financialPage },
  { test: (route) => route === "/media", page: mediaPage },
  { test: (route) => route === "/services", page: servicesPage },
  { test: (route) => route === "/content", page: contentPage },
  { test: (route) => route === "/cms", page: cmsPage },
  // #/activity is the pre-Lab name for this screen; keep the old link working.
  { test: (route) => route === "/logs" || route === "/activity", page: logsPage },
  { test: (route) => route === "/settings", page: settingsPage },
];

function currentRoute() {
  return window.location.hash.replace("#", "") || "/login";
}

function routeParams(route) {
  const [, section, id] = route.split("/");
  return { section, id };
}

function notFoundPage(route) {
  return {
    title: "Route not found",
    breadcrumb: "SYSTEM / 404",
    render: () => `
      <section class="empty-state">
        <span>404</span>
        <h2>Rota inexistente</h2>
        <p>A rota <code>${escapeHtml(route)}</code> ainda nao existe neste Admin.</p>
        <a class="button" href="#/dashboard">Voltar ao Dashboard</a>
      </section>
    `,
  };
}

function statusScreen({ title, heading, copy, action = "" }) {
  return `
    <main class="login-page">
      <section class="login-panel" aria-labelledby="status-title">
        <div class="login-panel__brand">
          <span class="brand-mark" aria-hidden="true">SU</span>
          <div>
            <p>SPACE UNDERGROUND</p>
            <h1 id="status-title">${escapeHtml(title)}</h1>
          </div>
        </div>
        <p class="login-panel__copy"><strong>${escapeHtml(heading)}</strong></p>
        <p class="login-panel__copy">${escapeHtml(copy)}</p>
        ${action}
      </section>
    </main>
  `;
}

function shell(page, route, params, session) {
  return `
    <div class="admin-shell">
      ${sidebar(route)}
      <div class="drawer-backdrop" data-drawer-backdrop></div>
      <div class="admin-main">
        ${topbar({ title: page.title, breadcrumb: page.breadcrumb, session })}
        <main class="page" tabindex="-1">${page.render(params)}</main>
      </div>
      ${toastRegion()}
    </div>
  `;
}

function bindShell() {
  const shellNode = document.querySelector(".admin-shell");
  const sidebarNode = document.querySelector("[data-sidebar]");
  const menuButton = document.querySelector("[data-menu-toggle]");
  const backdrop = document.querySelector("[data-drawer-backdrop]");

  if (sidebarNode) sidebarNode.id = "admin-sidebar";

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

// Lets a page (eg. Project Editor) block navigation while it has unsaved
// changes. The guard returns true when there is unsaved work; the optional
// cleanup runs once the page is actually left, which is what lets the editor
// discard uploads that never made it into a saved record.
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

  const render = async () => {
    const requestedRoute = currentRoute();
    const token = ++renderToken;

    if (navigationGuard && requestedRoute !== activeRoute) {
      if (navigationGuard()) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${activeRoute}`);
        confirmModal({
          title: "UNSAVED CHANGES",
          body: "<p>You have changes that haven't been saved.</p>",
          confirmLabel: "Discard Changes",
          cancelLabel: "Stay",
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

    // Authentication is asynchronous once Supabase is in play. Show an explicit
    // state instead of flashing the dashboard before we know who the user is.
    if (!hasResolvedSession()) {
      root.innerHTML = statusScreen({
        title: "ADMIN / SESSION",
        heading: "VERIFYING SESSION",
        copy: "Checking your administrative access...",
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

    // Being signed in is not the same as being an admin: authorization comes
    // from the admins table (and is enforced again by RLS on every query).
    if (session && !session.isAdmin) {
      activeRoute = requestedRoute;
      root.innerHTML = statusScreen({
        title: "ADMIN / DENIED",
        heading: "ACCESS DENIED",
        copy: "This account is not registered as an administrator.",
        action: '<button class="button" type="button" data-logout>Sign out</button>',
      });
      root.querySelector("[data-logout]")?.addEventListener("click", async () => {
        await logout();
        window.location.hash = "#/login";
        window.location.reload();
      });
      return;
    }

    const params = routeParams(requestedRoute);
    const match = pages.find((entry) => entry.test(requestedRoute));
    const page = match?.page || notFoundPage(requestedRoute);

    if (page === loginPage) {
      root.innerHTML = page.render(params);
    } else {
      root.innerHTML = shell(page, requestedRoute, params, session);
      bindShell();
    }

    activeRoute = requestedRoute;
    await page.afterRender?.(params);
    if (token !== renderToken) return;
    document.querySelector(".page")?.focus({ preventScroll: true });
  };

  window.addEventListener("hashchange", () => {
    render();
  });
  render();
}

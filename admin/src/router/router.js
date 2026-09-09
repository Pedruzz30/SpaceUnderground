import { sidebar } from "../components/sidebar.js";
import { topbar } from "../components/topbar.js";
import { toastRegion } from "../components/toast.js";
import { loginPage } from "../pages/login.js";
import { dashboardPage } from "../pages/dashboard.js";
import { projectsPage } from "../pages/projects.js";
import { projectEditorPage } from "../pages/project-editor.js";
import { isAuthenticated, logout } from "../services/session.js";
import { confirmModal } from "../components/modal.js";
import { escapeHtml } from "../utils/html.js";

const pages = [
  { test: (route) => route === "/login", page: loginPage },
  { test: (route) => route === "/dashboard" || route === "/", page: dashboardPage },
  { test: (route) => route === "/projects", page: projectsPage },
  { test: (route) => /^\/projects\/[^/]+$/.test(route), page: projectEditorPage },
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

function shell(page, route, params) {
  return `
    <div class="admin-shell">
      ${sidebar(route)}
      <div class="drawer-backdrop" data-drawer-backdrop></div>
      <div class="admin-main">
        ${topbar({ title: page.title, breadcrumb: page.breadcrumb })}
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

  document.querySelector("[data-logout]")?.addEventListener("click", () => {
    logout();
    window.location.hash = "#/login";
  });
}

let navigationGuard = null;
let activeRoute = null;

// Lets a page (eg. Project Editor) block navigation while it has unsaved
// changes. The guard function must return true when there is unsaved work.
export function setNavigationGuard(hasUnsavedChanges) {
  navigationGuard = hasUnsavedChanges;
}

export function clearNavigationGuard() {
  navigationGuard = null;
}

export function initRouter(root) {
  if (!root) return;

  const render = () => {
    const requestedRoute = currentRoute();

    if (navigationGuard && requestedRoute !== activeRoute) {
      if (navigationGuard()) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${activeRoute}`);
        confirmModal({
          title: "UNSAVED CHANGES",
          body: "<p>You have changes that haven't been saved.</p>",
          confirmLabel: "Discard Changes",
          cancelLabel: "Stay",
        }).then((discard) => {
          if (discard) {
            navigationGuard = null;
            window.location.hash = `#${requestedRoute}`;
          }
        });
        return;
      }
      navigationGuard = null;
    }

    if (requestedRoute !== "/login" && !isAuthenticated()) {
      window.location.hash = "#/login";
      return;
    }

    if (requestedRoute === "/login" && isAuthenticated()) {
      window.location.hash = "#/dashboard";
      return;
    }

    const params = routeParams(requestedRoute);
    const match = pages.find((entry) => entry.test(requestedRoute));
    const page = match?.page || notFoundPage(requestedRoute);

    if (page === loginPage) {
      root.innerHTML = page.render(params);
    } else {
      root.innerHTML = shell(page, requestedRoute, params);
      bindShell();
    }

    activeRoute = requestedRoute;
    page.afterRender?.(params);
    document.querySelector(".page")?.focus({ preventScroll: true });
  };

  window.addEventListener("hashchange", render);
  render();
}

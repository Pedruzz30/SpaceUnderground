let timer = 0;

export function toastRegion() {
  return `<div class="toast-region" data-toast-region role="status" aria-live="polite" aria-atomic="true"></div>`;
}

export function showToast(message) {
  const region = document.querySelector("[data-toast-region]");
  if (!region) return;
  window.clearTimeout(timer);
  region.textContent = message;
  region.classList.add("is-visible");
  timer = window.setTimeout(() => region.classList.remove("is-visible"), 2400);
}

// For a message about the navigation it triggers (a request sent, an
// invitation delivered): the next render of the shell shows it, instead of the
// old page's region disappearing with it.
let pending = null;

export function showToastAfterNavigation(message) {
  pending = message;
}

export function flushPendingToast() {
  if (!pending) return;
  const message = pending;
  pending = null;
  showToast(message);
}

import { escapeAttribute, escapeHtml } from "../utils/html.js";

// Per-row overflow menu ("..."), the same markup and .row-menu styles the
// Projects and Services hubs use, packaged so a new hub does not copy it again.
//
// items: [{ label, attrs?, href? }] -- attrs is a trusted attribute string built
// by the caller (data hooks only); label and href are escaped here. An item with
// an href renders as a link, anything else as a button.
export function rowMenu({ label, items }) {
  return `
    <span class="row-menu" data-row-menu>
      <button class="button button--compact row-menu__toggle" type="button" data-row-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="${escapeAttribute(label)}">...</button>
      <span class="row-menu__panel" role="menu" hidden>
        ${items
          .map((item) =>
            item.href
              ? `<a role="menuitem" href="${escapeAttribute(item.href)}" ${item.attrs ?? ""}>${escapeHtml(item.label)}</a>`
              : `<button type="button" role="menuitem" ${item.attrs ?? ""}>${escapeHtml(item.label)}</button>`,
          )
          .join("")}
      </span>
    </span>
  `;
}

export function closeRowMenus(root = document) {
  root.querySelectorAll("[data-row-menu] .row-menu__panel").forEach((panel) => {
    panel.hidden = true;
  });
  root.querySelectorAll("[data-row-menu-toggle]").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "false");
  });
}

// Wires every menu inside `root` through delegation, so re-rendering the rows
// needs no re-binding. The document listeners remove themselves once `root`
// leaves the page, instead of piling up on every visit.
export function bindRowMenus(root) {
  if (!root) return;

  root.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-row-menu-toggle]");
    if (toggle) {
      event.stopPropagation();
      const panel = toggle.nextElementSibling;
      const willOpen = panel?.hidden;
      closeRowMenus(root);
      if (panel && willOpen) {
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
      }
      return;
    }
    if (event.target.closest("[role='menuitem']")) closeRowMenus(root);
  });

  const onDocumentClick = (event) => {
    if (!root.isConnected) return detach();
    if (!event.target.closest("[data-row-menu]")) closeRowMenus(root);
  };
  const onKeydown = (event) => {
    if (!root.isConnected) return detach();
    if (event.key === "Escape") closeRowMenus(root);
  };
  function detach() {
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onKeydown);
  }

  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
}

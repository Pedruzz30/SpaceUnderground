// Hides controls the member cannot use: any element marked
//   data-requires="clients.create"            (one permission)
//   data-requires="finance.edit|finance.delete" (any of several)
// is hidden and disabled while none of them is held. Courtesy only, like the
// sidebar: the database refuses the action whether or not the button shows.
//
// Pages re-render parts of themselves, so the page container is watched and
// new controls are gated as they appear.

import { getAccess, hasAnyPermission } from "./access.js";

export function applyPermissionGates(root, access = getAccess()) {
  if (!root?.querySelectorAll) return;
  const nodes = [...(root.matches?.("[data-requires]") ? [root] : []), ...root.querySelectorAll("[data-requires]")];
  for (const node of nodes) {
    const allowed = hasAnyPermission(String(node.dataset.requires).split("|").map((key) => key.trim()).filter(Boolean), access);
    if (allowed) {
      if (node.hasAttribute("data-gated")) {
        node.removeAttribute("data-gated");
        node.hidden = false;
      }
      continue;
    }
    // Already gated: writing the attributes again would queue mutations the
    // observer below answers, forever.
    if (node.hasAttribute("data-gated") && node.hidden && (!("disabled" in node) || node.disabled)) continue;
    node.setAttribute("data-gated", "");
    if (!node.hidden) node.hidden = true;
    if ("disabled" in node && !node.disabled) node.disabled = true;
    node.setAttribute("aria-hidden", "true");
    node.tabIndex = -1;
  }
}

let observer = null;

export function watchPermissionGates(root) {
  observer?.disconnect();
  if (!root || typeof MutationObserver !== "function") return;
  applyPermissionGates(root);
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) applyPermissionGates(node);
      }
      if (mutation.type === "attributes" && mutation.target.hasAttribute?.("data-requires")) applyPermissionGates(mutation.target);
    }
  });
  // A page re-enabling a gated button (after a load, say) is gated again.
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden"] });
}

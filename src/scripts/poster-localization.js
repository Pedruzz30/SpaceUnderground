export function initPosterLocalization() {
  const apply = (node) => {
    if (!(node instanceof Element)) return;

    const poster = node.matches(".signal-ui__poster") ? node : node.querySelector?.(".signal-ui__poster");
    if (poster) {
      const current = poster.getAttribute("src") || "";
      if (current.includes("jarvis-preview-poster") && current !== "./jarvis-preview-poster-pt.svg") {
        poster.setAttribute("src", "./jarvis-preview-poster-pt.svg");
      }
    }

    const sources = node.matches("[data-poster-source]") ? [node] : [...(node.querySelectorAll?.("[data-poster-source]") || [])];
    sources.forEach((source) => {
      const current = source.getAttribute("srcset") || "";
      if (current.includes("jarvis-preview-poster")) source.removeAttribute("srcset");
    });
  };

  apply(document.body);

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === "attributes") apply(record.target);
      record.addedNodes?.forEach?.(apply);
    });
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "srcset"]
  });
}

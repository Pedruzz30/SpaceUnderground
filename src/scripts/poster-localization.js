export function initPosterLocalization() {
  const apply = (node) => {
    if (!(node instanceof Element)) return;

    const poster = node.matches(".signal-ui__poster") ? node : node.querySelector?.(".signal-ui__poster");
    if (poster) {
      const current = poster.getAttribute("src") || "";
      if (current.includes("jarvis-preview-poster") && current !== "./jarvis-preview-poster-pt.svg") {
        poster.setAttribute("src", "./jarvis-preview-poster-pt.svg");
        return;
      }

      // Posters SVG nao usam os <source> AVIF/WebP do <picture>. Limpar aqui
      // impede que o navegador reaproveite a imagem otimizada do case anterior.
      if (current.endsWith(".svg")) {
        poster.parentElement?.querySelectorAll("[data-poster-source]").forEach((source) => {
          source.removeAttribute("srcset");
        });
      }
    }

    const sources = node.matches("[data-poster-source]") ? [node] : [...(node.querySelectorAll?.("[data-poster-source]") || [])];
    sources.forEach((source) => {
      const current = source.getAttribute("srcset") || "";
      if (current.includes("jarvis-preview-poster")) source.removeAttribute("srcset");

      const picturePoster = source.parentElement?.querySelector(".signal-ui__poster");
      if ((picturePoster?.getAttribute("src") || "").endsWith(".svg")) source.removeAttribute("srcset");
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

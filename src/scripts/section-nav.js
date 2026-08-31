// Marca o link do menu correspondente à seção visível. Para trocar o mapeamento seção->link, edite sectionNavMap.

export function initSectionNav() {
  const navLinks = [...document.querySelectorAll(".nav-link")];

  const sectionNavMap = new Map([
    ["home", "home"],
    ["services", "services"],
    ["work", "work"],
    ["labs", "labs"],
    ["philosophy", "about"],
    ["process", "about"],
    ["plans", "plans"],
    ["why", "about"],
    ["about", "about"],
    ["contact", "contact"],
  ]);

  const observedSections = [...sectionNavMap.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if ("IntersectionObserver" in window && observedSections.length) {
    // Quanto de cada secao ocupa a faixa observada, em pixels. Comparar por
    // intersectionRatio nao serve: o ratio e relativo a altura da propria secao,
    // entao uma secao baixa sempre venceria uma alta ocupando a mesma faixa.
    const bandHeights = new Map();

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        bandHeights.set(entry.target.id, entry.isIntersecting ? entry.intersectionRect.height : 0);
      });

      let visibleId = "";
      let widest = 0;
      bandHeights.forEach((height, id) => {
        if (height > widest) {
          widest = height;
          visibleId = id;
        }
      });

      if (!visibleId) return;

      const currentNavId = sectionNavMap.get(visibleId);

      navLinks.forEach((link) => {
        const isCurrent = link.getAttribute("href") === `#${currentNavId}`;
        link.classList.toggle("is-active", isCurrent);
        if (isCurrent) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }, {
      rootMargin: "-30% 0px -55% 0px",
      // Escada mais densa: uma secao alta satura em ratio baixo e precisa
      // disparar mesmo assim (a #plans, por exemplo, nunca passa de ~0.12).
      threshold: [0, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1],
    });

    observedSections.forEach((section) => sectionObserver.observe(section));
  }
}

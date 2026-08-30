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
    ["why", "about"],
    ["about", "about"],
    ["contact", "contact"],
  ]);

  const observedSections = [...sectionNavMap.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if ("IntersectionObserver" in window && observedSections.length) {
    const sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      const currentNavId = sectionNavMap.get(visible.target.id);

      navLinks.forEach((link) => {
        const isCurrent = link.getAttribute("href") === `#${currentNavId}`;
        link.classList.toggle("is-active", isCurrent);
        if (isCurrent) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }, {
      rootMargin: "-30% 0px -55% 0px",
      threshold: [0, 0.15, 0.4],
    });

    observedSections.forEach((section) => sectionObserver.observe(section));
  }
}

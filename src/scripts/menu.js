// Menu mobile: abre/fecha, trava o scroll, prende o foco (focus trap) e devolve o foco ao fechar.

export function initMenu() {
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const navigation = document.querySelector("[data-nav]");
  const mainContent = document.querySelector("main");
  const siteFooter = document.querySelector(".site-footer");
  let menuOpen = false;
  let previousFocus = null;

  const getMenuFocusableItems = () => {
    if (!navigation) return [];
    const items = [...navigation.querySelectorAll("a[href], button:not([disabled])")];
    if (menuToggle) items.push(menuToggle);
    return items;
  };

  const setMenuState = (open, { restoreFocus = true } = {}) => {
    if (!menuToggle || !navigation) return;

    menuOpen = open;
    navigation.classList.toggle("is-open", open);
    navigation.style.visibility = open ? "visible" : "";
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    document.body.classList.toggle("menu-open", open);
    document.body.style.overflow = open ? "hidden" : "";

    [mainContent, siteFooter].forEach((region) => {
      if (!region) return;
      region.toggleAttribute("inert", open);
      if (open) region.setAttribute("aria-hidden", "true");
      else region.removeAttribute("aria-hidden");
    });

    if (open) {
      previousFocus = document.activeElement;
      const firstItem = getMenuFocusableItems()[0];
      if (firstItem) {
        navigation.getBoundingClientRect();
        firstItem.focus({ preventScroll: true });
        if (document.activeElement !== firstItem) {
          window.requestAnimationFrame(() => firstItem.focus({ preventScroll: true }));
        }
      }
    } else if (restoreFocus && previousFocus instanceof HTMLElement) {
      previousFocus.focus();
    }
  };

  menuToggle?.addEventListener("click", () => setMenuState(!menuOpen));

  navigation?.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (link && menuOpen) setMenuState(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!menuOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setMenuState(false);
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = getMenuFocusableItems();
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (menuOpen && window.innerWidth > 980) {
      setMenuState(false, { restoreFocus: false });
    }
  }, { passive: true });
}

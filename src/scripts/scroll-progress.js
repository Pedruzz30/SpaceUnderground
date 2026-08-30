// Header compacto ao rolar + barra de progresso de leitura.

export function initScrollProgress() {
  const header = document.querySelector("[data-header]");
  const progressBar = document.querySelector(".scroll-progress span");
  let scrollTicking = false;

  const updateScrollUI = () => {
    const scrollTop = window.scrollY;
    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollRange > 0 ? scrollTop / scrollRange : 0;

    header?.classList.toggle("is-scrolled", scrollTop > 24);

    if (progressBar) {
      progressBar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
    }

    scrollTicking = false;
  };

  const requestScrollUpdate = () => {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(updateScrollUI);
  };

  window.addEventListener("scroll", requestScrollUpdate, { passive: true });
  window.addEventListener("resize", requestScrollUpdate, { passive: true });
  updateScrollUI();
}

// Preenche o ano atual em qualquer [data-year].

export function initFooterYear() {
  const yearTargets = document.querySelectorAll("[data-year]");

  yearTargets.forEach((target) => {
    target.textContent = String(new Date().getFullYear());
  });
}

// Animação de entrada via IntersectionObserver. Respeita prefers-reduced-motion.
import { reduceMotion } from "./env.js";

export function initReveal() {
  const revealElements = document.querySelectorAll("[data-reveal]");
  const clippedLines = document.querySelectorAll(".statement-line, .contact-line");

  const makeVisible = (element) => element.classList.add("is-visible");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach(makeVisible);
    clippedLines.forEach(makeVisible);
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        makeVisible(entry.target);
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08,
    });

    revealElements.forEach((element) => revealObserver.observe(element));

    const lineObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        makeVisible(entry.target);
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -5% 0px",
      threshold: 0.35,
    });

    clippedLines.forEach((line) => lineObserver.observe(line));
  }
}

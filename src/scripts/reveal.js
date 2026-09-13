// Animação de entrada via IntersectionObserver. Respeita prefers-reduced-motion.
import { reduceMotion } from "./env.js";

let revealObserver = null;
let lineObserver = null;
const observedReveal = new WeakSet();
const observedLines = new WeakSet();

const makeVisible = (element) => element.classList.add("is-visible");

function observerFor(kind) {
  if (reduceMotion || !("IntersectionObserver" in window)) {
    return null;
  }

  if (kind === "line") {
    if (!lineObserver) {
      lineObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          makeVisible(entry.target);
          observer.unobserve(entry.target);
        });
      }, {
        rootMargin: "0px 0px -5% 0px",
        threshold: 0.35,
      });
    }
    return lineObserver;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        makeVisible(entry.target);
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08,
    });
  }
  return revealObserver;
}

export function observeReveal(root = document) {
  const scope = root instanceof Element ? root : document;
  const revealElements = [
    ...(scope.matches?.("[data-reveal]") ? [scope] : []),
    ...scope.querySelectorAll("[data-reveal]"),
  ];
  const clippedLines = [
    ...(scope.matches?.(".statement-line, .contact-line") ? [scope] : []),
    ...scope.querySelectorAll(".statement-line, .contact-line"),
  ];

  const reveal = observerFor("reveal");
  revealElements.forEach((element) => {
    if (element.classList.contains("is-visible") || observedReveal.has(element)) return;
    if (!reveal) {
      makeVisible(element);
      return;
    }
    observedReveal.add(element);
    reveal.observe(element);
  });

  const lines = observerFor("line");
  clippedLines.forEach((line) => {
    if (line.classList.contains("is-visible") || observedLines.has(line)) return;
    if (!lines) {
      makeVisible(line);
      return;
    }
    observedLines.add(line);
    lines.observe(line);
  });
}

export function initReveal() {
  observeReveal(document);
}

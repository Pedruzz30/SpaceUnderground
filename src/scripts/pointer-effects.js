// Efeitos exclusivos de mouse: aura do cursor e tilt 3D da arte do hero. Não roda em toque nem com reduced-motion.
import { finePointer, reduceMotion } from "./env.js";

export function initPointerEffects() {
  if (finePointer && !reduceMotion) {
    const cursorAura = document.querySelector(".cursor-aura");
    const hoverTargets = document.querySelectorAll("a, button");
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let auraX = pointerX;
    let auraY = pointerY;
    let auraFrame = 0;

    const renderAura = () => {
      auraX += (pointerX - auraX) * 0.11;
      auraY += (pointerY - auraY) * 0.11;

      if (cursorAura) {
        cursorAura.style.left = `${auraX}px`;
        cursorAura.style.top = `${auraY}px`;
      }

      const stillMoving = Math.abs(pointerX - auraX) > 0.1 || Math.abs(pointerY - auraY) > 0.1;
      auraFrame = stillMoving ? window.requestAnimationFrame(renderAura) : 0;
    };

    window.addEventListener("pointermove", (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      document.body.classList.add("has-pointer");
      if (!auraFrame) auraFrame = window.requestAnimationFrame(renderAura);
    }, { passive: true });

    document.documentElement.addEventListener("mouseleave", () => {
      document.body.classList.remove("has-pointer");
    });

    hoverTargets.forEach((target) => {
      target.addEventListener("pointerenter", () => document.body.classList.add("is-link-hover"));
      target.addEventListener("pointerleave", () => document.body.classList.remove("is-link-hover"));
    });

    document.querySelectorAll("[data-tilt]").forEach((tiltArea) => {
      const frame = tiltArea.querySelector(".hero-art__frame");
      if (!frame) return;

      tiltArea.addEventListener("pointermove", (event) => {
        const bounds = tiltArea.getBoundingClientRect();
        const xRatio = (event.clientX - bounds.left) / bounds.width - 0.5;
        const yRatio = (event.clientY - bounds.top) / bounds.height - 0.5;

        frame.style.setProperty("--tilt-x", `${xRatio * 7}deg`);
        frame.style.setProperty("--tilt-y", `${yRatio * -7}deg`);
      });

      tiltArea.addEventListener("pointerleave", () => {
        frame.style.setProperty("--tilt-x", "0deg");
        frame.style.setProperty("--tilt-y", "0deg");
      });
    });
  }
}

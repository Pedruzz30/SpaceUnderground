// Flags de ambiente lidas uma vez e compartilhadas entre os modulos.
const canMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";

export const reduceMotion = canMatchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
export const finePointer = canMatchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)").matches : false;

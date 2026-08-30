// Flags de ambiente lidas uma vez e compartilhadas entre os modulos.
export const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

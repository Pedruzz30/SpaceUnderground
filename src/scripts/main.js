// Ponto de entrada. Cada modulo cuida de uma parte da pagina e se
// inicializa sozinho; a ORDEM abaixo e a mesma do arquivo original.
import { initScrollProgress } from "./scroll-progress.js";
import { initMenu } from "./menu.js";
import { initReveal } from "./reveal.js";
import { initSectionNav } from "./section-nav.js";
import { initFooterYear } from "./footer-year.js";
import { initProjectDialog } from "./project-dialog.js";
import { initProjectHydrator } from "./project-hydrator.js";
import { initSignalFrame } from "./signal-frame.js";
import { initProjectForm } from "./project-form.js";
import { initPointerEffects } from "./pointer-effects.js";

document.documentElement.classList.add("js");

// Publica cases que ainda sao placeholders no HTML antes que o Project Viewer
// leia os slots e conecte os listeners.
initProjectHydrator();
initScrollProgress();
initMenu();
initReveal();
initSectionNav();
initFooterYear();
initProjectDialog();
initSignalFrame();
initProjectForm();
initPointerEffects();

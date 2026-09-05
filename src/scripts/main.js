// Ponto de entrada. Cada modulo cuida de uma parte da pagina e se
// inicializa sozinho; a ORDEM abaixo e a mesma do arquivo original.
import { initLocalization } from "./localization.js";
import { initPosterLocalization } from "./poster-localization.js";
import { initCapabilitiesSection } from "./capabilities-section.js";
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

// Localiza o conteudo estatico antes dos modulos que escrevem textos dinamicos.
// Um MutationObserver dentro do modulo cobre tambem updates posteriores do viewer,
// formulario, planos e estados de interface.
initLocalization();
initPosterLocalization();

// Insere a camada de posicionamento Sites > Sistemas > Automacao > IA antes
// do sistema de reveal e da navegacao observarem as secoes da pagina.
initCapabilitiesSection();

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

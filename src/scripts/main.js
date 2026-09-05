// Ponto de entrada. Cada modulo cuida de uma parte da pagina e se
// inicializa sozinho; a ORDEM abaixo e a mesma do arquivo original.
import { initCapabilitiesSection } from "./capabilities-section.js";
import { initCommercialPositioning } from "./commercial-positioning.js";
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

// A localizacao do HTML e feita no build pelo vite.config.js. Nao mantemos
// MutationObserver de traducao no navegador: ele era redundante, podia
// retransladar textos ja em pt-BR e gerar trabalho continuo no DOM.

// Insere a camada de posicionamento Sites > Sistemas > Automacao > IA antes
// do sistema de reveal e da navegacao observarem as secoes da pagina.
initCapabilitiesSection();

// Reposiciona a area comercial e expande o formulario antes de dialog/form
// capturarem os elementos e conectarem seus listeners.
initCommercialPositioning();

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

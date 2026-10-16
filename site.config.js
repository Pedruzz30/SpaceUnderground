// Fonte unica de verdade da presenca publica do site.
//
// canonical, Open Graph, Twitter card, JSON-LD, sitemap.xml e robots.txt saem
// TODOS daqui, injetados em build time pelo plugin do vite.config.js. Quando o
// dominio proprio existir, troque SITE_URL neste arquivo e nada mais: nenhuma
// URL publica esta escrita a mao em outro lugar.
//
// SITE_URL sempre com barra no final.

export const SITE_URL = "https://pedruzz30.github.io/SpaceUnderground/";
export const SITE_NAME = "SPACE UNDERGROUND";
export const SITE_TITLE = "SPACE UNDERGROUND — Estúdio Digital Independente";
export const SITE_DESCRIPTION =
  "A SPACE UNDERGROUND é um estúdio digital independente que cria sites, sistemas, automações e produtos digitais além do óbvio.";
export const SITE_LOCALE = "pt_BR";
export const SITE_EMAIL = "hello.SpaceUnderGround@gmail.com";

// Imagem das meta tags og:image / twitter:image. 1200x630, em public/.
export const OG_IMAGE = "og-image.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_ALT = "SPACE UNDERGROUND — Crie o que ainda não deveria existir.";

// Rotas indexaveis. Uma pagina so hoje, entao o sitemap lista a raiz.
// A 404 NAO entra aqui de proposito: pagina de erro nao vai para sitemap.
export const ROUTES = [""];

export const absoluteUrl = (path = "") => new URL(path, SITE_URL).href;

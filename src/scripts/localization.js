const TRANSLATIONS = [
  ["Space Underground home", "Início da SPACE UNDERGROUND"],
  ["Primary navigation", "Navegação principal"],
  ["Footer navigation", "Navegação do rodapé"],
  ["Skip to content", "Pular para o conteúdo"],
  ["Start a Project", "Iniciar um Projeto"],
  ["Open menu", "Abrir menu"],
  ["Close menu", "Fechar menu"],
  ["Independent digital studio", "Estúdio digital independente"],
  ["Build what shouldn't exist yet.", "Crie o que ainda não deveria existir."],
  ["Build what", "Crie o que"],
  ["shouldn't", "ainda não deveria"],
  ["exist yet.", "existir ainda."],
  ["Digital experiences, websites, systems and products built below the obvious.", "Experiências digitais, sites, sistemas e produtos criados além do óbvio."],
  ["Explore Our Work", "Conheça nossos projetos"],
  ["Scroll to explore", "Role para explorar"],
  ["STUDIO + SYSTEMS + LABS", "ESTÚDIO + SISTEMAS + LABORATÓRIO"],
  ["Space / Studio", "SPACE / ESTÚDIO"],
  ["What we build.", "O que construímos."],
  ["Client work for brands and businesses that need digital experiences with structure, intent and a sharper point of view.", "Projetos para marcas e empresas que precisam de experiências digitais com estrutura, intenção e uma identidade mais marcante."],
  ["Conversion-focused digital experiences designed around a specific product, service or campaign.", "Experiências digitais focadas em conversão, criadas para um produto, serviço ou campanha específica."],
  ["Portfolio Websites", "Sites de Portfólio"],
  ["Custom digital portfolios for professionals, creators and brands.", "Portfólios digitais personalizados para profissionais, criadores e marcas."],
  ["Institutional Websites", "Sites Institucionais"],
  ["Complete multi-page digital experiences for companies and businesses.", "Experiências digitais completas, com múltiplas páginas, para empresas e negócios."],
  ["Online stores designed around product discovery, usability and conversion.", "Lojas virtuais pensadas para descoberta de produtos, usabilidade e conversão."],
  ["Web Systems", "Sistemas Web"],
  ["Custom dashboards, internal platforms and business tools.", "Dashboards, plataformas internas e ferramentas de negócio sob medida."],
  ["Selected Work", "Projetos Selecionados"],
  ["Live projects.", "Projetos em produção."],
  ["Live client projects presented in a single frame. Switch between cases below; the reserved slots are next in line.", "Projetos reais de clientes apresentados em um único quadro. Alterne entre os cases abaixo; os espaços reservados são os próximos da fila."],
  ["Selected client work and experimental systems presented in a single frame. Switch between cases below; reserved slots are next in line.", "Projetos selecionados de clientes e sistemas experimentais apresentados em um único quadro. Alterne entre os cases abaixo; os espaços reservados são os próximos da fila."],
  ["Selected work / project selector", "Projetos selecionados / seletor de projeto"],
  ["Show project 001 — INK Tattoo", "Mostrar projeto 001 — INK Tattoo"],
  ["Show project 002 — Lucas Souza", "Mostrar projeto 002 — Lucas Souza"],
  ["Show project 003 — JARVIS AI", "Mostrar projeto 003 — JARVIS AI"],
  ["Project slot 003 — reserved", "Espaço de projeto 003 — reservado"],
  ["Project slot 004 — reserved", "Espaço de projeto 004 — reservado"],
  ["Project slot 005 — reserved", "Espaço de projeto 005 — reservado"],
  ["PROJECT /", "PROJETO /"],
  ["RESERVED", "RESERVADO"],
  ["CLIENT /", "CLIENTE /"],
  ["DIGITAL IDENTITY & PORTFOLIO", "IDENTIDADE DIGITAL & PORTFÓLIO"],
  ["A dark editorial experience built around tattoo culture, motion and visual depth.", "Uma experiência editorial escura construída em torno da cultura da tatuagem, movimento e profundidade visual."],
  ["VIEW LIVE", "VER AO VIVO"],
  ["Preview view mode", "Modo de visualização da prévia"],
  ["View mode: overview", "Modo de visualização: visão geral"],
  ["View mode: site", "Modo de visualização: site"],
  ["View mode: detail", "Modo de visualização: detalhes"],
  ["INK TATTOO / PRODUCTION", "INK TATTOO / PRODUÇÃO"],
  ["Open INK Tattoo website in a new tab", "Abrir o site INK Tattoo em uma nova aba"],
  ["INK Tattoo live website preview", "Prévia ao vivo do site INK Tattoo"],
  ["Restore overview mode", "Restaurar visão geral"],
  ["EXPERIENCE SYSTEM / 01", "SISTEMA DE EXPERIÊNCIA / 01"],
  ["ART DIRECTION", "DIREÇÃO DE ARTE"],
  ["MONOCHROME DEPTH", "PROFUNDIDADE MONOCROMÁTICA"],
  ["INTERACTION", "INTERAÇÃO"],
  ["FLUID MOTION", "MOVIMENTO FLUIDO"],
  ["EXPERIENCE", "EXPERIÊNCIA"],
  ["EDITORIAL RHYTHM", "RITMO EDITORIAL"],
  ["Inspect studio origin", "Inspecionar origem do estúdio"],
  ["PREVIEW / INITIALIZING", "PRÉVIA / INICIALIZANDO"],
  ["● LIVE PREVIEW", "● PRÉVIA AO VIVO"],
  ["PREVIEW / SLEEP", "PRÉVIA / EM ESPERA"],
  ["PREVIEW / FALLBACK", "PRÉVIA / ALTERNATIVA"],
  ["View INK Tattoo website (opens in a new tab)", "Ver o site INK Tattoo (abre em uma nova aba)"],
  ["View Lucas Souza website (opens in a new tab)", "Ver o site Lucas Souza (abre em uma nova aba)"],
  ["View JARVIS AI website (opens in a new tab)", "Ver o projeto JARVIS AI (abre em uma nova aba)"],
  ["Open Lucas Souza website in a new tab", "Abrir o site Lucas Souza em uma nova aba"],
  ["Open JARVIS AI website in a new tab", "Abrir o projeto JARVIS AI em uma nova aba"],
  ["LIVE PROJECT", "PROJETO ATIVO"],
  ["YEAR —", "ANO —"],
  ["TYPE —", "TIPO —"],
  ["TECH —", "TECNOLOGIA —"],
  ["STATUS — LIVE", "STATUS — NO AR"],
  ["View Project", "Ver Projeto"],
  ["One frame, one project at a time", "Um quadro, um projeto por vez"],
  ["Portfolio website", "Site de portfólio"],
  ["Sports nutrition website", "Site de nutrição esportiva"],
  ["Slot reserved", "Espaço reservado"],
  ["Reserved", "Reservado"],
  ["Space / Labs", "SPACE / LABORATÓRIO"],
  ["Products built underground.", "Produtos criados no subterrâneo."],
  ["Independent software, experiments and digital products researched inside Space Underground. Nothing is announced before it exists.", "Softwares independentes, experimentos e produtos digitais pesquisados dentro da SPACE UNDERGROUND. Nada é anunciado antes de existir."],
  ["Research / Active", "Pesquisa / Ativo"],
  ["Space Labs research status", "Status de pesquisa do laboratório da SPACE UNDERGROUND"],
  ["First system currently under research.", "Primeiro sistema atualmente em pesquisa."],
  ["Point of view", "Ponto de vista"],
  ["We don't build websites", "Não criamos sites"],
  ["just to exist.", "apenas para existir."],
  ["We build digital spaces", "Criamos espaços digitais"],
  ["designed to be remembered.", "feitos para serem lembrados."],
  ["SPACE UNDERGROUND — DIGITAL STUDIO —", "SPACE UNDERGROUND — ESTÚDIO DIGITAL —"],
  ["Process", "Processo"],
  ["From idea to launch.", "Da ideia ao lançamento."],
  ["A focused, collaborative process that keeps decisions clear and momentum high.", "Um processo focado e colaborativo que mantém as decisões claras e o ritmo alto."],
  ["Discovery", "Descoberta"],
  ["Understand the business, audience and problem.", "Entender o negócio, o público e o problema."],
  ["Direction", "Direção"],
  ["Define strategy, structure and visual identity.", "Definir estratégia, estrutura e identidade visual."],
  ["Build", "Construção"],
  ["Design and develop the digital experience.", "Projetar e desenvolver a experiência digital."],
  ["Launch", "Lançamento"],
  ["Test, optimize and put the project into production.", "Testar, otimizar e colocar o projeto em produção."],
  ["Plans / Engagement", "Planos / Contratação"],
  ["Three ways to start.", "Três formas de começar."],
  ["Transparent ranges by project level. Final scope and quote are defined together, before anything starts.", "Faixas transparentes por nível de projeto. O escopo final e o orçamento são definidos em conjunto antes do início."],
  ["View plan:", "Ver plano:"],
  ["PRICING PLAN", "PLANO DE INVESTIMENTO"],
  ["PLAN /", "PLANO /"],
  ["PLAN", "PLANO"],
  ["AVAILABLE", "DISPONÍVEL"],
  ["VIEW", "VER"],
  ["SCOPE —", "ESCOPO —"],
  ["RANGE —", "FAIXA —"],
  ["FROM R$", "A PARTIR DE R$"],
  ["LANDING PAGES · PORTFOLIOS", "LANDING PAGES · PORTFÓLIOS"],
  ["INSTITUTIONAL WEBSITES", "SITES INSTITUCIONAIS"],
  ["MULTI-PAGE INSTITUTIONAL SITES", "SITES INSTITUCIONAIS COM MÚLTIPLAS PÁGINAS"],
  ["E-COMMERCE · SYSTEMS", "E-COMMERCE · SISTEMAS"],
  ["E-COMMERCE · WEB SYSTEMS · CUSTOM BUILDS", "E-COMMERCE · SISTEMAS WEB · PROJETOS SOB MEDIDA"],
  ["View Plan", "Ver Plano"],
  ["The difference", "O diferencial"],
  ["Built without the usual.", "Criado sem o comum."],
  ["Every decision earns its place. Nothing is added simply because everyone else is doing it.", "Cada decisão precisa justificar seu lugar. Nada é adicionado apenas porque todos estão fazendo igual."],
  ["Space Underground principles", "Princípios da SPACE UNDERGROUND"],
  ["Custom design", "Design personalizado"],
  ["No generic templates", "Sem templates genéricos"],
  ["Performance-focused", "Foco em performance"],
  ["Responsive by default", "Responsivo por padrão"],
  ["Clean code", "Código limpo"],
  ["Scalable architecture", "Arquitetura escalável"],
  ["Direct communication", "Comunicação direta"],
  ["INDEPENDENT", "INDEPENDENTE"],
  ["DIGITAL STUDIO", "ESTÚDIO DIGITAL"],
  ["OPERATING BELOW", "OPERANDO ABAIXO"],
  ["THE SURFACE", "DA SUPERFÍCIE"],
  ["About", "Sobre"],
  ["Independent by design.", "Independente por escolha."],
  ["Space Underground is an independent technology and digital product studio based in Brazil. We started underground — small by choice, earning the name before the scale.", "A SPACE UNDERGROUND é um estúdio independente de tecnologia e produtos digitais com base no Brasil. Começamos no subterrâneo — pequenos por escolha, conquistando o nome antes da escala."],
  ["We work at the intersection of design, development and digital products. The point is space — a site that earns trust, a system that gives back the hours. We're starting too, so we build for people who are. Underground by origin. Upward by intent.", "Trabalhamos na interseção entre design, desenvolvimento e produtos digitais. O objetivo é criar espaço — um site que gera confiança, um sistema que devolve tempo. Também estamos começando, por isso construímos para quem está construindo. Subterrâneos na origem. Para cima na intenção."],
  ["Worldwide", "Mundial"],
  ["Taking projects", "Aceitando projetos"],
  ["Contact", "Contato"],
  ["Available for select projects", "Disponível para projetos selecionados"],
  ["Have something", "Tem algo"],
  ["worth building?", "que vale construir?"],
  ["Tell us what you're building. The first reply is human, direct and practical.", "Conte o que você está construindo. A primeira resposta é humana, direta e prática."],
  ["Leave this field empty", "Deixe este campo vazio"],
  ["Name", "Nome"],
  ["Required field.", "Campo obrigatório."],
  ["Use a valid email.", "Use um e-mail válido."],
  ["Company / Brand", "Empresa / Marca"],
  ["What do you need?", "Do que você precisa?"],
  ["Select one option", "Selecione uma opção"],
  ["Institutional Website", "Site Institucional"],
  ["Web System", "Sistema Web"],
  ["Other", "Outro"],
  ["Select a project type.", "Selecione um tipo de projeto."],
  ["Project type selector", "Seletor de tipo de projeto"],
  ["Choose the build", "Escolha o projeto"],
  ["Campaign, offer or launch page.", "Página de campanha, oferta ou lançamento."],
  ["CONVERSION", "CONVERSÃO"],
  ["Personal, creative or brand presence.", "Presença pessoal, criativa ou de marca."],
  ["IDENTITY", "IDENTIDADE"],
  ["Multi-page company experience.", "Experiência empresarial com múltiplas páginas."],
  ["STRUCTURE", "ESTRUTURA"],
  ["Storefront built around discovery.", "Loja virtual pensada para descoberta de produtos."],
  ["COMMERCE", "COMÉRCIO"],
  ["Dashboard, platform or internal tool.", "Dashboard, plataforma ou ferramenta interna."],
  ["SYSTEM", "SISTEMA"],
  ["Something that does not fit the map yet.", "Algo que ainda não cabe no mapa."],
  ["CUSTOM", "SOB MEDIDA"],
  ["NO PRODUCT SELECTED", "NENHUM PRODUTO SELECIONADO"],
  ["PRODUCT SELECTED", "PRODUTO SELECIONADO"],
  ["Choose a build type to calibrate the request.", "Escolha um tipo de projeto para calibrar a solicitação."],
  ["Budget range and timeline hints will appear here. You can still edit the fields manually.", "A faixa de orçamento e a estimativa de prazo aparecerão aqui. Você ainda pode editar os campos manualmente."],
  ["Tell us about the project", "Conte sobre o projeto"],
  ["Tell us enough to understand the first move.", "Conte o suficiente para entendermos o primeiro passo."],
  ["Estimated budget", "Orçamento estimado"],
  ["Example:", "Exemplo:"],
  ["Budget presets", "Faixas de orçamento"],
  ["TO DEFINE", "A DEFINIR"],
  ["To define", "A definir"],
  ["Desired timeline", "Prazo desejado"],
  ["Timeline presets", "Opções de prazo"],
  ["WEEKS", "SEMANAS"],
  ["weeks", "semanas"],
  ["Send Project Request", "Enviar Solicitação de Projeto"],
  ["Sending...", "Enviando..."],
  ["Request received. We reply within 1 business day.", "Solicitação recebida. Respondemos em até 1 dia útil."],
  ["Check the highlighted fields before sending.", "Confira os campos destacados antes de enviar."],
  ["Sending your request...", "Enviando sua solicitação..."],
  ["Could not send. Write us directly at hello.SpaceUnderGround@gmail.com", "Não foi possível enviar. Escreva diretamente para hello.SpaceUnderGround@gmail.com"],
  ["Best for campaigns, launches and focused offers. Usually includes strategy, page structure, responsive interface and a conversion-ready contact path.", "Ideal para campanhas, lançamentos e ofertas focadas. Normalmente inclui estratégia, estrutura da página, interface responsiva e um caminho de contato preparado para conversão."],
  ["Best for professionals, creators and brands that need a memorable digital identity with selected work, story and contact flow.", "Ideal para profissionais, criadores e marcas que precisam de uma identidade digital marcante, com trabalhos selecionados, história e fluxo de contato."],
  ["Best for companies that need a complete presence with multiple pages, clear navigation, service content and a scalable structure.", "Ideal para empresas que precisam de uma presença completa, com múltiplas páginas, navegação clara, conteúdo de serviços e estrutura escalável."],
  ["Best for product catalogs and stores where discovery, usability, checkout intent and visual direction need to work together.", "Ideal para catálogos e lojas em que descoberta, usabilidade, intenção de compra e direção visual precisam trabalhar juntas."],
  ["Best for dashboards, internal platforms and custom tools where workflow, data and interface behavior matter more than decoration.", "Ideal para dashboards, plataformas internas e ferramentas sob medida em que fluxo de trabalho, dados e comportamento da interface importam mais que decoração."],
  ["Best for unusual scopes, early product ideas or builds that need a technical conversation before being named properly.", "Ideal para escopos incomuns, ideias iniciais de produto ou projetos que precisam de uma conversa técnica antes de receberem um nome definitivo."],
  ["Budget range:", "Faixa de orçamento:"],
  ["Estimated time:", "Prazo estimado:"],
  ["BASED IN BRAZIL", "COM BASE NO BRASIL"],
  ["AVAILABLE WORLDWIDE", "ATENDIMENTO MUNDIAL"],
  ["Navigate", "Navegar"],
  ["Built below the surface.", "Criado abaixo da superfície."],
  ["Back to top", "Voltar ao topo"],
  ["Close project preview", "Fechar prévia do projeto"],
  ["Pricing plan", "Plano de investimento"],
  ["PLAN / LANDING PAGES & PORTFOLIOS", "PLANO / LANDING PAGES & PORTFÓLIOS"],
  ["For getting online with clarity — fast, focused, done right.", "Para entrar no digital com clareza — rápido, focado e bem feito."],
  ["Selected scope", "Escopo selecionado"],
  ["Investment range by project level. The final quote is set once the scope is defined — talk to the studio for a proposal.", "Faixa de investimento por nível de projeto. O valor final é definido após o escopo — fale com o estúdio para receber uma proposta."],
  ["Request a Proposal", "Solicitar Proposta"],
  ["What’s included", "O que está incluído"],
  ["What's included", "O que está incluído"],
  ["Typical timeline —", "Prazo típico —"],
  ["Single responsive page", "Página única responsiva"],
  ["Contact form integration", "Integração de formulário de contato"],
  ["1 revision round", "1 rodada de revisão"],
  ["PLAN / INSTITUTIONAL WEBSITES", "PLANO / SITES INSTITUCIONAIS"],
  ["For businesses ready to show up as more than a page.", "Para empresas prontas para se apresentar como algo maior que uma única página."],
  ["Multi-page structure", "Estrutura com múltiplas páginas"],
  ["Custom design, no templates", "Design personalizado, sem templates"],
  ["Basic SEO & performance", "SEO básico e performance"],
  ["2 revision rounds", "2 rodadas de revisão"],
  ["PLAN / E-COMMERCE & SYSTEMS", "PLANO / E-COMMERCE & SISTEMAS"],
  ["For the ones who need the full system behind the front.", "Para quem precisa de um sistema completo por trás da interface."],
  ["Custom e-commerce or web system", "E-commerce ou sistema web sob medida"],
  ["Third-party integrations", "Integrações com serviços de terceiros"],
  ["Revisions scoped per project", "Revisões definidas conforme o projeto"],
  ["SPORTS NUTRITION EXPERIENCE", "EXPERIÊNCIA EM NUTRIÇÃO ESPORTIVA"],
  ["Strategic digital presence designed around performance, credibility and conversion.", "Presença digital estratégica criada em torno de performance, credibilidade e conversão."],
  ["PERFORMANCE SYSTEM / 02", "SISTEMA DE PERFORMANCE / 02"],
  ["LUCAS SOUZA / PRODUCTION", "LUCAS SOUZA / PRODUÇÃO"],
  ["SPORTS NUTRITION WEBSITE", "SITE DE NUTRIÇÃO ESPORTIVA"],
  ["SPORTS STRATEGY", "ESTRATÉGIA ESPORTIVA"],
  ["COMPOSITION", "COMPOSIÇÃO"],
  ["BODY GOALS", "OBJETIVOS CORPORAIS"],
  ["RECOVERY", "RECUPERAÇÃO"],
  ["LONGEVITY", "LONGEVIDADE"],
  ["AI DESKTOP SYSTEM & AUTOMATION", "SISTEMA DE IA PARA DESKTOP & AUTOMAÇÃO"],
  ["An intelligent desktop environment combining artificial intelligence, voice interaction, automation and real-time system control.", "Um ambiente inteligente para desktop que combina inteligência artificial, interação por voz, automação e controle do sistema em tempo real."],
  ["INTELLIGENCE SYSTEM / 03", "SISTEMA DE INTELIGÊNCIA / 03"],
  ["AI / AUTOMATION", "IA / AUTOMAÇÃO"],
  ["JARVIS AI / PROTOTYPE", "JARVIS AI / PROTÓTIPO"],
  ["AI DESKTOP APPLICATION", "APLICAÇÃO DE IA PARA DESKTOP"],
  ["PYTHON / PYQT6 / AI / AUTOMATION", "PYTHON / PYQT6 / IA / AUTOMAÇÃO"],
  ["PROTOTYPE", "PROTÓTIPO"],
  ["INTELLIGENCE", "INTELIGÊNCIA"],
  ["AI ASSISTANT", "ASSISTENTE DE IA"],
  ["AUTOMATION", "AUTOMAÇÃO"],
  ["SYSTEM CONTROL", "CONTROLE DO SISTEMA"],
  ["INTERFACE", "INTERFACE"],
  ["HOLOGRAPHIC HUD", "HUD HOLOGRÁFICO"],
  ["JARVIS — Space Underground experimental AI lab", "JARVIS — laboratório experimental de IA da SPACE UNDERGROUND"],
  ["STATUS — PROTOTYPE / ACTIVE", "STATUS — PROTÓTIPO / ATIVO"],
  ["EXPERIMENTAL AI OPERATING ENVIRONMENT", "AMBIENTE OPERACIONAL EXPERIMENTAL DE IA"],
  ["Artificial intelligence, voice interaction, automation and desktop control.", "Inteligência artificial, interação por voz, automação e controle do desktop."],
  ["OPEN LAB", "ABRIR LABORATÓRIO"],
  ["Prototype / Active", "Protótipo / Ativo"],
  ["Inspect art direction", "Inspecionar direção de arte"],
  ["Inspect interaction", "Inspecionar interação"],
  ["Inspect experience", "Inspecionar experiência"],
  ["Inspect performance", "Inspecionar performance"],
  ["Inspect composition", "Inspecionar composição"],
  ["Inspect recovery", "Inspecionar recuperação"],
  ["Inspect intelligence", "Inspecionar inteligência"],
  ["Inspect automation", "Inspecionar automação"],
  ["Inspect interface", "Inspecionar interface"],
  ["live website preview", "prévia ao vivo do projeto"]
];

TRANSLATIONS.sort((a, b) => b[0].length - a[0].length);

const ATTRIBUTE_NAMES = [
  "aria-label",
  "title",
  "placeholder",
  "data-budget",
  "data-timeline",
  "data-budget-choice",
  "data-timeline-choice"
];

export function translateString(value) {
  let translated = String(value ?? "");
  TRANSLATIONS.forEach(([from, to]) => {
    if (translated.includes(from)) translated = translated.replaceAll(from, to);
  });
  return translated;
}

function translateTextNode(node) {
  const next = translateString(node.data);
  if (next !== node.data) node.data = next;
}

function translateElement(element) {
  ATTRIBUTE_NAMES.forEach((name) => {
    if (!element.hasAttribute?.(name)) return;
    const current = element.getAttribute(name);
    const next = translateString(current);
    if (next !== current) element.setAttribute(name, next);
  });
}

function localizeTree(root) {
  if (!root) return;

  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

  if (root.nodeType === Node.ELEMENT_NODE) {
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(root.tagName)) return;
    translateElement(root);
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (parent?.closest?.("script, style, noscript")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateTextNode(current);
    else translateElement(current);
    current = walker.nextNode();
  }
}

export function localizeHtmlSource(html) {
  let localized = String(html)
    .replace('<html lang="en">', '<html lang="pt-BR">')
    .replace(/>([^<]+)</g, (match, text) => `>${translateString(text)}<`);

  ATTRIBUTE_NAMES.forEach((name) => {
    const pattern = new RegExp(`${name}="([^"]*)"`, "g");
    localized = localized.replace(pattern, (match, value) => `${name}="${translateString(value)}"`);
  });

  return localized;
}

export function initLocalization() {
  document.documentElement.lang = "pt-BR";
  localizeTree(document.body);

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === "characterData") {
        translateTextNode(record.target);
        return;
      }

      if (record.type === "attributes") {
        translateElement(record.target);
        return;
      }

      record.addedNodes.forEach(localizeTree);
    });
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTE_NAMES
  });
}

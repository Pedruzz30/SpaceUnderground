# Space Underground

Site institucional do estúdio. HTML/CSS/JS puro, sem framework, empacotado com [Vite](https://vitejs.dev/).

## Rodando

```bash
npm install      # so na primeira vez
npm run dev      # servidor local em http://127.0.0.1:5173
npm run build    # gera dist/
npm run preview  # serve o dist/ para conferir o build final
npm run plans    # reescreve os cards de Plans no index.html a partir do registry
```

Publicação é automática: todo push na `main` dispara
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml),
que roda `npm run build` e joga o `dist/` no GitHub Pages. Não commite `dist/` —
ele é ignorado no `.gitignore` e regerado no CI.

## Mapa do projeto

```
site.config.js          Fonte unica da presenca publica: SITE_URL, titulo,
                        descricao, e-mail, OG image. canonical, Open Graph,
                        JSON-LD, sitemap.xml e robots.txt saem TODOS daqui.
                        Dominio novo = trocar SITE_URL e mais nada.
vite.config.js          Build + o plugin que injeta o SEO no HTML, CONFERE o
                        bloco de Plans e emite robots.txt, sitemap.xml e 404.html.
scripts/
  render-plans.mjs      `npm run plans`: escreve os cards de Plans dentro do
                        index.html a partir do plans-registry.js.
  plans-block.mjs       Acha o bloco entre @plans:start e @plans:end. Usado por
                        quem escreve e por quem confere, para os dois
                        concordarem sobre onde ele comeca e termina.
  optimize-images.mjs   Gera os AVIF/WebP de public/. Roda a mao, fora do build.

index.html              A pagina inteira. Uma <section> por bloco, cada uma com id
                        proprio (#home, #services, #work, #labs, #philosophy,
                        #process, #plans, #why, #about, #contact).
                        <!--@seo--> e preenchido em build time a partir do
                        site.config.js. O bloco entre @plans:start e @plans:end
                        e GERADO: fica versionado aqui (para o arquivo abrir
                        completo no editor), mas quem manda e o
                        plans-registry.js — edite la e rode `npm run plans`.

public/                 Copiado cru para a raiz do dist/, sem processamento.
  favicon.svg           Icone principal.
  favicon-32.png        Fallback para navegador que nao le SVG.
  apple-touch-icon.png  180x180, iOS. Os dois PNG saem do favicon.svg.
  og-image.png          Preview 1200x630 das meta tags og:image / twitter:image.
                        Gerado na estetica do hero; se o titulo mudar, regere.
  NoteBookSpaceU.{avif,webp,png}
                        Monolito do hero. E o LCP da pagina: entra por <picture>
                        com fetchpriority="high" e SEM loading="lazy".
  tattoo-preview-poster.{avif,webp,png}
  LucasNutri.{avif,webp,png}
                        Posters do PROJECT VIEWER: e o que aparece antes (e no
                        lugar) do iframe. Um por case, apontado em
                        project-registry.js — que guarda os tres formatos e as
                        dimensoes reais do arquivo.

src/styles/
  main.css              So @import. A ORDEM DOS IMPORTS E A ORDEM DA CASCATA.
  base/
    tokens.css          :root com todas as variaveis (cores, fontes, espacamentos).
                        Mexer aqui muda o site inteiro.
    reset.css           Normalizacao, <body>, textura de ruido, links, imagens.
    a11y.css            Skip link, :focus-visible, .visually-hidden.
  layout/
    container.css       .container e .section (largura maxima e respiro vertical).
    header.css          Cabecalho fixo e menu.
    footer.css
  components/
    scroll-progress.css Barra de progresso do topo.
    cursor-aura.css     Halo que segue o mouse.
    headings.css        Titulos reaproveitados entre secoes (.section-heading etc).
    live-project-preview.css
                        O frame do PROJECT VIEWER (.signal-ui): rail de slots,
                        browser, iframe e rodape. Entra logo depois de work.css.
    project-dialog.css  Modal de preview (hoje quem abre sao os planos).
  sections/             Um arquivo por secao da pagina, mesmo nome do id.
    hero.css services.css work.css labs.css statement.css
    process.css plans.css why.css about.css contact.css
  motion.css            Estados de animacao (.reveal, .is-visible) e transicoes.
  responsive.css        TODOS os media queries. Fica por ultimo de proposito.

src/scripts/
  main.js               Ponto de entrada: importa e chama os modulos na ordem.
  env.js                reduceMotion e finePointer, lidos uma vez e compartilhados.
  scroll-progress.js    Header compacto ao rolar + barra de progresso.
  menu.js               Menu mobile: abre/fecha, trava scroll, focus trap.
  reveal.js             Animacao de entrada via IntersectionObserver.
  section-nav.js        Marca o link do menu da secao visivel.
  footer-year.js        Preenche o ano em [data-year].
  project-registry.js   Fonte de verdade dos cases do PROJECT VIEWER: dados,
                        accent e qual case abre primeiro. A ordem dos slots e a
                        do HTML.
  plans-registry.js     Fonte de verdade dos planos: preco, prazo, escopo e o
                        que esta incluso. Card e modal leem daqui.
  plans-renderer.js     Monta o HTML dos cards a partir do registro. Roda no
                        Node (`npm run plans` e a conferencia do build), nunca
                        no navegador: nao toca em document.
  project-dialog.js     Modal dos planos, alimentado pelo plans-registry.
  signal-frame.js       PROJECT VIEWER da secao Selected Work: um iframe so,
                        um case por vez, alimentado pelo project-registry.
  project-form.js       Formulario: picker de produto, autofill, validacao, envio.
  pointer-effects.js    Aura do cursor e tilt 3D do hero (so mouse).
```

## Onde mexer para cada coisa

| Quero mudar | Vou em |
|---|---|
| Cor, fonte, espaçamento global | `src/styles/base/tokens.css` |
| Texto de uma seção | `index.html`, na `<section>` do id correspondente |
| Visual de uma seção | `src/styles/sections/<nome>.css` |
| Comportamento em telas menores | `src/styles/responsive.css` |
| Publicar um case novo no Selected Work | `src/scripts/project-registry.js`: troque um `slot-00x` reservado pelos dados reais (e tire o `data-slot-reserved` do botão e da linha do índice no HTML) |
| Preço, prazo ou escopo de um plano | `src/scripts/plans-registry.js`, **e só ali** — o card e o modal leem do mesmo lugar |
| Endereço público do site (domínio novo) | `SITE_URL` em `site.config.js`. canonical, OG, JSON-LD, sitemap e robots acompanham |
| Título, descrição ou e-mail públicos | `site.config.js` |
| Trocar um PNG de `public/` | troque o PNG, rode `node scripts/optimize-images.mjs` e atualize os `width`/`height` do `<picture>` correspondente |
| Campos/opções do formulário | `index.html` + `productDetails` em `src/scripts/project-form.js` |
| Para onde o formulário envia | atributo `action` do `<form id="project-request">` (hoje: Formspree) |

## Convenções que valem respeitar

- **A ordem dos `@import` em `main.css` é a cascata.** Reordenar muda o visual.
  `responsive.css` precisa continuar por último para os media queries vencerem
  as regras base.
- **CSS é dividido por seção, não por tipo de propriedade.** Um arquivo por
  bloco visual; se um estilo serve a mais de uma seção, ele pertence a
  `components/` ou `base/`.
- **Cada módulo JS exporta um único `init...()`** e faz suas próprias buscas no
  DOM. Nenhum módulo depende de variável global de outro — o único estado
  compartilhado está em `env.js`.
- **Não versione arquivo com `?v=`.** O Vite já coloca hash no nome do bundle
  (`index-abc123.css`) no build; cache-buster manual no `<link>` é redundante e
  fácil de esquecer de atualizar.
- **O `<script>` é `type="module"`**, então roda depois do HTML parseado. Não
  precisa de `DOMContentLoaded`.
- **Preço não se escreve em dois lugares.** Os planos vivem em
  `plans-registry.js`. O card é gerado a partir dele por `npm run plans` e o
  modal lê o mesmo registro em runtime. Os cards ficam versionados no
  `index.html` para o arquivo abrir completo, mas **são saída, não fonte**: se
  você editar um `R$` direto no HTML, o `npm run build` falha e diz para rodar
  `npm run plans`. A mesma trava pega o caminho contrário — mexer no registry e
  esquecer de regerar. O CI roda o build, então divergência não chega ao ar.
- **Nenhuma URL pública escrita à mão.** Tudo deriva de `SITE_URL`.
- **A interface pública é EN-first.** Texto que o visitante lê fica em inglês;
  comentário de código e este README seguem em português. Moeda não é idioma:
  os preços continuam em R$. Não há (e por ora não haverá) seletor PT/EN.
- **Imagem grande entra por `<picture>` com `width`/`height`.** As dimensões
  são as reais do arquivo servido — é o que reserva o espaço e evita layout
  shift. O notebook do hero é o LCP: ele nunca leva `loading="lazy"`.

## Publicação: atenção à origem do Pages

Em **Settings → Pages → Build and deployment**, a origem precisa estar em
**"GitHub Actions"**. Se estiver em "Deploy from a branch", o GitHub roda um
builder automático *além* deste workflow; os dois publicam a cada push e vale o
que terminar por último. Quando o automático vence, ele serve a raiz do
repositório em vez do `dist/` — o site vai ao ar sem os bundles.

O job `verify` do workflow existe para isso. Ele pergunta à API se um run
chamado "pages build and deployment" existe para o commit — pergunta
determinística, porque olhar o site não serve: há uma janela de alguns segundos
em que o conteúdo certo está no ar antes de ser sobrescrito, e um check feito
nessa janela passa e engana. Depois disso ele ainda confere que bundles,
favicon e og-image respondem 200 na URL publicada.

## O PROJECT VIEWER, em uma passada

A seção Selected Work tem **um** frame e **um** iframe. Trocar de case não cria
outro: `signal-frame.js` descarrega o atual, reescreve os campos `[data-viewer-*]`
a partir do `project-registry.js` e aponta o mesmo iframe para a nova URL.

- Os seletores vivem em dois lugares — os quadrados do rail (dentro do frame) e
  as linhas do índice de cases (irmão do card). Os dois usam `data-project-slot`,
  então são a mesma fonte de verdade e ficam sempre em sincronia.
- Cada case traz seu `accent`. Ele é escrito como `--accent` no `<article>` e no
  `.case-index`, então card, frame, índice e detalhes viram a cor do projeto —
  INK no verde do estúdio, Lucas no laranja. **CSS dentro desse escopo usa
  `var(--accent)`, nunca o verde literal.** A única exceção é o `.signal-logo`,
  que é a marca do estúdio e por isso fica fixo.
- O iframe só carrega quando o frame chega a ~800 px do viewport, e se desliga
  10 s depois de sair da tela. Até lá (e sempre, abaixo de 760 px) o que aparece
  é o poster do case.

## Pendências conhecidas

- **`Plano Max` anuncia `FROM R$ 5.000`, mas o formulário oferece e-commerce a
  partir de `R$ 4.000` e em `5–9 weeks`** (o plano diz `6–12 weeks`). São os dois
  únicos números do site que se contradizem. É decisão comercial, não bug: ou o
  piso do Max cai para R$ 4.000, ou a faixa de e-commerce do formulário sobe.
  Enquanto não se decide, um visitante atento vê a diferença.
- **Os quadradinhos do rail do PROJECT VIEWER ficam abaixo de 24 px no celular**,
  porque o frame inteiro é proporcional à largura. Não é bloqueante: as linhas do
  índice de cases logo abaixo trocam de projeto com alvo de toque cheio e usam o
  mesmo `data-project-slot`. Mexer no tamanho do rail é redesenhar o frame.

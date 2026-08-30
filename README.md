# Space Underground

Site institucional do estúdio. HTML/CSS/JS puro, sem framework, empacotado com [Vite](https://vitejs.dev/).

## Rodando

```bash
npm install      # so na primeira vez
npm run dev      # servidor local em http://127.0.0.1:5173
npm run build    # gera dist/
npm run preview  # serve o dist/ para conferir o build final
```

Publicação é automática: todo push na `main` dispara
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml),
que roda `npm run build` e joga o `dist/` no GitHub Pages. Não commite `dist/` —
ele é ignorado no `.gitignore` e regerado no CI.

## Mapa do projeto

```
index.html              A pagina inteira. Uma <section> por bloco, cada uma com id
                        proprio (#home, #services, #work, #labs, #philosophy,
                        #process, #why, #about, #contact).

public/                 Copiado cru para a raiz do dist/, sem processamento.
  favicon.svg

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
    project-dialog.css  Modal de preview dos projetos.
  sections/             Um arquivo por secao da pagina, mesmo nome do id.
    hero.css services.css work.css labs.css statement.css
    process.css why.css about.css contact.css
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
  project-dialog.js     Modal dos projetos (dados em projectPreviews).
  signal-frame.js       Controles do iframe ao vivo na secao Labs.
  project-form.js       Formulario: picker de produto, autofill, validacao, envio.
  pointer-effects.js    Aura do cursor e tilt 3D do hero (so mouse).

assets/                 Imagens do projeto.
```

## Onde mexer para cada coisa

| Quero mudar | Vou em |
|---|---|
| Cor, fonte, espaçamento global | `src/styles/base/tokens.css` |
| Texto de uma seção | `index.html`, na `<section>` do id correspondente |
| Visual de uma seção | `src/styles/sections/<nome>.css` |
| Comportamento em telas menores | `src/styles/responsive.css` |
| Adicionar um projeto ao portfólio | `projectPreviews` em `src/scripts/project-dialog.js` + um `[data-project]` no HTML |
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

## Pendências conhecidas

- `assets/tattoo-preview.png` (1,5 MB) não é referenciado por nenhum arquivo.
  Provavelmente sobrou de uma versão anterior da seção Labs, que hoje usa um
  `<iframe>` ao vivo. Pode ser apagado se ninguém for usar.

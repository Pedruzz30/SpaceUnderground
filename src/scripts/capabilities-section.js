export function initCapabilitiesSection() {
  const services = document.querySelector("#services");
  const work = document.querySelector("#work");
  if (!services || !work || document.querySelector("#capabilities")) return;

  const section = document.createElement("section");
  section.className = "section capabilities";
  section.id = "capabilities";
  section.setAttribute("aria-labelledby", "capabilities-title");
  section.innerHTML = `
    <div class="container">
      <header class="section-heading section-heading--row reveal" data-reveal>
        <div>
          <p class="section-label"><span>CAP</span> Capacidades</p>
          <h2 id="capabilities-title">Do site ao <em>sistema inteligente.</em></h2>
        </div>
        <p class="section-intro">Projetamos desde experiências digitais focadas em conversão até sistemas, automações e aplicações com inteligência artificial.</p>
      </header>

      <div class="capabilities__rail" aria-label="Níveis de capacidade da Space Underground">
        <article class="capability-card reveal" data-reveal style="--capability-accent:#c6ff00">
          <div class="capability-card__top"><span>01</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker">PRESENÇA DIGITAL</p>
          <h3>Sites</h3>
          <p>Landing pages, portfólios, sites institucionais e experiências digitais construídas para comunicar, converter e posicionar marcas.</p>
          <div class="capability-card__cases"><span>CASE 001</span><span>CASE 002</span></div>
          <a href="#work">Ver projetos <b aria-hidden="true">↗</b></a>
        </article>

        <article class="capability-card reveal" data-reveal style="--capability-accent:#22c55e">
          <div class="capability-card__top"><span>02</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker">OPERAÇÃO DIGITAL</p>
          <h3>Sistemas</h3>
          <p>Dashboards, plataformas internas, fluxos de gestão, autenticação, bancos de dados e produtos web conectados à operação real.</p>
          <div class="capability-card__cases"><span>CASE 004</span><span>CASE 005</span></div>
          <a href="#work">Ver sistemas <b aria-hidden="true">↗</b></a>
        </article>

        <article class="capability-card reveal" data-reveal style="--capability-accent:#38bdf8">
          <div class="capability-card__top"><span>03</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker">PROCESSOS CONECTADOS</p>
          <h3>Automação</h3>
          <p>Integrações, tarefas recorrentes, alertas, sincronização entre serviços, controle de processos e redução de trabalho manual.</p>
          <div class="capability-card__cases"><span>CASE 003</span><span>CASE 004</span></div>
          <a href="#work">Ver automações <b aria-hidden="true">↗</b></a>
        </article>

        <article class="capability-card capability-card--featured reveal" data-reveal style="--capability-accent:#f59e0b">
          <div class="capability-card__top"><span>04</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker">INTELIGÊNCIA APLICADA</p>
          <h3>IA</h3>
          <p>Assistentes, agentes, visão computacional, voz, memória, ferramentas inteligentes e IA integrada a sistemas e automações.</p>
          <div class="capability-card__cases"><span>CASE 003 / JARVIS</span></div>
          <a href="./jarvis-case/">Explorar JARVIS <b aria-hidden="true">↗</b></a>
        </article>
      </div>

      <div class="capabilities__statement reveal" data-reveal>
        <span>SPACE UNDERGROUND / CAPACIDADE</span>
        <p><b>Sites</b><i>→</i><b>Sistemas</b><i>→</i><b>Automação</b><i>→</i><b>IA</b></p>
        <small>O projeto pode começar em qualquer nível e evoluir conforme a necessidade da operação.</small>
      </div>
    </div>
  `;

  work.before(section);
}

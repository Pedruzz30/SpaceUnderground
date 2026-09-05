(() => {
  const translations = [
    ["JARVIS controls", "Controles do JARVIS"],
    ["Settings", "Configurações"],
    ["Camera", "Câmera"],
    ["Microphone", "Microfone"],
    ["Files", "Arquivos"],
    ["Minimize", "Minimizar"],
    ["Close", "Fechar"],
    ["AI DESKTOP ENVIRONMENT", "AMBIENTE DE IA PARA DESKTOP"],
    ["CORE / ACTIVE", "NÚCLEO / ATIVO"],
    ["VOICE LINK / READY", "LINK DE VOZ / PRONTO"],
    ["LOCAL NODE / SECURE", "NÓ LOCAL / SEGURO"],
    ["LATENCY / 18MS", "LATÊNCIA / 18MS"],
    ["MODE / DEMO", "MODO / DEMO"],
    ["Activate JARVIS voice simulation", "Ativar simulação de voz do JARVIS"],
    ["LISTENING", "OUVINDO"],
    ["PROCESSING", "PROCESSANDO"],
    ["SPEAKING", "FALANDO"],
    ["MUTED", "MUDO"],
    ["CLICK CORE TO INTERACT", "CLIQUE NO NÚCLEO PARA INTERAGIR"],
    ["Demo commands", "Comandos da demonstração"],
    ["RUN DIAGNOSTIC", "EXECUTAR DIAGNÓSTICO"],
    ["WEATHER REPORT", "RELATÓRIO DO TEMPO"],
    ["OPEN PANEL", "ABRIR PAINEL"],
    ["ADD TASK", "ADICIONAR TAREFA"],
    ["SPOTIFY CONTROL", "CONTROLE DO SPOTIFY"],
    ["JARVIS dashboard", "Painel do JARVIS"],
    ["01 / MEDIA", "01 / MÍDIA"],
    ["Space Underground Radio", "Rádio SPACE UNDERGROUND"],
    ["Previous track", "Faixa anterior"],
    ["Play or pause", "Reproduzir ou pausar"],
    ["Next track", "Próxima faixa"],
    ["02 / ENVIRONMENT", "02 / AMBIENTE"],
    ["CLEAR / NIGHT", "CÉU LIMPO / NOITE"],
    ["HUMIDITY", "UMIDADE"],
    ["WIND", "VENTO"],
    ["LOW", "BAIXO"],
    ["03 / SYSTEM", "03 / SISTEMA"],
    ["SYSTEM GAUGES", "MEDIDORES DO SISTEMA"],
    ["04 / PRODUCTIVITY", "04 / PRODUTIVIDADE"],
    ["TASKS", "TAREFAS"],
    ["Review automation queue", "Revisar fila de automações"],
    ["Sync project telemetry", "Sincronizar telemetria do projeto"],
    ["Generate daily brief", "Gerar resumo diário"],
    ["READY", "PRONTO"],
    ["+ ADD SIMULATED TASK", "+ ADICIONAR TAREFA SIMULADA"],
    ["05 / INTELLIGENCE", "05 / INTELIGÊNCIA"],
    ["JARVIS CHAT", "CHAT DO JARVIS"],
    ["Good evening. All systems are operational.", "Boa noite. Todos os sistemas estão operacionais."],
    ["Message JARVIS", "Enviar mensagem ao JARVIS"],
    ["Ask JARVIS...", "Pergunte ao JARVIS..."],
    ["Send message", "Enviar mensagem"],
    ["06 / STORAGE", "06 / ARMAZENAMENTO"],
    ["JARVIS / RESPONSE", "JARVIS / RESPOSTA"],
    ["PROTOTYPE / FRONTEND SIMULATION", "PROTÓTIPO / SIMULAÇÃO FRONTEND"],
    ["Voice channel ready. Awaiting command.", "Canal de voz pronto. Aguardando comando."],
    ["Processing request through local simulation core.", "Processando solicitação pelo núcleo local de simulação."],
    ["Voice input muted. Manual controls remain available.", "Entrada de voz silenciada. Os controles manuais continuam disponíveis."],
    ["Listening for a simulated voice command...", "Ouvindo um comando de voz simulado..."],
    ["Microphone is muted. Enable voice input to run the voice simulation.", "O microfone está silenciado. Ative a entrada de voz para executar a simulação."],
    ["Running simulated system diagnostic...", "Executando diagnóstico simulado do sistema..."],
    ["Diagnostic started: CPU, memory, automation and voice services checked.", "Diagnóstico iniciado: CPU, memória, automação e serviços de voz verificados."],
    ["Diagnostic complete. No critical issues detected.", "Diagnóstico concluído. Nenhum problema crítico detectado."],
    ["Diagnostic complete. All simulated services are within normal parameters.", "Diagnóstico concluído. Todos os serviços simulados estão dentro dos parâmetros normais."],
    ["Weather module refreshed for the demonstration.", "Módulo do tempo atualizado para a demonstração."],
    ["Weather report updated. Conditions are stable for Rio de Janeiro.", "Relatório do tempo atualizado. As condições estão estáveis no Rio de Janeiro."],
    ["System panel opened.", "Painel do sistema aberto."],
    ["New simulated task added to the queue.", "Nova tarefa simulada adicionada à fila."],
    ["Spotify simulation: playback started.", "Simulação do Spotify: reprodução iniciada."],
    ["Spotify simulation: playback paused.", "Simulação do Spotify: reprodução pausada."],
    ["Microphone simulation muted.", "Simulação do microfone silenciada."],
    ["Microphone simulation enabled.", "Simulação do microfone ativada."],
    ["Camera HUD simulation enabled.", "Simulação da câmera no HUD ativada."],
    ["Camera HUD simulation disabled.", "Simulação da câmera no HUD desativada."],
    ["Files panel selected.", "Painel de arquivos selecionado."],
    ["Settings are locked in portfolio demo mode.", "As configurações estão bloqueadas no modo de demonstração do portfólio."],
    ["Desktop minimize action is simulated in the web build.", "A ação de minimizar o desktop é simulada na versão web."],
    ["Close command blocked in embedded portfolio mode.", "Comando de fechar bloqueado no modo incorporado do portfólio."],
    ["Loaded next simulated track.", "Próxima faixa simulada carregada."],
    ["Loaded previous simulated track.", "Faixa simulada anterior carregada."],
    ["preview access granted in demo mode.", "acesso à prévia liberado no modo de demonstração."],
    ["Weather module ready. Rio de Janeiro is currently simulated at stable conditions.", "Módulo do tempo pronto. O Rio de Janeiro está simulado com condições estáveis."],
    ["System telemetry is nominal. No critical events detected in this frontend simulation.", "A telemetria do sistema está normal. Nenhum evento crítico foi detectado nesta simulação frontend."],
    ["Task queue is online. I can add a simulated task from the dashboard.", "A fila de tarefas está online. Posso adicionar uma tarefa simulada pelo painel."],
    ["Spotify control is available in demo mode. Playback is simulated locally in the browser.", "O controle do Spotify está disponível no modo de demonstração. A reprodução é simulada localmente no navegador."],
    ["I am JARVIS, an experimental AI desktop environment combining intelligence, automation and system control.", "Eu sou o JARVIS, um ambiente experimental de IA para desktop que combina inteligência, automação e controle do sistema."],
    ["Command understood. In this portfolio build, the response is simulated entirely in the frontend.", "Comando entendido. Nesta versão de portfólio, a resposta é simulada inteiramente no frontend."],
    ["Demo task", "Tarefa demo"],
    ["SYSTEM DATE", "DATA DO SISTEMA"],
    ["ACTIVE", "ATIVO"],
    ["NEW", "NOVA"]
  ];

  translations.sort((a, b) => b[0].length - a[0].length);
  const attrs = ["aria-label", "title", "placeholder"];

  const translate = (value) => {
    let next = String(value ?? "");
    translations.forEach(([from, to]) => {
      if (next.includes(from)) next = next.replaceAll(from, to);
    });
    return next;
  };

  const translateNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement?.closest("script, style, noscript")) return;
      const next = translate(node.data);
      if (next !== node.data) node.data = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.tagName)) return;
    attrs.forEach((name) => {
      if (!node.hasAttribute(name)) return;
      const current = node.getAttribute(name);
      const next = translate(current);
      if (next !== current) node.setAttribute(name, next);
    });
    node.childNodes.forEach(translateNode);
  };

  document.documentElement.lang = "pt-BR";
  translateNode(document.body);

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === "characterData") translateNode(record.target);
      if (record.type === "attributes") translateNode(record.target);
      if (record.type === "childList") record.addedNodes.forEach(translateNode);
    });
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: attrs
  });
})();

const ARCHITECTURE_COPY = {
  input: {
    index: "CAMADA / 01",
    title: "Entrada multimodal",
    text: "Comandos chegam por voz, chat no HUD ou adapters externos. A interface centraliza a experiência sem concentrar toda a lógica do sistema.",
    tags: ["Voz", "Texto", "CLI", "Telegram", "Alexa*"]
  },
  reflex: {
    index: "CAMADA / 02",
    title: "Camada Reflex",
    text: "Comandos frequentes e previsíveis podem ser resolvidos antes do LLM. Isso reduz latência, custo e dependência de rede em tarefas simples.",
    tags: ["Apps", "Volume", "Status", "UI", "Comércio"]
  },
  core: {
    index: "CAMADA / 03",
    title: "JARVIS Core",
    text: "O núcleo coordena contexto, interpretação, roteamento e execução. Gemini Live entra quando a tarefa exige raciocínio conversacional ou interpretação mais ampla.",
    tags: ["Gemini Live", "Roteamento", "Contexto", "Tools"]
  },
  tools: {
    index: "CAMADA / 04",
    title: "Tools e módulos de ação",
    text: "Cada ação é encapsulada em módulos Python com parâmetros claros. O núcleo decide qual tool chamar e recebe um resultado estruturado de volta.",
    tags: ["Python", "Actions", "JSON", "Automação"]
  },
  system: {
    index: "CAMADA / 05",
    title: "Sistema e integrações",
    text: "As tools conectam o JARVIS ao Windows, navegador, arquivos, câmeras e APIs externas como Spotify, Google, Telegram e Mercado Livre.",
    tags: ["Windows", "Playwright", "APIs", "Câmera"]
  },
  memory: {
    index: "SUPORTE / M",
    title: "Memória por domínios",
    text: "A persistência é local e separada por áreas. Perfil, projetos, estudos, rotinas, preferências, sistema, e-commerce e histórico não precisam compartilhar o mesmo arquivo.",
    tags: ["JSON local", "8 domínios", "Persistência"]
  },
  permissions: {
    index: "SUPORTE / P",
    title: "Permission Manager",
    text: "Uma camada central classifica ações como automaticamente permitidas, dependentes de confirmação ou permanentemente bloqueadas.",
    tags: ["Auto", "Confirmar", "Bloquear"]
  },
  events: {
    index: "SUPORTE / E",
    title: "Eventos e notificações",
    text: "EventBus e NotificationCenter permitem que módulos comuniquem eventos sem acoplamento direto e emitam alertas para o usuário.",
    tags: ["Pub/Sub", "Eventos", "Windows Toast"]
  },
  autopilot: {
    index: "SUPORTE / A",
    title: "Autopilot",
    text: "Monitora tarefas e estados em background com diferentes modos de operação, respeitando sempre as regras definidas no Permission Manager.",
    tags: ["Background", "Modos", "Safety Layer"]
  }
};

const detail = document.querySelector("#arch-detail");
const architectureButtons = [...document.querySelectorAll("[data-arch]")];

function renderArchitecture(key) {
  const data = ARCHITECTURE_COPY[key];
  if (!data || !detail) return;

  architectureButtons.forEach((button) => {
    const active = button.dataset.arch === key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  detail.innerHTML = `
    <span>${data.index}</span>
    <h3>${data.title}</h3>
    <p>${data.text}</p>
    <div>${data.tags.map((tag) => `<b>${tag}</b>`).join("")}</div>
  `;
}

architectureButtons.forEach((button) => {
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => renderArchitecture(button.dataset.arch));
});

renderArchitecture("input");

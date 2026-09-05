import { projects } from "./project-registry.js";

const SELECTORS = {
  name: ".case-index__name",
  type: ".case-index__type",
  year: ".case-index__year",
  status: ".case-index__status",
  go: ".case-index__go",
};

function replaceWithButton(node) {
  if (node.tagName === "BUTTON") return node;
  const button = document.createElement("button");
  button.type = "button";
  button.className = node.className;
  button.innerHTML = node.innerHTML;
  [...node.attributes].forEach((attribute) => {
    if (attribute.name === "class" || attribute.name === "data-project-slot") return;
    button.setAttribute(attribute.name, attribute.value);
  });
  node.replaceWith(button);
  return button;
}

function resetOptimizedPosterSources(project) {
  const fallback = project.poster?.png || "";
  if (!fallback.endsWith(".svg")) return;
  document.querySelectorAll("[data-project-viewer] [data-poster-source]").forEach((source) => {
    source.srcset = "";
  });
}

function hydrateSlot(projectKey, project) {
  if (!project.slot) return;
  const placeholders = [...document.querySelectorAll(`[data-project-slot="${project.slot}"]`)];

  placeholders.forEach((placeholder) => {
    const isIndexRow = placeholder.classList.contains("case-index__row");
    const node = isIndexRow ? replaceWithButton(placeholder) : placeholder;

    node.dataset.projectSlot = projectKey;
    node.removeAttribute("data-slot-reserved");
    node.removeAttribute("aria-disabled");
    node.classList.remove("is-reserved");
    node.setAttribute("aria-pressed", "false");
    node.style.setProperty("--slot-accent", project.accent);

    // Registrado antes do Project Viewer: para posters SVG, limpa os <source>
    // AVIF/WebP do case anterior antes que o viewer atualize o <img> fallback.
    node.addEventListener("click", () => resetOptimizedPosterSources(project));

    if (!isIndexRow) {
      node.setAttribute("aria-label", `Mostrar projeto ${project.id} — ${project.name}`);
      const tip = node.querySelector(".signal-ui__slot-tip");
      if (tip) tip.innerHTML = `<em>PROJETO / ${project.id}</em>${project.name}`;
      return;
    }

    node.setAttribute("aria-label", `Mostrar projeto ${project.id} — ${project.name}`);
    const write = (selector, value) => {
      const target = node.querySelector(selector);
      if (target) target.textContent = value;
    };
    write(SELECTORS.name, project.name);
    write(SELECTORS.type, project.type);
    write(SELECTORS.year, project.year);
    write(SELECTORS.go, "↗");

    const status = node.querySelector(SELECTORS.status);
    if (status) status.innerHTML = `<i aria-hidden="true"></i>${project.status}`;
  });
}

function hydrateLabs(project) {
  const labs = document.querySelector("#labs");
  const product = labs?.querySelector(".labs-product");
  if (!labs || !product || !project) return;

  labs.style.setProperty("--labs-accent", project.accent);
  product.style.setProperty("--accent", project.accent);
  product.classList.add("labs-product--jarvis");
  product.setAttribute("aria-label", "JARVIS — laboratório experimental de IA da Space Underground");

  const top = product.querySelectorAll(".labs-product__top span");
  if (top[0]) top[0].textContent = "LAB_001 / JARVIS";
  if (top[1]) top[1].textContent = "STATUS — PROTÓTIPO / ATIVO";

  const oldCopy = product.querySelector(":scope > p");
  if (oldCopy) oldCopy.remove();

  if (!product.querySelector(".labs-product__identity")) {
    const identity = document.createElement("div");
    identity.className = "labs-product__identity";
    identity.innerHTML = `
      <span>AMBIENTE OPERACIONAL EXPERIMENTAL DE IA</span>
      <strong>JARVIS</strong>
      <p>Inteligência artificial, interação por voz, automação e controle do computador.</p>
      <a href="${project.url}" target="_blank" rel="noopener noreferrer">ABRIR LAB <i aria-hidden="true">↗</i></a>
    `;
    product.insertBefore(identity, product.querySelector(".labs-product__signal"));
  }

  const labsStatus = labs.querySelector(".labs__status");
  if (labsStatus) labsStatus.textContent = "Protótipo / Ativo";
}

export function initProjectHydrator() {
  Object.entries(projects).forEach(([key, project]) => {
    if (!project.reserved && project.slot) hydrateSlot(key, project);
  });

  hydrateLabs(projects.jarvis);

  const workIntro = document.querySelector("#work .section-intro");
  if (workIntro) {
    workIntro.textContent = "Projetos de clientes e sistemas experimentais apresentados em um único frame. Alterne entre os cases abaixo.";
  }
}

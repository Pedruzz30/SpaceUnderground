// Controles do iframe ao vivo da seção Labs (modos de visualização, recarregar, abrir em nova aba).

export function initSignalFrame() {
  document.querySelectorAll("[data-signal-frame]").forEach((frame) => {
    const projectUrl = "https://pedruzz30.github.io/TattooSite/";
    const iframe = frame.querySelector("iframe");
    const modeButtons = [...frame.querySelectorAll("[data-signal-mode]")];
    const reloadButtons = [...frame.querySelectorAll("[data-signal-action='reload']")];
    const openButtons = [...frame.querySelectorAll("[data-signal-open]")];
    const viewClassNames = ["is-view-site", "is-view-detail", "is-view-origin"];

    const setSignalMode = (mode) => {
      frame.classList.remove(...viewClassNames);

      if (mode === "site") frame.classList.add("is-view-site");
      if (mode === "detail") frame.classList.add("is-view-detail");
      if (mode === "origin") frame.classList.add("is-view-origin");

      modeButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.signalMode === mode);
      });
    };

    modeButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextMode = button.dataset.signalMode === "reset" ? "default" : button.dataset.signalMode;
        setSignalMode(nextMode || "default");
      });
    });

    reloadButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!iframe) return;
        iframe.src = projectUrl;
        setSignalMode("default");
      });
    });

    openButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.open(projectUrl, "_blank", "noopener,noreferrer");
      });
    });
  });
}

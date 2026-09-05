(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const orb = $("#orb");
  const orbStatus = $("#orb-status");
  const statusText = $("#status-text");
  const toast = $("#toast");
  const stateDot = $(".state-dot");
  const chatLog = $("#chat-log");
  const taskList = $("#task-list");
  const chatInput = $("#chat-input");
  const playIcon = $("#play-icon");
  const spotifyProgress = $("#spotify-progress");

  let state = "LISTENING";
  let muted = false;
  let playing = false;
  let progress = 26;
  let taskNumber = 1;
  let toastTimer = 0;
  let stateSequence = 0;

  const states = {
    LISTENING: { message: "Voice channel ready. Awaiting command.", color: "#00ff88" },
    PROCESSING: { message: "Processing request through local simulation core.", color: "#f59e0b" },
    SPEAKING: { message: "Good evening. All systems are operational.", color: "#fbbf24" },
    MUTED: { message: "Voice input muted. Manual controls remain available.", color: "#ff4d4d" },
  };

  function setState(next, message = states[next]?.message) {
    state = next;
    orb.dataset.state = next;
    orbStatus.textContent = next;
    if (statusText && message) statusText.textContent = message;
    if (stateDot) {
      stateDot.style.background = states[next]?.color || "#f59e0b";
      stateDot.style.boxShadow = `0 0 10px ${states[next]?.color || "#f59e0b"}`;
    }
  }

  function announce(message) {
    statusText.textContent = message;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function addChat(role, message) {
    const p = document.createElement("p");
    p.className = role;
    const b = document.createElement("b");
    b.textContent = role === "user" ? "YOU" : "JARVIS";
    const span = document.createElement("span");
    span.textContent = message;
    p.append(b, span);
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function runVoiceDemo(response = "Good evening. All systems are operational.") {
    const sequence = ++stateSequence;
    if (muted) {
      setState("MUTED");
      announce("Microphone is muted. Enable voice input to run the voice simulation.");
      return;
    }
    setState("LISTENING", "Listening for a simulated voice command...");
    setTimeout(() => { if (sequence === stateSequence) setState("PROCESSING"); }, 620);
    setTimeout(() => {
      if (sequence !== stateSequence) return;
      setState("SPEAKING", response);
      addChat("jarvis", response);
    }, 1550);
    setTimeout(() => { if (sequence === stateSequence) setState("LISTENING"); }, 3200);
  }

  function command(name) {
    const actions = {
      diagnostic() {
        setState("PROCESSING", "Running simulated system diagnostic...");
        announce("Diagnostic started: CPU, memory, automation and voice services checked.");
        setTimeout(() => {
          setState(muted ? "MUTED" : "LISTENING", "Diagnostic complete. No critical issues detected.");
          addChat("jarvis", "Diagnostic complete. All simulated services are within normal parameters.");
        }, 1200);
      },
      weather() {
        $("#weather-temp").textContent = `${23 + Math.floor(Math.random() * 4)}°`;
        announce("Weather module refreshed for the demonstration.");
        addChat("jarvis", "Weather report updated. Conditions are stable for Rio de Janeiro.");
      },
      panel() {
        $("#system-panel").scrollIntoView({ behavior: "smooth", block: "center" });
        announce("System panel opened.");
      },
      task() {
        const li = document.createElement("li");
        li.innerHTML = `<i></i><span>Demo task ${String(taskNumber++).padStart(2, "0")}</span><b>NEW</b>`;
        taskList.appendChild(li);
        announce("New simulated task added to the queue.");
      },
      spotify() {
        togglePlay();
        $("#spotify-panel").scrollIntoView({ behavior: "smooth", block: "center" });
      },
    };
    actions[name]?.();
  }

  function togglePlay() {
    playing = !playing;
    playIcon.textContent = playing ? "❚❚" : "▶";
    announce(playing ? "Spotify simulation: playback started." : "Spotify simulation: playback paused.");
  }

  function respondTo(text) {
    const q = text.toLowerCase();
    if (/weather|clima|tempo/.test(q)) return "Weather module ready. Rio de Janeiro is currently simulated at stable conditions.";
    if (/cpu|system|diagnostic|sistema/.test(q)) return "System telemetry is nominal. No critical events detected in this frontend simulation.";
    if (/task|tarefa/.test(q)) return "Task queue is online. I can add a simulated task from the dashboard.";
    if (/spotify|music|música/.test(q)) return "Spotify control is available in demo mode. Playback is simulated locally in the browser.";
    if (/who|quem|jarvis/.test(q)) return "I am JARVIS, an experimental AI desktop environment combining intelligence, automation and system control.";
    return "Command understood. In this portfolio build, the response is simulated entirely in the frontend.";
  }

  orb.addEventListener("click", () => runVoiceDemo());

  $$('[data-command]').forEach((button) => button.addEventListener("click", () => command(button.dataset.command)));

  $$('[data-control]').forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.control;
      if (action === "mic") {
        muted = !muted;
        button.classList.toggle("is-active", !muted);
        ++stateSequence;
        setState(muted ? "MUTED" : "LISTENING");
        announce(muted ? "Microphone simulation muted." : "Microphone simulation enabled.");
        return;
      }
      if (action === "camera") {
        button.classList.toggle("is-active");
        announce(button.classList.contains("is-active") ? "Camera HUD simulation enabled." : "Camera HUD simulation disabled.");
        return;
      }
      if (action === "files") {
        $("#files-panel").scrollIntoView({ behavior: "smooth", block: "center" });
        announce("Files panel selected.");
        return;
      }
      if (action === "settings") {
        announce("Settings are locked in portfolio demo mode.");
        return;
      }
      if (action === "minimize") {
        announce("Desktop minimize action is simulated in the web build.");
        return;
      }
      if (action === "close") {
        announce("Close command blocked in embedded portfolio mode.");
      }
    });
  });

  $$('[data-player]').forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.player === "play") return togglePlay();
    progress = button.dataset.player === "next" ? 4 : 72;
    spotifyProgress.style.width = `${progress}%`;
    announce(button.dataset.player === "next" ? "Loaded next simulated track." : "Loaded previous simulated track.");
  }));

  $$('[data-file]').forEach((button) => button.addEventListener("click", () => announce(`${button.dataset.file}: preview access granted in demo mode.`)));

  $("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    addChat("user", text);
    chatInput.value = "";
    const response = respondTo(text);
    setState("PROCESSING");
    setTimeout(() => {
      addChat("jarvis", response);
      setState(muted ? "MUTED" : "SPEAKING", response);
      setTimeout(() => setState(muted ? "MUTED" : "LISTENING"), 900);
    }, 620);
  });

  function updateClock() {
    const now = new Date();
    $("#clock").textContent = now.toLocaleTimeString("en-GB", { hour12: false });
    $("#date").textContent = now.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  }
  updateClock();
  setInterval(updateClock, 1000);

  setInterval(() => {
    const values = [
      ["#cpu-value", 24, 68], ["#ram-value", 46, 67], ["#gpu-value", 18, 58],
    ];
    values.forEach(([selector, min, max]) => {
      const value = Math.floor(min + Math.random() * (max - min));
      const node = $(selector);
      node.textContent = String(value);
      node.closest(".gauge").style.setProperty("--value", value);
    });
    if (playing) {
      progress = (progress + 1.4) % 100;
      spotifyProgress.style.width = `${progress}%`;
    }
  }, 1400);

  const canvas = $("#ambient");
  const ctx = canvas.getContext("2d", { alpha: true });
  let particles = [];
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = Array.from({ length: Math.min(110, Math.floor(innerWidth / 12)) }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      s: .3 + Math.random() * 1.1,
      a: .08 + Math.random() * .32,
      v: .05 + Math.random() * .18,
    }));
  }
  function drawAmbient() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = "#f59e0b";
    particles.forEach((p) => {
      p.y -= p.v;
      if (p.y < -3) p.y = innerHeight + 3;
      ctx.globalAlpha = p.a;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(drawAmbient);
  }
  resizeCanvas();
  drawAmbient();
  addEventListener("resize", resizeCanvas, { passive: true });

  setState("LISTENING", "Good evening. All systems are operational.");
  if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("is-embedded");

  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "jarvis-preview:ready" }, window.location.origin);
    }
  } catch {}
})();

(() => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  const card = document.querySelector("[data-install]");
  if (!card) return;
  const button = card.querySelector("[data-install-button]");
  const steps = card.querySelector("[data-install-steps]");
  const key = "allforpic:install-hidden";
  const agent = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(agent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(agent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let prompt;

  function hidden() {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function hide() {
    card.hidden = true;
    try {
      localStorage.setItem(key, "1");
    } catch {
      // A preferência fica apenas para esta visita.
    }
  }

  function showSteps(lines) {
    steps.replaceChildren(...lines.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }));
    steps.hidden = false;
  }

  if (standalone || hidden() || (!isIos && !isAndroid)) return;
  card.hidden = false;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event;
  });
  window.addEventListener("appinstalled", hide);

  button.addEventListener("click", async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      prompt = undefined;
      if (outcome === "accepted") hide();
      return;
    }
    if (isIos) {
      showSteps([
        "Toca no botão Partilhar do browser.",
        "Escolhe Adicionar ao ecrã principal.",
        "Toca em Adicionar. A app fica junto das outras.",
      ]);
      return;
    }
    showSteps([
      "Abre o menu do browser, com os três pontos.",
      "Escolhe Instalar aplicação ou Adicionar ao ecrã principal.",
      "Confirma. A app fica junto das outras.",
    ]);
  });

  card.querySelector("[data-install-close]").addEventListener("click", hide);
})();

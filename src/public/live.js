(() => {
  const root = document.querySelector("[data-live]");
  if (!root) return;
  const url = root.dataset.live;
  const base = root.dataset.base;
  const key = `allforpic:${base}`;
  const POLL_MS = 20_000;
  const memory = {};
  let state = load();
  const queue = [];
  let open = false;
  let timer;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? null;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      memory.state = state;
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function showNext() {
    if (open || queue.length === 0) return;
    open = true;
    const item = queue.shift();
    const dialog = element("dialog", item.winner ? "live-popup live-winner" : "live-popup");
    if (item.winner) {
      const confetti = element("div", "confetti");
      confetti.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 28; i++) confetti.append(element("span"));
      dialog.append(confetti, element("p", "winner-word", "WINNER"));
    }
    dialog.append(element("h2", "", item.title));
    if (item.text) dialog.append(element("p", "", item.text));
    if (item.image) {
      const image = element("img");
      image.src = item.image;
      image.alt = item.text ?? item.title;
      dialog.append(image);
    }
    const actions = element("div", "live-actions");
    if (item.href) {
      const link = element("a", "primary", item.action);
      link.href = item.href;
      actions.append(link);
    }
    const close = element("button", "", "Fechar");
    close.type = "button";
    close.addEventListener("click", () => dialog.close());
    actions.append(close);
    dialog.append(actions);
    dialog.addEventListener("close", () => {
      dialog.remove();
      open = false;
      showNext();
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  function apply(data) {
    if (!state) {
      state = { status: data.status, phases: Object.fromEntries(data.missions.map((m) => [m.id, m.phase])), winners: [] };
    } else {
      if (state.status === "rascunho" && data.status !== "rascunho" && data.status !== "arquivado") {
        queue.push({ title: "As missões abriram", text: "Já podes começar a enviar as tuas fotografias.", href: base, action: "Ver missões" });
      }
      for (const mission of data.missions) {
        const before = state.phases[mission.id];
        if (mission.phase === "votacao" && before !== "votacao") {
          queue.push({ title: "A votação abriu", text: mission.title, href: `${base}/missoes/${mission.id}`, action: "Votar agora" });
        }
        if (mission.phase === "envio" && before !== undefined && before !== "envio") {
          queue.push({ title: "Nova ronda de fotografias", text: mission.title, href: `${base}/missoes/${mission.id}`, action: "Abrir missão" });
        }
      }
      state.status = data.status;
      state.phases = Object.fromEntries(data.missions.map((m) => [m.id, m.phase]));
    }
    for (const winner of data.winners) {
      if (state.winners.includes(winner.id)) continue;
      state.winners.push(winner.id);
      const photo = winner.photos[0];
      const names = winner.photos.map((item) => item.guest).join(", ");
      queue.push({
        winner: true,
        title: winner.title,
        text: `${winner.photos.length > 1 ? "Empate: " : ""}${names}`,
        image: `${base}/fotos/${photo.id}/preview`,
        href: `${base}/vencedores`,
        action: "Ver vencedores",
      });
    }
    save();
    showNext();
  }

  async function poll() {
    clearTimeout(timer);
    if (!document.hidden) {
      try {
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (response.ok) apply(await response.json());
      } catch {
        // Sem rede: a verificação seguinte tenta novamente.
      }
    }
    timer = setTimeout(poll, POLL_MS + Math.random() * 5000);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });
  poll();
})();

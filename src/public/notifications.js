(() => {
  const card = document.querySelector("[data-notifications]");
  if (!card) return;
  const button = card.querySelector("[data-notify-button]");
  const message = card.querySelector("[data-notify-message]");
  const url = card.dataset.notifications;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  const say = (text) => {
    message.textContent = text;
    message.hidden = false;
  };

  function toKey(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }

  async function register(subscription) {
    const data = subscription.toJSON();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth }),
    });
    if (!response.ok) throw new Error("Pedido recusado");
  }

  async function enable() {
    button.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        say("As notificações ficaram bloqueadas. Podes ativá-las nas definições do browser.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch(`${url}/chave`)).json();
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
      await register(subscription);
      button.hidden = true;
      say("Notificações ativas. Avisamos-te das missões, da votação e dos vencedores.");
    } catch {
      say("Não foi possível ativar as notificações. Confirma a ligação e tenta outra vez.");
    } finally {
      button.disabled = false;
    }
  }

  async function start() {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (isIos && !standalone) {
      card.hidden = false;
      button.hidden = true;
      say("No iPhone, instala primeiro a app no ecrã principal e abre-a por lá para ativares as notificações.");
      return;
    }
    if (!supported) return;
    card.hidden = false;
    if (Notification.permission === "denied") {
      button.hidden = true;
      say("As notificações estão bloqueadas nas definições do browser.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") {
      await register(subscription).catch(() => {});
      button.hidden = true;
      say("Notificações ativas.");
    }
    button.addEventListener("click", enable);
  }

  start();
})();

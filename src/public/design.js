(() => {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });

  const form = document.querySelector("[data-design-form]");
  const card = document.querySelector("[data-design-preview]");
  if (!form || !card) return;
  const root = document.documentElement;
  const qr = card.querySelector("[data-preview-qr]");
  const value = (name) => form.elements[name]?.value ?? "";
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
  let qrTimer;

  function text(name, content) {
    const element = card.querySelector(`[data-preview="${name}"]`);
    if (element) element.textContent = content;
  }

  function toggle(name, visible) {
    const element = card.querySelector(`[data-preview="${name}"]`);
    if (element) element.hidden = !visible;
  }

  function update() {
    root.style.setProperty("--t-bg", value("backgroundColor"));
    root.style.setProperty("--t-text", value("textColor"));
    root.style.setProperty("--t-accent", value("accentColor"));
    root.style.setProperty("--t-overlay", `rgba(${hexToRgb(value("backgroundColor"))},${Number(value("overlay")) / 100})`);
    text("headline", value("headline"));
    text("instructions", value("instructions"));
    text("extra", value("extraText"));
    toggle("date", form.elements.showDate?.checked);
    toggle("url", form.elements.showUrl?.checked);
    card.dataset.font = value("font");
    card.dataset.border = value("borderStyle");
    card.dataset.qr = value("qrSize");
    const overlayOutput = form.querySelector("[data-overlay-value]");
    if (overlayOutput) overlayOutput.textContent = `${value("overlay")}%`;

    clearTimeout(qrTimer);
    qrTimer = setTimeout(() => {
      const params = new URLSearchParams({ cor: value("qrColor"), fundo: value("qrBackground") });
      qr.src = `${qr.dataset.base}?${params}`;
    }, 150);
  }

  function previewFile(input, apply) {
    const file = input?.files?.[0];
    if (file) apply(URL.createObjectURL(file));
  }

  form.addEventListener("input", update);
  form.addEventListener("change", (event) => {
    if (event.target.name === "backgroundFile") {
      previewFile(event.target, (url) => {
        card.style.backgroundImage = `linear-gradient(var(--t-overlay), var(--t-overlay)), url("${url}")`;
        card.style.backgroundSize = "cover";
        card.style.backgroundPosition = "center";
      });
    }
    if (event.target.name === "logoFile") {
      previewFile(event.target, (url) => {
        const logo = card.querySelector("[data-preview='logo']");
        logo.src = url;
        logo.hidden = false;
      });
    }
  });
})();

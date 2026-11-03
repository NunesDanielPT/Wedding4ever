(() => {
  if (document.querySelector("[data-pending]")) {
    setTimeout(() => {
      const form = document.querySelector("form[enctype]");
      const busy = form && [...form.elements].some((field) => field.value);
      if (!busy) location.reload();
    }, 3000);
  }

  const viewer = document.querySelector("[data-viewer]");
  if (!viewer) return;
  const track = viewer.querySelector("[data-track]");
  const counter = viewer.querySelector("[data-counter]");
  const slides = [...viewer.querySelectorAll(".viewer-slide")];
  const current = () => Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));

  function updateCounter() {
    counter.textContent = `${Math.min(current() + 1, slides.length)} de ${slides.length}`;
  }

  function goTo(index) {
    track.scrollTo({ left: index * track.clientWidth, behavior: "instant" });
    updateCounter();
  }

  function open(index) {
    viewer.hidden = false;
    document.body.classList.add("viewer-open");
    goTo(index);
    track.focus({ preventScroll: true });
    history.pushState({ viewer: true }, "");
  }

  function hide() {
    viewer.hidden = true;
    document.body.classList.remove("viewer-open");
  }

  document.querySelectorAll("[data-open]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      open(Number(link.dataset.open));
    });
  });

  viewer.querySelector("[data-close]").addEventListener("click", () => history.back());
  window.addEventListener("popstate", hide);
  track.addEventListener("scroll", updateCounter, { passive: true });
  window.addEventListener("resize", () => {
    if (!viewer.hidden) goTo(current());
  });

  document.addEventListener("keydown", (event) => {
    if (viewer.hidden) return;
    if (event.key === "Escape") history.back();
    if (event.key === "ArrowRight") goTo(Math.min(current() + 1, slides.length - 1));
    if (event.key === "ArrowLeft") goTo(Math.max(current() - 1, 0));
  });

  function markVote(chosen) {
    viewer.querySelectorAll("[data-vote] button").forEach((button) => {
      const selected = button === chosen;
      button.toggleAttribute("data-chosen", selected);
      button.textContent = selected ? "O teu voto" : "Votar nesta fotografia";
    });
  }

  viewer.querySelectorAll("[data-vote]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        const response = await fetch(form.action, { method: "POST", body: new FormData(form) });
        if (response.ok) markVote(button);
        else button.textContent = "Não foi possível votar. Tenta outra vez.";
      } catch {
        button.textContent = "Sem ligação. Tenta outra vez.";
      } finally {
        button.disabled = false;
      }
    });
  });
})();

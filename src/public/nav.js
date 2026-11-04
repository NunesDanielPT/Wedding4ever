(() => {
  const sidebar = document.querySelector("[data-sidebar]");
  const toggle = document.querySelector("[data-menu-toggle]");
  if (!sidebar || !toggle) return;
  document.documentElement.classList.add("has-js");

  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Fechar" : "Menu";
  });

  const path = location.pathname;
  let best;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const href = link.getAttribute("href");
    const matches = path === href || path.startsWith(`${href}/`);
    if (matches && (!best || href.length > best.getAttribute("href").length)) best = link;
  });
  best?.setAttribute("aria-current", "page");
})();

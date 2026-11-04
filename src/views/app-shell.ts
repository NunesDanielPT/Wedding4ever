import { brand } from "../lib/brand";
import { asset } from "../lib/assets";
import { html, type Html } from "../lib/html";
import { page, rings } from "./layout";

const ICONS: Record<string, string> = {
  events: "M4 7h16v13H4zM4 11h16M9 3v5M15 3v5",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.8 3-6 6.5-6s5.9 2.2 6.5 6M16 4.5a3.5 3.5 0 0 1 0 6.6M18 14.5c1.9.8 3.1 2.7 3.5 5.5",
  chart: "M4 20V10M10 20V4M16 20v-7M21 20H3",
  mail: "M3 6h18v12H3zM3 7l9 7 9-7",
  site: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
  inbox: "M4 4h16v16H4zM4 14h5l1.5 2.5h3L15 14h5",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M16 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

function icon(name: string): Html {
  return html`<svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"></path></svg>`;
}

export function appShell(options: {
  title: string;
  home: string;
  groups: NavGroup[];
  logout: string;
  content: Html;
  stylesheet?: string;
}): string {
  return page(`${options.title} | ${brand()}`, html`
    <div class="app">
      <aside class="sidebar" data-sidebar>
        <div class="sidebar-top">
          <a class="brand" href="${options.home}">${rings}<span>${brand()}</span></a>
          <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="menu">Menu</button>
        </div>
        <nav class="sidebar-nav" id="menu" aria-label="Menu principal">
          ${options.groups.map((group) => html`
            <div class="nav-group">
              ${group.title && html`<p class="nav-title">${group.title}</p>`}
              ${group.items.map((item) => html`<a href="${item.href}" data-nav>${icon(item.icon)}<span>${item.label}</span></a>`)}
            </div>`)}
          <form method="post" action="${options.logout}" class="nav-logout"><button class="nav-exit">Sair</button></form>
        </nav>
      </aside>
      <main class="admin">${options.content}</main>
    </div>
    <script src="${asset("nav.js")}" defer></script>
  `, "app-page", options.stylesheet);
}

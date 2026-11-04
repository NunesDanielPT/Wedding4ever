import { asset } from "../lib/assets";
import { brand } from "../lib/brand";
import type { EventRecord, EventStats, RegisteredGuest } from "../db/events";
import { EVENT_STATUSES } from "../db/events";
import { formatDate } from "../lib/format";
import { html, Html } from "../lib/html";
import { PHASE_LABELS, type AdminMission, type AlbumMission, type AlbumPage, type MissionPhase } from "../lib/missions";
import { EVENT_TYPES } from "../lib/event-types";
import { retentionOf } from "../lib/retention";
import { type DesignContext, STATUS_LABELS } from "./admin";
import { appShell } from "./app-shell";
import { guestTable } from "./guests";
import { page, rings } from "./layout";

export function clientShell(title: string, content: Html, stylesheet?: string): string {
  return appShell({
    title,
    home: "/cliente",
    groups: [{ items: [{ href: "/cliente", label: "Os meus eventos", icon: "events" }] }],
    logout: "/cliente/sair",
    content,
    stylesheet,
  });
}

export function clientContext(event: EventRecord): DesignContext {
  const base = `/cliente/eventos/${event.id}`;
  return { base, back: base, wrap: clientShell };
}

function authCard(content: Html): string {
  return page(`Entrar | ${brand()}`, html`
    <main class="login">
      <a class="brand brand-large" href="/">${rings}<span>${brand()}</span></a>
      ${content}
    </main>
  `);
}

export function recoverPage(notice?: string, error?: string): string {
  return authCard(html`
    <h1 class="login-title">Recuperar acesso</h1>
    <p class="hint">Indica o teu e-mail e enviamos-te um link para definires uma nova palavra-passe.</p>
    ${notice && html`<p class="notice" role="status">${notice}</p>`}
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <form method="post" action="/recuperar" class="stack">
      <label>E-mail<input type="email" name="email" autocomplete="username" required></label>
      <button class="primary">Enviar link</button>
    </form>
    <p class="login-link"><a href="/entrar">Voltar a entrar</a></p>
  `);
}

export function resetPage(token: string, error?: string): string {
  return authCard(html`
    <h1 class="login-title">Nova palavra-passe</h1>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <form method="post" action="/recuperar/${token}" class="stack">
      <label>Nova palavra-passe<input type="password" name="password" autocomplete="new-password" minlength="12" required></label>
      <button class="primary">Guardar palavra-passe</button>
    </form>
  `);
}

export function clientLoginPage(error?: string, changed = false): string {
  return page(`Entrar | ${brand()}`, html`
    <main class="login">
      <a class="brand brand-large" href="/">${rings}<span>${brand()}</span></a>
      <h1 class="login-title">Área de cliente</h1>
      <p class="hint">Para clientes e organizadores de eventos.</p>
      <form method="post" action="/entrar" class="stack">
        ${changed && html`<p class="notice" role="status">Palavra-passe alterada. Já podes entrar.</p>`}
        ${error && html`<p class="error" role="alert">${error}</p>`}
        <label>E-mail<input type="email" name="email" autocomplete="username" required autofocus></label>
        <label>Código de acesso ou palavra-passe<input type="password" name="code" autocomplete="current-password" required></label>
        <button class="primary">Entrar</button>
      </form>
      <p class="login-link"><a href="/recuperar">Esqueci-me do acesso</a></p>
    </main>
  `);
}

function availability(event: EventRecord, retentionDays: number): string {
  const { deleteDate, daysLeft, expired } = retentionOf(event.event_date, retentionDays);
  if (expired) return "Prazo terminado";
  return `Disponível até ${formatDate(deleteDate)}, ${daysLeft === 1 ? "falta 1 dia" : `faltam ${daysLeft} dias`}`;
}

export function clientExpiredPage(event: EventRecord, deleteDate: string): string {
  return clientShell(event.name, html`
    <a class="back" href="/cliente">Voltar aos eventos</a>
    <h1>${event.name}</h1>
    <div class="empty"><p>O prazo deste evento terminou em ${formatDate(deleteDate)}. As fotografias e os downloads já não estão disponíveis.</p></div>
  `);
}

export function clientEventsPage(events: EventRecord[], canCreate = false, retentionDays = 30): string {
  return clientShell("Os meus eventos", html`
    <div class="page-head">
      <h1>Os meus eventos</h1>
      ${canCreate && html`<a class="primary" href="/cliente/eventos/novo">Criar evento</a>`}
    </div>
    ${events.length === 0
      ? html`<div class="empty"><p>Ainda não há eventos nesta conta.</p></div>`
      : html`<ul class="client-list event-list">
          ${events.map((event) => html`
            <li><a href="/cliente/eventos/${event.id}">
              <span class="client-name">${event.name}</span>
              <span class="client-date">${EVENT_TYPES[event.event_type].label}, ${formatDate(event.event_date)}<br>${availability(event, retentionDays)}</span>
              <span class="status status-${event.status}">${STATUS_LABELS[event.status]}</span>
            </a></li>`)}
        </ul>`}
  `);
}

const PHASE_ACTIONS: Record<MissionPhase, string> = {
  envio: "Iniciar envio de fotografias",
  votacao: "Iniciar votação",
  encerrada: "Encerrar missão",
};

function missionControls(event: EventRecord, mission: AdminMission): Html {
  const base = `/cliente/eventos/${event.id}/missoes/${mission.id}/fase`;
  return html`
    <li class="client-mission">
      <div>
        <h3>${mission.title}</h3>
        <p>${PHASE_LABELS[mission.phase]}. ${mission.photos} ${mission.photos === 1 ? "fotografia" : "fotografias"}, ${mission.votes} ${mission.votes === 1 ? "voto" : "votos"}.</p>
      </div>
      <div class="phase-buttons">
        ${(Object.keys(PHASE_ACTIONS) as MissionPhase[]).map((phase) => html`
          <form method="post" action="${base}">
            <input type="hidden" name="phase" value="${phase}">
            <button ${phase === mission.phase ? new Html("disabled") : ""}>${PHASE_ACTIONS[phase]}</button>
          </form>`)}
      </div>
    </li>`;
}

export function clientEventPage(
  event: EventRecord,
  stats: EventStats,
  guests: RegisteredGuest[],
  missions: AdminMission[],
  error?: string,
  manage?: { code?: string },
  retentionDays = 30,
): string {
  const base = `/cliente/eventos/${event.id}`;
  return clientShell(event.name, html`
    <a class="back" href="/cliente">Voltar aos eventos</a>
    <h1>${event.name}</h1>
    <p class="lead">${EVENT_TYPES[event.event_type].label}, ${formatDate(event.event_date)}${event.pack_name && `. Pack ${event.pack_name}`}</p>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    ${event.guest_limit !== null && stats.guests >= event.guest_limit && html`<p class="error" role="status">O limite de convidados do pack foi atingido. Novos convidados não conseguem entrar.</p>`}

    <p class="notice" role="status">${availability(event, retentionDays)}. Descarrega as fotografias antes desse dia, porque depois deixam de estar disponíveis.</p>

    <dl class="facts client-facts">
      <div><dt>Pessoas registadas</dt><dd>${stats.guests}${event.guest_limit ? ` de ${event.guest_limit}` : ""}</dd></div>
      <div><dt>Fotografias</dt><dd>${stats.photos}</dd></div>
      <div><dt>Missões</dt><dd>${stats.missions}</dd></div>
    </dl>

    <p class="client-actions">
      <a class="primary" href="${base}/galeria">Ver galeria</a>
      <a class="primary" href="${base}/vencedores">Apresentar vencedores</a>
      <a class="action" href="${base}/fotos.zip">Descarregar fotografias em ZIP</a>
    </p>

    <section id="missoes" class="client-section">
      <h2>Gestão das missões</h2>
      ${manage && html`<p><a class="action" href="${base}/missoes">Editar missões, sugestões e fotografias por missão</a></p>`}
      ${missions.length === 0
        ? html`<p>Este evento ainda não tem missões.</p>`
        : html`<ul class="client-missions">${missions.map((mission) => missionControls(event, mission))}</ul>`}
    </section>

    <section class="client-section">
      <h2>Estado geral do evento</h2>
      ${event.status === "arquivado"
        ? html`<p>Este evento foi arquivado.</p>`
        : html`<form method="post" action="${base}/estado" class="inline-form narrow-state">
            <select name="status" aria-label="Estado do evento">
              ${EVENT_STATUSES.filter((status) => status !== "arquivado").map((status) => html`<option value="${status}" ${status === event.status ? new Html("selected") : ""}>${STATUS_LABELS[status]}</option>`)}
            </select>
            <button>Guardar estado</button>
          </form>`}
    </section>

    <section class="client-section">
      <h2>Cartões e QR Code</h2>
      <p class="downloads">
        <a href="${base}/personalizar">Personalizar cartões e página</a>
        <a href="${base}/cartoes.pdf">Descarregar cartões em PDF</a>
        <a href="${base}/qr.png">Descarregar QR Code em PNG</a>
        <a href="${base}/qr.svg" download="qr-${event.slug}.svg">Descarregar QR Code em SVG</a>
      </p>
    </section>

    ${manage && html`<section class="client-section">
      <h2>Acesso do cliente</h2>
      <p>O cliente entra com ${event.couple_email} e um código de acesso.</p>
      ${manage.code && html`<p class="notice" role="status">Código de acesso: <strong>${manage.code}</strong><br>Guarda-o agora. Não volta a ser mostrado.</p>`}
      <form method="post" action="${base}/codigo"><button>${event.has_couple_code || manage.code ? "Gerar novo código" : "Gerar código de acesso"}</button></form>
    </section>`}

    <section class="client-section">
      <h2>Convidados registados</h2>
      ${guestTable(guests)}
    </section>
  `);
}

export function clientGalleryIndex(event: EventRecord, missions: AlbumMission[]): string {
  const base = `/cliente/eventos/${event.id}`;
  const total = missions.reduce((sum, mission) => sum + mission.photos, 0);
  return clientShell("Galeria", html`
    <a class="back" href="${base}">Voltar ao evento</a>
    <div class="page-head">
      <h1>Galeria</h1>
      <a class="primary" href="${base}/fotos.zip">Descarregar ZIP</a>
    </div>
    <p class="lead">${total} ${total === 1 ? "fotografia" : "fotografias"} em ${missions.length} ${missions.length === 1 ? "missão" : "missões"}. Abre uma missão para veres as fotografias.</p>
    ${missions.length === 0
      ? html`<div class="empty"><p>Este evento ainda não tem missões.</p></div>`
      : html`<ul class="album-missions">
          ${missions.map((mission) => html`
            <li><a href="${base}/galeria?missao=${mission.id}">
              ${mission.cover
                ? html`<img src="${base}/fotos/${mission.cover}/thumb" alt="" width="480" height="480" loading="lazy">`
                : html`<span class="album-empty">Sem fotografias</span>`}
              <span class="album-title">${mission.title}</span>
              <span class="album-count">${mission.photos} ${mission.photos === 1 ? "fotografia" : "fotografias"}</span>
            </a></li>`)}
        </ul>`}
  `);
}

export function clientGalleryPage(event: EventRecord, album: AlbumPage, pageNumber: number, pageSize: number, search: string): string {
  const base = `/cliente/eventos/${event.id}`;
  const ready = album.photos.filter((photo) => photo.preview_status === "ready");
  const pages = Math.max(1, Math.ceil(album.total / pageSize));
  const link = (target: number) => {
    const params = new URLSearchParams({ missao: album.mission.id, pagina: String(target) });
    if (search) params.set("nome", search);
    return `${base}/galeria?${params}`;
  };
  return clientShell(album.mission.title, html`
    <a class="back" href="${base}/galeria">Voltar às missões</a>
    <h1>${album.mission.title}</h1>
    <p class="lead">${album.total} ${album.total === 1 ? "fotografia" : "fotografias"}${search && ` de “${search}”`}.</p>
    <form method="get" action="${base}/galeria" class="inline-form gallery-search">
      <input type="hidden" name="missao" value="${album.mission.id}">
      <input type="search" name="nome" value="${search}" placeholder="Procurar por convidado" aria-label="Procurar por convidado">
      <button>Procurar</button>
    </form>
    ${ready.length === 0
      ? html`<div class="empty"><p>Não há fotografias para mostrar.</p></div>`
      : html`<ul class="photo-grid client-grid">
          ${ready.map((photo, index) => html`
            <li>
              <a href="${base}/fotos/${photo.id}/preview" data-open="${index}">
                <img src="${base}/fotos/${photo.id}/thumb" alt="${photo.caption || `Fotografia de ${photo.guest_name}`}" width="480" height="480" loading="lazy">
              </a>
              <p class="photo-author">${photo.guest_name}</p>
            </li>`)}
        </ul>`}
    ${pages > 1 && html`<nav class="pagination" aria-label="Páginas">
      ${pageNumber > 1 ? html`<a class="action" href="${link(pageNumber - 1)}">Anterior</a>` : ""}
      <span>Página ${pageNumber} de ${pages}</span>
      ${pageNumber < pages ? html`<a class="action" href="${link(pageNumber + 1)}">Seguinte</a>` : ""}
    </nav>`}
    ${ready.length > 0 && html`
      <div class="viewer" data-viewer hidden role="dialog" aria-modal="true" aria-label="Galeria de fotografias">
        <div class="viewer-bar"><span data-counter aria-live="polite"></span><button class="viewer-close" data-close>Fechar</button></div>
        <div class="viewer-track" data-track tabindex="0">
          ${ready.map((photo) => html`
            <figure class="viewer-slide">
              <img src="${base}/fotos/${photo.id}/preview" alt="${photo.caption || `Fotografia de ${photo.guest_name}`}" loading="lazy">
              <figcaption><p>${photo.guest_name}</p>${photo.caption && html`<p>${photo.caption}</p>`}</figcaption>
            </figure>`)}
        </div>
      </div>
      <script src="${asset("gallery.js")}" defer></script>`}
  `);
}

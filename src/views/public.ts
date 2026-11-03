import { asset } from "../lib/assets";
import { STATUS_LABELS } from "./admin";
import { eventDesign, type EventRecord, type EventStatus, type Mission } from "../db/events";
import { formatDate, initials } from "../lib/format";
import { html, Html } from "../lib/html";
import type { Guest } from "../lib/event-auth";
import { MAX_CAPTION_LENGTH, type MissionDetail, type Photo } from "../lib/photos";
import { page } from "./layout";

const MESSAGES: Record<EventStatus, string> = {
  rascunho: "As missões abrem no dia do evento. Guarda este link.",
  aberto: "As missões estão abertas. Escolhe uma para começar.",
  votacao: "A votação está aberta. Escolhe a tua fotografia favorita em cada missão.",
  resultados: "A batalha terminou. Abre cada missão para veres as vencedoras.",
  arquivado: "Este evento terminou. Obrigado por teres participado.",
};

function themed(event: EventRecord, title: string, body: Html): string {
  return page(title, body, "guest-page themed t-image", `/e/${event.slug}/tema.css`);
}

function heading(event: EventRecord): Html {
  const design = eventDesign(event);
  return html`
    ${design.logoImage && html`<img class="guest-logo" src="/e/${event.slug}/media/logo" alt="">`}
    ${!design.logoImage && html`<p class="card-monogram" aria-hidden="true">${initials(event.name)}</p>`}
    <h1>${event.name}</h1>
    <p class="card-date">${formatDate(event.event_date)}</p>
    <p class="guest-title">${design.headline}</p>
  `;
}

export interface JoinValues {
  name?: string;
  email?: string;
}

export function joinPage(event: EventRecord, values: JoinValues = {}, error?: string): string {
  return themed(event, event.name, html`
    <main class="guest">
      ${heading(event)}
      ${event.status === "arquivado"
        ? html`<p>${MESSAGES.arquivado}</p>`
        : html`<p>Indica o teu nome e e-mail para entrar.</p>
          <form method="post" action="/e/${event.slug}/entrar" class="stack guest-form">
            ${error && html`<p class="error" role="alert">${error}</p>`}
            <label>Nome completo<input name="name" autocomplete="name" maxlength="80" required value="${values.name ?? ""}"></label>
            <label>E-mail<input type="email" name="email" autocomplete="email" maxlength="160" required value="${values.email ?? ""}"></label>
            <button class="primary">Entrar</button>
          </form>`}
    </main>
  `);
}

export function guestHomePage(event: EventRecord, guest: Guest, missions: Mission[], hasWinners = false): string {
  return themed(event, event.name, html`
    <main class="guest">
      ${heading(event)}
      <p>Olá, ${guest.full_name}. ${MESSAGES[event.status]}</p>
      ${hasWinners && html`<p><a class="primary winners-link" href="/e/${event.slug}/vencedores">Ver os vencedores</a></p>`}
      ${event.status !== "rascunho" && event.status !== "arquivado" && html`
        <h2>A sua missão</h2>
        ${missions.length === 0
          ? html`<p>Ainda não há missões. Volta daqui a pouco.</p>`
          : html`<ul class="mission-list">
              ${missions.map((mission) => html`
                <li><a href="/e/${event.slug}/missoes/${mission.id}">
                  <span>${mission.title}</span>
                  <span class="mission-count">${mission.phase === "envio" ? `${mission.sent}/${mission.photo_limit}` : mission.phase === "votacao" ? "Votar" : "Ver vencedora"}</span>
                </a></li>`)}
            </ul>`}`}
    </main>
  `);
}

function photoStatus(photo: Photo): Html {
  if (photo.preview_status === "failed") return html`<div class="photo-placeholder">Sem pré-visualização</div>`;
  return html`<div class="photo-placeholder" data-pending>A preparar a fotografia</div>`;
}

function ownPhotos(event: EventRecord, photos: Photo[]): Html {
  if (photos.length === 0) return html`<p>Ainda não enviaste fotografias nesta missão.</p>`;
  return html`<ul class="photo-grid own-photos">
    ${photos.map((photo) => html`
      <li>
        ${photo.preview_status === "ready"
          ? html`<img src="/e/${event.slug}/fotos/${photo.id}/thumb" alt="${photo.caption || "A tua fotografia"}" width="480" height="480">`
          : photoStatus(photo)}
        ${photo.caption && html`<p class="photo-caption">${photo.caption}</p>`}
        <form method="post" action="/e/${event.slug}/fotos/${photo.id}/apagar">
          <button class="link-button">Apagar a minha fotografia</button>
        </form>
      </li>`)}
  </ul>`;
}

function voteControl(event: EventRecord, guest: Guest, photo: Photo, vote?: string): Html {
  if (photo.guest_id === guest.id) return html`<p class="viewer-note">A tua fotografia</p>`;
  const chosen = photo.id === vote;
  return html`<form method="post" action="/e/${event.slug}/fotos/${photo.id}/votar" data-vote>
    <button class="primary vote-button" ${chosen ? new Html("data-chosen") : ""}>${chosen ? "O teu voto" : "Votar nesta fotografia"}</button>
  </form>`;
}

function gallery(event: EventRecord, guest: Guest, mission: MissionDetail, photos: Photo[], vote?: string): Html {
  const ready = photos.filter((photo) => photo.preview_status === "ready");
  if (ready.length === 0) return html`<p>Ainda não há fotografias nesta missão.</p>`;
  const closed = mission.phase === "encerrada";
  const top = closed ? Math.max(...ready.map((photo) => photo.votes)) : 0;
  const isWinner = (photo: Photo) => closed && top > 0 && photo.votes === top;
  const votesLabel = (photo: Photo) => (photo.votes === 1 ? "1 voto" : `${photo.votes} votos`);
  return html`
    <ul class="photo-grid">
      ${ready.map((photo, index) => html`
        <li class="${isWinner(photo) ? "photo-winner" : ""}">
          <a href="/e/${event.slug}/fotos/${photo.id}/preview" data-open="${index}">
            <img src="/e/${event.slug}/fotos/${photo.id}/thumb" alt="${photo.caption || `Fotografia de ${photo.guest_name}`}" width="480" height="480" loading="lazy">
          </a>
          ${isWinner(photo) && html`<p class="winner-label">Vencedora</p>`}
          ${closed && html`<p class="photo-author">${photo.guest_name}, ${votesLabel(photo)}</p>`}
          ${!closed && photo.id === vote && html`<p class="photo-author" data-vote-mark>O teu voto</p>`}
        </li>`)}
    </ul>

    <div class="viewer" data-viewer hidden role="dialog" aria-modal="true" aria-label="Galeria de fotografias">
      <div class="viewer-bar">
        <span data-counter aria-live="polite"></span>
        <button class="viewer-close" data-close>Fechar</button>
      </div>
      <div class="viewer-track" data-track tabindex="0">
        ${ready.map((photo) => html`
          <figure class="viewer-slide">
            <img src="/e/${event.slug}/fotos/${photo.id}/preview" alt="${photo.caption || `Fotografia de ${photo.guest_name}`}" loading="lazy">
            <figcaption>
              ${closed && html`<p>${photo.guest_name}, ${votesLabel(photo)}</p>`}
              ${photo.caption && html`<p>${photo.caption}</p>`}
              ${mission.phase === "votacao" && voteControl(event, guest, photo, vote)}
            </figcaption>
          </figure>`)}
      </div>
    </div>
    <script src="${asset("gallery.js")}" defer></script>
  `;
}

export function missionPage(
  event: EventRecord,
  guest: Guest,
  mission: MissionDetail,
  photos: Photo[],
  sent: number,
  vote?: string,
  error?: string,
): string {
  const atLimit = sent >= mission.photo_limit;
  const disabled = atLimit ? new Html("disabled") : "";
  return themed(event, mission.title, html`
    <main class="guest mission-page">
      <a class="back" href="/e/${event.slug}">Voltar às missões</a>
      <h1>${mission.title}</h1>
      ${error && html`<p class="error" role="alert">${error}</p>`}

      ${mission.phase === "envio" && html`
        <p class="mission-progress">${sent}/${mission.photo_limit} ${mission.photo_limit === 1 ? "fotografia enviada" : "fotografias enviadas"}</p>
        <form method="post" action="/e/${event.slug}/missoes/${mission.id}/fotos" enctype="multipart/form-data" class="stack guest-form">
          <label>Fotografia
            <input type="file" name="photo" accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif" required ${disabled}>
          </label>
          <label>Legenda, opcional
            <input name="caption" maxlength="${MAX_CAPTION_LENGTH}" ${disabled}>
          </label>
          <button class="primary" ${disabled}>${atLimit ? "Limite atingido" : "Enviar fotografia"}</button>
        </form>
        <h2>As tuas fotografias</h2>
        <p class="hint">As fotografias dos outros convidados aparecem quando a votação abrir.</p>
        ${ownPhotos(event, photos)}
        <script src="${asset("gallery.js")}" defer></script>`}

      ${mission.phase === "votacao" && html`
        <p>Abre as fotografias, desliza para o lado e vota na tua favorita. Podes mudar de voto enquanto a votação estiver aberta.</p>
        ${gallery(event, guest, mission, photos, vote)}`}

      ${mission.phase === "encerrada" && html`
        <p>A votação terminou.</p>
        ${gallery(event, guest, mission, photos)}`}
    </main>
  `);
}

export function notFoundPage(): string {
  return page("Página não encontrada", html`
    <main class="guest">
      <h1>Este link não existe</h1>
      <p>Confirma o endereço ou lê novamente o QR Code da tua mesa.</p>
    </main>
  `, "guest-page");
}

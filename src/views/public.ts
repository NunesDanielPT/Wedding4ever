import { STATUS_LABELS } from "./admin";
import { eventDesign, type EventRecord, type EventStats, type EventStatus, type Mission } from "../db/events";
import { coupleNames, formatDate, initial } from "../lib/format";
import { html, Html } from "../lib/html";
import type { Guest } from "../lib/event-auth";
import { page } from "./layout";

const MESSAGES: Record<EventStatus, string> = {
  rascunho: "As missões abrem no dia do casamento. Guarda este link.",
  aberto: "As missões estão abertas. O envio de fotografias fica disponível em breve.",
  votacao: "A votação está aberta. Em breve vais poder escolher as tuas fotos favoritas.",
  resultados: "A batalha terminou. Os vencedores serão anunciados aqui.",
  arquivado: "Este evento terminou. Obrigado por teres participado.",
};
const COUPLE_STATUSES: EventStatus[] = ["rascunho", "aberto", "votacao", "resultados"];

function themed(event: EventRecord, title: string, body: Html): string {
  return page(title, body, "guest-page themed t-image", `/e/${event.slug}/tema.css`);
}

function heading(event: EventRecord): Html {
  const design = eventDesign(event);
  return html`
    ${design.logoImage && html`<img class="guest-logo" src="/e/${event.slug}/media/logo" alt="">`}
    ${!design.logoImage && html`<p class="card-monogram" aria-hidden="true">${initial(event.partner_one)}<span>&amp;</span>${initial(event.partner_two)}</p>`}
    <h1>${coupleNames(event.partner_one, event.partner_two)}</h1>
    <p class="card-date">${formatDate(event.event_date)}</p>
    <p class="guest-title">${design.headline}</p>
  `;
}

export interface JoinValues {
  name?: string;
  email?: string;
}

export function joinPage(event: EventRecord, values: JoinValues = {}, error?: string): string {
  return themed(event, coupleNames(event.partner_one, event.partner_two), html`
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

export function guestHomePage(event: EventRecord, guest: Guest, missions: Mission[]): string {
  return themed(event, coupleNames(event.partner_one, event.partner_two), html`
    <main class="guest">
      ${heading(event)}
      <p>Olá, ${guest.full_name}. ${MESSAGES[event.status]}</p>
      ${event.status !== "rascunho" && event.status !== "arquivado" && html`
        <h2>A sua missão</h2>
        ${missions[0] && html`<p>${missions[0].photo_limit === 1 ? "Podes enviar 1 fotografia por missão." : `Podes enviar até ${missions[0].photo_limit} fotografias por missão.`}</p>`}
        <ul class="mission-list">
          ${missions.map((mission) => html`<li>${mission.title}</li>`)}
        </ul>`}
    </main>
  `);
}

export function coupleLoginPage(event: EventRecord, error?: string, status = 200): { body: string; status: number } {
  return {
    status,
    body: themed(event, "Área dos noivos", html`
      <main class="guest">
        <h1>Área dos noivos</h1>
        <p>${coupleNames(event.partner_one, event.partner_two)}</p>
        <form method="post" action="/e/${event.slug}/noivos/entrar" class="stack guest-form">
          ${error && html`<p class="error" role="alert">${error}</p>`}
          <label>E-mail dos noivos<input type="email" name="email" autocomplete="username" required></label>
          <label>Código de acesso<input name="code" autocomplete="one-time-code" required></label>
          <button class="primary">Entrar</button>
        </form>
      </main>
    `),
  };
}

export function couplePanelPage(event: EventRecord, stats: EventStats | null, error?: string): string {
  const base = `/e/${event.slug}/noivos`;
  return themed(event, "Área dos noivos", html`
    <main class="guest couple-panel">
      <h1>${coupleNames(event.partner_one, event.partner_two)}</h1>
      <p class="card-date">${formatDate(event.event_date)}</p>
      ${error && html`<p class="error" role="alert">${error}</p>`}

      <section>
        <h2>Estado da batalha</h2>
        ${event.status === "arquivado"
          ? html`<p>Este evento foi arquivado. Fala com a organização para o reabrir.</p>`
          : html`<form method="post" action="${base}/estado" class="inline-form">
              <select name="status" aria-label="Estado da batalha">
                ${COUPLE_STATUSES.map((status) => html`<option value="${status}" ${status === event.status ? new Html("selected") : ""}>${STATUS_LABELS[status]}</option>`)}
              </select>
              <button>Guardar estado</button>
            </form>`}
      </section>

      ${stats && html`<section>
        <h2>Participação</h2>
        <dl class="facts couple-facts">
          <div><dt>Convidados</dt><dd>${stats.guests}</dd></div>
          <div><dt>Fotografias</dt><dd>${stats.photos}</dd></div>
        </dl>
      </section>`}

      <section>
        <h2>QR Code e cartões</h2>
        <p class="downloads">
          <a href="${base}/cartoes.pdf">Descarregar cartões em PDF</a>
          <a href="${base}/qr.png">Descarregar QR Code em PNG</a>
          <a href="${base}/qr.svg" download="qr-${event.slug}.svg">Descarregar QR Code em SVG</a>
        </p>
      </section>

      <form method="post" action="${base}/sair"><button class="link-button">Sair</button></form>
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

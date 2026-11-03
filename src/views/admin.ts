import { config } from "../config";
import { EVENT_STATUSES, type EventRecord, type EventStats, type EventStatus } from "../db/events";
import { coupleNames, formatDate, initial } from "../lib/format";
import { html, Html } from "../lib/html";
import { page, rings } from "./layout";

export const STATUS_LABELS: Record<EventStatus, string> = {
  rascunho: "Rascunho",
  aberto: "Aberto",
  votacao: "Votação",
  resultados: "Resultados",
  arquivado: "Arquivado",
};

function shell(title: string, content: Html): string {
  return page(`${title} | Wedding4Ever`, html`
    <header class="topbar">
      <a class="brand" href="/admin">${rings}<span>Wedding4Ever</span></a>
      <form method="post" action="/admin/sair"><button class="link-button">Sair</button></form>
    </header>
    <main class="admin">${content}</main>
  `);
}

export function loginPage(error?: string): string {
  return page("Entrar | Wedding4Ever", html`
    <main class="login">
      <div class="brand brand-large">${rings}<span>Wedding4Ever</span></div>
      <form method="post" action="/admin/entrar" class="stack">
        ${error && html`<p class="error" role="alert">${error}</p>`}
        <label>E-mail<input type="email" name="email" autocomplete="username" required autofocus></label>
        <label>Palavra-passe<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="primary">Entrar</button>
      </form>
    </main>
  `);
}

export function dashboardPage(events: EventRecord[]): string {
  return shell("Clientes", html`
    <div class="page-head">
      <h1>Clientes</h1>
      <a class="primary" href="/admin/clientes/novo">Criar cliente</a>
    </div>
    ${events.length === 0
      ? html`<div class="empty"><p>Ainda não tens clientes. Cria o primeiro para gerar o link, o QR Code e a base de dados do evento.</p></div>`
      : html`<ul class="client-list">
          ${events.map((event) => html`
            <li>
              <a href="/admin/clientes/${event.id}">
                <span class="monogram" aria-hidden="true">${initial(event.partner_one)}${initial(event.partner_two)}</span>
                <span class="client-name">${coupleNames(event.partner_one, event.partner_two)}</span>
                <span class="client-date">${formatDate(event.event_date)}</span>
                <span class="status status-${event.status}">${STATUS_LABELS[event.status]}</span>
              </a>
            </li>`)}
        </ul>`}
  `);
}

export interface EventForm {
  partnerOne?: string;
  partnerTwo?: string;
  eventDate?: string;
  venue?: string;
  coupleEmail?: string;
}

export function newEventPage(values: EventForm = {}, error?: string): string {
  return shell("Criar cliente", html`
    <a class="back" href="/admin">Voltar aos clientes</a>
    <h1>Criar cliente</h1>
    <p class="lead">Ao guardar, o evento recebe uma base de dados só sua, um link e um QR Code.</p>
    <form method="post" action="/admin/clientes" class="stack narrow">
      ${error && html`<p class="error" role="alert">${error}</p>`}
      <div class="pair">
        <label>Nome do primeiro noivo<input name="partnerOne" maxlength="60" required value="${values.partnerOne ?? ""}"></label>
        <label>Nome do segundo noivo<input name="partnerTwo" maxlength="60" required value="${values.partnerTwo ?? ""}"></label>
      </div>
      <label>Data do casamento<input type="date" name="eventDate" required value="${values.eventDate ?? ""}"></label>
      <label>Local<input name="venue" maxlength="120" value="${values.venue ?? ""}"></label>
      <label>E-mail dos noivos<input type="email" name="coupleEmail" maxlength="160" required value="${values.coupleEmail ?? ""}"></label>
      <button class="primary">Criar cliente</button>
    </form>
  `);
}

export function eventPage(event: EventRecord, stats: EventStats | null, error?: string): string {
  const url = `${config.publicUrl}/e/${event.slug}`;
  const couple = coupleNames(event.partner_one, event.partner_two);
  return shell(couple, html`
    <a class="back" href="/admin">Voltar aos clientes</a>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    ${event.migration_error && html`<p class="error" role="alert">Esta base não ficou atualizada: ${event.migration_error}</p>`}
    <div class="event-layout">
      <section class="place-card" aria-label="Cartão de mesa">
        <p class="card-monogram" aria-hidden="true">${initial(event.partner_one)}<span>&amp;</span>${initial(event.partner_two)}</p>
        <h1>${couple}</h1>
        <p class="card-date">${formatDate(event.event_date)}</p>
        <img src="/admin/clientes/${event.id}/qr.svg" alt="QR Code do evento" width="220" height="220">
        <p class="card-actions">
          <a href="/admin/clientes/${event.id}/cartoes.pdf">Descarregar cartões em PDF</a>
          <a href="/admin/clientes/${event.id}/qr.svg" download="qr-${event.slug}.svg">Descarregar QR Code</a>
        </p>
      </section>

      <div class="event-side">
        <section>
          <h2>Link dos convidados</h2>
          <input class="copy-field" readonly value="${url}" aria-label="Link dos convidados">
          <a href="${url}" target="_blank" rel="noopener">Abrir como convidado</a>
        </section>

        <section>
          <h2>Estado do evento</h2>
          <form method="post" action="/admin/clientes/${event.id}/estado" class="inline-form">
            <select name="status" aria-label="Estado do evento">
              ${EVENT_STATUSES.map((status) => html`<option value="${status}" ${status === event.status ? new Html("selected") : ""}>${STATUS_LABELS[status]}</option>`)}
            </select>
            <button>Guardar estado</button>
          </form>
        </section>

        <section>
          <h2>Base de dados</h2>
          ${stats
            ? html`<dl class="facts">
                <div><dt>Missões</dt><dd>${stats.missions}</dd></div>
                <div><dt>Convidados</dt><dd>${stats.guests}</dd></div>
                <div><dt>Fotografias</dt><dd>${stats.photos}</dd></div>
                <div><dt>Versão</dt><dd>${event.schema_version}</dd></div>
              </dl>`
            : html`<p class="error">Não foi possível ligar à base deste cliente.</p>`}
        </section>

        <section>
          <h2>Contacto</h2>
          <p>${event.couple_email}${event.venue && html`<br>${event.venue}`}</p>
        </section>

        <details class="danger">
          <summary>Apagar cliente</summary>
          <p>Apaga a base de dados e todas as fotografias deste evento. Não é possível recuperá-las.</p>
          <form method="post" action="/admin/clientes/${event.id}/apagar" class="stack">
            <label>Escreve <strong>${event.slug}</strong> para confirmar
              <input name="confirm" autocomplete="off" required>
            </label>
            <button class="destructive">Apagar cliente</button>
          </form>
        </details>
      </div>
    </div>
  `);
}

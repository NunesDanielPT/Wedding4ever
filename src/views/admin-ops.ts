import { EVENT_TYPES } from "../lib/event-types";
import { formatDate } from "../lib/format";
import { html, Html } from "../lib/html";
import type { Organizer } from "../lib/organizers";
import type { MonthRow, Stats } from "../lib/stats";
import { shell } from "./admin";

function organizerRow(organizer: Organizer): Html {
  const base = `/admin/organizadores/${organizer.id}`;
  return html`
    <li>
      <p class="admin-email"><strong>${organizer.name}</strong> ${organizer.email}<br>
        ${organizer.events} ${organizer.events === 1 ? "evento" : "eventos"}, ${organizer.active ? "conta ativa" : "conta desativada"}</p>
      <form method="post" action="${base}/palavra-passe" class="inline-form">
        <input type="password" name="password" autocomplete="new-password" minlength="12" required placeholder="Nova palavra-passe" aria-label="Nova palavra-passe de ${organizer.name}">
        <button>Mudar</button>
      </form>
      <div class="mission-tools">
        <form method="post" action="${base}/${organizer.active ? "desativar" : "ativar"}"><button class="link-button">${organizer.active ? "Desativar conta" : "Ativar conta"}</button></form>
        <form method="post" action="${base}/apagar"><button class="link-button link-danger">Remover conta</button></form>
      </div>
    </li>`;
}

export function organizersPage(organizers: Organizer[], error?: string): string {
  return shell("Organizadores", html`
    <h1>Organizadores</h1>
    <p class="lead">Fotógrafos, produtoras e equipas que criam e gerem os seus próprios eventos. Entram em Área de cliente, no site, com o e-mail e a palavra-passe definidos aqui.</p>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <div class="settings">
      ${organizers.length === 0
        ? html`<div class="empty"><p>Ainda não há organizadores.</p></div>`
        : html`<ul class="admin-accounts">${organizers.map(organizerRow)}</ul>`}
      <form method="post" action="/admin/organizadores" class="stack">
        <h2>Adicionar organizador</h2>
        <label>Nome ou empresa<input name="name" maxlength="100" required></label>
        <div class="pair">
          <label>E-mail<input type="email" name="email" autocomplete="off" required></label>
          <label>Palavra-passe<input type="password" name="password" autocomplete="new-password" minlength="12" required></label>
        </div>
        <button class="primary">Adicionar organizador</button>
      </form>
    </div>
  `);
}

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const number = new Intl.NumberFormat("pt-PT");

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace(".", ",")} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Um indicador por gráfico, com doze barras do ano e o detalhe de cada mês ao passar. */
function monthChart(title: string, months: MonthRow[], key: keyof MonthRow): Html {
  const values = months.map((month) => month[key]);
  const max = Math.max(...values, 1);
  const plot = 96;
  const slot = 28;
  return html`
    <figure class="stat-chart">
      <figcaption>${title}</figcaption>
      <svg width="100%" viewBox="0 0 336 120" role="img" aria-label="${title} por mês">
        <line class="chart-base" stroke="#a99f8c" x1="0" x2="336" y1="${plot}" y2="${plot}"></line>
        ${months.map((month, index) => {
          const value = month[key];
          const height = value === 0 ? 0 : Math.max((value / max) * (plot - 14), 3);
          const x = index * slot + 3;
          return html`
            <g class="chart-bar">
              <title>${MONTHS[index]}: ${number.format(value)}</title>
              <rect class="chart-hit" fill="transparent" x="${x - 2}" y="0" width="${slot}" height="${plot + 20}"></rect>
              ${value > 0 && html`<rect class="chart-mark" fill="#1f3350" x="${x}" y="${plot - height}" width="${slot - 8}" height="${height}" rx="3"></rect>`}
              ${value === max && value > 0 && html`<text class="chart-value" fill="#33373b" font-size="9" text-anchor="middle" x="${x + (slot - 8) / 2}" y="${plot - height - 3}">${number.format(value)}</text>`}
              <text class="chart-label" fill="#5e6063" font-size="9" text-anchor="middle" x="${x + (slot - 8) / 2}" y="112">${MONTHS[index]}</text>
            </g>`;
        })}
      </svg>
    </figure>`;
}

function option(value: string | number, label: string, current: unknown): Html {
  return html`<option value="${value}" ${String(current ?? "") === String(value) ? new Html("selected") : ""}>${label}</option>`;
}

export function statsPage(stats: Stats): string {
  const { filter, totals, allTime, months } = stats;
  const period = filter.month ? `${MONTH_NAMES[filter.month - 1]} de ${filter.year}` : `${filter.year}`;
  return shell("Estatísticas", html`
    <h1>Estatísticas</h1>
    <form method="get" action="/admin/estatisticas" class="stat-filters">
      <label>Ano<select name="ano">${stats.years.map((year) => option(year, String(year), filter.year))}</select></label>
      <label>Mês<select name="mes">${option("", "Todos", filter.month ?? "")}${MONTH_NAMES.map((name, index) => option(index + 1, name, filter.month))}</select></label>
      <label>Evento<select name="evento">${option("", "Todos", filter.eventId ?? "")}${stats.options.map((item) => option(item.id, `${item.name} (${item.date})`, filter.eventId))}</select></label>
      <label>Organizador<select name="organizador">${option("", "Todos", filter.organizerId ?? "")}${stats.organizers.map((item) => option(item.id, item.name, filter.organizerId))}</select></label>
      <button>Filtrar</button>
    </form>
    ${stats.unavailable > 0 && html`<p class="error" role="alert">Não foi possível ler ${stats.unavailable} ${stats.unavailable === 1 ? "base de evento" : "bases de eventos"}. Os números podem estar incompletos.</p>`}

    <h2>Em ${period}</h2>
    <dl class="facts stat-facts">
      <div><dt>Eventos criados</dt><dd>${number.format(totals.created)}</dd></div>
      <div><dt>Eventos realizados</dt><dd>${number.format(totals.held)}</dd></div>
      <div><dt>Registos</dt><dd>${number.format(totals.guests)}</dd></div>
      <div><dt>Fotografias</dt><dd>${number.format(totals.photos)}</dd></div>
      <div><dt>Votos</dt><dd>${number.format(totals.votes)}</dd></div>
      <div><dt>Espaço usado</dt><dd>${formatBytes(totals.bytes)}</dd></div>
    </dl>
    <p class="hint">Desde o início: ${number.format(allTime.events)} eventos, ${number.format(allTime.guests)} registos, ${number.format(allTime.photos)} fotografias, ${number.format(allTime.votes)} votos e ${formatBytes(allTime.bytes)}.</p>

    <section class="client-section stat-section">
      <h2>Por mês em ${filter.year}</h2>
      <div class="stat-charts">
        ${monthChart("Eventos criados", months, "created")}
        ${monthChart("Registos", months, "guests")}
        ${monthChart("Fotografias", months, "photos")}
        ${monthChart("Votos", months, "votes")}
      </div>
      <div class="table-scroll"><table class="stat-table">
        <thead><tr><th scope="col">Mês</th><th scope="col">Criados</th><th scope="col">Realizados</th><th scope="col">Registos</th><th scope="col">Fotografias</th><th scope="col">Votos</th></tr></thead>
        <tbody>${months.map((row, index) => html`
          <tr><td>${MONTHS[index]}</td><td>${number.format(row.created)}</td><td>${number.format(row.held)}</td><td>${number.format(row.guests)}</td><td>${number.format(row.photos)}</td><td>${number.format(row.votes)}</td></tr>`)}
        </tbody>
      </table></div>
    </section>

    <section class="client-section stat-section">
      <h2>Por tipo de evento</h2>
      ${stats.byType.length === 0
        ? html`<p>Sem dados neste período.</p>`
        : html`<div class="table-scroll"><table class="stat-table">
            <thead><tr><th scope="col">Tipo</th><th scope="col">Eventos</th><th scope="col">Registos</th><th scope="col">Fotografias</th></tr></thead>
            <tbody>${stats.byType.map((row) => html`<tr><td>${EVENT_TYPES[row.type].label}</td><td>${number.format(row.events)}</td><td>${number.format(row.guests)}</td><td>${number.format(row.photos)}</td></tr>`)}</tbody>
          </table></div>`}
    </section>

    <section class="client-section stat-section">
      <h2>Por evento</h2>
      ${stats.events.length === 0
        ? html`<p>Sem eventos neste período.</p>`
        : html`<div class="table-scroll"><table class="stat-table">
            <thead><tr><th scope="col">Evento</th><th scope="col">Data</th><th scope="col">Organizador</th><th scope="col">Pack</th><th scope="col">Registos</th><th scope="col">Fotografias</th><th scope="col">Votos</th><th scope="col">Espaço</th></tr></thead>
            <tbody>${stats.events.map((row) => html`
              <tr>
                <td><a href="/admin/clientes/${row.id}">${row.name}</a></td>
                <td>${formatDate(row.date)}</td>
                <td>${row.organizer || "Administração"}</td>
                <td>${row.pack || "Sem pack"}</td>
                <td>${row.unavailable ? "Indisponível" : number.format(row.guests)}</td>
                <td>${number.format(row.photos)}</td>
                <td>${number.format(row.votes)}</td>
                <td>${formatBytes(row.bytes)}</td>
              </tr>`)}</tbody>
          </table></div>`}
    </section>
  `);
}

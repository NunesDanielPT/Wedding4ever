import { asset } from "../lib/assets";
import { brand } from "../lib/brand";
import { EVENT_STATUSES, eventDesign, type EventRecord, type EventStats, type EventStatus, type RegisteredGuest } from "../db/events";
import type { Admin } from "../lib/auth";
import type { Design } from "../lib/design";
import { eventUrl } from "../lib/event-assets";
import { PAYMENT_LABELS } from "../lib/event-notes";
import { formatDate } from "../lib/format";
import { html, Html } from "../lib/html";
import { AUDIENCE_LABELS } from "../lib/email-templates";
import { retentionForEvent } from "../lib/retention";
import type { EmailLogRow } from "../lib/event-emails";
import type { SiteItem } from "../lib/site";
import { MAX_TITLE_LENGTH, MISSION_PHASES, PHASE_LABELS, type AdminMission } from "../lib/missions";
import { EVENT_TYPE_IDS, EVENT_TYPES } from "../lib/event-types";
import { BORDERS, COLOR_PRESETS, FONTS, QR_SIZES } from "../lib/design";
import { MAX_PHOTO_LIMIT, MIN_PHOTO_LIMIT, type EmailNotice, type PlatformSettings } from "../lib/settings";
import { guestTable } from "./guests";
import { appShell } from "./app-shell";
import { page, rings } from "./layout";

export const STATUS_LABELS: Record<EventStatus, string> = {
  rascunho: "Rascunho",
  aberto: "Aberto",
  votacao: "Votação",
  resultados: "Resultados",
  arquivado: "Arquivado",
};

const ADMIN_NAV = [
  {
    title: "Gestão",
    items: [
      { href: "/admin", label: "Eventos", icon: "events" },
      { href: "/admin/organizadores", label: "Organizadores", icon: "people" },
      { href: "/admin/estatisticas", label: "Estatísticas", icon: "chart" },
    ],
  },
  {
    title: "Comunicação",
    items: [
      { href: "/admin/mensagens", label: "Mensagens", icon: "inbox" },
      { href: "/admin/emails", label: "E-mails", icon: "mail" },
      { href: "/admin/site", label: "Site", icon: "site" },
    ],
  },
  { title: "Sistema", items: [{ href: "/admin/definicoes", label: "Definições", icon: "settings" }] },
];

export function shell(title: string, content: Html, stylesheet?: string): string {
  return appShell({ title, home: "/admin", groups: ADMIN_NAV, logout: "/admin/sair", content, stylesheet });
}

export function loginPage(error?: string): string {
  return page(`Entrar | ${brand()}`, html`
    <main class="login">
      <div class="brand brand-large">${rings}<span>${brand()}</span></div>
      <form method="post" action="/admin/entrar" class="stack">
        ${error && html`<p class="error" role="alert">${error}</p>`}
        <label>E-mail<input type="email" name="email" autocomplete="username" required autofocus></label>
        <label>Palavra-passe<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="primary">Entrar</button>
      </form>
    </main>
  `);
}

function retentionLabel(event: EventRecord, days: number): string {
  const { daysLeft, expired } = retentionForEvent(event, days);
  if (expired) return `Apagar: prazo terminou há ${-daysLeft} ${daysLeft === -1 ? "dia" : "dias"}`;
  return daysLeft === 0 ? "Último dia antes de apagar" : `Faltam ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"} para apagar`;
}

export function eventRows(events: EventRecord[], retentionDays: number, organizerNames: Map<string, string>): Html {
  return html`<ul class="client-list event-list">
    ${events.map((event) => html`
      <li>
        <a href="/admin/clientes/${event.id}">
          <span class="client-name">${event.name}
            ${event.organizer_id && html`<span class="organizer-tag">${organizerNames.get(event.organizer_id) ?? "Organizador"}</span>`}
            ${event.payment_status && html`<span class="payment-tag payment-${event.payment_status}">${PAYMENT_LABELS[event.payment_status]}</span>`}
          </span>
          <span class="client-date">${EVENT_TYPES[event.event_type].label}, ${formatDate(event.event_date)}<br>
            <span class="${retentionForEvent(event, retentionDays).expired ? "retention-late" : ""}">${retentionLabel(event, retentionDays)}</span></span>
          <span class="status status-${event.status}">${STATUS_LABELS[event.status]}</span>
        </a>
      </li>`)}
  </ul>`;
}

export interface OrganizerRef {
  id: string;
  name: string;
}

export function dashboardPage(
  events: EventRecord[],
  unread: number,
  retentionDays: number,
  organizers: OrganizerRef[],
  view: "admin" | "organizadores",
): string {
  const expired = events.filter((event) => retentionForEvent(event, retentionDays).expired).length;
  const names = new Map(organizers.map((organizer) => [organizer.id, organizer.name]));
  const own = events.filter((event) => !event.organizer_id);
  const external = events.filter((event) => event.organizer_id);
  const groups = organizers
    .map((organizer) => ({ organizer, events: external.filter((event) => event.organizer_id === organizer.id) }))
    .filter((group) => group.events.length > 0);
  return shell("Eventos", html`
    <div class="page-head">
      <h1>Eventos</h1>
      <a class="primary" href="/admin/clientes/novo">Criar evento</a>
    </div>
    ${expired > 0 && html`<p class="error" role="status">${expired === 1 ? "1 evento já passou do prazo e está à espera de ser apagado." : `${expired} eventos já passaram do prazo e estão à espera de ser apagados.`} Só tu os podes apagar, na página de cada evento.</p>`}
    ${unread > 0 && html`<p class="notice"><a href="/admin/mensagens">${unread === 1 ? "Tens 1 mensagem por ler." : `Tens ${unread} mensagens por ler.`}</a></p>`}
    <nav class="tabs" aria-label="Filtrar eventos">
      <a href="/admin" ${view === "admin" ? new Html('aria-current="page"') : ""}>Da administração (${own.length})</a>
      <a href="/admin?ver=organizadores" ${view === "organizadores" ? new Html('aria-current="page"') : ""}>De organizadores (${external.length})</a>
    </nav>
    ${view === "admin"
      ? own.length === 0
        ? html`<div class="empty"><p>Ainda não tens eventos criados pela administração.</p></div>`
        : eventRows(own, retentionDays, names)
      : groups.length === 0
        ? html`<div class="empty"><p>Os eventos criados por organizadores aparecem aqui.</p></div>`
        : groups.map(({ organizer, events: list }) => html`
            <section class="organizer-group">
              <div class="page-head">
                <h2>${organizer.name}</h2>
                <a href="/admin/organizadores/${organizer.id}">Ver organizador</a>
              </div>
              ${eventRows(list, retentionDays, names)}
            </section>`)}
  `);
}

export interface EventForm {
  name?: string;
  eventType?: string;
  eventDate?: string;
  venue?: string;
  coupleEmail?: string;
  packId?: string;
  organizerId?: string;
}

export interface EventFormContext {
  action: string;
  back: string;
  wrap?: (title: string, content: Html, stylesheet?: string) => string;
  organizers?: { id: string; name: string }[];
}

function packLabel(pack: SiteItem): string {
  const price = pack.price ? `, ${pack.price}` : "";
  return `${pack.name} (${pack.guests})${price}`;
}

export function newEventPage(packs: SiteItem[], values: EventForm = {}, error?: string, context?: EventFormContext): string {
  const wrap = context?.wrap ?? shell;
  const selectedType = values.eventType && values.eventType in EVENT_TYPES ? (values.eventType as keyof typeof EVENT_TYPES) : "casamento";
  return wrap("Criar evento", html`
    <a class="back" href="${context?.back ?? "/admin"}">Voltar aos eventos</a>
    <h1>Criar evento</h1>
    <p class="lead">Ao guardar, o evento recebe uma base de dados só sua, um link, um QR Code e missões adequadas ao tipo escolhido.</p>
    <form method="post" action="${context?.action ?? "/admin/clientes"}" class="stack narrow">
      ${error && html`<p class="error" role="alert">${error}</p>`}
      <label>Tipo de evento
        <select name="eventType" required>
          ${EVENT_TYPE_IDS.map((type) => html`<option value="${type}" ${type === selectedType ? new Html("selected") : ""}>${EVENT_TYPES[type].label}</option>`)}
        </select>
      </label>
      <label>Nome do evento
        <input name="name" maxlength="100" required placeholder="${EVENT_TYPES[selectedType].namePlaceholder}" value="${values.name ?? ""}">
        <span class="hint">Usa um nome que distinga o evento de outros, com o local ou o ano se for preciso.</span>
      </label>
      <label>Data do evento<input type="date" name="eventDate" required value="${values.eventDate ?? ""}"></label>
      <label>Local<input name="venue" maxlength="120" value="${values.venue ?? ""}"></label>
      <label>E-mail do cliente
        <input type="email" name="coupleEmail" maxlength="160" required value="${values.coupleEmail ?? ""}">
        <span class="hint">Pode ser dos noivos, da família ou da produtora.</span>
      </label>
      <label>Pack contratado
        <select name="packId">
          <option value="">Sem pack, sem limite de convidados</option>
          ${packs.map((pack) => html`<option value="${pack.id}" ${values.packId === pack.id ? new Html("selected") : ""}>${packLabel(pack)}</option>`)}
        </select>
      </label>
      ${context?.organizers && context.organizers.length > 0 && html`
        <label>Organizador
          <select name="organizerId">
            <option value="">Administração</option>
            ${context.organizers.map((organizer) => html`<option value="${organizer.id}" ${values.organizerId === organizer.id ? new Html("selected") : ""}>${organizer.name}</option>`)}
          </select>
        </label>`}
      <button class="primary">Criar evento</button>
    </form>
  `);
}

export function eventPage(
  event: EventRecord,
  stats: EventStats | null,
  guests: RegisteredGuest[],
  packs: SiteItem[],
  error?: string,
  coupleCode?: string,
  retentionDays = 30,
  emails: EmailLogRow[] = [],
  emailReady = false,
): string {
  const url = eventUrl(event);
  const retention = retentionForEvent(event, retentionDays);
  return shell(event.name, html`
    <a class="back" href="/admin">Voltar aos eventos</a>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    ${event.migration_error && html`<p class="error" role="alert">Esta base não ficou atualizada: ${event.migration_error}</p>`}
    <nav class="event-actions" aria-label="Gerir evento">
      <a class="primary" href="/admin/clientes/${event.id}/missoes">Missões e fotografias</a>
      <a class="action" href="/admin/clientes/${event.id}/personalizar">Personalizar</a>
      <a class="action" href="/cliente/eventos/${event.id}">Área do cliente</a>
      <a class="action" href="/cliente/eventos/${event.id}/galeria">Galeria</a>
      <a class="action" href="/cliente/eventos/${event.id}/vencedores">Vencedores</a>
      <a class="action" href="/cliente/eventos/${event.id}/notas">Bloco de notas</a>
    </nav>
    <div class="event-layout">
      <section class="place-card" aria-label="Cartão de mesa">
        ${eventDesign(event).monogram && html`<p class="card-monogram" aria-hidden="true">${eventDesign(event).monogram}</p>`}
        <p class="type-label">${EVENT_TYPES[event.event_type].label}</p>
        <h1>${event.name}</h1>
        <p class="card-date">${formatDate(event.event_date)}</p>
        <img src="/admin/clientes/${event.id}/qr.svg" alt="QR Code do evento" width="220" height="220">
        <p class="card-actions">
          <a href="/admin/clientes/${event.id}/cartoes.pdf">Descarregar cartões em PDF</a>
          <a href="/admin/clientes/${event.id}/qr.png">Descarregar QR Code em PNG</a>
          <a href="/admin/clientes/${event.id}/qr.svg" download="qr-${event.slug}.svg">Descarregar QR Code em SVG</a>
        </p>
      </section>

      <div class="event-side">
        <section>
          <h2>Link dos convidados</h2>
          <input class="copy-field" readonly value="${url}" aria-label="Link dos convidados">
          <a href="${url}" target="_blank" rel="noopener">Abrir como convidado</a>
        </section>

        <section>
          <h2>Prazo do evento</h2>
          ${retention.expired
            ? html`<p class="error" role="status">O prazo terminou em ${formatDate(retention.deleteDate)}, há ${-retention.daysLeft} ${retention.daysLeft === -1 ? "dia" : "dias"}. Clientes e organizadores já não têm acesso. Quando quiseres, apaga o evento no fim desta página.</p>`
            : html`<p>${retentionLabel(event, retentionDays)}. Disponível até ${formatDate(retention.deleteDate)}. O evento nunca é apagado sozinho.</p>`}
        </section>

        <section>
          <h2>Dias extra de acesso</h2>
          <form method="post" action="/admin/clientes/${event.id}/dias-extra" class="inline-form">
            <input type="number" name="extraDays" min="0" max="3650" value="${event.extra_days}" aria-label="Dias extra de acesso">
            <button>Guardar dias</button>
          </form>
        </section>

        <section>
          <h2>Pack</h2>
          <p>${event.pack_name || "Sem pack"}. ${stats?.guests ?? 0} ${event.guest_limit ? `de ${event.guest_limit} convidados registados.` : "convidados registados, sem limite."}</p>
          ${event.guest_limit !== null && stats && stats.guests >= event.guest_limit && html`<p class="error" role="status">O limite foi atingido. Novos convidados não conseguem entrar.</p>`}
          <form method="post" action="/admin/clientes/${event.id}/pack" class="stack">
            <label>Mudar de pack
              <select name="packId">
                <option value="atual">Manter o pack atual</option>
                <option value="">Sem pack, sem limite</option>
                ${packs.map((pack) => html`<option value="${pack.id}">${packLabel(pack)}</option>`)}
              </select>
            </label>
            <label>Limite de convidados, com o pack atual
              <input type="number" name="guestLimit" min="1" value="${event.guest_limit ?? ""}" placeholder="Sem limite">
            </label>
            <button class="pack-save">Guardar pack</button>
          </form>
        </section>

        <section>
          <h2>Acesso do cliente</h2>
          <p>O cliente entra em <strong>Área de cliente</strong>, no site, com ${event.couple_email} e um código de acesso. Eventos com o mesmo e-mail ficam juntos, o que é útil para produtoras.</p>
          ${coupleCode && html`<p class="notice" role="status">Código de acesso: <strong>${coupleCode}</strong><br>Guarda-o agora. Não volta a ser mostrado.</p>`}
          <form method="post" action="/admin/clientes/${event.id}/codigo-noivos">
            <button>${event.has_couple_code || coupleCode ? "Gerar novo código" : "Gerar código de acesso"}</button>
          </form>
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
          <summary>Apagar evento</summary>
          <p>Apaga a base de dados e todas as fotografias deste evento. Não é possível recuperá-las.</p>
          <form method="post" action="/admin/clientes/${event.id}/apagar" class="stack">
            <label>Escreve <strong>${event.slug}</strong> para confirmar
              <input name="confirm" autocomplete="off" required>
            </label>
            <button class="destructive">Apagar evento</button>
          </form>
        </details>
      </div>
    </div>

    <section class="guests-section">
      <h2>Download para os convidados</h2>
      ${event.album_token
        ? html`<p class="notice" role="status">O link de download está aberto. Podes reenviar o e-mail ou fechar o link.</p>`
        : html`<p>Quando quiseres, envia a todos os convidados um e-mail com o link para descarregarem as fotografias. Nada é enviado automaticamente.</p>`}
      ${!emailReady && html`<p class="hint">Ativa primeiro o serviço de e-mail em Definições.</p>`}
      <form method="post" action="/admin/clientes/${event.id}/download/enviar" class="stack">
        <label class="check"><input type="checkbox" name="confirm" required> Confirmo o envio a ${guests.length} ${guests.length === 1 ? "convidado" : "convidados"}</label>
        <button ${emailReady ? "" : new Html("disabled")}>Enviar e-mail de download a todos</button>
      </form>
      ${event.album_token && html`<form method="post" action="/admin/clientes/${event.id}/download/fechar" class="email-send"><button class="link-button link-danger">Fechar o link de download</button></form>`}
    </section>

    <section class="guests-section">
      <h2>E-mails do evento</h2>
      ${emails.length === 0
        ? html`<p>Ainda não há registos de e-mails.</p>`
        : html`<div class="table-scroll"><table class="stat-table email-log">
            <thead><tr><th scope="col">Para</th><th scope="col">Destino</th><th scope="col">Estado</th><th scope="col">Detalhe</th></tr></thead>
            <tbody>${emails.map((row) => html`<tr><td>${AUDIENCE_LABELS[row.audience]}</td><td>${row.recipient}</td><td>${EMAIL_STATUS[row.status]}</td><td>${row.error ?? ""}</td></tr>`)}</tbody>
          </table></div>`}
      <form method="post" action="/admin/clientes/${event.id}/emails/enviar" class="email-send">
        <button>Enviar e-mails do evento</button>
        <p class="hint">Se o serviço de e-mail estiver ativo, é criado um novo código de acesso do cliente, que substitui o anterior.</p>
      </form>
    </section>

    ${stats && html`<section class="guests-section">
      <h2>Convidados registados</h2>
      ${guestTable(guests)}
    </section>`}
  `);
}

const EMAIL_STATUS: Record<EmailLogRow["status"], string> = { enviado: "Enviado", falhou: "Falhou", nao_enviado: "Não enviado" };

function colorField(label: string, name: string, value: string): Html {
  return html`<label>${label}<input type="color" name="${name}" value="${value}"></label>`;
}

export interface DesignContext {
  base: string;
  back: string;
  wrap?: (title: string, content: Html, stylesheet?: string) => string;
}

function swatches(colors: Record<string, string>): Html {
  return html`<svg class="swatch" viewBox="0 0 48 16" aria-hidden="true">
    <rect width="16" height="16" fill="${colors.backgroundColor}"></rect>
    <rect x="16" width="16" height="16" fill="${colors.accentColor}"></rect>
    <rect x="32" width="16" height="16" fill="${colors.textColor}"></rect>
  </svg>`;
}

function choice(name: string, label: string, options: Record<string, string>, current: string): Html {
  return html`<label>${label}
    <select name="${name}">
      ${Object.entries(options).map(([value, text]) => html`<option value="${value}" ${value === current ? new Html("selected") : ""}>${text}</option>`)}
    </select>
  </label>`;
}

export function designPage(event: EventRecord, design: Design, error?: string, context?: DesignContext, saved = false): string {
  const base = context?.base ?? `/admin/clientes/${event.id}`;
  const back = context?.back ?? `/admin/clientes/${event.id}`;
  const wrap = context?.wrap ?? shell;
  const mediaBase = `/e/${event.slug}/media`;
  const version = Date.parse(event.updated_at);
  return wrap(`Personalizar ${event.name}`, html`
    <a class="back" href="${back}">Voltar a ${event.name}</a>
    <h1>Personalizar</h1>
    <p class="lead">As alterações aparecem na pré-visualização enquanto escolhes. Carrega em Guardar para as aplicares aos cartões, ao QR Code e à página dos convidados.</p>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    ${saved && html`<p class="notice" role="status">Personalização guardada.</p>`}
    <div class="event-layout design-layout">
      <section class="design-card themed t-image" data-design-preview data-font="${design.font}" data-border="${design.borderStyle}" data-qr="${design.qrSize}" aria-label="Pré-visualização">
        <p class="card-monogram" data-preview="monogram" ${design.monogram ? "" : new Html("hidden")}>${design.monogram}</p>
        <img class="design-logo" data-preview="logo" src="${design.logoImage ? `${mediaBase}/logo?v=${version}` : ""}" alt="" ${design.logoImage ? "" : new Html("hidden")}>
        <h2>${event.name}</h2>
        <p data-preview="date" ${design.showDate ? "" : new Html("hidden")}>${formatDate(event.event_date)}</p>
        <p class="design-headline" data-preview="headline">${design.headline}</p>
        <img class="design-qr" data-preview-qr data-base="${base}/qr.svg" src="${base}/qr.svg?v=${version}" alt="QR Code do evento" width="200" height="200">
        <p data-preview="instructions">${design.instructions}</p>
        <p class="design-url" data-preview="url" ${design.showUrl ? "" : new Html("hidden")}>${eventUrl(event).replace(/^https?:\/\//, "")}</p>
        <p class="design-url" data-preview="extra">${design.extraText}</p>
      </section>

      <div class="stack">
        <form method="post" action="${base}/personalizar" enctype="multipart/form-data">
          <fieldset>
            <legend>Esquemas de cores</legend>
            <div class="presets">
              ${COLOR_PRESETS.map((preset) => html`<button name="preset" value="${preset.id}">${swatches(preset.colors)}<span>${preset.label}</span></button>`)}
            </div>
            <button class="link-button" name="preset" value="tudo">Repor todas as opções padrão, mantendo as imagens</button>
          </fieldset>
        </form>

        <form method="post" action="${base}/personalizar" enctype="multipart/form-data" class="stack" data-design-form autocomplete="off">
          <label>Texto de destaque, opcional
            <input name="monogram" maxlength="12" value="${design.monogram}" placeholder="Por exemplo, A&P">
            <span class="hint">Aparece por cima do nome do evento. Em branco, não aparece.</span>
          </label>
          <label>Título<input name="headline" maxlength="60" required value="${design.headline}"></label>
          <label>Instrução para os convidados<input name="instructions" maxlength="120" required value="${design.instructions}"></label>
          <label>Texto adicional, opcional<input name="extraText" maxlength="120" value="${design.extraText}"></label>

          <fieldset>
            <legend>Cores</legend>
            <div class="color-grid">
              ${colorField("Fundo", "backgroundColor", design.backgroundColor)}
              ${colorField("Texto", "textColor", design.textColor)}
              ${colorField("Destaque", "accentColor", design.accentColor)}
              ${colorField("QR Code", "qrColor", design.qrColor)}
              ${colorField("Fundo do QR Code", "qrBackground", design.qrBackground)}
            </div>
          </fieldset>

          <fieldset>
            <legend>Estilo do cartão</legend>
            <div class="color-grid">
              ${choice("font", "Letra", FONTS, design.font)}
              ${choice("borderStyle", "Moldura", BORDERS, design.borderStyle)}
              ${choice("qrSize", "Tamanho do QR Code", QR_SIZES, design.qrSize)}
            </div>
            <label class="check"><input type="checkbox" name="showDate" ${design.showDate ? new Html("checked") : ""}> Mostrar a data</label>
            <label class="check"><input type="checkbox" name="showUrl" ${design.showUrl ? new Html("checked") : ""}> Mostrar o link escrito</label>
          </fieldset>

          <fieldset>
            <legend>Imagens</legend>
            <label>Imagem de fundo<input type="file" name="backgroundFile" accept="image/*,.heic,.heif"></label>
            ${design.backgroundImage && html`<label class="check"><input type="checkbox" name="removeBackground"> Remover a imagem de fundo</label>`}
            <label>Véu sobre a imagem, para o texto se ler melhor: <span data-overlay-value>${design.overlay}%</span>
              <input type="range" name="overlay" min="0" max="80" step="5" value="${design.overlay}">
            </label>
            <label>Logótipo<input type="file" name="logoFile" accept="image/*,.heic,.heif"></label>
            ${design.logoImage && html`<label class="check"><input type="checkbox" name="removeLogo"> Remover o logótipo</label>`}
            <p class="hint">JPG, PNG, HEIC ou WEBP, até 20 MB cada.</p>
          </fieldset>

          <button class="primary">Guardar personalização</button>
        </form>
      </div>
    </div>
    <p class="card-actions design-actions">
      <a href="${base}/cartoes.pdf">Descarregar cartões em PDF</a>
      <a href="${base}/qr.png">Descarregar QR Code em PNG</a>
      <a href="${base}/qr.svg" download="qr-${event.slug}.svg">Descarregar QR Code em SVG</a>
    </p>
    <script src="${asset("design.js")}" defer></script>
  `, `/e/${event.slug}/tema.css`);
}

export interface SettingsNotice {
  success?: string;
  error?: string;
}

const NOTICE_LABELS: Record<EmailNotice, string> = {
  missoes: "Quando as missões abrem",
  votacao: "Quando uma votação abre",
  vencedor: "Quando há vencedor numa missão",
};

function adminRow(admin: Admin, currentId?: string): Html {
  const base = `/admin/definicoes/administradores/${admin.id}`;
  const self = admin.id === currentId;
  return html`
    <li>
      <p class="admin-email"><strong>${admin.email}</strong>${self && " (a tua conta)"}</p>
      <form method="post" action="${base}/palavra-passe" class="inline-form">
        <input type="password" name="password" autocomplete="new-password" minlength="12" required aria-label="Nova palavra-passe de ${admin.email}" placeholder="Nova palavra-passe">
        <button>Mudar</button>
      </form>
      ${!self && html`<form method="post" action="${base}/apagar"><button class="link-button link-danger">Remover administrador</button></form>`}
    </li>`;
}

export function settingsPage(
  settings: PlatformSettings,
  adminEmail: string,
  admins: Admin[],
  currentId: string | undefined,
  notice: SettingsNotice = {},
): string {
  const { email } = settings;
  const selected = (value: string) => (email.security === value ? new Html("selected") : "");
  return shell("Definições", html`
    <h1>Definições</h1>
    <p class="lead">Estas opções aplicam-se a toda a plataforma.</p>
    ${notice.error && html`<p class="error" role="alert">${notice.error}</p>`}
    ${notice.success && html`<p class="notice" role="status">${notice.success}</p>`}

    <div class="settings">
      <section>
        <h2>Nome da plataforma</h2>
        <form method="post" action="/admin/definicoes/marca" class="inline-form">
          <input name="brandName" maxlength="60" required value="${settings.brandName}" aria-label="Nome da plataforma">
          <button>Guardar nome</button>
        </form>
      </section>

      <section>
        <h2>Administradores</h2>
        <p>Estas contas entram em <strong>/admin</strong> e têm acesso a todos os clientes.</p>
        <ul class="admin-accounts">${admins.map((admin) => adminRow(admin, currentId))}</ul>
        <form method="post" action="/admin/definicoes/administradores" class="stack add-admin">
          <h3>Adicionar administrador</h3>
          <div class="pair">
            <label>E-mail<input type="email" name="email" autocomplete="off" required></label>
            <label>Palavra-passe<input type="password" name="password" autocomplete="new-password" minlength="12" required></label>
          </div>
          <button class="primary">Adicionar administrador</button>
        </form>
      </section>

      <section>
        <h2>Avisos aos convidados por e-mail</h2>
        <p>Desligados por defeito. Convidados com notificações ativas não recebem estes e-mails.</p>
        <form method="post" action="/admin/definicoes/avisos" class="stack">
          ${(Object.entries(NOTICE_LABELS) as [EmailNotice, string][]).map(([key, label]) => html`
            <label class="check"><input type="checkbox" name="${key}" ${settings.emailNotices[key] ? new Html("checked") : ""}> ${label}</label>`)}
          <button>Guardar avisos</button>
        </form>
      </section>

      <section>
        <h2>Prazo dos eventos</h2>
        <p>Número de dias após o evento em que clientes e organizadores continuam a ter acesso. O sistema avisa-te, mas só tu apagas.</p>
        <form method="post" action="/admin/definicoes/prazo" class="inline-form narrow-form">
          <input type="number" name="retentionDays" min="1" max="365" value="${settings.retentionDays}" required aria-label="Dias de acesso após o evento">
          <button>Guardar prazo</button>
        </form>
      </section>

      <section>
        <h2>Fotografias por pessoa</h2>
        <p>Limite predefinido em cada missão para os novos clientes. Podes alterá-lo em cada cliente.</p>
        <form method="post" action="/admin/definicoes/fotos" class="inline-form narrow-form">
          <input type="number" name="photoLimit" min="${MIN_PHOTO_LIMIT}" max="${MAX_PHOTO_LIMIT}" value="${settings.defaultPhotoLimit}" required aria-label="Limite predefinido de fotografias">
          <button>Guardar limite</button>
        </form>
      </section>

      <section>
        <h2>Serviço de e-mail</h2>
        <p>${email.enabled ? "Ativo." : "Desligado."} Usa os dados SMTP do teu fornecedor. Quando estiver ativo, a plataforma envia os e-mails de evento criado. Os textos editam-se em E-mails.</p>
        <form method="post" action="/admin/definicoes/email" class="stack">
          <label class="check"><input type="checkbox" name="enabled" ${email.enabled ? new Html("checked") : ""}> Ativar o serviço de e-mail</label>
          <div class="pair">
            <label>Servidor SMTP<input name="host" autocomplete="off" value="${email.host}"></label>
            <label>Porta<input type="number" name="port" min="1" max="65535" value="${email.port}"></label>
          </div>
          <label>Segurança
            <select name="security">
              <option value="starttls" ${selected("starttls")}>STARTTLS, normalmente na porta 587</option>
              <option value="tls" ${selected("tls")}>TLS, normalmente na porta 465</option>
            </select>
          </label>
          <div class="pair">
            <label>Utilizador<input name="username" autocomplete="off" value="${email.username}"></label>
            <label>Palavra-passe ou chave<input type="password" name="password" autocomplete="new-password" placeholder="${email.passwordEncrypted ? "Guardada. Deixa em branco para manter." : ""}"></label>
          </div>
          <div class="pair">
            <label>Nome de envio<input name="fromName" maxlength="100" value="${email.fromName}"></label>
            <label>E-mail de envio<input type="email" name="fromAddress" value="${email.fromAddress}"></label>
          </div>
          <button class="primary">Guardar serviço de e-mail</button>
        </form>

        <form method="post" action="/admin/definicoes/email/testar" class="inline-form test-form">
          <input type="email" name="to" value="${adminEmail}" required aria-label="E-mail para o teste">
          <button>Enviar e-mail de teste</button>
        </form>
      </section>
    </div>
  `);
}

export interface MissionsContext {
  base: string;
  back: string;
  wrap?: (title: string, content: Html, stylesheet?: string) => string;
}

export function missionsPage(event: EventRecord, missions: AdminMission[], error: string | undefined, context: MissionsContext): string {
  const base = `${context.base}/missoes`;
  const wrap = context.wrap ?? shell;
  const used = new Set(missions.map((mission) => mission.title.toLowerCase()));
  const suggestions = EVENT_TYPES[event.event_type].suggestions.filter((title) => !used.has(title.toLowerCase()));
  return wrap(`Missões de ${event.name}`, html`
    <a class="back" href="${context.back}">Voltar a ${event.name}</a>
    <h1>Missões de ${event.name}</h1>
    <p class="lead">Cada missão tem a sua fase e o seu limite de fotografias. Podes pôr uma em votação e deixar as outras para depois.</p>
    ${error && html`<p class="error" role="alert">${error}</p>`}

    ${missions.length === 0
      ? html`<div class="empty"><p>Este evento ainda não tem missões. Escreve uma ou escolhe uma sugestão.</p></div>`
      : html`<ol class="admin-missions">
          ${missions.map((mission, index) => html`
            <li>
              <form method="post" action="${base}/${mission.id}/guardar" class="mission-form">
                <label class="mission-title">Missão<input name="title" maxlength="${MAX_TITLE_LENGTH}" required value="${mission.title}"></label>
                <label>Fotos por pessoa<input type="number" name="photoLimit" min="${MIN_PHOTO_LIMIT}" max="${MAX_PHOTO_LIMIT}" required value="${mission.photo_limit}"></label>
                <label>Fase
                  <select name="phase">
                    ${MISSION_PHASES.map((phase) => html`<option value="${phase}" ${phase === mission.phase ? new Html("selected") : ""}>${PHASE_LABELS[phase]}</option>`)}
                  </select>
                </label>
                <button>Guardar</button>
              </form>
              <div class="mission-tools">
                <span>${mission.photos} ${mission.photos === 1 ? "fotografia" : "fotografias"}, ${mission.votes} ${mission.votes === 1 ? "voto" : "votos"}</span>
                <form method="post" action="${base}/${mission.id}/subir"><button class="link-button" ${index === 0 ? new Html("disabled") : ""}>Subir</button></form>
                <form method="post" action="${base}/${mission.id}/descer"><button class="link-button" ${index === missions.length - 1 ? new Html("disabled") : ""}>Descer</button></form>
                <details class="danger-inline">
                  <summary>Apagar</summary>
                  <form method="post" action="${base}/${mission.id}/apagar" class="stack">
                    ${mission.photos > 0 && html`<label class="check"><input type="checkbox" name="confirm" required> Apagar também ${mission.photos} ${mission.photos === 1 ? "fotografia" : "fotografias"}</label>`}
                    <button class="destructive">Apagar missão</button>
                  </form>
                </details>
              </div>
            </li>`)}
        </ol>`}

    <section class="add-mission">
      <h2>Adicionar missão</h2>
      <form method="post" action="${base}" class="inline-form">
        <input name="title" maxlength="${MAX_TITLE_LENGTH}" required placeholder="Escreve a tua missão" aria-label="Nova missão">
        <button>Adicionar</button>
      </form>
      ${suggestions.length > 0 && html`
        <h3>Sugestões</h3>
        <ul class="suggestions">
          ${suggestions.map((title) => html`
            <li><form method="post" action="${base}">
              <input type="hidden" name="title" value="${title}">
              <button>${title}</button>
            </form></li>`)}
        </ul>`}
    </section>

    <section class="add-mission">
      <h2>Aplicar o mesmo limite a todas</h2>
      <form method="post" action="${base}/limite" class="inline-form narrow-form">
        <input type="number" name="photoLimit" min="${MIN_PHOTO_LIMIT}" max="${MAX_PHOTO_LIMIT}" required value="${missions[0]?.photo_limit ?? 1}" aria-label="Fotografias por pessoa em todas as missões">
        <button>Aplicar a todas</button>
      </form>
    </section>
  `);
}

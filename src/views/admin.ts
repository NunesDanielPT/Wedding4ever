import { asset } from "../lib/assets";
import { brand } from "../lib/brand";
import { EVENT_STATUSES, type EventRecord, type EventStats, type EventStatus, type RegisteredGuest } from "../db/events";
import type { Admin } from "../lib/auth";
import type { Design } from "../lib/design";
import { eventUrl } from "../lib/event-assets";
import { formatDate, initials } from "../lib/format";
import { html, Html } from "../lib/html";
import type { SiteItem } from "../lib/site";
import { MAX_TITLE_LENGTH, MISSION_PHASES, PHASE_LABELS, type AdminMission } from "../lib/missions";
import { EVENT_TYPE_IDS, EVENT_TYPES } from "../lib/event-types";
import { BORDERS, COLOR_PRESETS, FONTS, QR_SIZES } from "../lib/design";
import { MAX_PHOTO_LIMIT, MIN_PHOTO_LIMIT, type PlatformSettings } from "../lib/settings";
import { guestTable } from "./guests";
import { page, rings } from "./layout";

export const STATUS_LABELS: Record<EventStatus, string> = {
  rascunho: "Rascunho",
  aberto: "Aberto",
  votacao: "Votação",
  resultados: "Resultados",
  arquivado: "Arquivado",
};

export function shell(title: string, content: Html, stylesheet?: string): string {
  return page(`${title} | ${brand()}`, html`
    <header class="topbar">
      <a class="brand" href="/admin">${rings}<span>${brand()}</span></a>
      <nav class="topnav">
        <a href="/admin">Eventos</a>
        <a href="/admin/organizadores">Organizadores</a>
        <a href="/admin/estatisticas">Estatísticas</a>
        <a href="/admin/site">Site</a>
        <a href="/admin/mensagens">Mensagens</a>
        <a href="/admin/definicoes">Definições</a>
        <form method="post" action="/admin/sair"><button class="link-button">Sair</button></form>
      </nav>
    </header>
    <main class="admin">${content}</main>
  `, "", stylesheet);
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

export function dashboardPage(events: EventRecord[], unread = 0): string {
  return shell("Eventos", html`
    <div class="page-head">
      <h1>Eventos</h1>
      <a class="primary" href="/admin/clientes/novo">Criar evento</a>
    </div>
    ${unread > 0 && html`<p class="notice"><a href="/admin/mensagens">${unread === 1 ? "Tens 1 mensagem por ler." : `Tens ${unread} mensagens por ler.`}</a></p>`}
    ${events.length === 0
      ? html`<div class="empty"><p>Ainda não tens eventos. Cria o primeiro para gerar o link, o QR Code e a base de dados.</p></div>`
      : html`<ul class="client-list">
          ${events.map((event) => html`
            <li>
              <a href="/admin/clientes/${event.id}">
                <span class="monogram" aria-hidden="true">${initials(event.name)}</span>
                <span class="client-name">${event.name}</span>
                <span class="client-date">${EVENT_TYPES[event.event_type].label}, ${formatDate(event.event_date)}</span>
                <span class="status status-${event.status}">${STATUS_LABELS[event.status]}</span>
              </a>
            </li>`)}
        </ul>`}
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
): string {
  const url = eventUrl(event);
  return shell(event.name, html`
    <a class="back" href="/admin">Voltar aos eventos</a>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    ${event.migration_error && html`<p class="error" role="alert">Esta base não ficou atualizada: ${event.migration_error}</p>`}
    <div class="event-layout">
      <section class="place-card" aria-label="Cartão de mesa">
        <p class="card-monogram" aria-hidden="true">${initials(event.name)}</p>
        <p class="type-label">${EVENT_TYPES[event.event_type].label}</p>
        <h1>${event.name}</h1>
        <p class="card-date">${formatDate(event.event_date)}</p>
        <img src="/admin/clientes/${event.id}/qr.svg" alt="QR Code do evento" width="220" height="220">
        <p class="card-actions">
          <a href="/admin/clientes/${event.id}/cartoes.pdf">Descarregar cartões em PDF</a>
          <a href="/admin/clientes/${event.id}/qr.png">Descarregar QR Code em PNG</a>
          <a href="/admin/clientes/${event.id}/qr.svg" download="qr-${event.slug}.svg">Descarregar QR Code em SVG</a>
          <a href="/admin/clientes/${event.id}/personalizar">Personalizar cartões e página</a>
        </p>
      </section>

      <div class="event-side">
        <section>
          <h2>Link dos convidados</h2>
          <input class="copy-field" readonly value="${url}" aria-label="Link dos convidados">
          <a href="${url}" target="_blank" rel="noopener">Abrir como convidado</a>
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
          <h2>Definições do cliente</h2>
          <p class="downloads">
            <a href="/admin/clientes/${event.id}/missoes">Missões, fases e fotografias por missão</a>
            <a href="/admin/clientes/${event.id}/personalizar">Personalizar cartões e página</a>
            <a href="/cliente/eventos/${event.id}">Abrir a área deste cliente</a>
          </p>
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

    ${stats && html`<section class="guests-section">
      <h2>Convidados registados</h2>
      ${guestTable(guests)}
    </section>`}
  `);
}

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
        <h2>Fotografias por pessoa</h2>
        <p>Limite predefinido em cada missão para os novos clientes. Podes alterá-lo em cada cliente.</p>
        <form method="post" action="/admin/definicoes/fotos" class="inline-form narrow-form">
          <input type="number" name="photoLimit" min="${MIN_PHOTO_LIMIT}" max="${MAX_PHOTO_LIMIT}" value="${settings.defaultPhotoLimit}" required aria-label="Limite predefinido de fotografias">
          <button>Guardar limite</button>
        </form>
      </section>

      <section>
        <h2>Serviço de e-mail</h2>
        <p>${email.enabled ? "Ativo." : "Desligado."} Usa os dados SMTP do teu fornecedor. A plataforma ainda não envia e-mails automáticos; por agora, só o teste abaixo envia.</p>
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

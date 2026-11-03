import { EVENT_STATUSES, type EventRecord, type EventStats, type EventStatus, type RegisteredGuest } from "../db/events";
import type { Design } from "../lib/design";
import { eventUrl } from "../lib/event-assets";
import { coupleNames, formatDate, initial } from "../lib/format";
import { html, Html } from "../lib/html";
import { MAX_TITLE_LENGTH, MISSION_PHASES, MISSION_SUGGESTIONS, PHASE_LABELS, type AdminMission } from "../lib/missions";
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

function shell(title: string, content: Html, stylesheet?: string): string {
  return page(`${title} | Wedding4Ever`, html`
    <header class="topbar">
      <a class="brand" href="/admin">${rings}<span>Wedding4Ever</span></a>
      <nav class="topnav">
        <a href="/admin">Clientes</a>
        <a href="/admin/definicoes">Definições</a>
        <form method="post" action="/admin/sair"><button class="link-button">Sair</button></form>
      </nav>
    </header>
    <main class="admin">${content}</main>
  `, "", stylesheet);
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

export function eventPage(
  event: EventRecord,
  stats: EventStats | null,
  guests: RegisteredGuest[],
  error?: string,
  coupleCode?: string,
): string {
  const url = eventUrl(event);
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
          <h2>Definições do cliente</h2>
          <p class="downloads">
            <a href="/admin/clientes/${event.id}/missoes">Missões, fases e fotografias por missão</a>
            <a href="/admin/clientes/${event.id}/personalizar">Personalizar cartões e página</a>
          </p>
        </section>

        <section>
          <h2>Acesso dos noivos</h2>
          <input class="copy-field" readonly value="${url}/noivos" aria-label="Link dos noivos">
          <p>Entram com ${event.couple_email} e um código de acesso.</p>
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

    ${stats && html`<section class="guests-section">
      <h2>Convidados registados</h2>
      ${guestTable(guests)}
    </section>`}
  `);
}

function colorField(label: string, name: string, value: string): Html {
  return html`<label>${label}<input type="color" name="${name}" value="${value}"></label>`;
}

export function designPage(event: EventRecord, design: Design, error?: string): string {
  const couple = coupleNames(event.partner_one, event.partner_two);
  const mediaBase = `/e/${event.slug}/media`;
  return shell(`Personalizar ${couple}`, html`
    <a class="back" href="/admin/clientes/${event.id}">Voltar a ${couple}</a>
    <h1>Personalizar</h1>
    <p class="lead">Estas opções mudam os cartões em PDF, o QR Code e a página dos convidados.</p>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <div class="event-layout design-layout">
      <section class="design-card themed t-image" aria-label="Pré-visualização">
        ${design.logoImage && html`<img class="design-logo" src="${mediaBase}/logo" alt="">`}
        <h2>${couple}</h2>
        <p>${formatDate(event.event_date)}</p>
        <p class="design-headline">${design.headline}</p>
        <img class="design-qr" src="/admin/clientes/${event.id}/qr.svg" alt="QR Code do evento" width="200" height="200">
        <p>${design.instructions}</p>
      </section>

      <form method="post" action="/admin/clientes/${event.id}/personalizar" enctype="multipart/form-data" class="stack">
        <label>Título<input name="headline" maxlength="60" required value="${design.headline}"></label>
        <label>Instrução para os convidados<input name="instructions" maxlength="120" required value="${design.instructions}"></label>

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
          <legend>Imagens</legend>
          <label>Imagem de fundo<input type="file" name="backgroundFile" accept="image/jpeg,image/png"></label>
          ${design.backgroundImage && html`<label class="check"><input type="checkbox" name="removeBackground"> Remover a imagem de fundo</label>`}
          <label>Logótipo<input type="file" name="logoFile" accept="image/jpeg,image/png"></label>
          ${design.logoImage && html`<label class="check"><input type="checkbox" name="removeLogo"> Remover o logótipo</label>`}
          <p class="hint">JPG ou PNG, até 8 MB cada.</p>
        </fieldset>

        <button class="primary">Guardar personalização</button>
      </form>
    </div>
    <p class="card-actions design-actions">
      <a href="/admin/clientes/${event.id}/cartoes.pdf">Descarregar cartões em PDF</a>
      <a href="/admin/clientes/${event.id}/qr.png">Descarregar QR Code em PNG</a>
      <a href="/admin/clientes/${event.id}/qr.svg" download="qr-${event.slug}.svg">Descarregar QR Code em SVG</a>
    </p>
  `, `/e/${event.slug}/tema.css`);
}

export interface SettingsNotice {
  success?: string;
  error?: string;
}

export function settingsPage(settings: PlatformSettings, adminEmail: string, notice: SettingsNotice = {}): string {
  const { email } = settings;
  const selected = (value: string) => (email.security === value ? new Html("selected") : "");
  return shell("Definições", html`
    <h1>Definições</h1>
    <p class="lead">Estas opções aplicam-se a toda a plataforma.</p>
    ${notice.error && html`<p class="error" role="alert">${notice.error}</p>`}
    ${notice.success && html`<p class="notice" role="status">${notice.success}</p>`}

    <div class="settings">
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

export function missionsPage(event: EventRecord, missions: AdminMission[], error?: string): string {
  const couple = coupleNames(event.partner_one, event.partner_two);
  const base = `/admin/clientes/${event.id}/missoes`;
  const used = new Set(missions.map((mission) => mission.title.toLowerCase()));
  const suggestions = MISSION_SUGGESTIONS.filter((title) => !used.has(title.toLowerCase()));
  return shell(`Missões de ${couple}`, html`
    <a class="back" href="/admin/clientes/${event.id}">Voltar a ${couple}</a>
    <h1>Missões de ${couple}</h1>
    <p class="lead">Cada missão tem a sua fase e o seu limite. Podes pôr uma em votação e deixar as outras para depois.</p>
    ${error && html`<p class="error" role="alert">${error}</p>`}

    ${missions.length === 0
      ? html`<div class="empty"><p>Este cliente ainda não tem missões. Escreve uma ou escolhe uma sugestão.</p></div>`
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
      <form method="post" action="/admin/clientes/${event.id}/limite-fotos" class="inline-form narrow-form">
        <input type="number" name="photoLimit" min="${MIN_PHOTO_LIMIT}" max="${MAX_PHOTO_LIMIT}" required value="${missions[0]?.photo_limit ?? 1}" aria-label="Fotografias por pessoa em todas as missões">
        <button>Aplicar a todas</button>
      </form>
    </section>
  `);
}

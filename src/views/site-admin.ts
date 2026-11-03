import { html, Html } from "../lib/html";
import { SITE_COLLECTIONS, TEXT_FIELDS, type Site, type SiteField, type SiteItem, type SupportMessage } from "../lib/site";
import { shell } from "./admin";

function fieldInput(item: SiteField, value = ""): Html {
  const required = item.required ? new Html("required") : "";
  if (item.type === "checkbox") {
    return html`<label class="check"><input type="checkbox" name="${item.name}" ${value ? new Html("checked") : ""}> ${item.label}</label>`;
  }
  if (item.type === "image") {
    return html`<div class="image-field">
      ${value && html`<img src="/media/site/${value}" alt="" width="96" height="96">`}
      <label>${item.label}<input type="file" name="${item.name}" accept="image/jpeg,image/png" ${item.required && !value ? new Html("required") : ""}></label>
      ${value && !item.required && html`<label class="check"><input type="checkbox" name="remove_${item.name}"> Remover imagem</label>`}
    </div>`;
  }
  const hint = item.hint && html`<span class="hint">${item.hint}</span>`;
  if (item.type === "textarea") {
    return html`<label>${item.label}<textarea name="${item.name}" rows="4" ${required}>${value}</textarea>${hint}</label>`;
  }
  return html`<label>${item.label}<input type="${item.type === "text" ? "text" : item.type}" name="${item.name}" value="${value}" ${item.type === "number" ? new Html('min="1"') : ""} ${required}>${hint}</label>`;
}

function collection(name: string, items: SiteItem[]): Html {
  const definition = SITE_COLLECTIONS[name]!;
  const base = `/admin/site/${name}`;
  return html`
    <section class="site-section" id="${name}">
      <h2>${definition.title}</h2>
      ${items.length === 0 && html`<p class="hint">Sem conteúdo. Esta secção fica escondida no site.</p>`}
      <ol class="site-items">
        ${items.map((item, index) => html`
          <li>
            <form method="post" action="${base}/${item.id}/guardar" enctype="multipart/form-data" class="stack">
              ${definition.fields.map((entry) => fieldInput(entry, item[entry.name]))}
              <button>Guardar</button>
            </form>
            <div class="mission-tools">
              <form method="post" action="${base}/${item.id}/subir"><button class="link-button" ${index === 0 ? new Html("disabled") : ""}>Subir</button></form>
              <form method="post" action="${base}/${item.id}/descer"><button class="link-button" ${index === items.length - 1 ? new Html("disabled") : ""}>Descer</button></form>
              <form method="post" action="${base}/${item.id}/apagar"><button class="link-button link-danger">Apagar</button></form>
            </div>
          </li>`)}
      </ol>
      <details class="site-add">
        <summary>${definition.add}</summary>
        <form method="post" action="${base}" enctype="multipart/form-data" class="stack">
          ${definition.fields.map((entry) => fieldInput(entry))}
          <button class="primary">${definition.add}</button>
        </form>
      </details>
    </section>`;
}

export function siteAdminPage(site: Site, error?: string): string {
  return shell("Site", html`
    <div class="page-head">
      <h1>Site</h1>
      <a class="action" href="/" target="_blank" rel="noopener">Abrir o site</a>
    </div>
    <p class="lead">Tudo o que aparece na página pública é editado aqui.</p>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <section class="site-section">
      <h2>Textos e imagem principal</h2>
      <form method="post" action="/admin/site/textos" enctype="multipart/form-data" class="stack">
        ${TEXT_FIELDS.map((entry) => fieldInput(entry, site.texts[entry.name]))}
        <button class="primary">Guardar textos</button>
      </form>
    </section>
    ${Object.keys(SITE_COLLECTIONS).map((name) => collection(name, site[name as keyof Omit<Site, "texts">]))}
  `);
}

const dateTime = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" });

export function messagesPage(messages: SupportMessage[]): string {
  return shell("Mensagens", html`
    <h1>Mensagens</h1>
    <p class="lead">Mensagens enviadas pelo formulário de suporte do site.</p>
    ${messages.length === 0
      ? html`<div class="empty"><p>Ainda não recebeste mensagens.</p></div>`
      : html`<ul class="message-list">
          ${messages.map((message) => html`
            <li class="${message.read_at ? "" : "message-unread"}">
              <p class="message-head"><strong>${message.name}</strong> <a href="mailto:${message.email}">${message.email}</a> <span>${dateTime.format(new Date(message.created_at))}</span></p>
              <p class="message-body">${message.message}</p>
              <div class="mission-tools">
                <form method="post" action="/admin/mensagens/${message.id}/${message.read_at ? "por-ler" : "lida"}">
                  <button class="link-button">${message.read_at ? "Marcar como por ler" : "Marcar como lida"}</button>
                </form>
                <form method="post" action="/admin/mensagens/${message.id}/apagar"><button class="link-button link-danger">Apagar</button></form>
              </div>
            </li>`)}
        </ul>`}
  `);
}

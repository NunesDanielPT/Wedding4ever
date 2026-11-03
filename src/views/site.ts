import { html, type Html } from "../lib/html";
import type { Site, SiteItem } from "../lib/site";
import { page, rings } from "./layout";

export interface SiteState {
  error?: string;
  sent?: boolean;
  values?: { name?: string; email?: string; message?: string };
}

const phoneMock = html`
  <div class="hero-art" aria-hidden="true">
    <div class="table-card">
      <p class="table-names">Ana &amp; Pedro</p>
      <p>Batalha da Melhor Foto</p>
      <div class="table-qr"><span></span><span></span><span></span><i></i></div>
    </div>
    <div class="phone">
      <div class="phone-screen">
        <p class="phone-title">A sua missão</p>
        <ul>
          <li><span>Um brinde com os noivos</span><b>1/1</b></li>
          <li><span>Na pista de dança</span><b>0/1</b></li>
          <li><span>A aliança com orgulho</span><b>Votar</b></li>
          <li><span>A melhor gargalhada</span><b>0/1</b></li>
        </ul>
        <div class="phone-winner">WINNER</div>
      </div>
    </div>
  </div>
`;

function ad(item: SiteItem): Html {
  const content = html`
    ${item.image && html`<img src="/media/site/${item.image}" alt="" loading="lazy">`}
    <h3>${item.title}</h3>
    ${item.text && html`<p>${item.text}</p>`}`;
  return item.url
    ? html`<li><a href="${item.url}" target="_blank" rel="noopener sponsored">${content}</a></li>`
    : html`<li>${content}</li>`;
}

function packCard(item: SiteItem): Html {
  return html`
    <li class="pack ${item.highlight ? "pack-highlight" : ""}">
      <h3>${item.name}</h3>
      <p class="pack-guests">${item.guests}</p>
      <p class="pack-price">${item.price || "Sob consulta"}</p>
      <ul>${(item.features ?? "").split("\n").filter((line) => line.trim()).map((line) => html`<li>${line}</li>`)}</ul>
      <a class="site-button" href="/?pack=${encodeURIComponent(`${item.name} (${item.guests})`)}#suporte">Pedir este pack</a>
    </li>`;
}

export function sitePage(site: Site, state: SiteState = {}): string {
  const t = site.texts;
  return page("Wedding4Ever | Batalha da Melhor Foto", html`
    <header class="site-header">
      <a class="brand" href="/">${rings}<span>Wedding4Ever</span></a>
      <nav>
        <a href="#como-funciona">Como funciona</a>
        <a href="#packs">Packs</a>
        <a href="#suporte">Suporte</a>
        <a class="site-login" href="/entrar">Área de cliente</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <div class="hero-copy">
          <h1>${t.heroTitle}</h1>
          <p>${t.heroSubtitle}</p>
          <a class="site-button" href="#packs">${t.heroButton}</a>
        </div>
        ${t.heroImage ? html`<img class="hero-image" src="/media/site/${t.heroImage}" alt="">` : phoneMock}
      </section>

      <section class="about">
        <h2>${t.aboutTitle}</h2>
        <p>${t.aboutText}</p>
      </section>

      ${site.steps.length > 0 && html`<section class="steps" id="como-funciona">
        <h2>${t.stepsTitle}</h2>
        <ol>${site.steps.map((step) => html`<li><h3>${step.title}</h3><p>${step.text}</p></li>`)}</ol>
      </section>`}

      ${site.gallery.length > 0 && html`<section class="site-gallery">
        <h2>${t.galleryTitle}</h2>
        <ul>${site.gallery.map((item) => html`<li><figure><img src="/media/site/${item.image}" alt="${item.caption ?? ""}" loading="lazy">${item.caption && html`<figcaption>${item.caption}</figcaption>`}</figure></li>`)}</ul>
      </section>`}

      ${site.testimonials.length > 0 && html`<section class="testimonials">
        <h2>${t.testimonialsTitle}</h2>
        <ul>${site.testimonials.map((item) => html`
          <li><blockquote>
            ${item.image && html`<img src="/media/site/${item.image}" alt="" loading="lazy">`}
            <p>${item.text}</p>
            <footer><strong>${item.author}</strong>${item.role && html`<span>${item.role}</span>`}</footer>
          </blockquote></li>`)}</ul>
      </section>`}

      ${site.packs.length > 0 && html`<section class="packs" id="packs">
        <h2>${t.packsTitle}</h2>
        ${t.packsNote && html`<p>${t.packsNote}</p>`}
        <ul class="pack-list">${site.packs.map(packCard)}</ul>
      </section>`}

      ${site.ads.length > 0 && html`<section class="ads">
        <h2>${t.adsTitle}</h2>
        <ul>${site.ads.map(ad)}</ul>
      </section>`}

      <section class="support" id="suporte">
        <div>
          <h2>${t.supportTitle}</h2>
          <p>${t.supportText}</p>
        </div>
        <form method="post" action="/suporte" class="stack">
          ${state.sent && html`<p class="notice" role="status">Mensagem enviada. Vamos responder para o teu e-mail.</p>`}
          ${state.error && html`<p class="error" role="alert">${state.error}</p>`}
          <label>Nome<input name="name" autocomplete="name" maxlength="100" required value="${state.values?.name ?? ""}"></label>
          <label>E-mail<input type="email" name="email" autocomplete="email" maxlength="160" required value="${state.values?.email ?? ""}"></label>
          <label>Mensagem<textarea name="message" rows="5" maxlength="3000" required>${state.values?.message ?? ""}</textarea></label>
          <label class="site-trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
          <button class="site-button">Enviar mensagem</button>
        </form>
      </section>
    </main>

    <footer class="site-footer">
      <p>${t.footerText}</p>
      <a href="/entrar">Área de cliente</a>
    </footer>
  `, "site-page", "/static/site.css", t.heroSubtitle);
}

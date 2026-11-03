import type { EventRecord, EventStatus } from "../db/events";
import { coupleNames, formatDate, initial } from "../lib/format";
import { html } from "../lib/html";
import { page } from "./layout";

const MESSAGES: Record<EventStatus, string> = {
  rascunho: "As missões abrem no dia do casamento. Guarda este link.",
  aberto: "As missões estão abertas. O envio de fotografias chega na próxima versão.",
  votacao: "A votação está aberta.",
  resultados: "Os vencedores já são conhecidos.",
  arquivado: "Este evento terminou. Obrigado por teres participado.",
};

export function eventLandingPage(event: EventRecord): string {
  return page(coupleNames(event.partner_one, event.partner_two), html`
    <main class="guest">
      <p class="card-monogram" aria-hidden="true">${initial(event.partner_one)}<span>&amp;</span>${initial(event.partner_two)}</p>
      <h1>${coupleNames(event.partner_one, event.partner_two)}</h1>
      <p class="card-date">${formatDate(event.event_date)}</p>
      <p class="guest-title">Batalha da Melhor Foto</p>
      <p>${MESSAGES[event.status]}</p>
    </main>
  `, "guest-page");
}

export function notFoundPage(): string {
  return page("Página não encontrada", html`
    <main class="guest">
      <h1>Este link não existe</h1>
      <p>Confirma o endereço ou lê novamente o QR Code da tua mesa.</p>
    </main>
  `, "guest-page");
}

import type { EventRecord } from "../db/events";
import { html } from "../lib/html";
import type { MissionWinners } from "../lib/missions";
import { page } from "./layout";

const confetti = html`<div class="confetti" aria-hidden="true">${Array.from({ length: 28 }, () => html`<span></span>`)}</div>`;

export function winnersPage(event: EventRecord, missions: MissionWinners[], photoBase: string, back: string): string {
  return page("Vencedores", html`
    <main class="winners">
      <a class="winners-back" href="${back}">Voltar</a>
      <header>
        <p>${event.name}</p>
        <h1>A melhor foto</h1>
      </header>
      ${missions.length === 0
        ? html`<p class="winners-empty">Os vencedores aparecem aqui quando uma missão com votos for encerrada.</p>`
        : missions.map((mission) => html`
            <details class="winner-reveal">
              <summary><span>${mission.title}</span><strong>Revelar vencedor</strong></summary>
              <div class="winner-stage">
                ${confetti}
                <p class="winner-word">WINNER</p>
                ${mission.photos.map((photo) => html`
                  <figure class="winner-photo">
                    <img src="${photoBase}/${photo.id}/preview" alt="${photo.caption || `Fotografia de ${photo.guest_name}`}">
                    <figcaption>
                      <strong>${photo.guest_name}</strong>
                      <span>${photo.votes === 1 ? "1 voto" : `${photo.votes} votos`}</span>
                      ${photo.caption && html`<em>${photo.caption}</em>`}
                    </figcaption>
                  </figure>`)}
              </div>
            </details>`)}
    </main>
  `, "winners-page");
}

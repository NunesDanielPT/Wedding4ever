import type { RegisteredGuest } from "../db/events";
import { html, type Html } from "../lib/html";

const dateTime = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" });

/** Lista numerada pela ordem em que cada conta foi criada. */
export function guestTable(guests: RegisteredGuest[]): Html {
  if (guests.length === 0) return html`<p>Ainda não há convidados registados.</p>`;
  return html`
    <table class="guest-table">
      <thead>
        <tr><th scope="col">N.º</th><th scope="col">Criação</th><th scope="col">Nome</th><th scope="col">E-mail</th></tr>
      </thead>
      <tbody>
        ${guests.map((guest, index) => html`
          <tr>
            <td class="guest-number">${index + 1}</td>
            <td class="guest-created">${dateTime.format(new Date(guest.created_at))}</td>
            <td class="guest-name">${guest.full_name}</td>
            <td class="guest-email">${guest.email}</td>
          </tr>`)}
      </tbody>
    </table>
  `;
}

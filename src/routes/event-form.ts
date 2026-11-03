import { EVENT_TYPE_IDS, isEventType, type EventType } from "../lib/event-types";
import type { SiteItem } from "../lib/site";
import { field, isEmail } from "./http";

export interface EventValues {
  name: string;
  eventType: EventType;
  eventDate: string;
  venue: string;
  coupleEmail: string;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function readEventForm(form: FormData, packs: SiteItem[]) {
  const type = field(form, "eventType");
  const values: EventValues = {
    name: field(form, "name"),
    eventType: isEventType(type) ? type : EVENT_TYPE_IDS[0],
    eventDate: field(form, "eventDate"),
    venue: field(form, "venue"),
    coupleEmail: field(form, "coupleEmail").toLowerCase(),
  };
  const packId = field(form, "packId");
  const pack = packs.find((item) => item.id === packId);
  let error: string | undefined;
  if (!isEventType(type)) error = "Escolhe o tipo de evento.";
  else if (values.name.length < 2 || values.name.length > 100) error = "O nome do evento tem de ter entre 2 e 100 caracteres.";
  else if (!isRealDate(values.eventDate)) error = "Indica uma data válida para o evento.";
  else if (values.venue.length > 120) error = "O local pode ter até 120 caracteres.";
  else if (!isEmail(values.coupleEmail)) error = "Indica um e-mail válido para o cliente.";
  else if (packId && !pack) error = "Escolhe um pack válido.";
  return {
    values,
    packId,
    pack,
    error,
    packName: pack ? `${pack.name} (${pack.guests})` : "",
    guestLimit: pack?.maxGuests ? Number(pack.maxGuests) : null,
  };
}

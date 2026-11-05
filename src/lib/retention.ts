const DAY_MS = 86_400_000;
const lisbonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" });

export interface Retention {
  deleteDate: string;
  daysLeft: number;
  expired: boolean;
}

function toDay(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

/** O acesso fica disponível até ao fim do último dia do prazo, em hora de Portugal. */
export function retentionOf(eventDate: string, retentionDays: number, now = new Date()): Retention {
  const end = toDay(eventDate) + retentionDays * DAY_MS;
  const daysLeft = Math.round((end - toDay(lisbonDate.format(now))) / DAY_MS);
  return { deleteDate: new Date(end).toISOString().slice(0, 10), daysLeft, expired: daysLeft < 0 };
}

/** Soma ao prazo geral os dias extra vendidos a este evento. */
export function retentionForEvent(event: { event_date: string; extra_days: number }, retentionDays: number): Retention {
  return retentionOf(event.event_date, retentionDays + event.extra_days);
}

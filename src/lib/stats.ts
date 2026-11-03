import { central } from "../db/central";
import { eventDb } from "../db/events";
import type { EventType } from "./event-types";

const TIME_ZONE = "Europe/Lisbon";
const BATCH = 5;

export interface StatsFilter {
  year: number;
  month?: number;
  eventId?: string;
  organizerId?: string;
}

export interface MonthRow {
  month: number;
  created: number;
  held: number;
  guests: number;
  photos: number;
  votes: number;
}

export interface EventRow {
  id: string;
  name: string;
  type: EventType;
  date: string;
  organizer: string;
  pack: string;
  guests: number;
  photos: number;
  votes: number;
  bytes: number;
  unavailable: boolean;
}

export interface Stats {
  filter: StatsFilter;
  years: number[];
  options: { id: string; name: string; date: string }[];
  organizers: { id: string; name: string }[];
  months: MonthRow[];
  events: EventRow[];
  totals: { created: number; held: number; guests: number; photos: number; votes: number; bytes: number };
  allTime: { events: number; guests: number; photos: number; votes: number; bytes: number };
  byType: { type: EventType; events: number; guests: number; photos: number }[];
  unavailable: number;
}

interface CentralEvent {
  id: string;
  name: string;
  event_type: EventType;
  event_date: string;
  created_at: Date;
  db_name: string;
  pack_name: string;
  organizer_id: string | null;
  organizer_name: string | null;
}

interface Activity {
  ym: string;
  guests: number;
  photos: number;
  votes: number;
  bytes: number;
}

async function eventActivity(dbName: string): Promise<Activity[]> {
  return eventDb(dbName)`
    SELECT ym, sum(guests)::int AS guests, sum(photos)::int AS photos, sum(votes)::int AS votes, sum(bytes)::float8 AS bytes
    FROM (
      SELECT to_char(created_at AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM') AS ym, 1 AS guests, 0 AS photos, 0 AS votes, 0::bigint AS bytes FROM guests
      UNION ALL
      SELECT to_char(created_at AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM'), 0, 1, 0, size_bytes FROM photos
      UNION ALL
      SELECT to_char(created_at AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM'), 0, 0, 1, 0 FROM votes
    ) activity GROUP BY ym
  `;
}

function ym(date: Date | string): string {
  const value = new Date(date);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" }).formatToParts(value);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}

/** Junta os dados de todas as bases de clientes; uma base indisponível não trava o resto. */
export async function getStats(filter: StatsFilter): Promise<Stats> {
  const all: CentralEvent[] = await central`
    SELECT e.id, e.name, e.event_type, e.event_date::text AS event_date, e.created_at, e.db_name, e.pack_name,
           e.organizer_id, o.name AS organizer_name
    FROM events e LEFT JOIN organizers o ON o.id = e.organizer_id
    ORDER BY e.event_date DESC, e.created_at DESC
  `;
  const organizers: { id: string; name: string }[] = await central`SELECT id, name FROM organizers ORDER BY name`;
  const selected = all.filter(
    (event) =>
      (!filter.eventId || event.id === filter.eventId) &&
      (!filter.organizerId || event.organizer_id === filter.organizerId),
  );

  const activity = new Map<string, Activity[] | null>();
  for (let i = 0; i < selected.length; i += BATCH) {
    await Promise.all(
      selected.slice(i, i + BATCH).map(async (event) => {
        activity.set(event.id, await eventActivity(event.db_name).catch(() => null));
      }),
    );
  }

  const prefix = `${filter.year}-`;
  const period = filter.month ? `${prefix}${String(filter.month).padStart(2, "0")}` : undefined;
  const inPeriod = (value: string) => value.startsWith(prefix) && (!period || value === period);
  const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, created: 0, held: 0, guests: 0, photos: 0, votes: 0 }));
  const allTime = { events: selected.length, guests: 0, photos: 0, votes: 0, bytes: 0 };
  const totals = { created: 0, held: 0, guests: 0, photos: 0, votes: 0, bytes: 0 };
  const types = new Map<EventType, { type: EventType; events: number; guests: number; photos: number }>();
  const years = new Set<number>([new Date().getFullYear(), filter.year]);
  const events: EventRow[] = [];
  let unavailable = 0;

  for (const event of selected) {
    const createdYm = ym(event.created_at);
    const heldYm = event.event_date.slice(0, 7);
    years.add(Number(createdYm.slice(0, 4)));
    years.add(Number(heldYm.slice(0, 4)));
    if (createdYm.startsWith(prefix)) months[Number(createdYm.slice(5)) - 1]!.created++;
    if (heldYm.startsWith(prefix)) months[Number(heldYm.slice(5)) - 1]!.held++;
    if (inPeriod(createdYm)) totals.created++;
    if (inPeriod(heldYm)) totals.held++;

    const row: EventRow = {
      id: event.id, name: event.name, type: event.event_type, date: event.event_date,
      organizer: event.organizer_name ?? "", pack: event.pack_name,
      guests: 0, photos: 0, votes: 0, bytes: 0, unavailable: false,
    };
    const rows = activity.get(event.id);
    if (!rows) {
      row.unavailable = true;
      unavailable++;
    }
    for (const item of rows ?? []) {
      years.add(Number(item.ym.slice(0, 4)));
      allTime.guests += item.guests;
      allTime.photos += item.photos;
      allTime.votes += item.votes;
      allTime.bytes += item.bytes;
      if (item.ym.startsWith(prefix)) {
        const month = months[Number(item.ym.slice(5)) - 1]!;
        month.guests += item.guests;
        month.photos += item.photos;
        month.votes += item.votes;
      }
      if (inPeriod(item.ym)) {
        row.guests += item.guests;
        row.photos += item.photos;
        row.votes += item.votes;
        row.bytes += item.bytes;
      }
    }
    totals.guests += row.guests;
    totals.photos += row.photos;
    totals.votes += row.votes;
    totals.bytes += row.bytes;

    const active = row.guests + row.photos + row.votes > 0 || inPeriod(heldYm) || inPeriod(createdYm);
    if (active) {
      events.push(row);
      const type = types.get(event.event_type) ?? { type: event.event_type, events: 0, guests: 0, photos: 0 };
      type.events++;
      type.guests += row.guests;
      type.photos += row.photos;
      types.set(event.event_type, type);
    }
  }

  return {
    filter,
    years: [...years].sort((a, b) => b - a),
    options: all.map((event) => ({ id: event.id, name: event.name, date: event.event_date })),
    organizers,
    months,
    events: events.sort((a, b) => b.photos - a.photos || b.guests - a.guests),
    totals,
    allTime,
    byType: [...types.values()].sort((a, b) => b.events - a.events),
    unavailable,
  };
}

import { SQL } from "bun";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { resolveDesign, type Design } from "../lib/design";
import { central } from "./central";
import { migrate } from "./migrate";

export const EVENT_STATUSES = ["rascunho", "aberto", "votacao", "resultados", "arquivado"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface EventRecord {
  id: string;
  slug: string;
  partner_one: string;
  partner_two: string;
  event_date: string;
  venue: string;
  couple_email: string;
  status: EventStatus;
  db_name: string;
  schema_version: number;
  migration_error: string | null;
  design: unknown;
  has_couple_code: boolean;
}

export interface NewEvent {
  partnerOne: string;
  partnerTwo: string;
  eventDate: string;
  venue: string;
  coupleEmail: string;
  photoLimit: number;
}

export const DEFAULT_MISSIONS = [
  "Foto com todos da sua mesa",
  "Beijo dos noivos",
  "Um brinde com os noivos",
  "Na pista de dança",
  "Selfie com alguém de quem gostes",
  "Um pai a enxugar uma lágrima",
  "A aliança mostrada com orgulho",
];

const SELECT_EVENT = central`
  id, slug, partner_one, partner_two, event_date::text AS event_date, venue,
  couple_email, status, db_name, schema_version, migration_error, design,
  couple_code_hash IS NOT NULL AS has_couple_code
`;
const DB_NAME = /^evt_[0-9a-f]{16}$/;
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const MAX_OPEN_POOLS = 50;

/** Os nomes de bases não aceitam parâmetros, por isso só passam nomes neste formato. */
function assertDbName(name: string): string {
  if (!DB_NAME.test(name)) throw new Error(`Nome de base inválido: ${name}`);
  return name;
}

function tenantPassword(dbName: string): string {
  return createHmac("sha256", config.appSecret).update(`tenant-db:${dbName}`).digest("hex");
}

export function tenantCredentials(dbName: string) {
  return {
    hostname: config.database.hostname,
    port: config.database.port,
    username: assertDbName(dbName),
    password: tenantPassword(dbName),
    database: dbName,
  };
}

const pools = new Map<string, SQL>();

/** Devolve a ligação do evento, feita com o utilizador exclusivo dessa base. */
export function eventDb(dbName: string): SQL {
  const existing = pools.get(dbName);
  if (existing) {
    pools.delete(dbName);
    pools.set(dbName, existing);
    return existing;
  }
  const pool = new SQL({ ...tenantCredentials(dbName), max: 3, idleTimeout: 60 });
  pools.set(dbName, pool);
  if (pools.size > MAX_OPEN_POOLS) {
    const oldest = pools.keys().next().value as string;
    void closeEventDb(oldest);
  }
  return pool;
}

async function closeEventDb(dbName: string): Promise<void> {
  const pool = pools.get(dbName);
  if (!pool) return;
  pools.delete(dbName);
  await pool.close();
}

function slugPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function buildSlug(partnerOne: string, partnerTwo: string): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return [slugPart(partnerOne), slugPart(partnerTwo), suffix].filter(Boolean).join("-");
}

async function dropEventDatabase(dbName: string): Promise<void> {
  assertDbName(dbName);
  await closeEventDb(dbName);
  await central.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await central.unsafe(`DROP ROLE IF EXISTS "${dbName}"`);
}

/** Cria a base do cliente, com utilizador próprio, estrutura e missões predefinidas. */
export async function createEvent(input: NewEvent): Promise<EventRecord> {
  const dbName = `evt_${randomBytes(8).toString("hex")}`;
  try {
    await central.unsafe(`CREATE ROLE "${dbName}" LOGIN PASSWORD '${tenantPassword(dbName)}'`);
    await central.unsafe(`CREATE DATABASE "${dbName}" OWNER "${dbName}"`);
    await central.unsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE "${dbName}" FROM PUBLIC`);

    const db = eventDb(dbName);
    const schemaVersion = await migrate(db, "event");
    await db.begin(async (tx) => {
      for (const [position, title] of DEFAULT_MISSIONS.entries()) {
        await tx`INSERT INTO missions (title, position, photo_limit) VALUES (${title}, ${position}, ${input.photoLimit})`;
      }
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = buildSlug(input.partnerOne, input.partnerTwo);
      const rows: EventRecord[] = await central`
        INSERT INTO events (slug, partner_one, partner_two, event_date, venue, couple_email, db_name, schema_version)
        VALUES (${slug}, ${input.partnerOne}, ${input.partnerTwo}, ${input.eventDate}::date,
                ${input.venue}, ${input.coupleEmail}, ${dbName}, ${schemaVersion})
        ON CONFLICT (slug) DO NOTHING
        RETURNING ${SELECT_EVENT}
      `;
      if (rows[0]) return rows[0];
    }
    throw new Error("Não foi possível gerar um link único");
  } catch (error) {
    await dropEventDatabase(dbName).catch((cleanupError) => {
      console.error(`Falha ao limpar ${dbName}`, cleanupError);
    });
    throw error;
  }
}

export async function listEvents(): Promise<EventRecord[]> {
  return central`SELECT ${SELECT_EVENT} FROM events ORDER BY event_date DESC, created_at DESC`;
}

export async function getEventById(id: string): Promise<EventRecord | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const rows: EventRecord[] = await central`SELECT ${SELECT_EVENT} FROM events WHERE id = ${id}::uuid`;
  return rows[0];
}

export async function getEventBySlug(slug: string): Promise<EventRecord | undefined> {
  const rows: EventRecord[] = await central`SELECT ${SELECT_EVENT} FROM events WHERE slug = ${slug}`;
  return rows[0];
}

export async function setEventStatus(id: string, status: EventStatus): Promise<void> {
  await central`UPDATE events SET status = ${status}, updated_at = now() WHERE id = ${id}::uuid`;
}

export function eventDesign(event: EventRecord): Design {
  return resolveDesign(event.design);
}

export async function saveEventDesign(id: string, design: Design): Promise<void> {
  await central`
    UPDATE events SET design = ${JSON.stringify(design)}::text::jsonb, updated_at = now() WHERE id = ${id}::uuid
  `;
}

/** Aplica o limite a todas as missões do evento. */
export async function setPhotoLimit(dbName: string, limit: number): Promise<void> {
  await eventDb(dbName)`UPDATE missions SET photo_limit = ${limit}`;
}

export interface RegisteredGuest {
  full_name: string;
  email: string;
  created_at: Date;
}

export async function listGuests(dbName: string): Promise<RegisteredGuest[]> {
  return eventDb(dbName)`SELECT full_name, email, created_at FROM guests ORDER BY created_at, id`;
}

export interface Mission {
  id: string;
  title: string;
  position: number;
  photo_limit: number;
  sent: number;
}

/** Lista as missões com o número de fotografias que este convidado já enviou. */
export async function listMissions(dbName: string, guestId: string): Promise<Mission[]> {
  return eventDb(dbName)`
    SELECT m.id, m.title, m.position, m.photo_limit,
           (SELECT count(*)::int FROM photos p WHERE p.mission_id = m.id AND p.guest_id = ${guestId}::uuid) AS sent
    FROM missions m WHERE m.active ORDER BY m.position
  `;
}

export async function deleteEvent(event: EventRecord): Promise<void> {
  await dropEventDatabase(event.db_name);
  await rm(join(config.storageDir, "events", event.id), { recursive: true, force: true });
  await central`DELETE FROM events WHERE id = ${event.id}::uuid`;
}

export interface EventStats {
  missions: number;
  guests: number;
  photos: number;
  photoLimit: number;
}

export async function getEventStats(dbName: string): Promise<EventStats> {
  const rows: EventStats[] = await eventDb(dbName)`
    SELECT (SELECT count(*)::int FROM missions) AS missions,
           (SELECT count(*)::int FROM guests) AS guests,
           (SELECT count(*)::int FROM photos) AS photos,
           (SELECT COALESCE(max(photo_limit), 3)::int FROM missions) AS "photoLimit"
  `;
  return rows[0]!;
}

/** Atualiza todas as bases; a falha de um cliente fica registada e não trava os outros. */
export async function migrateAllEvents(): Promise<void> {
  const rows: { id: string; db_name: string }[] = await central`SELECT id, db_name FROM events`;
  for (const { id, db_name } of rows) {
    try {
      const version = await migrate(eventDb(db_name), "event");
      await central`
        UPDATE events SET schema_version = ${version}, migration_error = NULL WHERE id = ${id}::uuid
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Falha ao migrar ${db_name}: ${message}`);
      await central`UPDATE events SET migration_error = ${message} WHERE id = ${id}::uuid`;
    }
  }
}

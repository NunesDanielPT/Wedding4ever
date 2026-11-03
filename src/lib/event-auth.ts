import { randomInt } from "node:crypto";
import { config } from "../config";
import { central } from "../db/central";
import { eventDb, type EventRecord } from "../db/events";
import { clearFailures, hashToken, isLoginLocked, newToken, readCookie, recordFailure } from "./auth";

const SESSION_DAYS = 30;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GUEST_COOKIE = "w4e_guest";
const COUPLE_COOKIE = "w4e_couple";

function expiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 86_400_000);
}

function cookie(name: string, path: string, value: string | null): string {
  const secure = config.secureCookies ? "; Secure" : "";
  const maxAge = value ? SESSION_DAYS * 86_400 : 0;
  return `${name}=${value ?? ""}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function guestCookie(slug: string, token: string): string {
  return cookie(GUEST_COOKIE, `/e/${slug}`, token);
}

export function coupleCookie(slug: string, token: string | null): string {
  return cookie(COUPLE_COOKIE, `/e/${slug}/noivos`, token);
}

/** Gera um novo código e termina as sessões abertas com o anterior. */
export async function generateCoupleCode(eventId: string): Promise<string> {
  let code = "";
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const hash = await Bun.password.hash(code);
  await central`UPDATE events SET couple_code_hash = ${hash}, updated_at = now() WHERE id = ${eventId}::uuid`;
  await central`DELETE FROM couple_sessions WHERE event_id = ${eventId}::uuid`;
  return code;
}

export function isCoupleLocked(event: EventRecord): boolean {
  return isLoginLocked(`couple:${event.id}`);
}

export async function loginCouple(event: EventRecord, email: string, code: string): Promise<string | null> {
  const key = `couple:${event.id}`;
  const rows: { couple_code_hash: string | null }[] = await central`
    SELECT couple_code_hash FROM events WHERE id = ${event.id}::uuid
  `;
  const hash = rows[0]?.couple_code_hash;
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, "");
  const valid = Boolean(hash) && (await Bun.password.verify(normalized, hash!));
  if (!valid || email.trim().toLowerCase() !== event.couple_email) {
    recordFailure(key);
    return null;
  }
  clearFailures(key);
  const token = newToken();
  await central`DELETE FROM couple_sessions WHERE expires_at < now()`;
  await central`
    INSERT INTO couple_sessions (token_hash, event_id, expires_at)
    VALUES (${hashToken(token)}, ${event.id}::uuid, ${expiry()})
  `;
  return token;
}

export async function isCoupleAuthenticated(req: Request, event: EventRecord): Promise<boolean> {
  const token = readCookie(req, COUPLE_COOKIE);
  if (!token) return false;
  const rows = await central`
    SELECT 1 FROM couple_sessions
    WHERE token_hash = ${hashToken(token)} AND event_id = ${event.id}::uuid AND expires_at > now()
  `;
  return rows.length > 0;
}

export async function logoutCouple(req: Request): Promise<void> {
  const token = readCookie(req, COUPLE_COOKIE);
  if (token) await central`DELETE FROM couple_sessions WHERE token_hash = ${hashToken(token)}`;
}

export interface Guest {
  id: string;
  full_name: string;
}

/** Regista o convidado ou reabre a sessão de quem volta com o mesmo e-mail. */
export async function joinGuest(event: EventRecord, name: string, email: string): Promise<string> {
  const db = eventDb(event.db_name);
  const [guest]: { id: string }[] = await db`
    INSERT INTO guests (full_name, email) VALUES (${name}, ${email})
    ON CONFLICT (lower(email)) DO UPDATE SET email = guests.email
    RETURNING id
  `;
  const token = newToken();
  await db`DELETE FROM guest_sessions WHERE expires_at < now()`;
  await db`
    INSERT INTO guest_sessions (token_hash, guest_id, expires_at)
    VALUES (${hashToken(token)}, ${guest!.id}::uuid, ${expiry()})
  `;
  return token;
}

export async function currentGuest(req: Request, event: EventRecord): Promise<Guest | undefined> {
  const token = readCookie(req, GUEST_COOKIE);
  if (!token) return undefined;
  const rows: Guest[] = await eventDb(event.db_name)`
    SELECT g.id, g.full_name FROM guest_sessions s JOIN guests g ON g.id = s.guest_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()
  `;
  return rows[0];
}

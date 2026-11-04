import { randomInt } from "node:crypto";
import { config } from "../config";
import { central } from "../db/central";
import { eventDb, type EventRecord } from "../db/events";
import { organizerHash } from "./organizers";
import { clearFailures, hashToken, isLoginLocked, newToken, readCookie, recordFailure } from "./auth";

const SESSION_DAYS = 30;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GUEST_COOKIE = "w4e_guest";
const CLIENT_COOKIE = "w4e_client";

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

export function clientCookie(token: string | null): string {
  return cookie(CLIENT_COOKIE, "/", token);
}

/** Gera um novo código e termina as sessões abertas desse cliente. */
export async function generateClientCode(event: EventRecord, options: { keepSessions?: boolean } = {}): Promise<string> {
  let code = "";
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const hash = await Bun.password.hash(code);
  await central`UPDATE events SET couple_code_hash = ${hash}, updated_at = now() WHERE id = ${event.id}::uuid`;
  if (!options.keepSessions) await central`DELETE FROM client_sessions WHERE email = ${event.couple_email}`;
  return code;
}

export function isClientLocked(email: string): boolean {
  return isLoginLocked(`client:${email.trim().toLowerCase()}`);
}

/** Aceita o código de qualquer evento deste e-mail; a sessão dá acesso a todos os eventos dele. */
export async function loginClient(emailInput: string, code: string): Promise<string | null> {
  const email = emailInput.trim().toLowerCase();
  const key = `client:${email}`;
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, "");
  const rows: { couple_code_hash: string }[] = await central`
    SELECT couple_code_hash FROM events WHERE couple_email = ${email} AND couple_code_hash IS NOT NULL
  `;
  const password = await organizerHash(email);
  let valid = password ? await Bun.password.verify(code, password) : false;
  for (const row of rows) {
    if (await Bun.password.verify(normalized, row.couple_code_hash)) valid = true;
  }
  if (!valid) {
    recordFailure(key);
    return null;
  }
  clearFailures(key);
  const token = newToken();
  await central`DELETE FROM client_sessions WHERE expires_at < now()`;
  await central`
    INSERT INTO client_sessions (token_hash, email, expires_at) VALUES (${hashToken(token)}, ${email}, ${expiry()})
  `;
  return token;
}

export async function currentClientEmail(req: Request): Promise<string | undefined> {
  const token = readCookie(req, CLIENT_COOKIE);
  if (!token) return undefined;
  const rows: { email: string }[] = await central`
    SELECT email FROM client_sessions WHERE token_hash = ${hashToken(token)} AND expires_at > now()
  `;
  return rows[0]?.email;
}

export async function logoutClient(req: Request): Promise<void> {
  const token = readCookie(req, CLIENT_COOKIE);
  if (token) await central`DELETE FROM client_sessions WHERE token_hash = ${hashToken(token)}`;
}

export interface Guest {
  id: string;
  full_name: string;
}

export class GuestLimitError extends Error {}

/** Regista o convidado dentro do limite do pack; quem já tem conta pode voltar sempre. */
export async function joinGuest(event: EventRecord, name: string, email: string): Promise<string> {
  const db = eventDb(event.db_name);
  const token = newToken();
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('guest-limit'))`;
    let rows: { id: string }[] = await tx`SELECT id FROM guests WHERE lower(email) = lower(${email})`;
    if (rows.length === 0) {
      if (event.guest_limit !== null) {
        const [row]: { count: number }[] = await tx`SELECT count(*)::int AS count FROM guests`;
        if (row!.count >= event.guest_limit) throw new GuestLimitError();
      }
      rows = await tx`INSERT INTO guests (full_name, email) VALUES (${name}, ${email}) RETURNING id`;
    }
    await tx`DELETE FROM guest_sessions WHERE expires_at < now()`;
    await tx`
      INSERT INTO guest_sessions (token_hash, guest_id, expires_at)
      VALUES (${hashToken(token)}, ${rows[0]!.id}::uuid, ${expiry()})
    `;
  });
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

import { createHash, randomBytes } from "node:crypto";
import { config } from "../config";
import { central } from "../db/central";

const COOKIE = "w4e_admin";
const SESSION_DAYS = 7;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, { count: number; resetAt: number }>();
const dummyHash = await Bun.password.hash(randomBytes(16).toString("hex"));

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function clearFailures(key: string): void {
  failures.delete(key);
}

export function isLoginLocked(email: string): boolean {
  const entry = failures.get(email);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failures.delete(email);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(email: string): void {
  const entry = failures.get(email);
  if (entry && entry.resetAt > Date.now()) entry.count++;
  else failures.set(email, { count: 1, resetAt: Date.now() + FAILURE_WINDOW_MS });
}

export async function ensureFirstAdmin(): Promise<void> {
  const [row]: { count: number }[] = await central`SELECT count(*)::int AS count FROM admins`;
  if (row!.count > 0) return;
  if (!config.adminEmail || config.adminPassword.length < 12) {
    throw new Error("Define ADMIN_EMAIL e ADMIN_PASSWORD (mínimo de 12 caracteres) no primeiro arranque");
  }
  const passwordHash = await Bun.password.hash(config.adminPassword);
  await central`
    INSERT INTO admins (email, password_hash) VALUES (${config.adminEmail}, ${passwordHash})
    ON CONFLICT (email) DO NOTHING
  `;
}

/** Valida o login e devolve o token da sessão. */
export async function login(emailInput: string, password: string): Promise<string | null> {
  const email = emailInput.trim().toLowerCase();
  const rows: { id: string; password_hash: string }[] = await central`
    SELECT id, password_hash FROM admins WHERE email = ${email}
  `;
  const admin = rows[0];
  const valid = await Bun.password.verify(password, admin?.password_hash ?? dummyHash);
  if (!admin || !valid) {
    recordFailure(email);
    return null;
  }
  failures.delete(email);
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await central`DELETE FROM admin_sessions WHERE expires_at < now()`;
  await central`
    INSERT INTO admin_sessions (token_hash, admin_id, expires_at)
    VALUES (${hashToken(token)}, ${admin.id}::uuid, ${expiresAt})
  `;
  return token;
}

export function readCookie(req: Request, cookie: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === cookie) return value;
  }
  return undefined;
}

function sessionToken(req: Request): string | undefined {
  return readCookie(req, COOKIE);
}

export async function isAuthenticated(req: Request): Promise<boolean> {
  const token = sessionToken(req);
  if (!token) return false;
  const rows = await central`
    SELECT 1 FROM admin_sessions WHERE token_hash = ${hashToken(token)} AND expires_at > now()
  `;
  return rows.length > 0;
}

export async function logout(req: Request): Promise<void> {
  const token = sessionToken(req);
  if (token) await central`DELETE FROM admin_sessions WHERE token_hash = ${hashToken(token)}`;
}

export function sessionCookie(token: string | null): string {
  const secure = config.secureCookies ? "; Secure" : "";
  const maxAge = token ? SESSION_DAYS * 86_400 : 0;
  return `${COOKIE}=${token ?? ""}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** Aceita formulários apenas quando vêm do próprio site. */
export function isSameOrigin(req: Request): boolean {
  return req.headers.get("origin") === config.publicUrl;
}

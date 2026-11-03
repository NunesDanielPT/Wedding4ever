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

/** Com ADMIN_RESET=true, repõe o acesso de ADMIN_EMAIL com ADMIN_PASSWORD no arranque. */
async function resetAdminFromEnvironment(): Promise<void> {
  if (!config.adminEmail || config.adminPassword.length < MIN_ADMIN_PASSWORD) {
    throw new Error("ADMIN_RESET precisa de ADMIN_EMAIL e de ADMIN_PASSWORD com pelo menos 12 caracteres");
  }
  const hash = await Bun.password.hash(config.adminPassword);
  await central`
    INSERT INTO admins (email, password_hash) VALUES (${config.adminEmail}, ${hash})
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `;
  console.log(`Acesso de administrador reposto para ${config.adminEmail}. Remove ADMIN_RESET da stack.`);
}

export async function ensureFirstAdmin(): Promise<void> {
  if (process.env.ADMIN_RESET === "true") return resetAdminFromEnvironment();
  const [row]: { count: number }[] = await central`SELECT count(*)::int AS count FROM admins`;
  if (row!.count > 0) return;
  if (!config.adminEmail || config.adminPassword.length < MIN_ADMIN_PASSWORD) {
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

/** Pode haver mais do que um cookie com este nome, de uma versão anterior com outro caminho. */
function sessionTokens(req: Request): string[] {
  return (req.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([name, value]) => name === COOKIE && value)
    .map(([, value]) => value!);
}

export async function currentAdminId(req: Request): Promise<string | undefined> {
  for (const token of sessionTokens(req)) {
    const rows: { admin_id: string }[] = await central`
      SELECT admin_id FROM admin_sessions WHERE token_hash = ${hashToken(token)} AND expires_at > now()
    `;
    if (rows[0]) return rows[0].admin_id;
  }
  return undefined;
}

export async function isAuthenticated(req: Request): Promise<boolean> {
  return (await currentAdminId(req)) !== undefined;
}

export async function logout(req: Request): Promise<void> {
  for (const token of sessionTokens(req)) {
    await central`DELETE FROM admin_sessions WHERE token_hash = ${hashToken(token)}`;
  }
}

export interface Admin {
  id: string;
  email: string;
}

export const MIN_ADMIN_PASSWORD = 12;

export async function listAdmins(): Promise<Admin[]> {
  return central`SELECT id, email FROM admins ORDER BY created_at, email`;
}

export async function addAdmin(email: string, password: string): Promise<boolean> {
  const hash = await Bun.password.hash(password);
  const rows = await central`
    INSERT INTO admins (email, password_hash) VALUES (${email}, ${hash})
    ON CONFLICT (email) DO NOTHING RETURNING id
  `;
  return rows.length > 0;
}

/** Muda a palavra-passe e termina as sessões abertas, exceto a de quem a mudou. */
export async function setAdminPassword(id: string, password: string, keepToken?: Request): Promise<void> {
  const hash = await Bun.password.hash(password);
  const keep = keepToken ? sessionTokens(keepToken).map(hashToken) : [];
  await central`UPDATE admins SET password_hash = ${hash} WHERE id = ${id}::uuid`;
  const sessions: { token_hash: string }[] = await central`SELECT token_hash FROM admin_sessions WHERE admin_id = ${id}::uuid`;
  for (const { token_hash } of sessions) {
    if (!keep.includes(token_hash)) await central`DELETE FROM admin_sessions WHERE token_hash = ${token_hash}`;
  }
}

export async function removeAdmin(id: string): Promise<void> {
  await central`DELETE FROM admins WHERE id = ${id}::uuid`;
}

export function sessionCookie(token: string | null): string {
  const secure = config.secureCookies ? "; Secure" : "";
  const maxAge = token ? SESSION_DAYS * 86_400 : 0;
  return `${COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** Aceita formulários apenas quando vêm do próprio site. */
export function isSameOrigin(req: Request): boolean {
  return req.headers.get("origin") === config.publicUrl;
}

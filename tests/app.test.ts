import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = new URL(process.env.TEST_POSTGRES_URL ?? "postgres://postgres:test@127.0.0.1:5432/postgres");
const TEST_DB = "w4e_test";
const ORIGIN = "http://w4e.test";
const maintenance = new SQL(server.href);
const storage = await mkdtemp(join(tmpdir(), "w4e-"));

async function removeLeftovers() {
  const roles: { rolname: string }[] = await maintenance`SELECT rolname FROM pg_roles WHERE rolname LIKE 'evt_%'`;
  for (const { rolname } of roles) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${rolname}" WITH (FORCE)`);
    await maintenance.unsafe(`DROP ROLE "${rolname}"`);
  }
  await maintenance.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
}

await removeLeftovers();
await maintenance.unsafe(`CREATE DATABASE ${TEST_DB}`);

const centralUrl = new URL(server.href);
centralUrl.pathname = `/${TEST_DB}`;
Object.assign(process.env, {
  PUBLIC_URL: ORIGIN,
  DATABASE_URL: centralUrl.href,
  APP_SECRET: "t".repeat(40),
  ADMIN_EMAIL: "admin@w4e.test",
  ADMIN_PASSWORD: "palavra-passe-de-teste",
  STORAGE_DIR: storage,
});

const { central } = await import("../src/db/central");
const { migrate } = await import("../src/db/migrate");
const events = await import("../src/db/events");
const { ensureFirstAdmin } = await import("../src/lib/auth");
const { handle } = await import("../src/server");

let cookie = "";

function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return handle(new Request(`${ORIGIN}${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", ...headers },
  }));
}

function get(path: string, withCookie = true) {
  return handle(new Request(`${ORIGIN}${path}`, { headers: withCookie ? { Cookie: cookie } : {} }));
}

const couple = {
  partnerOne: "João",
  partnerTwo: "Inês",
  eventDate: "2027-06-12",
  venue: "Quinta da Ribeira",
  coupleEmail: "noivos@exemplo.pt",
};

async function createClient(values = couple) {
  const response = await post("/admin/clientes", values);
  expect(response.status).toBe(303);
  const id = response.headers.get("location")!.split("/").pop()!;
  return (await events.getEventById(id))!;
}

beforeAll(async () => {
  await migrate(central, "central");
  await ensureFirstAdmin();
});

afterAll(async () => {
  await central.close();
  await removeLeftovers();
  await maintenance.close();
  await rm(storage, { recursive: true, force: true });
});

describe("acesso de administração", () => {
  test("rejeita a palavra-passe errada", async () => {
    const response = await post("/admin/entrar", { email: "admin@w4e.test", password: "errada" });
    expect(response.status).toBe(401);
  });

  test("protege o painel sem sessão", async () => {
    const response = await get("/admin", false);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/entrar");
    expect((await post("/admin/clientes", couple)).status).toBe(401);
  });

  test("inicia sessão com cookie protegido", async () => {
    const response = await post("/admin/entrar", { email: "ADMIN@w4e.test", password: "palavra-passe-de-teste" });
    expect(response.status).toBe(303);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    cookie = setCookie.split(";")[0]!;
    expect((await get("/admin")).status).toBe(200);
  });

  test("mantém a origem nos formulários do próprio site", async () => {
    const response = await get("/admin/entrar", false);
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
  });

  test("bloqueia pedidos vindos de outro site", async () => {
    const response = await post("/admin/clientes", couple, { Origin: "https://atacante.test" });
    expect(response.status).toBe(403);
    expect((await events.listEvents()).length).toBe(0);
  });
});

describe("criação de clientes", () => {
  test("valida o formulário", async () => {
    const response = await post("/admin/clientes", { ...couple, eventDate: "2027-02-31" });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("data válida");
  });

  test("cria base, missões, link, QR Code e PDF", async () => {
    const event = await createClient();
    expect(event.slug).toMatch(/^joao-ines-[a-z2-9]{6}$/);
    expect(event.schema_version).toBe(1);
    expect(event.status).toBe("rascunho");
    expect(await events.getEventStats(event.db_name)).toEqual({ missions: 7, guests: 0, photos: 0 });

    const qr = await get(`/admin/clientes/${event.id}/qr.svg`);
    expect(qr.headers.get("content-type")).toContain("image/svg+xml");
    const pdf = await get(`/admin/clientes/${event.id}/cartoes.pdf`);
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect((await get(`/admin/clientes/${event.id}/cartoes.pdf`, false)).status).toBe(303);

    const guest = await get(`/e/${event.slug}`, false);
    expect(guest.status).toBe(200);
    expect(await guest.text()).toContain("João &amp; Inês");
  });

  test("escapa conteúdo introduzido nos nomes", async () => {
    const event = await createClient({ ...couple, partnerOne: "<script>alert(1)</script>" });
    const body = await (await get(`/admin/clientes/${event.id}`)).text();
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  test("devolve 404 para links inexistentes", async () => {
    expect((await get("/e/nao-existe", false)).status).toBe(404);
  });
});

describe("isolamento entre clientes", () => {
  test("cada utilizador só entra na sua base", async () => {
    const a = await createClient();
    const b = await createClient();

    await events.eventDb(a.db_name)`INSERT INTO guests (full_name, email) VALUES ('Só em A', 'a@exemplo.pt')`;
    expect((await events.getEventStats(a.db_name)).guests).toBe(1);
    expect((await events.getEventStats(b.db_name)).guests).toBe(0);

    const intruder = new SQL({ ...events.tenantCredentials(a.db_name), database: b.db_name, connectionTimeout: 5 });
    await expect(intruder`SELECT 1`).rejects.toThrow(/permission denied/);
    await intruder.close().catch(() => {});

    const toCentral = new SQL({ ...events.tenantCredentials(a.db_name), database: TEST_DB, connectionTimeout: 5 });
    await expect(toCentral`SELECT slug FROM events`).rejects.toThrow(/permission denied/);
    await toCentral.close().catch(() => {});

    const toPostgres = new SQL({ ...events.tenantCredentials(a.db_name), database: "postgres", connectionTimeout: 5 });
    await expect(toPostgres`SELECT 1`).rejects.toThrow(/permission denied/);
    await toPostgres.close().catch(() => {});
  });
});

describe("ciclo de vida", () => {
  test("muda o estado e recusa estados inválidos", async () => {
    const event = await createClient();
    expect((await post(`/admin/clientes/${event.id}/estado`, { status: "votacao" })).status).toBe(303);
    expect((await events.getEventById(event.id))!.status).toBe("votacao");
    expect((await post(`/admin/clientes/${event.id}/estado`, { status: "fim" })).status).toBe(422);
  });

  test("repetir as migrações não altera nada", async () => {
    const event = await createClient();
    await events.migrateAllEvents();
    const after = (await events.getEventById(event.id))!;
    expect(after.schema_version).toBe(1);
    expect(after.migration_error).toBeNull();
    expect((await events.getEventStats(event.db_name)).missions).toBe(7);
  });

  test("só apaga com confirmação e remove base e utilizador", async () => {
    const event = await createClient();
    const refused = await post(`/admin/clientes/${event.id}/apagar`, { confirm: "outra-coisa" });
    expect(refused.status).toBe(422);
    expect(await events.getEventById(event.id)).toBeDefined();

    expect((await post(`/admin/clientes/${event.id}/apagar`, { confirm: event.slug })).status).toBe(303);
    expect(await events.getEventById(event.id)).toBeUndefined();
    expect((await maintenance`SELECT 1 FROM pg_database WHERE datname = ${event.db_name}`).length).toBe(0);
    expect((await maintenance`SELECT 1 FROM pg_roles WHERE rolname = ${event.db_name}`).length).toBe(0);
  });
});

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
    expect(event.schema_version).toBe(4);
    expect(event.status).toBe("rascunho");
    expect(await events.getEventStats(event.db_name)).toEqual({ missions: 7, guests: 0, photos: 0, photoLimit: 3 });

    const qr = await get(`/admin/clientes/${event.id}/qr.svg`);
    expect(qr.headers.get("content-type")).toContain("image/svg+xml");
    const pdf = await get(`/admin/clientes/${event.id}/cartoes.pdf`);
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect((await get(`/admin/clientes/${event.id}/cartoes.pdf`, false)).status).toBe(303);

    const guest = await get(`/e/${event.slug}`, false);
    expect(guest.status).toBe(200);
    const guestBody = await guest.text();
    expect(guestBody).toContain("João &amp; Inês");
    expect(guestBody).toContain('name="email"');
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
    expect(after.schema_version).toBe(4);
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

const PNG_1X1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

function postMultipart(path: string, form: FormData) {
  return handle(new Request(`${ORIGIN}${path}`, { method: "POST", body: form, headers: { Origin: ORIGIN, Cookie: cookie } }));
}

function designForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = {
    headline: "A nossa batalha", instructions: "Lê o código", backgroundColor: "#FFFFFF", textColor: "#222222",
    accentColor: "#556B2F", qrColor: "#000000", qrBackground: "#FFFFFF", ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

describe("personalização", () => {
  test("guarda cores, textos e imagens e usa-os nas saídas", async () => {
    const event = await createClient();
    const form = designForm();
    form.set("backgroundFile", new File([PNG_1X1], "fundo.png", { type: "image/png" }));
    const saved = await postMultipart(`/admin/clientes/${event.id}/personalizar`, form);
    expect(saved.status).toBe(303);

    const theme = await (await get(`/e/${event.slug}/tema.css`, false)).text();
    expect(theme).toContain("--t-accent:#556B2F");
    expect(theme).toContain("media/background");
    expect((await get(`/e/${event.slug}/media/background`, false)).headers.get("content-type")).toBe("image/png");
    expect(await (await get(`/admin/clientes/${event.id}/qr.svg`)).text()).toContain('fill="#000000"');

    const pdf = new TextDecoder("latin1").decode(await (await get(`/admin/clientes/${event.id}/cartoes.pdf`)).arrayBuffer());
    expect(pdf).toContain("/Subtype /Image");
    const png = new Uint8Array(await (await get(`/admin/clientes/${event.id}/qr.png`)).arrayBuffer());
    expect([...png.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  test("recusa um QR Code ilegível e ficheiros que não são imagens", async () => {
    const event = await createClient();
    expect((await postMultipart(`/admin/clientes/${event.id}/personalizar`, designForm({ qrColor: "#FFFFFF", qrBackground: "#000000" }))).status).toBe(422);
    const form = designForm();
    form.set("logoFile", new File(["<script>"], "logo.png", { type: "image/png" }));
    expect((await postMultipart(`/admin/clientes/${event.id}/personalizar`, form)).status).toBe(422);
  });
});

describe("convidados", () => {
  test("exige nome e e-mail e mantém a sessão no regresso", async () => {
    const event = await createClient();
    await events.setEventStatus(event.id, "aberto");
    expect((await post(`/e/${event.slug}/entrar`, { name: "", email: "x" })).status).toBe(422);

    const joined = await post(`/e/${event.slug}/entrar`, { name: "Rita Sousa", email: "Rita@Exemplo.pt" }, { Cookie: "" });
    expect(joined.status).toBe(303);
    const guestCookie = cookieOf(joined);
    const home = await handle(new Request(`${ORIGIN}/e/${event.slug}`, { headers: { Cookie: guestCookie } }));
    const body = await home.text();
    expect(body).toContain("Olá, Rita Sousa");
    expect(body).toContain("Na pista de dança");

    await post(`/e/${event.slug}/entrar`, { name: "Outro Nome", email: "rita@exemplo.pt" }, { Cookie: "" });
    expect((await events.getEventStats(event.db_name)).guests).toBe(1);

    const other = await createClient();
    const elsewhere = await handle(new Request(`${ORIGIN}/e/${other.slug}`, { headers: { Cookie: guestCookie } }));
    expect(await elsewhere.text()).toContain('name="email"');
  });
});


describe("definições", () => {
  test("aplica o limite predefinido aos novos clientes e permite ajustar cada um", async () => {
    expect((await post("/admin/definicoes/fotos", { photoLimit: "51" })).status).toBe(422);
    expect((await post("/admin/definicoes/fotos", { photoLimit: "1" })).status).toBe(200);
    const event = await createClient();
    expect((await events.getEventStats(event.db_name)).photoLimit).toBe(1);

    await events.setEventStatus(event.id, "aberto");
    const joined = await post(`/e/${event.slug}/entrar`, { name: "Ana Reis", email: "ana@exemplo.pt" }, { Cookie: "" });
    const page = await handle(new Request(`${ORIGIN}/e/${event.slug}`, { headers: { Cookie: cookieOf(joined) } }));
    expect(await page.text()).toContain("0/1");

    expect((await post(`/admin/clientes/${event.id}/limite-fotos`, { photoLimit: "2" })).status).toBe(303);
    expect((await events.getEventStats(event.db_name)).photoLimit).toBe(2);
    await post("/admin/definicoes/fotos", { photoLimit: "3" });
  });

  test("guarda o e-mail desligado e nunca devolve a palavra-passe", async () => {
    const page = await get("/admin/definicoes");
    expect(await page.text()).toContain("Desligado.");

    const fields = {
      host: "smtp.exemplo.pt", port: "587", security: "starttls", username: "conta",
      password: "segredo-muito-forte", fromName: "Wedding4Ever", fromAddress: "ola@exemplo.pt",
    };
    expect((await post("/admin/definicoes/email", { ...fields, enabled: "on" })).status).toBe(200);
    expect((await post("/admin/definicoes/email", { ...fields, password: "", enabled: "on" })).status).toBe(200);

    const { getSettings } = await import("../src/lib/settings");
    const { decryptSecret } = await import("../src/lib/secret");
    const { email } = await getSettings();
    expect(email.enabled).toBe(true);
    expect(email.passwordEncrypted).not.toContain("segredo");
    expect(decryptSecret(email.passwordEncrypted)).toBe("segredo-muito-forte");
    const body = await (await get("/admin/definicoes")).text();
    expect(body).not.toContain("segredo-muito-forte");
    expect(body).not.toContain(email.passwordEncrypted);

    await post("/admin/definicoes/email", { ...fields, password: "" });
    expect((await getSettings()).email.enabled).toBe(false);
  });
});

describe("envio de e-mail", () => {
  async function selfSigned() {
    const dir = join(storage, "cert");
    await Bun.spawn(["mkdir", "-p", dir]).exited;
    await Bun.spawn(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/k.pem`, "-out", `${dir}/c.pem`, "-days", "1", "-subj", "/CN=localhost"], { stderr: "ignore" }).exited;
    return { key: await Bun.file(`${dir}/k.pem`).text(), cert: await Bun.file(`${dir}/c.pem`).text() };
  }

  /** Servidor SMTP mínimo, com a mesma sequência de comandos de um fornecedor real. */
  function smtpServer(credentials: { key: string; cert: string }, implicitTls: boolean) {
    const received: string[] = [];
    const net = require("node:net");
    const tls = require("node:tls");
    const serve = (socket: any, secure: boolean) => {
      let inData = false;
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("error", () => {});
      socket.write("220 teste\r\n");
      const onData = (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          received.push(line);
          if (inData) {
            if (line === ".") { inData = false; socket.write("250 aceite\r\n"); }
          } else if (line.startsWith("EHLO")) {
            socket.write(`250-teste\r\n${secure ? "" : "250-STARTTLS\r\n"}250 AUTH PLAIN\r\n`);
          } else if (line === "STARTTLS") {
            socket.off("data", onData);
            socket.write("220 pronto\r\n", () => {
              const upgraded = new tls.TLSSocket(socket, { isServer: true, ...credentials });
              upgraded.once("secure", () => {});
              upgradedServe(upgraded);
            });
          } else if (line.startsWith("AUTH")) socket.write("235 ok\r\n");
          else if (line === "DATA") { inData = true; socket.write("354 envia\r\n"); }
          else if (line === "QUIT") { socket.write("221 adeus\r\n"); socket.end(); }
          else socket.write("250 ok\r\n");
        }
      };
      socket.on("data", onData);
    };
    const upgradedServe = (socket: any) => {
      let inData = false;
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("error", () => {});
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          received.push(line);
          if (inData) {
            if (line === ".") { inData = false; socket.write("250 aceite\r\n"); }
          } else if (line.startsWith("EHLO")) socket.write("250-teste\r\n250 AUTH PLAIN\r\n");
          else if (line.startsWith("AUTH")) socket.write("235 ok\r\n");
          else if (line === "DATA") { inData = true; socket.write("354 envia\r\n"); }
          else if (line === "QUIT") { socket.write("221 adeus\r\n"); socket.end(); }
          else socket.write("250 ok\r\n");
        }
      });
    };
    const server = implicitTls
      ? tls.createServer(credentials, (socket: any) => serve(socket, true))
      : net.createServer((socket: any) => serve(socket, false));
    return new Promise<{ server: any; port: number; received: string[] }>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, received }));
    });
  }

  test.each(["tls", "starttls"] as const)("entrega uma mensagem por %s", async (security) => {
    const { sendMail } = await import("../src/lib/mail");
    const { encryptSecret } = await import("../src/lib/secret");
    const smtp = await smtpServer(await selfSigned(), security === "tls");
    await sendMail(
      {
        enabled: true, host: "127.0.0.1", port: smtp.port, security, username: "conta",
        passwordEncrypted: encryptSecret("chave"), fromName: "Wedding4Ever", fromAddress: "ola@exemplo.pt",
      },
      { to: "ana@exemplo.pt", subject: "Olá João\r\nBcc: x@y.z", text: "Mensagem" },
      { rejectUnauthorized: false },
    );
    smtp.server.close();
    expect(smtp.received).toContain("RCPT TO:<ana@exemplo.pt>");
    expect(smtp.received.some((line) => line.startsWith("Subject: =?UTF-8?B?"))).toBe(true);
    expect(smtp.received).not.toContain("Bcc: x@y.z");
  });
});

const { setMissionPhase } = await import("../src/lib/missions");

describe("missões de cada cliente", () => {
  test("cria, edita, ordena e apaga sem mínimo nem máximo", async () => {
    const event = await createClient();
    const base = `/admin/clientes/${event.id}/missoes`;
    const list = () => events.eventDb(event.db_name)`SELECT id, title, photo_limit, phase FROM missions ORDER BY position`;

    for (const mission of await list()) expect((await post(`${base}/${mission.id}/apagar`, {})).status).toBe(303);
    expect(await list()).toHaveLength(0);
    expect(await (await get(base)).text()).toContain("ainda não tem missões");
    const home = await post(`/e/${event.slug}/entrar`, { name: "Sem Missões", email: "s@exemplo.pt" }, { Cookie: "" });
    await events.setEventStatus(event.id, "aberto");
    const empty = await handle(new Request(`${ORIGIN}/e/${event.slug}`, { headers: { Cookie: cookieOf(home) } }));
    expect(await empty.text()).toContain("Ainda não há missões");

    for (let i = 0; i < 12; i++) expect((await post(base, { title: `Missão ${i}` })).status).toBe(303);
    expect(await list()).toHaveLength(12);
    expect((await post(base, { title: "" })).status).toBe(422);

    const [first, second] = await list();
    const saved = await post(`${base}/${second.id}/guardar`, { title: "Nova missão", photoLimit: "5", phase: "votacao" });
    expect(saved.status).toBe(303);
    await post(`${base}/${second.id}/subir`, {});
    const reordered = await list();
    expect(reordered[0]).toMatchObject({ id: second.id, title: "Nova missão", photo_limit: 5, phase: "votacao" });
    expect(reordered[1].id).toBe(first.id);
  });

  test("exige confirmação para apagar uma missão com fotografias", async () => {
    const event = await createClient();
    await events.setEventStatus(event.id, "aberto");
    const opened = (await events.getEventById(event.id))!;
    const [mission] = await events.eventDb(opened.db_name)`SELECT id FROM missions ORDER BY position LIMIT 1`;
    const guest = cookieOf(await post(`/e/${event.slug}/entrar`, { name: "Foto", email: "j@exemplo.pt" }, { Cookie: "" }));
    const form = new FormData();
    form.set("photo", new File([PNG_1X1], "a.png", { type: "image/png" }));
    await handle(new Request(`${ORIGIN}/e/${event.slug}/missoes/${mission.id}/fotos`, { method: "POST", body: form, headers: { Origin: ORIGIN, Cookie: guest } }));

    const base = `/admin/clientes/${event.id}/missoes/${mission.id}/apagar`;
    expect((await post(base, {})).status).toBe(422);
    expect((await post(base, { confirm: "on" })).status).toBe(303);
    expect((await events.getEventStats(opened.db_name)).photos).toBe(0);
  });

});

describe("envio de fotografias", () => {
  async function openEvent(limit: number) {
    const event = await createClient();
    await events.setEventStatus(event.id, "aberto");
    await events.setPhotoLimit(event.db_name, limit);
    const opened = (await events.getEventById(event.id))!;
    const [mission] = await events.eventDb(opened.db_name)`SELECT id FROM missions ORDER BY position LIMIT 1`;
    return { event: opened, missionId: mission.id as string };
  }

  async function join(slug: string, email: string) {
    return cookieOf(await post(`/e/${slug}/entrar`, { name: `Pessoa ${email[0]}`, email }, { Cookie: "" }));
  }

  function upload(event: { slug: string }, missionId: string, guest: string, bytes: Uint8Array, caption = "") {
    const form = new FormData();
    form.set("photo", new File([bytes], "foto.jpg", { type: "image/jpeg" }));
    form.set("caption", caption);
    return handle(new Request(`${ORIGIN}/e/${event.slug}/missoes/${missionId}/fotos`, {
      method: "POST", body: form, headers: { Origin: ORIGIN, Cookie: guest },
    }));
  }

  function guestGet(path: string, guest: string) {
    return handle(new Request(`${ORIGIN}${path}`, { headers: { Cookie: guest } }));
  }

  test("aplica o limite, mostra a galeria e gera a miniatura", async () => {
    const { event, missionId } = await openEvent(1);
    const guest = await join(event.slug, "a@exemplo.pt");
    expect((await upload(event, missionId, guest, PNG_1X1, "<b>Linda</b>")).status).toBe(303);

    const second = await upload(event, missionId, guest, PNG_1X1);
    expect(second.status).toBe(422);
    expect(await second.text()).toContain("limite");

    const page = await (await guestGet(`/e/${event.slug}/missoes/${missionId}`, guest)).text();
    expect(page).toContain("1/1");
    expect(page).toContain("Limite atingido");
    expect(page).toContain("&lt;b&gt;Linda&lt;/b&gt;");

    const [photo] = await events.eventDb(event.db_name)`SELECT id FROM photos`;
    let status = "pending";
    for (let i = 0; i < 50 && status === "pending"; i++) {
      await Bun.sleep(100);
      [{ preview_status: status }] = await events.eventDb(event.db_name)`SELECT preview_status FROM photos`;
    }
    expect(status).toBe("ready");
    const preview = await guestGet(`/e/${event.slug}/fotos/${photo.id}/preview`, guest);
    expect(preview.headers.get("content-type")).toBe("image/jpeg");
    expect((await get(`/e/${event.slug}/fotos/${photo.id}/preview`, false)).status).toBe(303);
  });

  test("recusa vídeos e ficheiros disfarçados, e aceita HEIC pelo conteúdo", async () => {
    const { detectPhoto } = await import("../src/lib/photos");
    const box = (brand: string) => new TextEncoder().encode(`\0\0\0\x18ftyp${brand}\0\0\0\0`);
    expect(detectPhoto(box("isom"))).toBeUndefined();
    expect(detectPhoto(box("qt  "))).toBeUndefined();
    expect(detectPhoto(box("heic"))).toBe("heic");

    const { event, missionId } = await openEvent(3);
    const guest = await join(event.slug, "b@exemplo.pt");
    const video = await upload(event, missionId, guest, box("mp42"));
    expect(video.status).toBe(422);
    expect(await video.text()).toContain("JPG, PNG ou HEIC");
    expect((await events.getEventStats(event.db_name)).photos).toBe(0);
  });

  test("só deixa enviar com a batalha aberta e só o autor apaga", async () => {
    const { event, missionId } = await openEvent(1);
    const owner = await join(event.slug, "c@exemplo.pt");
    const other = await join(event.slug, "d@exemplo.pt");
    await upload(event, missionId, owner, PNG_1X1);
    const [photo] = await events.eventDb(event.db_name)`SELECT id FROM photos`;

    const remove = (guest: string) => post(`/e/${event.slug}/fotos/${photo.id}/apagar`, {}, { Cookie: guest });
    expect((await remove(other)).status).toBe(404);
    expect((await events.getEventStats(event.db_name)).photos).toBe(1);
    expect((await remove(owner)).status).toBe(303);
    expect((await events.getEventStats(event.db_name)).photos).toBe(0);

    await events.applyEventStatus(event, "votacao");
    expect((await upload(event, missionId, owner, PNG_1X1)).status).toBe(409);
  });

  async function readyPhoto(event: { db_name: string }, count: number) {
    for (let i = 0; i < 60; i++) {
      const rows = await events.eventDb(event.db_name)`SELECT id FROM photos WHERE preview_status = 'ready'`;
      if (rows.length >= count) return rows;
      await Bun.sleep(100);
    }
    throw new Error("As miniaturas não ficaram prontas");
  }

  test("esconde as fotos dos outros até a missão entrar em votação", async () => {
    const { event, missionId } = await openEvent(1);
    const owner = await join(event.slug, "e@exemplo.pt");
    const other = await join(event.slug, "f@exemplo.pt");
    await upload(event, missionId, owner, PNG_1X1, "A minha legenda");
    const [photo] = await readyPhoto(event, 1);

    expect((await guestGet(`/e/${event.slug}/fotos/${photo.id}/thumb`, owner)).status).toBe(200);
    expect((await guestGet(`/e/${event.slug}/fotos/${photo.id}/thumb`, other)).status).toBe(404);
    expect((await guestGet(`/e/${event.slug}/fotos/${photo.id}/preview`, other)).status).toBe(404);
    expect(await (await guestGet(`/e/${event.slug}/missoes/${missionId}`, other)).text()).not.toContain("A minha legenda");

    await setMissionPhase(event.db_name, missionId, "votacao");
    expect((await guestGet(`/e/${event.slug}/fotos/${photo.id}/thumb`, other)).status).toBe(200);
    expect(await (await guestGet(`/e/${event.slug}/missoes/${missionId}`, other)).text()).toContain("A minha legenda");
  });

  test("vota por missão, sem autovoto, com troca de voto e vencedora no fim", async () => {
    const { event, missionId } = await openEvent(1);
    const [secondMission] = await events.eventDb(event.db_name)`SELECT id FROM missions WHERE id <> ${missionId}::uuid ORDER BY position LIMIT 1`;
    const a = await join(event.slug, "g@exemplo.pt");
    const b = await join(event.slug, "h@exemplo.pt");
    const c = await join(event.slug, "i@exemplo.pt");
    await upload(event, missionId, a, PNG_1X1);
    await upload(event, missionId, b, PNG_1X1);
    await upload(event, secondMission.id, a, PNG_1X1);
    await readyPhoto(event, 3);
    const rows = await events.eventDb(event.db_name)`
      SELECT p.id, g.email FROM photos p JOIN guests g ON g.id = p.guest_id
      WHERE p.mission_id = ${missionId}::uuid
    `;
    const photoA = rows.find((row: { email: string }) => row.email.startsWith("g"))!.id;
    const photoB = rows.find((row: { email: string }) => row.email.startsWith("h"))!.id;
    const vote = (guest: string, photo: string) => post(`/e/${event.slug}/fotos/${photo}/votar`, {}, { Cookie: guest });

    expect((await vote(c, photoA)).status).toBe(422);
    await setMissionPhase(event.db_name, missionId, "votacao");
    expect((await vote(a, photoA)).status).toBe(422);
    expect((await vote(c, photoA)).status).toBe(303);
    expect((await vote(c, photoB)).status).toBe(303);
    expect((await vote(a, photoB)).status).toBe(303);
    const [{ count }] = await events.eventDb(event.db_name)`SELECT count(*)::int AS count FROM votes`;
    expect(count).toBe(2);

    const stillOpen = await (await guestGet(`/e/${event.slug}/missoes/${secondMission.id}`, b)).text();
    expect(stillOpen).toContain("Enviar fotografia");
    expect(await (await guestGet(`/e/${event.slug}/missoes/${missionId}`, c)).text()).not.toContain("2 votos");

    await setMissionPhase(event.db_name, missionId, "encerrada");
    expect((await vote(b, photoA)).status).toBe(422);
    const results = await (await guestGet(`/e/${event.slug}/missoes/${missionId}`, c)).text();
    expect(results).toContain("Vencedora");
    expect(results).toContain("2 votos");
  });
});

describe("lista de convidados", () => {
  test("mostra convidados numerados por ordem de criação", async () => {
    const event = await createClient();
    await post(`/e/${event.slug}/entrar`, { name: "Primeira Pessoa", email: "primeira@exemplo.pt" }, { Cookie: "" });
    await Bun.sleep(5);
    await post(`/e/${event.slug}/entrar`, { name: "Segunda <b>", email: "segunda@exemplo.pt" }, { Cookie: "" });

    const adminPage = await (await get(`/admin/clientes/${event.id}`)).text();
    expect(adminPage.indexOf("primeira@exemplo.pt")).toBeLessThan(adminPage.indexOf("segunda@exemplo.pt"));
    expect(adminPage).toMatch(/guest-number">1<[\s\S]*Primeira Pessoa[\s\S]*guest-number">2</);
    expect(adminPage).toContain("Segunda &lt;b&gt;");

    expect(await (await get(`/e/${event.slug}`, false)).text()).not.toContain("segunda@exemplo.pt");
  });
});

describe("site público", () => {
  test("mostra a página de venda sem secções vazias e permite indexação", async () => {
    const response = await get("/", false);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
    const body = await response.text();
    expect(body).toContain("Até 100 convidados");
    expect(body).toContain("Sob consulta");
    expect(body).toContain("Área de cliente");
    expect(body).not.toContain("O que dizem os noivos");
  });

  test("o painel altera textos, packs, testemunhos e imagens", async () => {
    const before = await (await get("/admin/site")).text();
    expect(before).toContain("Guardar textos");
    const { getSite } = await import("../src/lib/site");
    const site = await getSite();

    const texts = new FormData();
    for (const [key, value] of Object.entries(site.texts)) if (key !== "heroImage") texts.set(key, value);
    texts.set("heroTitle", "Título novo <b>");
    texts.set("heroImage", new File([PNG_1X1], "h.png", { type: "image/png" }));
    expect((await postMultipart("/admin/site/textos", texts)).status).toBe(303);

    const testimonial = new FormData();
    testimonial.set("text", "Foi a melhor parte da festa");
    testimonial.set("author", "Cliente Real");
    expect((await postMultipart("/admin/site/testimonials", testimonial)).status).toBe(303);

    const pack = (await getSite()).packs[0]!;
    const edited = new FormData();
    edited.set("name", "Pack Editado");
    edited.set("guests", "Até 80 convidados");
    edited.set("price", "199 €");
    edited.set("features", "Linha um\nLinha dois");
    expect((await postMultipart(`/admin/site/packs/${pack.id}/guardar`, edited)).status).toBe(303);

    const bad = new FormData();
    bad.set("title", "Anúncio");
    bad.set("url", "javascript:alert(1)");
    expect((await postMultipart("/admin/site/ads", bad)).status).toBe(422);

    const body = await (await get("/", false)).text();
    expect(body).toContain("Título novo &lt;b&gt;");
    expect(body).toContain("Foi a melhor parte da festa");
    expect(body).toContain("199 €");
    const image = (await getSite()).texts.heroImage;
    expect((await get(`/media/site/${image}`, false)).headers.get("content-type")).toBe("image/png");
    expect((await post("/admin/site/textos", {}, { Cookie: "" })).status).toBe(401);
  });

  test("recebe mensagens de suporte no painel e trava abusos", async () => {
    const send = (fields: Record<string, string>) => post("/suporte", fields, { Cookie: "", "X-Real-IP": "10.0.0.9" });
    const valid = { name: "Maria", email: "maria@exemplo.pt", message: "Quero saber mais sobre os packs" };
    expect((await send({ ...valid, email: "x" })).status).toBe(422);
    expect((await send({ ...valid, website: "spam" })).status).toBe(303);
    expect(await (await get("/admin/mensagens")).text()).not.toContain("maria@exemplo.pt");

    expect((await send(valid)).status).toBe(303);
    const inbox = await (await get("/admin/mensagens")).text();
    expect(inbox).toContain("maria@exemplo.pt");
    expect(inbox).toContain("message-unread");
    expect(await (await get("/admin")).text()).toContain("1 mensagem por ler");

    const id = inbox.match(/mensagens\/([0-9a-f-]{36})\/lida/)![1];
    await post(`/admin/mensagens/${id}/lida`, {});
    expect(await (await get("/admin/mensagens")).text()).not.toContain("message-unread");
    await post(`/admin/mensagens/${id}/apagar`, {});
    expect(await (await get("/admin/mensagens")).text()).toContain("Ainda não recebeste");

    for (let i = 0; i < 5; i++) await send(valid);
    expect((await send(valid)).status).toBe(422);
    expect((await get("/admin/mensagens", false)).status).toBe(303);
  });
});

describe("área de cliente", () => {
  async function clientEvent(email = "produtora@exemplo.pt") {
    const event = await createClient({ ...couple, coupleEmail: email });
    const page = await (await post(`/admin/clientes/${event.id}/codigo-noivos`, {})).text();
    const code = page.match(/Código de acesso: <strong>([A-Z2-9]{10})</)![1]!;
    return { event: (await events.getEventById(event.id))!, code };
  }

  async function login(email: string, code: string) {
    const response = await post("/entrar", { email, code }, { Cookie: "" });
    expect(response.status).toBe(303);
    return cookieOf(response);
  }

  const asClient = (path: string, session: string) => handle(new Request(`${ORIGIN}${path}`, { headers: { Cookie: session } }));

  test("uma produtora vê os seus eventos e não os de outros", async () => {
    const first = await clientEvent();
    const second = await createClient({ ...couple, partnerOne: "Marta", coupleEmail: "produtora@exemplo.pt" });
    const other = await clientEvent("outra@exemplo.pt");
    expect((await post("/entrar", { email: "produtora@exemplo.pt", code: "ERRADO" }, { Cookie: "" })).status).toBe(401);

    const session = await login("PRODUTORA@exemplo.pt", first.code.toLowerCase());
    const list = await (await asClient("/cliente", session)).text();
    expect(list).toContain(`/cliente/eventos/${first.event.id}`);
    expect(list).toContain(`/cliente/eventos/${second.id}`);
    expect(list).not.toContain(other.event.id);
    expect((await asClient(`/cliente/eventos/${other.event.id}`, session)).status).toBe(303);
    expect((await asClient(`/cliente/eventos/${other.event.id}/fotos.zip`, session)).status).toBe(303);
    expect((await asClient(`/cliente/eventos/${first.event.id}`, session)).status).toBe(200);
    expect((await get(`/cliente/eventos/${other.event.id}`)).status).toBe(200);
    expect((await get("/e/x-y-z/noivos", false)).status).toBe(404);

    await post(`/admin/clientes/${first.event.id}/codigo-noivos`, {});
    expect((await asClient("/cliente", session)).status).toBe(303);
  });

  test("gere missões, personaliza, vê a galeria, descarrega o ZIP e revela vencedores", async () => {
    const { event, code } = await clientEvent("noivos@exemplo.pt");
    await events.setEventStatus(event.id, "aberto");
    const session = await login("noivos@exemplo.pt", code);
    const [mission] = await events.eventDb(event.db_name)`SELECT id FROM missions ORDER BY position LIMIT 1`;
    const a = cookieOf(await post(`/e/${event.slug}/entrar`, { name: "Rita/Sousa", email: "r@exemplo.pt" }, { Cookie: "" }));
    const b = cookieOf(await post(`/e/${event.slug}/entrar`, { name: "Luís", email: "l@exemplo.pt" }, { Cookie: "" }));
    const form = new FormData();
    form.set("photo", new File([PNG_1X1], "a.png", { type: "image/png" }));
    await handle(new Request(`${ORIGIN}/e/${event.slug}/missoes/${mission.id}/fotos`, { method: "POST", body: form, headers: { Origin: ORIGIN, Cookie: a } }));
    let photo: { id: string } | undefined;
    for (let i = 0; i < 60 && !photo; i++) {
      [photo] = await events.eventDb(event.db_name)`SELECT id FROM photos WHERE preview_status = 'ready'`;
      if (!photo) await Bun.sleep(100);
    }

    const base = `/cliente/eventos/${event.id}`;
    expect(await (await asClient(`${base}/galeria`, session)).text()).toContain(`${base}/fotos/${photo!.id}/thumb`);
    expect((await asClient(`${base}/fotos/${photo!.id}/preview`, session)).status).toBe(200);
    expect((await asClient(`${base}/qr.png`, session)).headers.get("content-type")).toBe("image/png");
    expect((await asClient(`${base}/personalizar`, session)).status).toBe(200);
    const design = designForm({ headline: "Título do cliente" });
    const saved = await handle(new Request(`${ORIGIN}${base}/personalizar`, { method: "POST", body: design, headers: { Origin: ORIGIN, Cookie: session } }));
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(`${base}/personalizar`);

    const zipResponse = await asClient(`${base}/fotos.zip`, session);
    expect(zipResponse.headers.get("content-type")).toBe("application/zip");
    const zipPath = join(storage, "album.zip");
    await Bun.write(zipPath, await zipResponse.arrayBuffer());
    const listing = Bun.spawnSync(["python3", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(z.namelist())", zipPath]);
    const output = listing.stdout.toString();
    expect(output).toContain("None");
    expect(output).toContain("Rita Sousa.png");
    expect(output).toContain("Foto com todos da sua mesa/");

    const phase = (value: string) => post(`${base}/missoes/${mission.id}/fase`, { phase: value }, { Cookie: session });
    expect((await phase("votacao")).status).toBe(303);
    expect((await post(`/e/${event.slug}/fotos/${photo!.id}/votar`, {}, { Cookie: b })).status).toBe(303);
    expect((await phase("encerrada")).status).toBe(303);

    const winners = await (await asClient(`${base}/vencedores`, session)).text();
    expect(winners).toContain("WINNER");
    expect(winners).toContain("Rita/Sousa");
    expect(await (await asClient(`/e/${event.slug}`, b)).text()).toContain("Ver os vencedores");
    expect(await (await asClient(`/e/${event.slug}/vencedores`, b)).text()).toContain("WINNER");
  });

  test("o ZIP com mais de 4 GB usa o formato ZIP64", async () => {
    const { zipStream } = await import("../src/lib/zip");
    const source = join(storage, "zip64.bin");
    await Bun.write(source, "conteúdo de teste");
    const path = join(storage, "zip64.zip");
    await Bun.write(path, await new Response(zipStream([{ name: "a/foto ç.jpg", path: source }, { name: "b.jpg", path: source }], 0)).arrayBuffer());
    const check = Bun.spawnSync(["python3", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip(), len(z.namelist()), z.read('a/foto ç.jpg').decode())", path]);
    expect(check.stdout.toString().trim()).toBe("None 2 conteúdo de teste");
  });
});

describe("packs dos clientes", () => {
  test("aplica o limite do pack, deixa voltar quem já entrou e permite mudar de pack", async () => {
    const { getSite, saveSite } = await import("../src/lib/site");
    const site = await getSite();
    const pack = site.packs[0]!;
    await saveSite({ ...site, packs: site.packs.map((item) => (item.id === pack.id ? { ...item, maxGuests: "2" } : item)) });
    expect(await (await get("/admin/clientes/novo")).text()).toContain("Pack contratado");

    const created = await post("/admin/clientes", { ...couple, packId: pack.id });
    const id = created.headers.get("location")!.split("/").pop()!;
    const event = (await events.getEventById(id))!;
    expect(event.guest_limit).toBe(2);
    expect(event.pack_name).toContain(pack.name);
    expect((await post("/admin/clientes", { ...couple, packId: "inexistente" })).status).toBe(422);

    const join = (email: string) => post(`/e/${event.slug}/entrar`, { name: "Convidado Teste", email }, { Cookie: "" });
    expect((await join("um@exemplo.pt")).status).toBe(303);
    expect((await join("dois@exemplo.pt")).status).toBe(303);
    const blocked = await join("tres@exemplo.pt");
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toContain("número máximo de convidados");
    expect((await join("UM@exemplo.pt")).status).toBe(303);
    expect((await events.getEventStats(event.db_name)).guests).toBe(2);
    expect(await (await get(`/admin/clientes/${id}`)).text()).toContain("O limite foi atingido");

    const results = await Promise.all(["a1", "a2", "a3"].map((name) => join(`${name}@exemplo.pt`)));
    expect(results.every((result) => result.status === 409)).toBe(true);

    expect((await post(`/admin/clientes/${id}/pack`, { packId: "atual", guestLimit: "3" })).status).toBe(303);
    const updated = (await events.getEventById(id))!;
    expect(updated.guest_limit).toBe(3);
    expect((await post(`/e/${event.slug}/entrar`, { name: "Convidado Teste", email: "tres@exemplo.pt" }, { Cookie: "" })).status).toBe(303);
    expect((await post(`/admin/clientes/${id}/pack`, { packId: "", guestLimit: "" })).status).toBe(303);
    expect((await events.getEventById(id))!.guest_limit).toBeNull();
    await saveSite(site);
  });
});

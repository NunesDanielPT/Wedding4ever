import { join } from "node:path";
import { config } from "./config";
import { central } from "./db/central";
import {
  createEvent,
  deleteEvent,
  EVENT_STATUSES,
  eventDesign,
  getEventById,
  getEventStats,
  listEvents,
  listGuests,
  applyEventStatus,
  setPhotoLimit,
  type EventRecord,
  type EventStatus,
} from "./db/events";
import { isAuthenticated, isLoginLocked, isSameOrigin, login, logout, sessionCookie } from "./lib/auth";
import { cardsPdfResponse, qrPngResponse, qrSvgResponse } from "./lib/event-assets";
import { generateClientCode } from "./lib/event-auth";
import { sendMail } from "./lib/mail";
import {
  addMission,
  deleteMission,
  listAdminMissions,
  MAX_TITLE_LENGTH,
  MISSION_PHASES,
  moveMission,
  updateMission,
  type MissionPhase,
} from "./lib/missions";
import { getSettings, parsePhotoLimit, saveDefaultPhotoLimit, saveEmailSettings, type SmtpSecurity } from "./lib/settings";
import { countUnreadMessages } from "./lib/site";
import { handleSiteAdmin } from "./routes/admin-site";
import { handleClient } from "./routes/client";
import { handleDesign } from "./routes/design";
import { handleEvent } from "./routes/event";
import { handleSite } from "./routes/site";
import { field, htmlResponse, isEmail, notFound, redirect } from "./routes/http";
import * as admin from "./views/admin";

const PUBLIC_DIR = join(import.meta.dir, "public");
const STATIC_FILES: Record<string, string> = {
  "/static/style.css": "style.css",
  "/static/favicon.svg": "favicon.svg",
  "/static/gallery.js": "gallery.js",
  "/static/site.css": "site.css",
};
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function validateEvent(values: Required<admin.EventForm>): string | undefined {
  if (!values.partnerOne || !values.partnerTwo) return "Preenche o nome dos dois noivos.";
  if (values.partnerOne.length > 60 || values.partnerTwo.length > 60) return "Cada nome pode ter até 60 caracteres.";
  if (!isRealDate(values.eventDate)) return "Indica uma data válida para o casamento.";
  if (values.venue.length > 120) return "O local pode ter até 120 caracteres.";
  if (!isEmail(values.coupleEmail)) return "Indica um e-mail válido para os noivos.";
  return undefined;
}

async function eventDetail(id: string, error?: string, status = 200, coupleCode?: string): Promise<Response> {
  const event = await getEventById(id);
  if (!event) return notFound();
  const [stats, guests] = await Promise.all([getEventStats(event.db_name), listGuests(event.db_name)]).catch((cause) => {
    console.error(`Base ${event.db_name} indisponível`, cause);
    return [null, []];
  });
  return htmlResponse(admin.eventPage(event, stats, guests, error, coupleCode), status);
}


async function missionsPage(event: EventRecord, error?: string, status = 200): Promise<Response> {
  return htmlResponse(admin.missionsPage(event, await listAdminMissions(event.db_name), error), status);
}

async function handleMissions(req: Request, event: EventRecord, action: string): Promise<Response> {
  const back = redirect(`/admin/clientes/${event.id}/missoes`);
  if (action === "missoes") {
    if (req.method === "GET") return missionsPage(event);
    if (req.method !== "POST") return notFound();
    const title = field(await req.formData(), "title");
    if (!title || title.length > MAX_TITLE_LENGTH) {
      return missionsPage(event, `O nome da missão tem de ter entre 1 e ${MAX_TITLE_LENGTH} caracteres.`, 422);
    }
    await addMission(event.db_name, title, (await getSettings()).defaultPhotoLimit);
    return back;
  }

  const match = action.match(/^missoes\/([0-9a-f-]{36})\/(guardar|subir|descer|apagar)$/);
  if (!match || req.method !== "POST") return notFound();
  const [, missionId, operation] = match as unknown as [string, string, string];

  if (operation === "subir" || operation === "descer") {
    await moveMission(event.db_name, missionId, operation === "subir" ? -1 : 1);
    return back;
  }
  const form = await req.formData();
  if (operation === "apagar") {
    const mission = (await listAdminMissions(event.db_name)).find((item) => item.id === missionId);
    if (!mission) return notFound();
    if (mission.photos > 0 && !form.get("confirm")) {
      return missionsPage(event, "Confirma que queres apagar a missão e as fotografias dela.", 422);
    }
    await deleteMission(event, missionId);
    return back;
  }

  const title = field(form, "title");
  const limit = parsePhotoLimit(field(form, "photoLimit"));
  const phase = field(form, "phase") as MissionPhase;
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return missionsPage(event, `O nome da missão tem de ter entre 1 e ${MAX_TITLE_LENGTH} caracteres.`, 422);
  }
  if (!limit) return missionsPage(event, "Escolhe um limite de fotografias entre 1 e 50.", 422);
  if (!MISSION_PHASES.includes(phase)) return missionsPage(event, "Escolhe uma fase válida.", 422);
  await updateMission(event.db_name, missionId, title, limit, phase);
  return back;
}

function emailInput(form: FormData) {
  return {
    enabled: form.get("enabled") !== null,
    host: field(form, "host"),
    port: Number(field(form, "port")),
    security: (field(form, "security") === "tls" ? "tls" : "starttls") as SmtpSecurity,
    username: field(form, "username"),
    password: String(form.get("password") ?? ""),
    fromName: field(form, "fromName"),
    fromAddress: field(form, "fromAddress").toLowerCase(),
  };
}

function validateEmailSettings(input: ReturnType<typeof emailInput>): string | undefined {
  if (!input.enabled && !input.host && !input.fromAddress) return undefined;
  if (!/^[a-zA-Z0-9.-]+$/.test(input.host)) return "Indica o servidor SMTP.";
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) return "Indica uma porta válida.";
  if (!isEmail(input.fromAddress)) return "Indica um e-mail de envio válido.";
  if (input.username.length > 200 || input.fromName.length > 100) return "Encurta o utilizador ou o nome de envio.";
  return undefined;
}

async function settingsPage(notice?: admin.SettingsNotice, status = 200): Promise<Response> {
  return htmlResponse(admin.settingsPage(await getSettings(), config.adminEmail, notice), status);
}

async function handleSettings(req: Request, path: string): Promise<Response> {
  if (path === "/admin/definicoes" && req.method === "GET") return settingsPage();
  if (req.method !== "POST") return notFound();
  const form = await req.formData();

  if (path === "/admin/definicoes/fotos") {
    const limit = parsePhotoLimit(field(form, "photoLimit"));
    if (!limit) return settingsPage({ error: "Escolhe um limite de fotografias entre 1 e 50." }, 422);
    await saveDefaultPhotoLimit(limit);
    return settingsPage({ success: "Limite predefinido guardado. Aplica-se aos novos clientes." });
  }

  if (path === "/admin/definicoes/email") {
    const input = emailInput(form);
    const error = validateEmailSettings(input);
    if (error) return settingsPage({ error }, 422);
    await saveEmailSettings(input);
    return settingsPage({ success: "Serviço de e-mail guardado." });
  }

  if (path === "/admin/definicoes/email/testar") {
    const to = field(form, "to").toLowerCase();
    const { email } = await getSettings();
    if (!isEmail(to)) return settingsPage({ error: "Indica um e-mail válido para o teste." }, 422);
    if (!email.host || !email.fromAddress) return settingsPage({ error: "Guarda primeiro os dados do serviço de e-mail." }, 422);
    try {
      await sendMail(email, {
        to,
        subject: "Teste do Wedding4Ever",
        text: "Este e-mail confirma que o serviço de e-mail está a funcionar.",
      });
      return settingsPage({ success: `E-mail de teste enviado para ${to}.` });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return settingsPage({ error: `O teste falhou: ${message}` }, 502);
    }
  }
  return notFound();
}

async function handleAdminLogin(req: Request): Promise<Response> {
  if (req.method === "GET") {
    if (await isAuthenticated(req)) return redirect("/admin");
    return htmlResponse(admin.loginPage());
  }
  const form = await req.formData();
  const email = field(form, "email").toLowerCase();
  if (isLoginLocked(email)) {
    return htmlResponse(admin.loginPage("Demasiadas tentativas. Tenta novamente daqui a 15 minutos."), 429);
  }
  const token = await login(email, String(form.get("password") ?? ""));
  if (!token) return htmlResponse(admin.loginPage("O e-mail ou a palavra-passe estão incorretos."), 401);
  return redirect("/admin", { "Set-Cookie": sessionCookie(token) });
}

async function handleAdmin(req: Request, path: string): Promise<Response> {
  if (path === "/admin/entrar") {
    if (req.method !== "GET" && req.method !== "POST") return new Response(null, { status: 405 });
    return handleAdminLogin(req);
  }
  if (!(await isAuthenticated(req))) {
    return req.method === "GET" ? redirect("/admin/entrar") : new Response(null, { status: 401 });
  }

  if (path === "/admin/sair" && req.method === "POST") {
    await logout(req);
    return redirect("/admin/entrar", { "Set-Cookie": sessionCookie(null) });
  }
  if (path === "/admin/definicoes" || path.startsWith("/admin/definicoes/")) return handleSettings(req, path);
  if (path === "/admin/site" || path.startsWith("/admin/site/") || path === "/admin/mensagens" || path.startsWith("/admin/mensagens/")) {
    return handleSiteAdmin(req, path);
  }
  if (path === "/admin" && req.method === "GET") {
    return htmlResponse(admin.dashboardPage(await listEvents(), await countUnreadMessages()));
  }
  if (path === "/admin/clientes/novo" && req.method === "GET") return htmlResponse(admin.newEventPage());

  if (path === "/admin/clientes" && req.method === "POST") {
    const form = await req.formData();
    const values = {
      partnerOne: field(form, "partnerOne"),
      partnerTwo: field(form, "partnerTwo"),
      eventDate: field(form, "eventDate"),
      venue: field(form, "venue"),
      coupleEmail: field(form, "coupleEmail").toLowerCase(),
    };
    const error = validateEvent(values);
    if (error) return htmlResponse(admin.newEventPage(values, error), 422);
    try {
      const { defaultPhotoLimit } = await getSettings();
      const event = await createEvent({ ...values, photoLimit: defaultPhotoLimit });
      return redirect(`/admin/clientes/${event.id}`);
    } catch (cause) {
      console.error("Falha ao criar cliente", cause);
      return htmlResponse(admin.newEventPage(values, "Não foi possível criar o cliente. Confirma a ligação ao PostgreSQL e tenta novamente."), 500);
    }
  }

  const match = path.match(/^\/admin\/clientes\/([0-9a-f-]{36})(?:\/([a-z0-9./-]+))?$/);
  if (!match) return notFound();
  const [, id, action] = match as unknown as [string, string, string | undefined];

  if (!action && req.method === "GET") return eventDetail(id);

  if (req.method === "GET" && action && ["qr.svg", "qr.png", "cartoes.pdf", "personalizar"].includes(action)) {
    const event = await getEventById(id);
    if (!event) return notFound();
    if (action === "qr.svg") return qrSvgResponse(event);
    if (action === "qr.png") return qrPngResponse(event);
    if (action === "cartoes.pdf") return cardsPdfResponse(event);
    return htmlResponse(admin.designPage(event, eventDesign(event)));
  }

  if (action === "personalizar" && req.method === "POST") {
    const event = await getEventById(id);
    return event ? handleDesign(req, event, { base: `/admin/clientes/${event.id}`, back: `/admin/clientes/${event.id}` }) : notFound();
  }

  if (action === "limite-fotos" && req.method === "POST") {
    const event = await getEventById(id);
    if (!event) return notFound();
    const limit = parsePhotoLimit(field(await req.formData(), "photoLimit"));
    if (!limit) return eventDetail(id, "Escolhe um limite de fotografias entre 1 e 50.", 422);
    await setPhotoLimit(event.db_name, limit);
    return redirect(`/admin/clientes/${id}/missoes`);
  }

  if (action === "missoes" || action?.startsWith("missoes/")) {
    const event = await getEventById(id);
    return event ? handleMissions(req, event, action) : notFound();
  }

  if (action === "codigo-noivos" && req.method === "POST") {
    const event = await getEventById(id);
    return event ? eventDetail(id, undefined, 200, await generateClientCode(event)) : notFound();
  }

  if (action === "estado" && req.method === "POST") {
    const status = field(await req.formData(), "status");
    if (!EVENT_STATUSES.includes(status as EventStatus)) return eventDetail(id, "Escolhe um estado válido.", 422);
    const event = await getEventById(id);
    if (!event) return notFound();
    await applyEventStatus(event, status as EventStatus);
    return redirect(`/admin/clientes/${id}`);
  }

  if (action === "apagar" && req.method === "POST") {
    const event = await getEventById(id);
    if (!event) return notFound();
    if (field(await req.formData(), "confirm") !== event.slug) {
      return eventDetail(id, "O texto de confirmação não coincide. O cliente não foi apagado.", 422);
    }
    await deleteEvent(event);
    return redirect("/admin");
  }

  return notFound();
}

async function route(req: Request): Promise<Response> {
  const { pathname: path } = new URL(req.url);

  if (req.method === "POST" && !isSameOrigin(req)) return new Response("Origem não permitida", { status: 403 });

  if (path === "/healthz") {
    await central`SELECT 1`;
    return Response.json({ ok: true });
  }

  const staticFile = STATIC_FILES[path];
  if (staticFile) {
    return new Response(Bun.file(join(PUBLIC_DIR, staticFile)), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(req, path);

  return (await handleSite(req, path)) ?? (await handleClient(req, path)) ?? (await handleEvent(req, path)) ?? notFound();
}

export async function handle(req: Request): Promise<Response> {
  let response: Response;
  try {
    response = await route(req);
  } catch (cause) {
    console.error(`Erro em ${req.method} ${new URL(req.url).pathname}`, cause);
    response = new Response("Ocorreu um erro interno.", { status: 500 });
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  if (new URL(req.url).pathname === "/") response.headers.delete("X-Robots-Tag");
  return response;
}

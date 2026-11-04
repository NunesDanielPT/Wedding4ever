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
  setEventPack,
  type EventRecord,
  type EventStatus,
} from "./db/events";
import {
  addAdmin,
  currentAdminId,
  isAuthenticated,
  isLoginLocked,
  isSameOrigin,
  listAdmins,
  login,
  logout,
  MIN_ADMIN_PASSWORD,
  removeAdmin,
  sessionCookie,
  setAdminPassword,
} from "./lib/auth";
import { cardsPdfResponse, qrPngResponse, qrSvgResponse } from "./lib/event-assets";
import { readEventForm } from "./routes/event-form";
import { handleAdminOps } from "./routes/admin-ops";
import { handleMissions } from "./routes/missions";
import { listOrganizers } from "./lib/organizers";
import { generateClientCode } from "./lib/event-auth";
import { sendMail } from "./lib/mail";
import { getSettings, parsePhotoLimit, saveBrandName, saveDefaultPhotoLimit, saveEmailSettings, saveRetentionDays, type SmtpSecurity } from "./lib/settings";
import { countUnreadMessages, getSite, type SiteItem } from "./lib/site";
import { handleSiteAdmin } from "./routes/admin-site";
import { handleClient } from "./routes/client";
import { handleDesign } from "./routes/design";
import { handleEvent } from "./routes/event";
import { handleSite } from "./routes/site";
import { field, htmlResponse, isEmail, notFound, redirect } from "./routes/http";
import { brand } from "./lib/brand";
import { listEmailLog, queueEventEmails, sendEventEmails } from "./lib/event-emails";
import { archiveEvent } from "./lib/stats";
import * as admin from "./views/admin";

const VERSION = "2026-11-04-winner-hero";
const PUBLIC_DIR = join(import.meta.dir, "public");
const STATIC_FILES: Record<string, string> = {
  "/static/style.css": "style.css",
  "/static/favicon.svg": "favicon.svg",
  "/static/gallery.js": "gallery.js",
  "/static/nav.js": "nav.js",
  "/static/live.js": "live.js",
  "/static/install.js": "install.js",
  "/static/icon-192.png": "icon-192.png",
  "/static/icon-512.png": "icon-512.png",
  "/static/apple-touch-icon.png": "apple-touch-icon.png",
  "/sw.js": "sw.js",
  "/static/design.js": "design.js",
  "/static/site.css": "site.css",
};
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' blob:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

function packGuestLimit(pack: SiteItem | undefined): number | null {
  return pack?.maxGuests ? Number(pack.maxGuests) : null;
}

function parseGuestLimit(value: string): number | null | undefined {
  if (!value) return null;
  return /^[1-9]\d{0,5}$/.test(value) ? Number(value) : undefined;
}

async function eventDetail(id: string, error?: string, status = 200, coupleCode?: string): Promise<Response> {
  const event = await getEventById(id);
  if (!event) return notFound();
  const [stats, guests] = await Promise.all([getEventStats(event.db_name), listGuests(event.db_name)]).catch((cause) => {
    console.error(`Base ${event.db_name} indisponível`, cause);
    return [null, []];
  });
  const [{ retentionDays }, emails] = await Promise.all([getSettings(), listEmailLog(id)]);
  return htmlResponse(admin.eventPage(event, stats, guests, (await getSite()).packs, error, coupleCode, retentionDays, emails), status);
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

async function settingsPage(req: Request, notice?: admin.SettingsNotice, status = 200): Promise<Response> {
  const [settings, admins, adminId] = await Promise.all([getSettings(), listAdmins(), currentAdminId(req)]);
  return htmlResponse(admin.settingsPage(settings, config.adminEmail, admins, adminId, notice), status);
}

async function handleAdmins(req: Request, path: string, form: FormData): Promise<Response> {
  const shortPassword = `A palavra-passe tem de ter pelo menos ${MIN_ADMIN_PASSWORD} caracteres.`;
  const password = String(form.get("password") ?? "");
  if (path === "/admin/definicoes/administradores") {
    const email = field(form, "email").toLowerCase();
    if (!isEmail(email)) return settingsPage(req, { error: "Indica um e-mail válido." }, 422);
    if (password.length < MIN_ADMIN_PASSWORD) return settingsPage(req, { error: shortPassword }, 422);
    if (!(await addAdmin(email, password))) return settingsPage(req, { error: "Esse e-mail já é administrador." }, 422);
    return settingsPage(req, { success: `Administrador ${email} adicionado.` });
  }
  const match = path.match(/^\/admin\/definicoes\/administradores\/([0-9a-f-]{36})\/(palavra-passe|apagar)$/);
  if (!match) return notFound();
  const [, id, operation] = match as unknown as [string, string, string];
  const admins = await listAdmins();
  const target = admins.find((item) => item.id === id);
  if (!target) return notFound();
  const self = id === (await currentAdminId(req));
  if (operation === "apagar") {
    if (self) return settingsPage(req, { error: "Não podes remover a tua própria conta." }, 422);
    await removeAdmin(id);
    return settingsPage(req, { success: `Administrador ${target.email} removido.` });
  }
  if (password.length < MIN_ADMIN_PASSWORD) return settingsPage(req, { error: shortPassword }, 422);
  await setAdminPassword(id, password, self ? req : undefined);
  return settingsPage(req, { success: `Palavra-passe de ${target.email} alterada.` });
}

async function handleSettings(req: Request, path: string): Promise<Response> {
  if (path === "/admin/definicoes" && req.method === "GET") return settingsPage(req);
  if (req.method !== "POST") return notFound();
  const form = await req.formData();
  if (path.startsWith("/admin/definicoes/administradores")) return handleAdmins(req, path, form);

  if (path === "/admin/definicoes/marca") {
    const name = field(form, "brandName");
    if (name.length < 2 || name.length > 60) return settingsPage(req, { error: "O nome tem de ter entre 2 e 60 caracteres." }, 422);
    await saveBrandName(name);
    return settingsPage(req, { success: "Nome da plataforma guardado." });
  }

  if (path === "/admin/definicoes/prazo") {
    const days = Number(field(form, "retentionDays"));
    if (!Number.isInteger(days) || days < 1 || days > 365) return settingsPage(req, { error: "Escolhe um prazo entre 1 e 365 dias." }, 422);
    await saveRetentionDays(days);
    return settingsPage(req, { success: "Prazo guardado." });
  }

  if (path === "/admin/definicoes/fotos") {
    const limit = parsePhotoLimit(field(form, "photoLimit"));
    if (!limit) return settingsPage(req, { error: "Escolhe um limite de fotografias entre 1 e 50." }, 422);
    await saveDefaultPhotoLimit(limit);
    return settingsPage(req, { success: "Limite predefinido guardado. Aplica-se aos novos clientes." });
  }

  if (path === "/admin/definicoes/email") {
    const input = emailInput(form);
    const error = validateEmailSettings(input);
    if (error) return settingsPage(req, { error }, 422);
    await saveEmailSettings(input);
    return settingsPage(req, { success: "Serviço de e-mail guardado." });
  }

  if (path === "/admin/definicoes/email/testar") {
    const to = field(form, "to").toLowerCase();
    const { email } = await getSettings();
    if (!isEmail(to)) return settingsPage(req, { error: "Indica um e-mail válido para o teste." }, 422);
    if (!email.host || !email.fromAddress) return settingsPage(req, { error: "Guarda primeiro os dados do serviço de e-mail." }, 422);
    try {
      await sendMail(email, {
        to,
        subject: `Teste de ${brand()}`,
        text: "Este e-mail confirma que o serviço de e-mail está a funcionar.",
      });
      return settingsPage(req, { success: `E-mail de teste enviado para ${to}.` });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return settingsPage(req, { error: `O teste falhou: ${message}` }, 502);
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
  if (path === "/admin/estatisticas" || path === "/admin/organizadores" || path.startsWith("/admin/organizadores/") || path === "/admin/emails" || path.startsWith("/admin/emails/")) {
    return handleAdminOps(req, path);
  }
  if (path === "/admin/site" || path.startsWith("/admin/site/") || path === "/admin/mensagens" || path.startsWith("/admin/mensagens/")) {
    return handleSiteAdmin(req, path);
  }
  if (path === "/admin" && req.method === "GET") {
    return htmlResponse(admin.dashboardPage(await listEvents(), await countUnreadMessages(), (await getSettings()).retentionDays));
  }
  if (path === "/admin/clientes/novo" && req.method === "GET") {
    return htmlResponse(admin.newEventPage((await getSite()).packs, {}, undefined, { action: "/admin/clientes", back: "/admin", organizers: await listOrganizers() }));
  }

  if (path === "/admin/clientes" && req.method === "POST") {
    const form = await req.formData();
    const { packs } = await getSite();
    const organizers = await listOrganizers();
    const parsed = readEventForm(form, packs);
    const organizerId = field(form, "organizerId");
    const validOrganizer = !organizerId || organizers.some((item) => item.id === organizerId);
    const context = { action: "/admin/clientes", back: "/admin", organizers };
    const values = { ...parsed.values, packId: parsed.packId, organizerId };
    const error = parsed.error ?? (validOrganizer ? undefined : "Escolhe um organizador válido.");
    if (error) return htmlResponse(admin.newEventPage(packs, values, error, context), 422);
    try {
      const { defaultPhotoLimit } = await getSettings();
      const event = await createEvent({
        ...parsed.values,
        organizerId: organizerId || null,
        photoLimit: defaultPhotoLimit,
        packName: parsed.packName,
        guestLimit: parsed.guestLimit,
      });
      queueEventEmails(event);
      return redirect(`/admin/clientes/${event.id}`);
    } catch (cause) {
      console.error("Falha ao criar evento", cause);
      return htmlResponse(admin.newEventPage(packs, values, "Não foi possível criar o evento. Confirma a ligação ao PostgreSQL e tenta novamente.", context), 500);
    }
  }

  const match = path.match(/^\/admin\/clientes\/([0-9a-f-]{36})(?:\/([a-z0-9./-]+))?$/);
  if (!match) return notFound();
  const [, id, action] = match as unknown as [string, string, string | undefined];

  if (!action && req.method === "GET") return eventDetail(id);

  if (req.method === "GET" && action && ["qr.svg", "qr.png", "cartoes.pdf", "personalizar"].includes(action)) {
    const event = await getEventById(id);
    if (!event) return notFound();
    const url = new URL(req.url);
    if (action === "qr.svg") return qrSvgResponse(event, url);
    if (action === "qr.png") return qrPngResponse(event);
    if (action === "cartoes.pdf") return cardsPdfResponse(event);
    return htmlResponse(admin.designPage(event, eventDesign(event), undefined, undefined, url.searchParams.has("guardado")));
  }

  if (action === "personalizar" && req.method === "POST") {
    const event = await getEventById(id);
    return event ? handleDesign(req, event, { base: `/admin/clientes/${event.id}`, back: `/admin/clientes/${event.id}` }) : notFound();
  }

  if (action === "missoes" || action?.startsWith("missoes/")) {
    const event = await getEventById(id);
    return event ? handleMissions(req, event, action, { base: `/admin/clientes/${id}`, back: `/admin/clientes/${id}` }) : notFound();
  }

  if (action === "pack" && req.method === "POST") {
    const event = await getEventById(id);
    if (!event) return notFound();
    const form = await req.formData();
    const packId = field(form, "packId");
    const pack = (await getSite()).packs.find((item) => item.id === packId);
    if (packId && packId !== "atual" && !pack) return eventDetail(id, "Escolhe um pack válido.", 422);
    const custom = parseGuestLimit(field(form, "guestLimit"));
    if (custom === undefined) return eventDetail(id, "O limite de convidados tem de ser um número inteiro.", 422);
    const changed = packId !== "atual";
    const name = changed ? (pack ? `${pack.name} (${pack.guests})` : "") : event.pack_name;
    await setEventPack(id, name, changed ? packGuestLimit(pack) : custom);
    return redirect(`/admin/clientes/${id}`);
  }

  if (action === "emails/enviar" && req.method === "POST") {
    const event = await getEventById(id);
    if (!event) return notFound();
    await sendEventEmails(event);
    return redirect(`/admin/clientes/${id}`);
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
    await archiveEvent(event);
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
    return Response.json({ ok: true, version: VERSION });
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

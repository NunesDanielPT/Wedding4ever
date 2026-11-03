import { join } from "node:path";
import { config } from "./config";
import { central } from "./db/central";
import {
  createEvent,
  deleteEvent,
  EVENT_STATUSES,
  getEventById,
  getEventBySlug,
  getEventStats,
  listEvents,
  setEventStatus,
  type EventStatus,
} from "./db/events";
import { isAuthenticated, isLoginLocked, isSameOrigin, login, logout, sessionCookie } from "./lib/auth";
import { coupleNames, formatDate } from "./lib/format";
import { tableCardsPdf } from "./lib/pdf";
import { createQr, qrSvg } from "./lib/qr";
import * as admin from "./views/admin";
import { eventLandingPage, notFoundPage } from "./views/public";

const PUBLIC_DIR = join(import.meta.dir, "public");
const STATIC_FILES: Record<string, string> = {
  "/static/style.css": "style.css",
  "/static/favicon.svg": "favicon.svg",
};
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...headers } });
}

function notFound(): Response {
  return htmlResponse(notFoundPage(), 404);
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

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
  if (values.coupleEmail.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.coupleEmail)) {
    return "Indica um e-mail válido para os noivos.";
  }
  return undefined;
}

async function eventDetail(id: string, error?: string, status = 200): Promise<Response> {
  const event = await getEventById(id);
  if (!event) return notFound();
  const stats = await getEventStats(event.db_name).catch((cause) => {
    console.error(`Base ${event.db_name} indisponível`, cause);
    return null;
  });
  return htmlResponse(admin.eventPage(event, stats, error), status);
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
  if (path === "/admin" && req.method === "GET") return htmlResponse(admin.dashboardPage(await listEvents()));
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
      const event = await createEvent(values);
      return redirect(`/admin/clientes/${event.id}`);
    } catch (cause) {
      console.error("Falha ao criar cliente", cause);
      return htmlResponse(admin.newEventPage(values, "Não foi possível criar o cliente. Confirma a ligação ao PostgreSQL e tenta novamente."), 500);
    }
  }

  const match = path.match(/^\/admin\/clientes\/([0-9a-f-]{36})(?:\/([a-z.]+))?$/);
  if (!match) return notFound();
  const [, id, action] = match as unknown as [string, string, string | undefined];

  if (!action && req.method === "GET") return eventDetail(id);

  if (action === "qr.svg" && req.method === "GET") {
    const event = await getEventById(id);
    if (!event) return notFound();
    return new Response(qrSvg(createQr(`${config.publicUrl}/e/${event.slug}`)), {
      headers: { "Content-Type": "image/svg+xml" },
    });
  }

  if (action === "cartoes.pdf" && req.method === "GET") {
    const event = await getEventById(id);
    if (!event) return notFound();
    const pdf = tableCardsPdf({
      couple: coupleNames(event.partner_one, event.partner_two),
      date: formatDate(event.event_date),
      url: `${config.publicUrl}/e/${event.slug}`,
    });
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cartoes-${event.slug}.pdf"`,
      },
    });
  }

  if (action === "estado" && req.method === "POST") {
    const status = field(await req.formData(), "status");
    if (!EVENT_STATUSES.includes(status as EventStatus)) return eventDetail(id, "Escolhe um estado válido.", 422);
    if (!(await getEventById(id))) return notFound();
    await setEventStatus(id, status as EventStatus);
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
  if (path === "/") return redirect("/admin");

  const staticFile = STATIC_FILES[path];
  if (staticFile) {
    return new Response(Bun.file(join(PUBLIC_DIR, staticFile)), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(req, path);

  const eventMatch = path.match(/^\/e\/([a-z0-9-]{3,100})$/);
  if (eventMatch && req.method === "GET") {
    const event = await getEventBySlug(eventMatch[1]!);
    return event ? htmlResponse(eventLandingPage(event)) : notFound();
  }
  return notFound();
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
  return response;
}

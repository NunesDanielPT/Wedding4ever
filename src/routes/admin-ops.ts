import { MIN_ADMIN_PASSWORD } from "../lib/auth";
import { DEFAULT_TEMPLATES, getTemplates, renderTemplate, saveTemplate, type TemplateKey } from "../lib/email-templates";
import { sampleVariables } from "../lib/event-emails";
import { sendMail } from "../lib/mail";
import { getSettings } from "../lib/settings";
import { addOrganizer, listOrganizers, removeOrganizer, setOrganizerActive, setOrganizerPassword } from "../lib/organizers";
import { getStats } from "../lib/stats";
import { emailsPage, organizerPage, organizersPage, statsPage, type EmailsNotice } from "../views/admin-ops";
import { listEvents } from "../db/events";
import { field, htmlResponse, isEmail, notFound, redirect } from "./http";

async function render(error?: string, status = 200): Promise<Response> {
  return htmlResponse(organizersPage(await listOrganizers(), error), status);
}

async function handleOrganizers(req: Request, path: string): Promise<Response> {
  if (path === "/admin/organizadores") {
    if (req.method === "GET") return render();
    if (req.method !== "POST") return notFound();
    const form = await req.formData();
    const name = field(form, "name");
    const email = field(form, "email").toLowerCase();
    const password = String(form.get("password") ?? "");
    if (name.length < 2 || name.length > 100) return render("Indica o nome do organizador.", 422);
    if (!isEmail(email)) return render("Indica um e-mail válido.", 422);
    if (password.length < MIN_ADMIN_PASSWORD) return render("A palavra-passe tem de ter pelo menos 12 caracteres.", 422);
    if (!(await addOrganizer(name, email, password))) return render("Esse e-mail já está registado.", 422);
    return redirect("/admin/organizadores");
  }
  const detail = path.match(/^\/admin\/organizadores\/([0-9a-f-]{36})$/);
  if (detail && req.method === "GET") {
    const organizers = await listOrganizers();
    const organizer = organizers.find((item) => item.id === detail[1]);
    if (!organizer) return notFound();
    const events = (await listEvents()).filter((event) => event.organizer_id === organizer.id);
    return htmlResponse(organizerPage(organizer, events, (await getSettings()).retentionDays));
  }
  const match = path.match(/^\/admin\/organizadores\/([0-9a-f-]{36})\/(palavra-passe|ativar|desativar|apagar)$/);
  if (!match || req.method !== "POST") return notFound();
  const [, id, operation] = match as unknown as [string, string, string];
  if (operation === "palavra-passe") {
    const password = String((await req.formData()).get("password") ?? "");
    if (password.length < MIN_ADMIN_PASSWORD) return render("A palavra-passe tem de ter pelo menos 12 caracteres.", 422);
    await setOrganizerPassword(id, password);
  } else if (operation === "apagar") await removeOrganizer(id);
  else await setOrganizerActive(id, operation === "ativar");
  return redirect("/admin/organizadores");
}

async function handleStats(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const now = new Date();
  const year = Number(params.get("ano")) || now.getFullYear();
  const month = Number(params.get("mes")) || undefined;
  const uuid = (value: string | null) => (value && /^[0-9a-f-]{36}$/.test(value) ? value : undefined);
  const stats = await getStats({
    year: year >= 2000 && year <= 2100 ? year : now.getFullYear(),
    month: month && month >= 1 && month <= 12 ? month : undefined,
    eventId: uuid(params.get("evento")),
    organizerId: uuid(params.get("organizador")),
  });
  return htmlResponse(statsPage(stats));
}

async function renderEmails(notice?: EmailsNotice, status = 200): Promise<Response> {
  return htmlResponse(emailsPage(await getTemplates(), sampleVariables(), notice), status);
}

async function handleEmails(req: Request, path: string): Promise<Response> {
  if (path === "/admin/emails") return req.method === "GET" ? renderEmails() : notFound();
  const match = path.match(/^\/admin\/emails\/(cliente|organizador|superadmin|download|missoes|votacao|vencedor|recuperacao)\/(guardar|repor|testar)$/);
  if (!match || req.method !== "POST") return notFound();
  const audience = match[1] as TemplateKey;
  const form = await req.formData();
  if (match[2] === "repor") {
    await saveTemplate(audience, DEFAULT_TEMPLATES[audience]);
    return renderEmails({ success: "Texto padrão reposto." });
  }
  if (match[2] === "guardar") {
    const subject = field(form, "subject");
    const body = String(form.get("body") ?? "").trim();
    if (!subject || subject.length > 200) return renderEmails({ error: "O assunto tem de ter entre 1 e 200 caracteres." }, 422);
    if (!body || body.length > 20_000) return renderEmails({ error: "A mensagem tem de ter entre 1 e 20 000 caracteres." }, 422);
    await saveTemplate(audience, { subject, body });
    return renderEmails({ success: "Modelo guardado." });
  }
  const to = field(form, "to").toLowerCase();
  const { email } = await getSettings();
  if (!isEmail(to)) return renderEmails({ error: "Indica um e-mail válido para o teste." }, 422);
  if (!email.host || !email.fromAddress) return renderEmails({ error: "Configura primeiro o serviço de e-mail em Definições." }, 422);
  const template = (await getTemplates())[audience];
  const variables = sampleVariables();
  try {
    await sendMail(email, { to, subject: renderTemplate(template.subject, variables), text: renderTemplate(template.body, variables) });
    return renderEmails({ success: `E-mail de teste enviado para ${to}.` });
  } catch (cause) {
    return renderEmails({ error: `O teste falhou: ${cause instanceof Error ? cause.message : String(cause)}` }, 502);
  }
}

export function handleAdminOps(req: Request, path: string): Promise<Response> {
  if (path === "/admin/estatisticas") return handleStats(req);
  if (path.startsWith("/admin/emails")) return handleEmails(req, path);
  return handleOrganizers(req, path);
}

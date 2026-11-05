import { config } from "../config";
import { central } from "../db/central";
import type { EventRecord } from "../db/events";
import { brand } from "./brand";
import { eventUrl } from "./event-assets";
import { generateClientCode } from "./event-auth";
import { EVENT_TYPES } from "./event-types";
import { AUDIENCES, getTemplates, renderTemplate, type Audience, type TemplateKey } from "./email-templates";
import { formatDate } from "./format";
import { sendMail } from "./mail";
import { retentionForEvent } from "./retention";
import { getSettings } from "./settings";

export interface EmailLogRow {
  audience: TemplateKey;
  recipient: string;
  subject: string;
  status: "enviado" | "falhou" | "nao_enviado";
  error: string | null;
  created_at: Date;
}

export async function listEmailLog(eventId: string): Promise<EmailLogRow[]> {
  return central`
    SELECT audience, recipient, subject, status, error, created_at FROM email_log
    WHERE event_id = ${eventId}::uuid ORDER BY created_at DESC LIMIT 30
  `;
}

export function sampleVariables(): Record<string, string> {
  return {
    evento: "Casamento Ana e Pedro",
    tipo: "Casamento",
    data: formatDate("2027-06-12"),
    local: "Quinta do Lago",
    pack: "Clássico (Até 150 convidados)",
    limite: "150",
    link: `${config.publicUrl}/e/exemplo`,
    area_cliente: `${config.publicUrl}/entrar`,
    email_cliente: "cliente@exemplo.pt",
    codigo: "ABCD234EFG",
    organizador: "Equipa de exemplo",
    dias: "30",
    data_limite: formatDate("2027-07-12"),
    plataforma: brand(),
    missao: "Na pista de dança",
    vencedor: "Rita Sousa",
  };
}

async function eventVariables(event: EventRecord, retentionDays: number, organizerName: string, code: string) {
  return {
    evento: event.name,
    tipo: EVENT_TYPES[event.event_type].label,
    data: formatDate(event.event_date),
    local: event.venue || "A definir",
    pack: event.pack_name || "Sem pack",
    limite: event.guest_limit ? String(event.guest_limit) : "Sem limite",
    link: eventUrl(event),
    area_cliente: `${config.publicUrl}/entrar`,
    email_cliente: event.couple_email,
    codigo: code,
    organizador: organizerName,
    dias: String(retentionDays),
    data_limite: formatDate(retentionForEvent(event, retentionDays).deleteDate),
    plataforma: brand(),
  };
}

async function log(event: EventRecord, audience: Audience, recipient: string, subject: string, status: EmailLogRow["status"], error?: string) {
  await central`
    INSERT INTO email_log (event_id, audience, recipient, subject, status, error)
    VALUES (${event.id}::uuid, ${audience}, ${recipient}, ${subject}, ${status}, ${error ?? null})
  `;
}

/** Envia os e-mails do evento criado; um envio falhado fica registado e não trava os outros. */
export async function sendEventEmails(event: EventRecord): Promise<void> {
  const settings = await getSettings();
  const active = settings.email.enabled && Boolean(settings.email.host);
  const organizers: { name: string; email: string }[] = event.organizer_id
    ? await central`SELECT name, email FROM organizers WHERE id = ${event.organizer_id}::uuid`
    : [];
  const organizer = organizers[0];
  const admins: { email: string }[] = await central`SELECT email FROM admins ORDER BY created_at`;
  const code = active ? await generateClientCode(event, { keepSessions: true }) : "Pede o código à organização";
  const variables = await eventVariables(event, settings.retentionDays, organizer?.name ?? "Administração", code);
  const templates = await getTemplates();
  const recipients: Record<Audience, string[]> = {
    cliente: [event.couple_email],
    organizador: organizer ? [organizer.email] : [],
    superadmin: admins.map((admin) => admin.email),
  };

  for (const audience of AUDIENCES) {
    const subject = renderTemplate(templates[audience].subject, variables);
    const text = renderTemplate(templates[audience].body, variables);
    for (const to of recipients[audience]) {
      if (!active) {
        await log(event, audience, to, subject, "nao_enviado", "Serviço de e-mail desligado");
        continue;
      }
      try {
        await sendMail(settings.email, { to, subject, text });
        await log(event, audience, to, subject, "enviado");
      } catch (cause) {
        await log(event, audience, to, subject, "falhou", cause instanceof Error ? cause.message : String(cause));
      }
    }
  }
}

export function queueEventEmails(event: EventRecord): void {
  void sendEventEmails(event).catch((cause) => console.error(`Falha nos e-mails de ${event.id}`, cause));
}

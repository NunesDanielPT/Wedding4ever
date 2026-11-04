import { getEventById, eventDb, type EventRecord } from "../db/events";
import { brand } from "./brand";
import { getTemplates, renderTemplate } from "./email-templates";
import { eventUrl } from "./event-assets";
import { sendMail } from "./mail";
import { getWinners, listAdminMissions, type MissionWinners } from "./missions";
import { getVapidKeys, sendPush, type PushSubscription } from "./push";
import { getSettings } from "./settings";

const CONCURRENCY = 10;

interface Notice {
  title: string;
  body: string;
  url: string;
}

interface StoredSubscription extends PushSubscription {
  guest_id: string;
}

export async function saveSubscription(event: EventRecord, guestId: string, subscription: PushSubscription): Promise<void> {
  await eventDb(event.db_name)`
    INSERT INTO push_subscriptions (endpoint, guest_id, p256dh, auth)
    VALUES (${subscription.endpoint}, ${guestId}::uuid, ${subscription.p256dh}, ${subscription.auth})
    ON CONFLICT (endpoint) DO UPDATE SET guest_id = EXCLUDED.guest_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
  `;
}

export async function removeSubscription(event: EventRecord, endpoint: string): Promise<void> {
  await eventDb(event.db_name)`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}

/** Marca o aviso como feito; devolve falso se já tinha sido enviado. */
async function claim(event: EventRecord, key: string): Promise<boolean> {
  const rows = await eventDb(event.db_name)`
    INSERT INTO notification_log (key) VALUES (${key}) ON CONFLICT (key) DO NOTHING RETURNING key
  `;
  return rows.length > 0;
}

async function pushAll(event: EventRecord, notice: Notice): Promise<void> {
  const db = eventDb(event.db_name);
  const subscriptions: StoredSubscription[] = await db`SELECT endpoint, guest_id, p256dh, auth FROM push_subscriptions`;
  if (subscriptions.length === 0) return;
  const keys = await getVapidKeys();
  const payload = JSON.stringify({ ...notice, tag: notice.url });
  for (let i = 0; i < subscriptions.length; i += CONCURRENCY) {
    await Promise.all(
      subscriptions.slice(i, i + CONCURRENCY).map(async (subscription) => {
        try {
          const active = await sendPush(subscription, payload, keys);
          if (!active) await removeSubscription(event, subscription.endpoint);
        } catch (cause) {
          console.error("Falha numa notificação", cause instanceof Error ? cause.message : cause);
        }
      }),
    );
  }
}

/** O e-mail é a reserva: só vai para quem não tem notificações ativas. */
async function emailWinner(event: EventRecord, winners: MissionWinners): Promise<void> {
  const { email } = await getSettings();
  if (!email.enabled || !email.host) return;
  const guests: { email: string; full_name: string }[] = await eventDb(event.db_name)`
    SELECT g.email, g.full_name FROM guests g
    WHERE NOT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.guest_id = g.id)
  `;
  const template = (await getTemplates()).vencedor;
  const variables = {
    evento: event.name,
    missao: winners.title,
    vencedor: winners.photos.map((photo) => photo.guest_name).join(", "),
    link: `${eventUrl(event)}/missoes/${winners.id}`,
    plataforma: brand(),
  };
  const subject = renderTemplate(template.subject, variables);
  const text = renderTemplate(template.body, variables);
  for (const guest of guests) {
    await sendMail(email, { to: guest.email, subject, text }).catch((cause) => {
      console.error("Falha num e-mail de vencedor", cause instanceof Error ? cause.message : cause);
    });
  }
}

/** Compara o estado atual com o que já foi avisado, por isso repetir nunca duplica avisos. */
export async function notifyEventChanges(eventId: string): Promise<void> {
  const event = await getEventById(eventId);
  if (!event || event.status === "rascunho" || event.status === "arquivado") return;
  const base = `/e/${event.slug}`;
  const [missions, winners] = await Promise.all([listAdminMissions(event.db_name), getWinners(event.db_name)]);

  if (missions.some((mission) => mission.phase === "envio") && (await claim(event, "missoes-abertas"))) {
    await pushAll(event, { title: "As missões abriram", body: `Já podes enviar fotografias em ${event.name}.`, url: base });
  }
  for (const mission of missions) {
    if (mission.phase === "votacao" && (await claim(event, `votacao:${mission.id}`))) {
      await pushAll(event, { title: "A votação abriu", body: mission.title, url: `${base}/missoes/${mission.id}` });
    }
  }
  for (const winner of winners) {
    if (await claim(event, `vencedor:${winner.id}`)) {
      const names = winner.photos.map((photo) => photo.guest_name).join(", ");
      await pushAll(event, { title: `Temos vencedor: ${winner.title}`, body: names, url: `${base}/missoes/${winner.id}` });
      await emailWinner(event, winner);
    }
  }
}

export function queueNotifications(eventId: string): void {
  void notifyEventChanges(eventId).catch((cause) => console.error(`Falha nos avisos de ${eventId}`, cause));
}

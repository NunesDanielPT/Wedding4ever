import { central } from "../db/central";

export interface Organizer {
  id: string;
  name: string;
  email: string;
  active: boolean;
  events: number;
  event_credits: number | null;
}

export async function listOrganizers(): Promise<Organizer[]> {
  return central`
    SELECT o.id, o.name, o.email, o.active, o.event_credits, count(e.id)::int AS events
    FROM organizers o LEFT JOIN events e ON e.organizer_id = o.id
    GROUP BY o.id ORDER BY o.name, o.email
  `;
}

export async function findActiveOrganizer(email: string): Promise<Pick<Organizer, "id" | "name" | "email" | "event_credits"> | undefined> {
  const rows: Pick<Organizer, "id" | "name" | "email" | "event_credits">[] = await central`
    SELECT id, name, email, event_credits FROM organizers WHERE email = ${email} AND active
  `;
  return rows[0];
}

export async function organizerHash(email: string): Promise<string | undefined> {
  const rows: { password_hash: string }[] = await central`
    SELECT password_hash FROM organizers WHERE email = ${email} AND active
  `;
  return rows[0]?.password_hash;
}

export async function addOrganizer(name: string, email: string, password: string): Promise<boolean> {
  const hash = await Bun.password.hash(password);
  const rows = await central`
    INSERT INTO organizers (name, email, password_hash) VALUES (${name}, ${email}, ${hash})
    ON CONFLICT (email) DO NOTHING RETURNING id
  `;
  return rows.length > 0;
}

async function endSessions(id: string): Promise<void> {
  await central`DELETE FROM client_sessions WHERE email = (SELECT email FROM organizers WHERE id = ${id}::uuid)`;
}

export async function setOrganizerPassword(id: string, password: string): Promise<void> {
  const hash = await Bun.password.hash(password);
  await central`UPDATE organizers SET password_hash = ${hash} WHERE id = ${id}::uuid`;
  await endSessions(id);
}

export async function setOrganizerActive(id: string, active: boolean): Promise<void> {
  await central`UPDATE organizers SET active = ${active} WHERE id = ${id}::uuid`;
  if (!active) await endSessions(id);
}

export async function removeOrganizer(id: string): Promise<void> {
  await endSessions(id);
  await central`DELETE FROM organizers WHERE id = ${id}::uuid`;
}

export async function setOrganizerCredits(id: string, credits: number | null): Promise<void> {
  await central`UPDATE organizers SET event_credits = ${credits} WHERE id = ${id}::uuid`;
}

/** Gasta um evento do pacote; sem pacote definido, a conta não tem limite. */
export async function useOrganizerCredit(id: string): Promise<boolean> {
  const rows = await central`
    UPDATE organizers SET event_credits = event_credits - 1
    WHERE id = ${id}::uuid AND event_credits > 0 RETURNING id
  `;
  if (rows.length > 0) return true;
  const unlimited = await central`SELECT 1 FROM organizers WHERE id = ${id}::uuid AND event_credits IS NULL`;
  return unlimited.length > 0;
}

export async function refundOrganizerCredit(id: string): Promise<void> {
  await central`UPDATE organizers SET event_credits = event_credits + 1 WHERE id = ${id}::uuid AND event_credits IS NOT NULL`;
}

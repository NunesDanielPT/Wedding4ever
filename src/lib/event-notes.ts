import { central } from "../db/central";

export const PAYMENT_LABELS = {
  por_pagar: "Por pagar",
  sinal_pago: "Sinal pago",
  pago: "Pago",
  oferta: "Oferta",
} as const;
export type PaymentStatus = keyof typeof PAYMENT_LABELS;

export interface EventNotes {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  payment_status: PaymentStatus;
  amount: string;
  notes: string;
}

export const EMPTY_NOTES: EventNotes = {
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  payment_status: "por_pagar",
  amount: "",
  notes: "",
};

export async function getEventNotes(eventId: string): Promise<EventNotes> {
  const rows: EventNotes[] = await central`
    SELECT contact_name, contact_phone, contact_email, payment_status, amount, notes
    FROM event_notes WHERE event_id = ${eventId}::uuid
  `;
  return rows[0] ?? EMPTY_NOTES;
}

export async function saveEventNotes(eventId: string, notes: EventNotes): Promise<void> {
  await central`
    INSERT INTO event_notes (event_id, contact_name, contact_phone, contact_email, payment_status, amount, notes)
    VALUES (${eventId}::uuid, ${notes.contact_name}, ${notes.contact_phone}, ${notes.contact_email},
            ${notes.payment_status}, ${notes.amount}, ${notes.notes})
    ON CONFLICT (event_id) DO UPDATE SET
      contact_name = EXCLUDED.contact_name, contact_phone = EXCLUDED.contact_phone,
      contact_email = EXCLUDED.contact_email, payment_status = EXCLUDED.payment_status,
      amount = EXCLUDED.amount, notes = EXCLUDED.notes, updated_at = now()
  `;
}

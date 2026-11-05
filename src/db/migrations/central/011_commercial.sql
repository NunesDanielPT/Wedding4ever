ALTER TABLE organizers ADD COLUMN event_credits integer CHECK (event_credits IS NULL OR event_credits >= 0);
ALTER TABLE events ADD COLUMN extra_days integer NOT NULL DEFAULT 0 CHECK (extra_days >= 0);

CREATE TABLE event_notes (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  contact_name text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  payment_status text NOT NULL DEFAULT 'por_pagar'
    CHECK (payment_status IN ('por_pagar', 'sinal_pago', 'pago', 'oferta')),
  amount text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

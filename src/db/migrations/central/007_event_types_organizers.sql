CREATE TABLE organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE events
  ADD COLUMN name text NOT NULL DEFAULT '',
  ADD COLUMN event_type text NOT NULL DEFAULT 'evento'
    CHECK (event_type IN ('casamento', 'batizado', 'aniversario', 'evento')),
  ADD COLUMN organizer_id uuid REFERENCES organizers(id) ON DELETE SET NULL,
  ALTER COLUMN partner_one SET DEFAULT '',
  ALTER COLUMN partner_two SET DEFAULT '';

UPDATE events SET name = trim(partner_one || ' & ' || partner_two), event_type = 'casamento';
CREATE INDEX events_organizer_idx ON events (organizer_id);

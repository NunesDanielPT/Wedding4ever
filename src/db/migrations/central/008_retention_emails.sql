CREATE TABLE email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  audience text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('enviado', 'falhou', 'nao_enviado')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_event_idx ON email_log (event_id, created_at DESC);

CREATE TABLE archived_events (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  event_type text NOT NULL,
  event_date date NOT NULL,
  created_at timestamptz NOT NULL,
  pack_name text NOT NULL DEFAULT '',
  organizer_id uuid,
  organizer_name text,
  activity jsonb NOT NULL DEFAULT '[]',
  deleted_at timestamptz NOT NULL DEFAULT now()
);

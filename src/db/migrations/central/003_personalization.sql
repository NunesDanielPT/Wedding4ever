ALTER TABLE events
  ADD COLUMN design jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN couple_code_hash text;

CREATE TABLE couple_sessions (
  token_hash text PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX couple_sessions_expires_idx ON couple_sessions (expires_at);

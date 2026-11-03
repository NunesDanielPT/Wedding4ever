CREATE TABLE guest_sessions (
  token_hash text PRIMARY KEY,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX guest_sessions_expires_idx ON guest_sessions (expires_at);

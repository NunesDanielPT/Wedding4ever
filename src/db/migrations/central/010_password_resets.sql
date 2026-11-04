CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX password_resets_email_idx ON password_resets (email);

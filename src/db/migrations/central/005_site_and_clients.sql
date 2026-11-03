DROP TABLE couple_sessions;

CREATE TABLE client_sessions (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX client_sessions_email_idx ON client_sessions (email);

CREATE TABLE support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_created_idx ON support_messages (created_at DESC);

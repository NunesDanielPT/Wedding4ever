CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_guest_idx ON push_subscriptions (guest_id);

CREATE TABLE notification_log (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

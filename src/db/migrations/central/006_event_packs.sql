ALTER TABLE events
  ADD COLUMN pack_name text NOT NULL DEFAULT '',
  ADD COLUMN guest_limit integer CHECK (guest_limit IS NULL OR guest_limit > 0);

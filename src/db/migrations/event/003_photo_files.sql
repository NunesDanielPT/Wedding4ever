ALTER TABLE photos
  ADD COLUMN extension text NOT NULL DEFAULT 'jpg' CHECK (extension IN ('jpg', 'png', 'heic')),
  ADD COLUMN size_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN preview_status text NOT NULL DEFAULT 'pending'
    CHECK (preview_status IN ('pending', 'ready', 'failed'));

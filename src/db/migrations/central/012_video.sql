CREATE TABLE video_music (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  extension text NOT NULL,
  duration integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_videos (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('na_fila', 'a_gerar', 'pronto', 'erro')),
  music_id uuid REFERENCES video_music(id) ON DELETE SET NULL,
  max_photos integer NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  photos integer NOT NULL DEFAULT 0,
  duration integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  has_file boolean NOT NULL DEFAULT false,
  error text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

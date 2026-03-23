CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  ccli_num TEXT,
  lyrics_json TEXT NOT NULL,
  section_order_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS songaudit (
  id INTEGER PRIMARY KEY,
  song_id INTEGER NOT NULL,
  audit_type TEXT NOT NULL CHECK (audit_type IN ('edit', 'check')),
  initial INTEGER NOT NULL DEFAULT 0,
  chordPlay INTEGER NOT NULL DEFAULT 0,
  audit_status TEXT NOT NULL DEFAULT 'recorded',
  audit_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_songaudit_song_id_created_at
ON songaudit (song_id, created_at DESC);

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

CREATE TABLE IF NOT EXISTS section_types (
  code TEXT PRIMARY KEY,
  desc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songaudit (
  id INTEGER PRIMARY KEY,
  song_id INTEGER NOT NULL UNIQUE,
  audit_type TEXT NOT NULL DEFAULT 'check' CHECK (audit_type IN ('edit', 'check')),
  initial INTEGER NOT NULL DEFAULT 0,
  chordPlay INTEGER NOT NULL DEFAULT 0,
  audit_status TEXT NOT NULL DEFAULT 'recorded',
  audit_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_songaudit_initial_song_id
ON songaudit (initial, song_id);

CREATE TABLE IF NOT EXISTS setlist_entries (
  id INTEGER PRIMARY KEY,
  song_id INTEGER NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_setlist_entries_position
ON setlist_entries (position, song_id);

CREATE TABLE IF NOT EXISTS performance_events (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_performance_events_started_at
ON performance_events (started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS performance_event_songs (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  song_id INTEGER,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  ccli_num TEXT,
  first_played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  play_count INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES performance_events(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE SET NULL,
  UNIQUE (event_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_performance_event_songs_event_position
ON performance_event_songs (event_id, position, id);

INSERT INTO section_types (code, desc) VALUES
  ('V', 'Verse'),
  ('C', 'Chorus'),
  ('B', 'Bridge'),
  ('E', 'Ending')
ON CONFLICT(code) DO UPDATE SET
  desc = excluded.desc;

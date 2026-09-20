const fs = require("fs");
const path = require("path");

const VERSION = 2;
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
const requiredColumns = {
  songs: ["id", "title", "ccli_num", "lyrics_json", "section_order_json", "created_at", "updated_at"],
  section_types: ["code", "desc"],
  songaudit: ["id", "song_id", "audit_type", "audit_status", "audit_note", "created_at"],
  setlist_entries: ["id", "song_id", "position", "created_at", "updated_at"],
  performance_events: ["id", "started_at", "ended_at", "created_at", "updated_at"],
  performance_event_songs: ["id", "event_id", "song_id", "first_played_at", "last_played_at", "play_count", "position", "created_at", "updated_at"],
};

// Only known, additive legacy changes are accepted. Unrecognized layouts must be
// migrated explicitly; startup must never discard a user's library or history.
function migrateDatabase(db) {
  db.transaction(() => {
    let version = db.pragma("user_version", { simple: true });
    if (version > VERSION) throw new Error(`Database schema version ${version} is newer than supported version ${VERSION}.`);
    const tables = new Map();
    for (const [table, required] of Object.entries(requiredColumns)) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.length) {
        if (version > 0) throw new Error(`Unsupported database schema: missing ${table}. No data was changed.`);
        continue;
      }
      tables.set(table, columns);
      const missing = required.filter((name) => !columns.some((column) => column.name === name));
      const id = columns.find((column) => column.name === "id");
      if (missing.length || (id && (id.type.toUpperCase() !== "INTEGER" || id.pk !== 1))) {
        throw new Error(`Unsupported database schema for ${table}. No data was changed; migrate this database explicitly.`);
      }
    }

    if (version === 0) {
      for (const [table, name, definition] of [
        ["songs", "authors", "TEXT NOT NULL DEFAULT ''"],
        ["songaudit", "initial", "INTEGER NOT NULL DEFAULT 0"],
        ["songaudit", "chordPlay", "INTEGER NOT NULL DEFAULT 0"],
        ["songaudit", "updated_at", "TEXT NOT NULL DEFAULT ''"],
      ]) {
        const columns = tables.get(table);
        if (columns && !columns.some((column) => column.name === name)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
          if (name === "updated_at") db.exec(`UPDATE ${table} SET updated_at = created_at`);
        }
      }
      db.exec(schema);
      version = 1;
      db.pragma("user_version = 1");
    }

    if (version === 1) {
      const columns = db.prepare("PRAGMA table_info(performance_event_songs)").all();
      const snapshots = ["title", "authors", "ccli_num"].filter((name) => columns.some((column) => column.name === name));
      if (snapshots.length > 0 && snapshots.length !== 3) {
        throw new Error("Unsupported partial performance snapshot schema. No data was changed.");
      }
      if (snapshots.length === 0) {
        // Keep IDs, counts, ordering, and timestamps while replacing the
        // cascading song reference with a nullable reference and snapshots.
        db.exec("ALTER TABLE performance_event_songs RENAME TO performance_event_songs_old");
        const tableSql = schema.match(/CREATE TABLE IF NOT EXISTS performance_event_songs \([\s\S]*?\n\);/)[0];
        db.exec(tableSql);
        db.exec(`INSERT INTO performance_event_songs
          (id, event_id, song_id, title, authors, ccli_num, first_played_at,
           last_played_at, play_count, position, created_at, updated_at)
          SELECT p.id, p.event_id, p.song_id, s.title, s.authors, s.ccli_num,
                 p.first_played_at, p.last_played_at, p.play_count, p.position, p.created_at, p.updated_at
          FROM performance_event_songs_old p LEFT JOIN songs s ON s.id = p.song_id`);
        db.exec("DROP TABLE performance_event_songs_old");
        db.exec(schema);
      }
      db.pragma("user_version = 2");
    }

    for (const [table, names] of Object.entries({
      songs: ["authors"], songaudit: ["initial", "chordPlay", "updated_at"],
      performance_event_songs: ["title", "authors", "ccli_num"],
    })) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (names.some((name) => !columns.some((column) => column.name === name))) {
        throw new Error(`Unsupported database schema for ${table}. No data was changed.`);
      }
    }
    const songReference = db.prepare("PRAGMA foreign_key_list(performance_event_songs)").all()
      .find((key) => key.from === "song_id");
    if (songReference?.on_delete !== "SET NULL") {
      throw new Error("Unsupported performance history foreign key. No data was changed.");
    }
    if (db.pragma("foreign_key_check").length) {
      throw new Error("Database has broken references. No data was changed; repair it before starting.");
    }
  })();
}

module.exports = { migrateDatabase, VERSION };

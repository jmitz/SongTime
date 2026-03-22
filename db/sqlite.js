const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { loadSeedData } = require("./seed-data");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "songlist.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

function hydrateSongs(db) {
  return db
    .prepare(
      `SELECT id, title, ccli_num, lyrics_json, section_order_json
       FROM songs
       ORDER BY title ASC`,
    )
    .all()
    .map((song) => ({
      id: song.id,
      title: song.title,
      ccliNum: song.ccli_num,
      sections: Object.fromEntries(
        Object.entries(JSON.parse(song.lyrics_json)).map(([sectionId, content]) => [
          sectionId,
          { content },
        ]),
      ),
      sectionOrder: JSON.parse(song.section_order_json),
    }));
}

function createRepository(db) {
  const songs = hydrateSongs(db);
  const songsById = new Map(songs.map((song) => [song.id, song]));

  return {
    get songs() {
      return songs;
    },
    listSongSummaries() {
      return songs.map((song) => ({
        id: song.id,
        title: song.title,
      }));
    },
    getSong(songId) {
      const numericSongId = Number(songId);
      if (!Number.isInteger(numericSongId)) {
        return null;
      }

      return songsById.get(numericSongId) || null;
    },
  };
}

function ensureSongsSchema(db) {
  const songsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'songs'")
    .get();

  if (songsTable) {
    const columns = db.prepare("PRAGMA table_info(songs)").all();
    const columnNames = columns.map((column) => column.name);
    const idColumn = columns.find((column) => column.name === "id");
    const hasExpectedColumns =
      idColumn?.type === "INTEGER" &&
      columnNames.includes("ccli_num") &&
      columnNames.includes("lyrics_json") &&
      columnNames.includes("section_order_json");
    if (!hasExpectedColumns) {
      db.exec("DROP TABLE IF EXISTS songs");
    }
  }

  db.exec("DROP TABLE IF EXISTS live_sessions");
  db.exec("DROP TABLE IF EXISTS song_arrangement_sections");
  db.exec("DROP TABLE IF EXISTS song_sections");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

function initializeDatabase() {
  const dbPath = process.env.SQLITE_PATH || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureSongsSchema(db);

  const seedData = loadSeedData();
  const songCount = db.prepare("SELECT COUNT(*) AS count FROM songs").get().count;

  if (songCount === 0) {
    const insertSong = db.prepare(
      `INSERT INTO songs (id, title, ccli_num, lyrics_json, section_order_json)
       VALUES (@id, @title, @ccli_num, @lyrics_json, @section_order_json)`,
    );

    const seed = db.transaction(() => {
      for (const song of seedData) {
        insertSong.run(song);
      }
    });

    seed();
  }

  return {
    db,
    dbPath,
    repository: createRepository(db),
  };
}

module.exports = {
  DEFAULT_DB_PATH,
  initializeDatabase,
};

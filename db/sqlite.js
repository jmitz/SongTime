const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { loadSeedData } = require("./seed-data");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "songlist.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

function hydrateSongs(db) {
  return db
    .prepare(
      `SELECT id, title, authors, ccli_num, lyrics_json, section_order_json
       FROM songs
       ORDER BY title ASC`,
    )
    .all()
    .map((song) => ({
      id: song.id,
      title: song.title,
      authors: song.authors,
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

function mapSongRow(song) {
  return {
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
  };
}

function validateSongInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Song payload is required.");
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) {
    throw new Error("Song title is required.");
  }

  const ccliNum = typeof input.ccliNum === "string" ? input.ccliNum.trim() : "";
  const sectionOrder = Array.isArray(input.sectionOrder)
    ? input.sectionOrder.map((sectionId) => String(sectionId).trim()).filter(Boolean)
    : [];

  if (sectionOrder.length === 0) {
    throw new Error("Section order must contain at least one section ID.");
  }

  const sectionsInput = input.sections && typeof input.sections === "object" ? input.sections : null;
  if (!sectionsInput) {
    throw new Error("Sections are required.");
  }

  const sections = {};
  for (const [sectionId, section] of Object.entries(sectionsInput)) {
    const trimmedId = String(sectionId).trim();
    const content =
      typeof section === "string"
        ? section.trim()
        : typeof section?.content === "string"
          ? section.content.trim()
          : "";

    if (!trimmedId) {
      continue;
    }

    if (!content) {
      throw new Error(`Section "${trimmedId}" must have content.`);
    }

    sections[trimmedId] = { content };
  }

  const sectionIds = Object.keys(sections);
  if (sectionIds.length === 0) {
    throw new Error("At least one section with content is required.");
  }

  for (const sectionId of sectionOrder) {
    if (!sections[sectionId]) {
      throw new Error(`Section order references missing section "${sectionId}".`);
    }
  }

  return {
    title,
    ccliNum: ccliNum || null,
    sections,
    sectionOrder,
  };
}

function createRepository(db) {
  const songs = [];
  const songsById = new Map();

  const insertSong = db.prepare(
    `INSERT INTO songs (title, ccli_num, lyrics_json, section_order_json)
     VALUES (@title, @ccli_num, @lyrics_json, @section_order_json)`,
  );
  const updateSong = db.prepare(
    `UPDATE songs
     SET title = @title,
         ccli_num = @ccli_num,
         lyrics_json = @lyrics_json,
         section_order_json = @section_order_json,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @id`,
  );
  const selectSongById = db.prepare(
    `SELECT id, title, ccli_num, lyrics_json, section_order_json
     FROM songs
     WHERE id = ?`,
  );
  const deleteSong = db.prepare("DELETE FROM songs WHERE id = ?");

  function refreshSongs() {
    songs.length = 0;
    songsById.clear();

    for (const song of hydrateSongs(db)) {
      songs.push(song);
      songsById.set(song.id, song);
    }
  }

  function persistSong(songInput, songId = null) {
    const validatedSong = validateSongInput(songInput);
    const payload = {
      title: validatedSong.title,
      ccli_num: validatedSong.ccliNum,
      lyrics_json: JSON.stringify(
        Object.fromEntries(
          Object.entries(validatedSong.sections).map(([sectionId, section]) => [sectionId, section.content]),
        ),
      ),
      section_order_json: JSON.stringify(validatedSong.sectionOrder),
    };

    let savedSongId = songId;
    if (savedSongId == null) {
      const result = insertSong.run(payload);
      savedSongId = Number(result.lastInsertRowid);
    } else {
      const result = updateSong.run({
        id: savedSongId,
        ...payload,
      });
      if (result.changes === 0) {
        return null;
      }
    }

    const songRow = selectSongById.get(savedSongId);
    if (!songRow) {
      return null;
    }

    refreshSongs();
    return mapSongRow(songRow);
  }

  refreshSongs();

  return {
    get songs() {
      return songs;
    },
    listSongSummaries() {
      return songs.map((song) => ({
        id: song.id,
        title: song.title,
        authors: song.authors,
      }));
    },
    getSong(songId) {
      const numericSongId = Number(songId);
      if (!Number.isInteger(numericSongId)) {
        return null;
      }

      return songsById.get(numericSongId) || null;
    },
    createSong(songInput) {
      return persistSong(songInput);
    },
    updateSong(songId, songInput) {
      const numericSongId = Number(songId);
      if (!Number.isInteger(numericSongId)) {
        return null;
      }

      return persistSong(songInput, numericSongId);
    },
    deleteSong(songId) {
      const numericSongId = Number(songId);
      if (!Number.isInteger(numericSongId)) {
        return null;
      }

      const existingSong = songsById.get(numericSongId) || null;
      if (!existingSong) {
        return null;
      }

      if (songs.length <= 1) {
        throw new Error("Cannot delete the last remaining song.");
      }

      deleteSong.run(numericSongId);
      refreshSongs();
      return existingSong;
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
      columnNames.includes("authors") &&
      columnNames.includes("ccli_num") &&
      columnNames.includes("lyrics_json") &&
      columnNames.includes("section_order_json");
    const canMigrateAuthors =
      idColumn?.type === "INTEGER" &&
      !columnNames.includes("authors") &&
      columnNames.includes("ccli_num") &&
      columnNames.includes("lyrics_json") &&
      columnNames.includes("section_order_json");

    if (canMigrateAuthors) {
      db.exec("ALTER TABLE songs ADD COLUMN authors TEXT NOT NULL DEFAULT ''");
    } else if (!hasExpectedColumns) {
      db.exec("DROP TABLE IF EXISTS songaudit");
      db.exec("DROP TABLE IF EXISTS songs");
    }
  }

  const songAuditTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'songaudit'")
    .get();

  if (songAuditTable) {
    const columns = db.prepare("PRAGMA table_info(songaudit)").all();
    const columnNames = columns.map((column) => column.name);
    const missingInitial = !columnNames.includes("initial");
    const missingChordPlay = !columnNames.includes("chordPlay");
    const hasExpectedColumns =
      columnNames.includes("song_id") &&
      columnNames.includes("audit_type") &&
      columnNames.includes("initial") &&
      columnNames.includes("chordPlay") &&
      columnNames.includes("audit_status") &&
      columnNames.includes("audit_note") &&
      columnNames.includes("created_at");

    const canMigrateAuditFlags =
      columnNames.includes("song_id") &&
      columnNames.includes("audit_type") &&
      columnNames.includes("audit_status") &&
      columnNames.includes("audit_note") &&
      columnNames.includes("created_at") &&
      (missingInitial || missingChordPlay);

    if (canMigrateAuditFlags) {
      if (missingInitial) {
        db.exec("ALTER TABLE songaudit ADD COLUMN initial INTEGER NOT NULL DEFAULT 0");
      }
      if (missingChordPlay) {
        db.exec("ALTER TABLE songaudit ADD COLUMN chordPlay INTEGER NOT NULL DEFAULT 0");
      }
    } else if (!hasExpectedColumns) {
      db.exec("DROP TABLE IF EXISTS songaudit");
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
  const updateSongMetadata = db.prepare(
    `UPDATE songs
     SET authors = @authors,
         ccli_num = CASE
           WHEN (@ccli_num IS NOT NULL AND @ccli_num <> '') THEN @ccli_num
           ELSE ccli_num
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @id
       AND (
         authors <> @authors
         OR ((ccli_num IS NULL OR ccli_num = '') AND (@ccli_num IS NOT NULL AND @ccli_num <> ''))
       )`,
  );

  if (songCount === 0) {
    const insertSong = db.prepare(
      `INSERT INTO songs (id, title, authors, ccli_num, lyrics_json, section_order_json)
       VALUES (@id, @title, @authors, @ccli_num, @lyrics_json, @section_order_json)`,
    );

    const seed = db.transaction(() => {
      for (const song of seedData) {
        insertSong.run(song);
      }
    });

    seed();
  } else {
    const syncSongMetadata = db.transaction(() => {
      for (const song of seedData) {
        updateSongMetadata.run(song);
      }
    });

    syncSongMetadata();
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

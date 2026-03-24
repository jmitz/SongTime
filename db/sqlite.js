const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { loadSeedData } = require("./seed-data");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "songlist.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

function hydrateSectionTypes(db) {
  return db
    .prepare(
      `SELECT code, desc
       FROM section_types
       ORDER BY code ASC`,
    )
    .all()
    .reduce((sectionTypes, row) => {
      sectionTypes[row.code] = row.desc;
      return sectionTypes;
    }, {});
}

function hydrateSongs(db) {
  return db
    .prepare(
      `SELECT songs.id, songs.title, songs.author, songs.ccli_num, songs.lyrics_json, songs.section_order_json,
              COALESCE(songaudit.initial, 0) AS initial,
              COALESCE(songaudit.chordPlay, 0) AS chordPlay
       FROM songs
       LEFT JOIN songaudit ON songaudit.song_id = songs.id
       ORDER BY title ASC`,
    )
    .all()
    .map((song) => ({
      id: song.id,
      title: song.title,
      author: song.author,
      ccliNum: song.ccli_num,
      audit: {
        initial: Boolean(song.initial),
        chordPlay: Boolean(song.chordPlay),
      },
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
    author: song.author,
    ccliNum: song.ccli_num,
    audit: {
      initial: Boolean(song.initial),
      chordPlay: Boolean(song.chordPlay),
    },
    sections: Object.fromEntries(
      Object.entries(JSON.parse(song.lyrics_json)).map(([sectionId, content]) => [
        sectionId,
        { content },
      ]),
    ),
    sectionOrder: JSON.parse(song.section_order_json),
  };
}

function formatSectionLabel(sectionId, sectionTypes) {
  const normalizedId = String(sectionId || "").trim();
  if (!normalizedId) {
    return "";
  }

  if (/^\d+$/.test(normalizedId)) {
    const verseLabel = sectionTypes.V || "Verse";
    return `${verseLabel} ${normalizedId}`;
  }

  const match = normalizedId.match(/^([A-Za-z]+)(\d*)$/);
  if (!match) {
    return normalizedId;
  }

  const code = match[1].toUpperCase();
  const ordinal = match[2];
  const description = sectionTypes[code] || code;
  return ordinal ? `${description} ${ordinal}` : description;
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
  const author = typeof input.author === "string" ? input.author.trim() : "";
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
    author: author || null,
    ccliNum: ccliNum || null,
    sections,
    sectionOrder,
  };
}

function createRepository(db) {
  const songs = [];
  const songsById = new Map();
  let sectionTypes = hydrateSectionTypes(db);

  const insertSong = db.prepare(
    `INSERT INTO songs (title, author, ccli_num, lyrics_json, section_order_json)
     VALUES (@title, @author, @ccli_num, @lyrics_json, @section_order_json)`,
  );
  const updateSong = db.prepare(
    `UPDATE songs
     SET title = @title,
         author = @author,
         ccli_num = @ccli_num,
         lyrics_json = @lyrics_json,
         section_order_json = @section_order_json,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @id`,
  );
  const selectSongById = db.prepare(
    `SELECT songs.id, songs.title, songs.author, songs.ccli_num, songs.lyrics_json, songs.section_order_json,
            COALESCE(songaudit.initial, 0) AS initial,
            COALESCE(songaudit.chordPlay, 0) AS chordPlay
     FROM songs
     LEFT JOIN songaudit ON songaudit.song_id = songs.id
     WHERE songs.id = ?`,
  );
  const deleteSong = db.prepare("DELETE FROM songs WHERE id = ?");
  const ensureSongAudit = db.prepare(
    `INSERT INTO songaudit (song_id, audit_type, initial, chordPlay)
     VALUES (?, 'check', 0, 0)
     ON CONFLICT(song_id) DO NOTHING`,
  );
  const markSongEdited = db.prepare(
    `INSERT INTO songaudit (song_id, audit_type, initial, chordPlay, updated_at)
     VALUES (?, 'edit', 1, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(song_id) DO UPDATE SET
       audit_type = 'edit',
       initial = 1,
       updated_at = CURRENT_TIMESTAMP`,
  );

  function refreshSongs() {
    sectionTypes = hydrateSectionTypes(db);
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
      author: validatedSong.author,
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
      ensureSongAudit.run(savedSongId);
    } else {
      const result = updateSong.run({
        id: savedSongId,
        ...payload,
      });
      if (result.changes === 0) {
        return null;
      }
      markSongEdited.run(savedSongId);
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
    get sectionTypes() {
      return sectionTypes;
    },
    listSongSummaries({ initial = null } = {}) {
      return songs
        .filter((song) => (typeof initial === "boolean" ? song.audit.initial === initial : true))
        .map((song) => ({
          id: song.id,
          title: song.title,
          audit: song.audit,
        }));
    },
    getSectionLabel(sectionId) {
      return formatSectionLabel(sectionId, sectionTypes);
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
      columnNames.includes("ccli_num") &&
      columnNames.includes("lyrics_json") &&
      columnNames.includes("section_order_json");
    if (!hasExpectedColumns) {
      db.exec("DROP TABLE IF EXISTS songaudit");
      db.exec("DROP TABLE IF EXISTS songs");
    } else if (!columnNames.includes("author")) {
      db.exec("ALTER TABLE songs ADD COLUMN author TEXT");
    }
  }

  const sectionTypesTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'section_types'")
    .get();

  if (sectionTypesTable) {
    const columns = db.prepare("PRAGMA table_info(section_types)").all();
    const columnNames = columns.map((column) => column.name);
    const hasExpectedColumns = columnNames.includes("code") && columnNames.includes("desc");

    if (!hasExpectedColumns) {
      db.exec("DROP TABLE IF EXISTS section_types");
    }
  }

  const songAuditTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'songaudit'")
    .get();

  if (songAuditTable) {
    const columns = db.prepare("PRAGMA table_info(songaudit)").all();
    const columnNames = columns.map((column) => column.name);
    const hasExpectedColumns =
      columnNames.includes("song_id") &&
      columnNames.includes("audit_type") &&
      columnNames.includes("initial") &&
      columnNames.includes("chordPlay") &&
      columnNames.includes("audit_status") &&
      columnNames.includes("audit_note") &&
      columnNames.includes("created_at") &&
      columnNames.includes("updated_at");

    if (!hasExpectedColumns) {
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

  if (songCount === 0) {
    const insertSong = db.prepare(
      `INSERT INTO songs (id, title, author, ccli_num, lyrics_json, section_order_json)
       VALUES (@id, @title, @author, @ccli_num, @lyrics_json, @section_order_json)`,
    );
    const insertAudit = db.prepare(
      `INSERT INTO songaudit (song_id, audit_type, initial, chordPlay)
       VALUES (@song_id, 'check', 0, 0)`,
    );

    const seed = db.transaction(() => {
      for (const song of seedData) {
        insertSong.run(song);
        insertAudit.run({ song_id: song.id });
      }
    });

    seed();
  } else {
    const insertMissingAudit = db.prepare(
      `INSERT INTO songaudit (song_id, audit_type, initial, chordPlay)
       SELECT songs.id, 'check', 0, 0
       FROM songs
       LEFT JOIN songaudit ON songaudit.song_id = songs.id
       WHERE songaudit.song_id IS NULL`,
    );

    insertMissingAudit.run();
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

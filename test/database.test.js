const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { initializeDatabase } = require("../db/sqlite");
const { migrateDatabase, VERSION } = require("../db/migrations");

const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
const songInput = { title: "Test song", authors: "Original author", ccliNum: "12345", sections: { V1: { content: "Lyrics" } }, sectionOrder: ["V1"] };

function temporaryDatabase(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "songlist-test-"));
  const previousPath = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = path.join(dir, "test.db");
  t.after(() => {
    if (previousPath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return process.env.SQLITE_PATH;
}

test("saved metadata survives restarts and blank metadata is backfilled", (t) => {
  temporaryDatabase(t);
  let { db, repository } = initializeDatabase();
  const song = repository.createSong({ ...songInput, title: "10,000 Reasons" });
  db.close();
  ({ db, repository } = initializeDatabase());
  assert.equal(repository.getSong(song.id).authors, "Original author");
  assert.equal(repository.getSong(song.id).ccliNum, "12345");
  repository.updateSong(song.id, { ...song, authors: "" });
  db.close();
  ({ db, repository } = initializeDatabase());
  assert.equal(repository.getSong(song.id).authors, "Jonas Myrin & Matt Redman");
  assert.equal(repository.getSong(song.id).ccliNum, "12345");
  db.close();
});

test("completed performance snapshots survive song edits, deletion, and restart", (t) => {
  temporaryDatabase(t);
  let { db, repository } = initializeDatabase();
  const song = repository.createSong(songInput);
  repository.startPerformanceEvent(song.id);
  repository.recordPerformanceSong(song.id);
  repository.stopPerformanceEvent();
  const before = repository.getPerformanceLog().songs[0];
  repository.updateSong(song.id, { ...songInput, title: "Changed", authors: "Changed", ccliNum: "999" });
  assert.deepEqual(repository.getPerformanceLog().songs[0], before);
  repository.deleteSong(song.id);
  assert.deepEqual(repository.getPerformanceLog().songs[0], { ...before, songId: null });
  db.close();
  ({ db, repository } = initializeDatabase());
  assert.deepEqual(repository.getPerformanceLog().songs[0], { ...before, songId: null });
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("unsupported schemas and future versions are rejected without changing data", () => {
  for (const future of [false, true]) {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE songs(id TEXT PRIMARY KEY, title TEXT); INSERT INTO songs VALUES ('custom', 'Keep me')");
    if (future) db.pragma("user_version = 999");
    const before = db.serialize();
    assert.throws(() => migrateDatabase(db), /Unsupported database schema|newer than supported/);
    assert.deepEqual(db.serialize(), before);
    db.close();
  }
});

test("legacy history migrates transactionally without losing IDs, timestamps, or counts", () => {
  const db = new Database(":memory:");
  const legacy = schema.replace("song_id INTEGER,\n  title TEXT NOT NULL,\n  authors TEXT NOT NULL DEFAULT '',\n  ccli_num TEXT,", "song_id INTEGER NOT NULL,")
    .replace("REFERENCES songs(id) ON DELETE SET NULL", "REFERENCES songs(id) ON DELETE CASCADE");
  db.exec(legacy);
  db.exec(`INSERT INTO songs (id,title,authors,ccli_num,lyrics_json,section_order_json) VALUES (1,'Old title','Old author','456','{}','[]');
    INSERT INTO performance_events(id,ended_at) VALUES (1,'2026-01-01');
    INSERT INTO performance_event_songs(id,event_id,song_id,play_count,position) VALUES (7,1,1,3,0);
    CREATE TABLE live_sessions (value TEXT); INSERT INTO live_sessions VALUES ('Keep legacy data');`);
  const before = db.prepare("SELECT * FROM performance_event_songs").get();
  migrateDatabase(db);
  assert.equal(db.pragma("user_version", { simple: true }), VERSION);
  assert.deepEqual(db.prepare("SELECT * FROM performance_event_songs").get(), {
    ...before, title: "Old title", authors: "Old author", ccli_num: "456",
  });
  db.exec("DELETE FROM songs WHERE id = 1");
  assert.equal(db.prepare("SELECT title FROM performance_event_songs").get().title, "Old title");
  assert.equal(db.prepare("SELECT song_id FROM performance_event_songs").get().song_id, null);
  assert.equal(db.prepare("SELECT value FROM live_sessions").get().value, "Keep legacy data");
  migrateDatabase(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM performance_event_songs").get().count, 1);
  db.close();
});

test("failed history migration rolls back preceding additive changes", () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.exec("ALTER TABLE songs DROP COLUMN authors; ALTER TABLE performance_event_songs DROP COLUMN ccli_num");
  const before = db.serialize();
  assert.throws(() => migrateDatabase(db), /partial performance snapshot/);
  assert.deepEqual(db.serialize(), before);
  db.close();
});

test("known legacy audit flags and author column migrate without discarding songs", () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.exec(`ALTER TABLE songs DROP COLUMN authors;
    DROP INDEX idx_songaudit_initial_song_id;
    ALTER TABLE songaudit DROP COLUMN initial;
    ALTER TABLE songaudit DROP COLUMN chordPlay;
    ALTER TABLE songaudit DROP COLUMN updated_at;
    INSERT INTO songs(id,title,lyrics_json,section_order_json) VALUES (1,'Keep me','{}','[]');
    INSERT INTO songaudit(song_id,audit_note) VALUES (1,'Keep note');`);
  migrateDatabase(db);
  assert.equal(db.prepare("SELECT title FROM songs").get().title, "Keep me");
  const audit = db.prepare("SELECT * FROM songaudit").get();
  assert.equal(audit.audit_note, "Keep note");
  assert.equal(audit.initial, 0);
  assert.equal(audit.chordPlay, 0);
  assert.equal(audit.updated_at, audit.created_at);
  db.close();
});

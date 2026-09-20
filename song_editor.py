#!/usr/bin/env python3
"""Run a local Python web editor for the SongList SQLite song library."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


APP_ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = APP_ROOT / "data" / "songlist.db"
SCHEMA_PATH = APP_ROOT / "db" / "schema.sql"


EDITOR_HTML = r"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SongList Python Editor</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f8;
        --panel: #ffffff;
        --ink: #202428;
        --muted: #5f6a72;
        --line: #d8dde2;
        --accent: #126b61;
        --danger: #9d2d2d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell {
        display: grid;
        grid-template-columns: minmax(260px, 330px) 1fr;
        min-height: 100vh;
      }
      .sidebar {
        border-right: 1px solid var(--line);
        background: var(--panel);
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }
      .stage {
        min-width: 0;
        padding: 22px;
      }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background: rgba(246, 247, 248, 0.96);
        border-bottom: 1px solid var(--line);
        margin: -22px -22px 20px;
        padding: 14px 22px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      .eyebrow {
        margin: 0 0 4px;
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      h1, h2, h3 { margin: 0; }
      h1 { font-size: 1.65rem; }
      h2 { font-size: 1.55rem; }
      h3 { font-size: 1.05rem; }
      .muted { color: var(--muted); }
      .status {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel);
        color: var(--muted);
        padding: 6px 10px;
        white-space: nowrap;
      }
      .status.error {
        border-color: #d99;
        color: var(--danger);
        background: #fff5f5;
      }
      button {
        min-height: 36px;
        border: 1px solid var(--accent);
        border-radius: 6px;
        background: var(--accent);
        color: #fff;
        font: inherit;
        font-weight: 700;
        padding: 7px 12px;
        cursor: pointer;
      }
      button.secondary {
        background: #fff;
        color: var(--accent);
      }
      button.danger {
        border-color: var(--danger);
        background: var(--danger);
      }
      button.ghost {
        border-color: var(--line);
        background: #fff;
        color: var(--ink);
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      label.field {
        display: grid;
        gap: 5px;
        font-weight: 700;
      }
      input, textarea {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        color: var(--ink);
        font: inherit;
        padding: 9px 10px;
      }
      textarea {
        min-height: 180px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        line-height: 1.45;
      }
      .toggle {
        display: flex;
        gap: 8px;
        align-items: center;
        color: var(--ink);
      }
      .toggle input { width: auto; }
      .song-list {
        min-height: 0;
        overflow: auto;
        display: grid;
        gap: 5px;
      }
      .song-list-item {
        border: 1px solid var(--line);
        border-left-width: 5px;
        border-radius: 6px;
        background: #fff;
        color: var(--ink);
        padding: 8px 9px;
        text-align: left;
        font-weight: 650;
      }
      .song-list-item.needs-initial { border-left-color: #ba4a3a; }
      .song-list-item.needs-chordplay { border-left-color: #b7891f; }
      .song-list-item.complete { border-left-color: #2d7a46; }
      .song-list-item.active {
        border-color: var(--accent);
        outline: 2px solid rgba(18, 107, 97, 0.18);
      }
      .form {
        display: grid;
        gap: 14px;
        max-width: 980px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .full { grid-column: 1 / -1; }
      .section-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        padding: 12px;
      }
      .section-head {
        display: flex;
        gap: 10px;
        align-items: end;
        margin-bottom: 10px;
      }
      .section-head .field { max-width: 170px; }
      .import-panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        padding: 12px;
        display: grid;
        gap: 10px;
      }
      .import-panel[hidden] { display: none; }
      @media (max-width: 820px) {
        .shell { grid-template-columns: 1fr; }
        .sidebar { min-height: 320px; border-right: 0; border-bottom: 1px solid var(--line); }
        .grid { grid-template-columns: 1fr; }
        .topbar { align-items: stretch; flex-direction: column; }
        .actions { justify-content: flex-start; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar">
        <div>
          <p class="eyebrow">Song Editor</p>
          <h1>Manage songs</h1>
          <p class="muted">Editing SQLite locally through Python.</p>
        </div>
        <button id="new-song-button" class="secondary" type="button">Add new song</button>
        <label class="field">
          <span>Song library</span>
          <input id="song-search" type="search" placeholder="Filter by title" />
        </label>
        <label class="toggle">
          <input id="initial-filter-input" type="checkbox" checked />
          <span>Only show songs needing initial edit</span>
        </label>
        <div id="song-list" class="song-list" aria-live="polite"></div>
      </aside>

      <main class="stage">
        <div class="topbar">
          <div>
            <p id="editor-mode-label" class="eyebrow">Add Song</p>
            <h2 id="editor-title">New song</h2>
          </div>
          <div class="actions">
            <span id="save-status" class="status">Loading songs...</span>
            <button id="save-song-button" type="submit" form="song-form">Save song</button>
            <button id="delete-song-button" class="danger" type="button">Delete song</button>
            <button id="editor-add-section-button" class="secondary" type="button">Add section</button>
          </div>
        </div>

        <form id="song-form" class="form">
          <div class="grid">
            <label class="field">
              <span>Title</span>
              <input id="song-title-input" name="title" type="text" required />
            </label>
            <label class="field">
              <span>Author</span>
              <input id="song-authors-input" name="authors" type="text" />
            </label>
            <label class="field">
              <span>CCLI Number</span>
              <input id="song-ccli-input" name="ccli" type="text" />
            </label>
            <label class="toggle">
              <input id="song-initial-input" name="initial" type="checkbox" disabled />
              <span>Initial edit completed</span>
            </label>
            <label class="field full">
              <span>Section Order</span>
              <input id="section-order-input" name="sectionOrder" type="text" placeholder="1, 1, C, 2, C, B, C" required />
            </label>
          </div>

          <section id="import-panel" class="import-panel" hidden>
            <h3>Import</h3>
            <label class="field">
              <span>Ultimate Guitar text</span>
              <textarea id="import-source-input" rows="10" placeholder="[Verse 1]\nG            C\nAmazing grace...\n\n[Chorus]\nD\nHow sweet the sound..."></textarea>
            </label>
            <div class="actions">
              <input id="import-file-input" type="file" accept=".txt,.crd,.chopro,text/plain" />
              <button id="import-song-button" class="secondary" type="button">Import into editor</button>
            </div>
            <p id="import-status" class="muted">Import updates sections and section order only.</p>
          </section>

          <section>
            <h3>Sections</h3>
            <div id="sections-container"></div>
          </section>
        </form>
      </main>
    </div>

    <script>
      const songList = document.getElementById("song-list");
      const songSearch = document.getElementById("song-search");
      const newSongButton = document.getElementById("new-song-button");
      const saveStatus = document.getElementById("save-status");
      const editorModeLabel = document.getElementById("editor-mode-label");
      const editorTitle = document.getElementById("editor-title");
      const songForm = document.getElementById("song-form");
      const initialFilterInput = document.getElementById("initial-filter-input");
      const songTitleInput = document.getElementById("song-title-input");
      const songAuthorsInput = document.getElementById("song-authors-input");
      const songCcliInput = document.getElementById("song-ccli-input");
      const songInitialInput = document.getElementById("song-initial-input");
      const sectionOrderInput = document.getElementById("section-order-input");
      const importPanel = document.getElementById("import-panel");
      const importFileInput = document.getElementById("import-file-input");
      const importSourceInput = document.getElementById("import-source-input");
      const importSongButton = document.getElementById("import-song-button");
      const importStatus = document.getElementById("import-status");
      const sectionsContainer = document.getElementById("sections-container");
      const deleteSongButton = document.getElementById("delete-song-button");
      const addSectionButton = document.getElementById("editor-add-section-button");

      let songs = [];
      let activeSongId = null;
      let activeSong = null;
      let dirtyTrackingSuspended = false;
      let hasPendingEdits = false;

      function setStatus(message, isError = false) {
        saveStatus.textContent = message;
        saveStatus.classList.toggle("error", isError);
      }
      function markPendingEdits() {
        if (dirtyTrackingSuspended || hasPendingEdits) return;
        hasPendingEdits = true;
        setStatus("Pending edits");
      }
      function resetDirtyState(status = "Ready") {
        hasPendingEdits = false;
        setStatus(status);
      }
      function getSongStatusTone(song) {
        if (!song?.audit?.initial) return "needs-initial";
        if (!song?.audit?.chordPlay) return "needs-chordplay";
        return "complete";
      }
      function isChordToken(token) {
        return /^[A-G](#|b)?(m|maj|min|sus|aug|dim|add)?\d*(\/[A-G](#|b)?)?$/.test(token);
      }
      function looksLikeChordLine(line) {
        const tokens = line.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return false;
        const chordTokens = tokens.filter(isChordToken).length;
        return chordTokens > 0 && chordTokens / tokens.length >= 0.6;
      }
      function insertInlineChords(chordLine, lyricLine) {
        const matches = [...chordLine.matchAll(/\S+/g)].filter((match) => isChordToken(match[0]));
        const chordIndent = chordLine.match(/^ */)?.[0].length || 0;
        const lyricIndent = lyricLine.match(/^ */)?.[0].length || 0;
        const alignmentOffset = chordIndent - lyricIndent;
        let result = "";
        let cursor = 0;
        for (const match of matches) {
          const insertAt = Math.max(cursor, Math.min((match.index ?? 0) - alignmentOffset, lyricLine.length));
          result += lyricLine.slice(cursor, insertAt) + `[${match[0]}]`;
          cursor = insertAt;
        }
        return result + lyricLine.slice(cursor);
      }
      function parseSectionHeader(line) {
        const match = line.trim().match(/^\[([^[\]]+)\]$/);
        if (!match) return null;
        const label = match[1].trim();
        return label && !isChordToken(label) ? label : null;
      }
      function trimBlankLines(lines) {
        const out = [...lines];
        while (out[0] === "") out.shift();
        while (out[out.length - 1] === "") out.pop();
        return out;
      }
      function buildFallbackSectionId(label) {
        const compact = label.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").trim();
        const initials = compact.split(/\s+/).filter(Boolean).map((part) => part[0]).join("");
        return initials || compact.replace(/\s+/g, "") || "S";
      }
      function getBaseSectionId(label, unlabeledCount) {
        if (!label) return String(unlabeledCount + 1);
        const normalized = label.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
        const match = normalized.match(/^(verse|chorus|bridge|pre chorus|prechorus|intro|outro|ending|tag|refrain|interlude)\s*(\d+)?$/);
        if (!match) return buildFallbackSectionId(label);
        const prefixMap = { verse: "", chorus: "C", bridge: "B", "pre chorus": "P", prechorus: "P", intro: "I", outro: "E", ending: "E", tag: "T", refrain: "R", interlude: "N" };
        const prefix = prefixMap[match[1]];
        const number = match[2] || "";
        if (!prefix) return number || String(unlabeledCount + 1);
        return !number || number === "1" ? prefix : `${prefix}${number}`;
      }
      function normalizeUltimateGuitarSection(lines) {
        const merged = [];
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index].replace(/\s+$/, "");
          if (line.trim() === "") {
            if (merged[merged.length - 1] !== "") merged.push("");
            continue;
          }
          if (looksLikeChordLine(line)) {
            const nextLine = lines[index + 1]?.replace(/\s+$/, "") ?? "";
            if (nextLine.trim() !== "" && !looksLikeChordLine(nextLine) && !parseSectionHeader(nextLine)) {
              merged.push(insertInlineChords(line, nextLine));
              index += 1;
              continue;
            }
            merged.push(line.trim().split(/\s+/).filter(Boolean).map((token) => isChordToken(token) ? `[${token}]` : token).join(" "));
            continue;
          }
          merged.push(line);
        }
        return trimBlankLines(merged).join("\n");
      }
      function parseUltimateGuitarImport(source) {
        const normalized = String(source || "").replace(/\r\n?/g, "\n").trim();
        if (!normalized) throw new Error("Paste Ultimate Guitar text or choose a file to import.");
        const blocks = [];
        let current = { label: null, lines: [] };
        const pushCurrent = () => { if (current.lines.length) blocks.push(current); };
        for (const rawLine of normalized.split("\n")) {
          const header = parseSectionHeader(rawLine);
          if (header) {
            pushCurrent();
            current = { label: header, lines: [] };
          } else {
            current.lines.push(rawLine);
          }
        }
        pushCurrent();
        const sections = {};
        const sectionOrder = [];
        let unlabeledCount = 0;
        for (const block of blocks) {
          const content = normalizeUltimateGuitarSection(block.lines);
          if (!content) continue;
          const baseId = getBaseSectionId(block.label, unlabeledCount);
          if (!block.label) unlabeledCount += 1;
          let sectionId = baseId;
          let suffix = 2;
          while (sections[sectionId] && sections[sectionId].content !== content) {
            sectionId = `${baseId}_${suffix}`;
            suffix += 1;
          }
          if (!sections[sectionId]) sections[sectionId] = { content };
          sectionOrder.push(sectionId);
        }
        if (!sectionOrder.length) throw new Error("No importable song sections were found.");
        return { sections, sectionOrder };
      }
      function createSectionRow(sectionId = "", content = "") {
        const row = document.createElement("article");
        row.className = "section-card";
        row.innerHTML = `
          <div class="section-head">
            <label class="field">
              <span>Section ID</span>
              <input data-field="section-id" type="text" placeholder="1 or C" />
            </label>
            <button class="ghost" type="button">Remove</button>
          </div>
          <label class="field">
            <span>Content</span>
            <textarea data-field="section-content" rows="9" placeholder="[C] Amazing grace..."></textarea>
          </label>
        `;
        row.querySelector('[data-field="section-id"]').value = sectionId;
        row.querySelector('[data-field="section-content"]').value = content;
        row.querySelector("button").addEventListener("click", () => {
          row.remove();
          markPendingEdits();
        });
        return row;
      }
      function getSectionRows() {
        return Array.from(sectionsContainer.querySelectorAll(".section-card"));
      }
      function populateSections(sections) {
        sectionsContainer.innerHTML = "";
        const entries = Object.entries(sections || {});
        if (!entries.length) {
          sectionsContainer.append(createSectionRow("1", ""));
          return;
        }
        for (const [sectionId, section] of entries) {
          sectionsContainer.append(createSectionRow(sectionId, section.content || ""));
        }
      }
      function setFormSong(song) {
        dirtyTrackingSuspended = true;
        activeSong = song ?? null;
        activeSongId = song?.id ?? null;
        editorModeLabel.textContent = activeSongId == null ? "Add Song" : "Edit Song";
        importPanel.hidden = activeSongId != null;
        editorTitle.textContent = song?.title || "New song";
        songTitleInput.value = song?.title || "";
        songAuthorsInput.value = song?.authors || "";
        songCcliInput.value = song?.ccliNum || "";
        songInitialInput.checked = Boolean(song?.audit?.initial);
        sectionOrderInput.value = song?.sectionOrder?.join(", ") || "1";
        populateSections(song?.sections || { 1: { content: "" } });
        deleteSongButton.disabled = activeSongId == null;
        renderSongList();
        dirtyTrackingSuspended = false;
        resetDirtyState("Ready");
      }
      function getFormPayload() {
        const sections = {};
        for (const row of getSectionRows()) {
          const sectionId = row.querySelector('[data-field="section-id"]').value.trim();
          const content = row.querySelector('[data-field="section-content"]').value.trim();
          if (!sectionId && !content) continue;
          if (!sectionId || !content) throw new Error("Each section needs both an ID and content.");
          if (sections[sectionId]) throw new Error(`Section "${sectionId}" appears more than once.`);
          sections[sectionId] = { content };
        }
        return {
          title: songTitleInput.value.trim(),
          authors: songAuthorsInput.value.trim(),
          ccliNum: songCcliInput.value.trim(),
          sectionOrder: sectionOrderInput.value.split(",").map((value) => value.trim()).filter(Boolean),
          sections,
        };
      }
      function renderSongList() {
        const query = songSearch.value.trim().toLowerCase();
        songList.innerHTML = "";
        const filteredSongs = songs.filter((song) => song.title.toLowerCase().includes(query));
        if (!filteredSongs.length) {
          const empty = document.createElement("p");
          empty.className = "muted";
          empty.textContent = "No songs match this filter.";
          songList.append(empty);
          return;
        }
        for (const song of filteredSongs) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `song-list-item ${getSongStatusTone(song)}`;
          button.textContent = song.title;
          button.classList.toggle("active", song.id === activeSongId);
          button.addEventListener("click", () => {
            if (hasPendingEdits && !window.confirm("Load another song and discard pending edits?")) return;
            loadSong(song.id).catch((error) => setStatus(error.message, true));
          });
          songList.append(button);
        }
      }
      async function requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Request failed.");
        return data;
      }
      async function loadSongLibrary(selectedSongId = activeSongId) {
        const params = new URLSearchParams();
        if (initialFilterInput.checked) params.set("initial", "false");
        const data = await requestJson(`/api/songs${params.size ? `?${params}` : ""}`);
        songs = data.songs;
        renderSongList();
        if (selectedSongId != null && songs.some((song) => song.id === selectedSongId)) await loadSong(selectedSongId);
      }
      async function loadSong(songId) {
        setStatus("Loading song...");
        const data = await requestJson(`/api/songs/${songId}`);
        setFormSong(data.song);
      }
      songSearch.addEventListener("input", renderSongList);
      initialFilterInput.addEventListener("change", () => loadSongLibrary().catch((error) => setStatus(error.message, true)));
      newSongButton.addEventListener("click", () => {
        if (hasPendingEdits && !window.confirm("Start a new song and discard pending edits?")) return;
        setFormSong(null);
      });
      addSectionButton.addEventListener("click", () => {
        sectionsContainer.append(createSectionRow("", ""));
        markPendingEdits();
      });
      importFileInput.addEventListener("change", async () => {
        const [file] = importFileInput.files || [];
        if (!file) return;
        importSourceInput.value = await file.text();
        importStatus.textContent = `Loaded ${file.name}.`;
      });
      importSongButton.addEventListener("click", () => {
        try {
          const importedSong = parseUltimateGuitarImport(importSourceInput.value);
          dirtyTrackingSuspended = true;
          sectionOrderInput.value = importedSong.sectionOrder.join(", ");
          populateSections(importedSong.sections);
          dirtyTrackingSuspended = false;
          markPendingEdits();
          importStatus.textContent = `Imported ${Object.keys(importedSong.sections).length} section(s).`;
        } catch (error) {
          importStatus.textContent = error.message;
        }
      });
      deleteSongButton.addEventListener("click", async () => {
        if (activeSongId == null) return;
        const targetSong = songs.find((song) => song.id === activeSongId) || activeSong;
        const confirmation = window.prompt(`Type the song title to delete it:\n\n${targetSong.title}`, "");
        if (confirmation === null) return;
        if (confirmation.trim() !== targetSong.title) {
          setStatus("Delete cancelled: title did not match.", true);
          return;
        }
        try {
          setStatus("Deleting...");
          const data = await requestJson(`/api/songs/${activeSongId}`, { method: "DELETE" });
          setFormSong(null);
          await loadSongLibrary(data.currentSongId);
          resetDirtyState("Ready");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      songForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          setStatus("Saving...");
          const payload = getFormPayload();
          const response = await requestJson(activeSongId == null ? "/api/songs" : `/api/songs/${activeSongId}`, {
            method: activeSongId == null ? "POST" : "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          await loadSongLibrary(response.song.id);
          setFormSong(response.song);
          resetDirtyState("Saved");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      songForm.addEventListener("input", markPendingEdits);
      loadSongLibrary().then(() => {
        if (songs.length) return loadSong(songs[0].id);
        setFormSong(null);
      }).catch((error) => setStatus(error.message, true));
    </script>
  </body>
</html>
"""


def normalize_authors(authors):
    if not isinstance(authors, str):
        return ""
    authors = re.sub(r"\s*\|\s*", " & ", authors)
    authors = re.sub(r"\s*&\s*", " & ", authors)
    return re.sub(r"[ \t]{2,}", " ", authors).strip()


class SongRepository:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        history_keys = self.db.execute("PRAGMA foreign_key_list(performance_event_songs)").fetchall()
        if version > 2 or any(row["from"] == "song_id" and row["on_delete"] != "SET NULL" for row in history_keys):
            self.db.close()
            raise ValueError("This database needs migration. Start the current Node app before using the Python editor.")
        if SCHEMA_PATH.exists():
            self.db.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            self.db.commit()

    def close(self):
        self.db.close()

    def list_song_summaries(self, initial=None):
        params = []
        where = ""
        if isinstance(initial, bool):
            where = "WHERE COALESCE(songaudit.initial, 0) = ?"
            params.append(1 if initial else 0)
        rows = self.db.execute(
            f"""
            SELECT songs.id, songs.title, songs.authors,
                   COALESCE(songaudit.initial, 0) AS initial,
                   COALESCE(songaudit.chordPlay, 0) AS chordPlay
            FROM songs
            LEFT JOIN songaudit ON songaudit.song_id = songs.id
            {where}
            ORDER BY songs.title ASC
            """,
            params,
        ).fetchall()
        return [
            {
                "id": row["id"],
                "title": row["title"],
                "authors": row["authors"],
                "audit": {"initial": bool(row["initial"]), "chordPlay": bool(row["chordPlay"])},
            }
            for row in rows
        ]

    def get_song(self, song_id):
        row = self.db.execute(
            """
            SELECT songs.id, songs.title, songs.authors, songs.ccli_num,
                   songs.lyrics_json, songs.section_order_json,
                   COALESCE(songaudit.initial, 0) AS initial,
                   COALESCE(songaudit.chordPlay, 0) AS chordPlay
            FROM songs
            LEFT JOIN songaudit ON songaudit.song_id = songs.id
            WHERE songs.id = ?
            """,
            (song_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "title": row["title"],
            "authors": row["authors"],
            "ccliNum": row["ccli_num"] or "",
            "audit": {"initial": bool(row["initial"]), "chordPlay": bool(row["chordPlay"])},
            "sections": {key: {"content": value} for key, value in json.loads(row["lyrics_json"]).items()},
            "sectionOrder": json.loads(row["section_order_json"]),
        }

    def validate_song(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("Song payload is required.")
        title = payload.get("title", "")
        title = title.strip() if isinstance(title, str) else ""
        if not title:
            raise ValueError("Song title is required.")
        authors = normalize_authors(payload.get("authors", ""))
        ccli_num = payload.get("ccliNum", "")
        ccli_num = ccli_num.strip() if isinstance(ccli_num, str) else ""
        section_order = payload.get("sectionOrder", [])
        if not isinstance(section_order, list):
            section_order = []
        section_order = [str(section_id).strip() for section_id in section_order if str(section_id).strip()]
        if not section_order:
            raise ValueError("Section order must contain at least one section ID.")
        sections_input = payload.get("sections")
        if not isinstance(sections_input, dict):
            raise ValueError("Sections are required.")
        sections = {}
        for section_id, section in sections_input.items():
            trimmed_id = str(section_id).strip()
            if isinstance(section, dict):
                content = section.get("content", "")
            else:
                content = section
            content = content.strip() if isinstance(content, str) else ""
            if not trimmed_id:
                continue
            if not content:
                raise ValueError(f'Section "{trimmed_id}" must have content.')
            sections[trimmed_id] = content
        if not sections:
            raise ValueError("At least one section with content is required.")
        for section_id in section_order:
            if section_id not in sections:
                raise ValueError(f'Section order references missing section "{section_id}".')
        return {
            "title": title,
            "authors": authors,
            "ccli_num": ccli_num or None,
            "lyrics_json": json.dumps(sections, separators=(",", ":")),
            "section_order_json": json.dumps(section_order, separators=(",", ":")),
        }

    def create_song(self, payload):
        song = self.validate_song(payload)
        with self.lock, self.db:
            cursor = self.db.execute(
                """
                INSERT INTO songs (title, authors, ccli_num, lyrics_json, section_order_json)
                VALUES (:title, :authors, :ccli_num, :lyrics_json, :section_order_json)
                """,
                song,
            )
            song_id = cursor.lastrowid
            self.db.execute(
                """
                INSERT INTO songaudit (song_id, audit_type, initial, chordPlay)
                VALUES (?, 'check', 0, 0)
                ON CONFLICT(song_id) DO NOTHING
                """,
                (song_id,),
            )
        return self.get_song(song_id)

    def update_song(self, song_id, payload):
        song = self.validate_song(payload)
        song["id"] = song_id
        with self.lock, self.db:
            cursor = self.db.execute(
                """
                UPDATE songs
                SET title = :title,
                    authors = :authors,
                    ccli_num = :ccli_num,
                    lyrics_json = :lyrics_json,
                    section_order_json = :section_order_json,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
                """,
                song,
            )
            if cursor.rowcount == 0:
                return None
            self.db.execute(
                """
                INSERT INTO songaudit (song_id, audit_type, initial, chordPlay, updated_at)
                VALUES (?, 'edit', 1, 0, CURRENT_TIMESTAMP)
                ON CONFLICT(song_id) DO UPDATE SET
                  audit_type = 'edit',
                  initial = 1,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (song_id,),
            )
        return self.get_song(song_id)

    def delete_song(self, song_id):
        with self.lock, self.db:
            song = self.get_song(song_id)
            if not song:
                return None
            count = self.db.execute("SELECT COUNT(*) AS count FROM songs").fetchone()["count"]
            if count <= 1:
                raise ValueError("Cannot delete the last remaining song.")
            self.db.execute("DELETE FROM songs WHERE id = ?", (song_id,))
        return song

    def first_song_id(self):
        row = self.db.execute("SELECT id FROM songs ORDER BY title ASC LIMIT 1").fetchone()
        return row["id"] if row else None


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler, status, body, content_type="text/html; charset=utf-8"):
    data = body.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class EditorHandler(BaseHTTPRequestHandler):
    repository = None

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")

    def request_is_local(self):
        expected = f"{self.headers.get('Host', '')}"
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        origin = self.headers.get("Origin")
        if expected not in allowed or (origin is not None and origin != f"http://{expected}"):
            json_response(self, HTTPStatus.FORBIDDEN, {"error": "Local same-origin requests only."})
            return False
        return True

    def do_GET(self):
        if not self.request_is_local():
            return
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/editor.html"):
            text_response(self, HTTPStatus.OK, EDITOR_HTML)
            return
        if parsed.path == "/api/songs":
            query = parse_qs(parsed.query)
            initial = None
            if query.get("initial", [None])[0] == "true":
                initial = True
            elif query.get("initial", [None])[0] == "false":
                initial = False
            json_response(self, HTTPStatus.OK, {"songs": self.repository.list_song_summaries(initial=initial)})
            return
        match = re.match(r"^/api/songs/(\d+)$", parsed.path)
        if match:
            song = self.repository.get_song(int(match.group(1)))
            if not song:
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "Song not found."})
                return
            json_response(self, HTTPStatus.OK, {"song": song})
            return
        if parsed.path == "/health":
            json_response(self, HTTPStatus.OK, {"ok": True, "songs": len(self.repository.list_song_summaries())})
            return
        text_response(self, HTTPStatus.NOT_FOUND, "Not found", "text/plain; charset=utf-8")

    def do_POST(self):
        if not self.request_is_local():
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/songs":
            try:
                song = self.repository.create_song(self.read_json_body())
                json_response(self, HTTPStatus.OK, {"song": song, "songs": self.repository.list_song_summaries()})
            except ValueError as error:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        text_response(self, HTTPStatus.NOT_FOUND, "Not found", "text/plain; charset=utf-8")

    def do_PUT(self):
        if not self.request_is_local():
            return
        parsed = urlparse(self.path)
        match = re.match(r"^/api/songs/(\d+)$", parsed.path)
        if match:
            try:
                song = self.repository.update_song(int(match.group(1)), self.read_json_body())
                if not song:
                    json_response(self, HTTPStatus.NOT_FOUND, {"error": "Song not found."})
                    return
                json_response(self, HTTPStatus.OK, {"song": song, "songs": self.repository.list_song_summaries()})
            except ValueError as error:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        text_response(self, HTTPStatus.NOT_FOUND, "Not found", "text/plain; charset=utf-8")

    def do_DELETE(self):
        if not self.request_is_local():
            return
        parsed = urlparse(self.path)
        match = re.match(r"^/api/songs/(\d+)$", parsed.path)
        if match:
            try:
                deleted = self.repository.delete_song(int(match.group(1)))
                if not deleted:
                    json_response(self, HTTPStatus.NOT_FOUND, {"error": "Song not found."})
                    return
                json_response(
                    self,
                    HTTPStatus.OK,
                    {
                        "deletedSongId": deleted["id"],
                        "songs": self.repository.list_song_summaries(),
                        "currentSongId": self.repository.first_song_id(),
                    },
                )
            except ValueError as error:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        text_response(self, HTTPStatus.NOT_FOUND, "Not found", "text/plain; charset=utf-8")

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            return json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            raise ValueError("Request body must be JSON.")


def parse_args():
    parser = argparse.ArgumentParser(description="Run the local Python SongList editor.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help=f"SQLite path, default: {DEFAULT_DB_PATH}")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind, default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind, default: 8765")
    parser.add_argument("--no-open", action="store_true", help="Do not open the editor in a browser")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.host not in ("127.0.0.1", "localhost"):
        raise ValueError("The standalone editor is local only. Use the authenticated Node editor for network access.")
    repository = SongRepository(args.db)
    EditorHandler.repository = repository
    server = ThreadingHTTPServer((args.host, args.port), EditorHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"SongList Python editor listening on {url} using SQLite at {args.db}")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down editor.")
    finally:
        server.server_close()
        repository.close()


if __name__ == "__main__":
    main()

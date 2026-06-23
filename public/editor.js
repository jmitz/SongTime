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
const importFormatSelect = document.getElementById("import-format-select");
const importFileInput = document.getElementById("import-file-input");
const importSourceInput = document.getElementById("import-source-input");
const importSongButton = document.getElementById("import-song-button");
const importStatus = document.getElementById("import-status");
const sectionsContainer = document.getElementById("sections-container");
const saveSongButton = document.getElementById("save-song-button");
const deleteSongButton = document.getElementById("delete-song-button");
const addSectionButton = document.getElementById("editor-add-section-button");
const shutdownSystemButton = document.getElementById("shutdown-system-button");

let songs = [];
let activeSongId = null;
let activeSong = null;
let dirtyTrackingSuspended = false;
let hasPendingEdits = false;
const defaultImportStatus =
  "Import updates the current form and keeps the title, author, and CCLI fields as they are.";

function getSongStatusTone(song) {
  if (!song?.audit?.initial) {
    return "song-status-needs-initial";
  }

  if (!song?.audit?.chordPlay) {
    return "song-status-needs-chordplay";
  }

  return "song-status-complete";
}

function setStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("pill-error", isError);
}

function updateSaveButtonState() {
  saveSongButton.disabled = !hasPendingEdits;
}

function setImportStatus(message, isError = false) {
  importStatus.textContent = message;
  importStatus.classList.toggle("pill-error", isError);
}

function resetImportState() {
  importFormatSelect.value = "ultimate-guitar";
  importFileInput.value = "";
  importSourceInput.value = "";
  setImportStatus(defaultImportStatus);
}

function updateEditorMode() {
  const isNewSong = activeSongId == null;
  editorModeLabel.textContent = isNewSong ? "Add Song" : "Edit Song";
  importPanel.hidden = !isNewSong;
}

function resetDirtyState(status = "Ready") {
  hasPendingEdits = false;
  setStatus(status);
  updateSaveButtonState();
}

function markPendingEdits() {
  if (dirtyTrackingSuspended || hasPendingEdits) {
    return;
  }

  hasPendingEdits = true;
  setStatus("Pending edits");
  updateSaveButtonState();
}

function isChordToken(token) {
  return /^[A-G](#|b)?(m|maj|min|sus|aug|dim|add)?\d*(\/[A-G](#|b)?)?$/.test(token);
}

function looksLikeChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  const chordTokens = tokens.filter(isChordToken).length;
  return chordTokens > 0 && chordTokens / tokens.length >= 0.6;
}

function insertInlineChords(chordLine, lyricLine) {
  const chordMatches = [...chordLine.matchAll(/\S+/g)].filter((match) => isChordToken(match[0]));
  if (chordMatches.length === 0) {
    return lyricLine;
  }

  const chordIndent = chordLine.match(/^ */)?.[0].length || 0;
  const lyricIndent = lyricLine.match(/^ */)?.[0].length || 0;
  const alignmentOffset = chordIndent - lyricIndent;
  let result = "";
  let cursor = 0;

  for (const match of chordMatches) {
    const insertAt = Math.max(
      cursor,
      Math.min((match.index ?? 0) - alignmentOffset, lyricLine.length),
    );
    result += lyricLine.slice(cursor, insertAt);
    result += `[${match[0]}]`;
    cursor = insertAt;
  }

  result += lyricLine.slice(cursor);
  return result;
}

function trimBlankLines(lines) {
  const trimmedLines = [...lines];

  while (trimmedLines[0] === "") {
    trimmedLines.shift();
  }

  while (trimmedLines[trimmedLines.length - 1] === "") {
    trimmedLines.pop();
  }

  return trimmedLines;
}

function parseSectionHeader(line) {
  const match = line.trim().match(/^\[([^[\]]+)\]$/);
  if (!match) {
    return null;
  }

  const label = match[1].trim();
  if (!label || isChordToken(label)) {
    return null;
  }

  return label;
}

function buildFallbackSectionId(label) {
  const compact = label
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim();

  if (!compact) {
    return "S";
  }

  const initials = compact
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("");

  return initials || compact.replace(/\s+/g, "");
}

function getBaseSectionId(label, unlabeledCount) {
  if (!label) {
    return String(unlabeledCount + 1);
  }

  const normalized = label
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const numberedMatch = normalized.match(/^(verse|chorus|bridge|pre chorus|prechorus|intro|outro|ending|tag|refrain|interlude)\s*(\d+)?$/);
  const sectionNumber = numberedMatch?.[2] || "";

  if (numberedMatch) {
    const prefixMap = {
      verse: "",
      chorus: "C",
      bridge: "B",
      "pre chorus": "P",
      prechorus: "P",
      intro: "I",
      outro: "E",
      ending: "E",
      tag: "T",
      refrain: "R",
      interlude: "N",
    };
    const prefix = prefixMap[numberedMatch[1]];

    if (!prefix) {
      return sectionNumber || String(unlabeledCount + 1);
    }

    if (!sectionNumber || sectionNumber === "1") {
      return prefix;
    }

    return `${prefix}${sectionNumber}`;
  }

  return buildFallbackSectionId(label);
}

function makeUniqueSectionId(baseId, sections) {
  if (!sections[baseId]) {
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}_${suffix}`;
  while (sections[candidate]) {
    suffix += 1;
    candidate = `${baseId}_${suffix}`;
  }

  return candidate;
}

function normalizeUltimateGuitarSection(lines) {
  const mergedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\s+$/, "");
    if (line.trim() === "") {
      if (mergedLines[mergedLines.length - 1] !== "") {
        mergedLines.push("");
      }
      continue;
    }

    if (looksLikeChordLine(line)) {
      const nextLine = lines[index + 1]?.replace(/\s+$/, "") ?? "";
      if (
        nextLine.trim() !== "" &&
        !looksLikeChordLine(nextLine) &&
        !parseSectionHeader(nextLine)
      ) {
        mergedLines.push(insertInlineChords(line, nextLine));
        index += 1;
        continue;
      }

      mergedLines.push(
        line
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((token) => (isChordToken(token) ? `[${token}]` : token))
          .join(" "),
      );
      continue;
    }

    mergedLines.push(line);
  }

  return trimBlankLines(mergedLines).join("\n");
}

function parseUltimateGuitarImport(source) {
  const normalized = String(source || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    throw new Error("Paste Ultimate Guitar text or choose a file to import.");
  }

  const blocks = [];
  let currentBlock = { label: null, lines: [] };

  function pushCurrentBlock() {
    if (currentBlock.lines.length === 0) {
      return;
    }

    blocks.push(currentBlock);
  }

  for (const rawLine of normalized.split("\n")) {
    const header = parseSectionHeader(rawLine);
    if (header) {
      pushCurrentBlock();
      currentBlock = { label: header, lines: [] };
      continue;
    }

    currentBlock.lines.push(rawLine);
  }

  pushCurrentBlock();

  if (blocks.length === 0) {
    throw new Error("No importable lyrics were found in that Ultimate Guitar text.");
  }

  const sections = {};
  const sectionOrder = [];
  let unlabeledCount = 0;

  for (const block of blocks) {
    const content = normalizeUltimateGuitarSection(block.lines);
    if (!content) {
      continue;
    }

    const baseId = getBaseSectionId(block.label, unlabeledCount);
    if (!block.label) {
      unlabeledCount += 1;
    }

    let sectionId = baseId;
    if (sections[sectionId]?.content && sections[sectionId].content !== content) {
      sectionId = makeUniqueSectionId(baseId, sections);
    }

    if (!sections[sectionId]) {
      sections[sectionId] = { content };
    }

    sectionOrder.push(sectionId);
  }

  if (sectionOrder.length === 0) {
    throw new Error("No importable song sections were found in that Ultimate Guitar text.");
  }

  return {
    sections,
    sectionOrder,
  };
}

function applyImportedSongData(importedSong) {
  dirtyTrackingSuspended = true;
  sectionOrderInput.value = importedSong.sectionOrder.join(", ");
  populateSections(importedSong.sections);
  dirtyTrackingSuspended = false;
  markPendingEdits();
}

function createSectionRow(sectionId = "", content = "") {
  const row = document.createElement("article");
  row.className = "section-card";

  const header = document.createElement("div");
  header.className = "section-card-header";

  const idLabel = document.createElement("label");
  idLabel.className = "field";
  const idText = document.createElement("span");
  idText.textContent = "Section ID";
  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.value = sectionId;
  idInput.dataset.field = "section-id";
  idInput.placeholder = "1 or C";
  idLabel.append(idText, idInput);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "button button-ghost";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    row.remove();
    markPendingEdits();
  });

  header.append(idLabel, removeButton);

  const contentLabel = document.createElement("label");
  contentLabel.className = "field";
  const contentText = document.createElement("span");
  contentText.textContent = "Content";
  const contentInput = document.createElement("textarea");
  contentInput.rows = 9;
  contentInput.dataset.field = "section-content";
  contentInput.placeholder = "[C] Amazing grace...\nWhen we've been there...";
  contentInput.value = content;
  contentLabel.append(contentText, contentInput);

  row.append(header, contentLabel);
  return row;
}

function getSectionRows() {
  return Array.from(sectionsContainer.querySelectorAll(".section-card"));
}

function populateSections(sections) {
  sectionsContainer.innerHTML = "";
  const entries = Object.entries(sections);
  if (entries.length === 0) {
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
  updateEditorMode();
  resetImportState();
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

    if (!sectionId && !content) {
      continue;
    }

    if (!sectionId || !content) {
      throw new Error("Each section needs both an ID and content.");
    }

    if (sections[sectionId]) {
      throw new Error(`Section "${sectionId}" appears more than once.`);
    }

    sections[sectionId] = { content };
  }

  return {
    title: songTitleInput.value.trim(),
    authors: songAuthorsInput.value.trim(),
    ccliNum: songCcliInput.value.trim(),
    sectionOrder: sectionOrderInput.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    sections,
  };
}

function renderSongList() {
  const query = songSearch.value.trim().toLowerCase();
  songList.innerHTML = "";

  const filteredSongs = songs.filter((song) => song.title.toLowerCase().includes(query));
  if (filteredSongs.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "muted";
    emptyState.textContent = "No songs match this filter.";
    songList.append(emptyState);
    return;
  }

  for (const song of filteredSongs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song-list-item";
    button.textContent = song.title;
    button.classList.add(getSongStatusTone(song));
    button.classList.toggle("active", song.id === activeSongId);
    button.addEventListener("click", () => {
      loadSong(song.id).catch((error) => {
        setStatus(error.message, true);
      });
    });
    songList.append(button);
  }
}

async function loadSongLibrary(selectedSongId = activeSongId) {
  const params = new URLSearchParams();
  if (initialFilterInput.checked) {
    params.set("initial", "false");
  }

  const response = await fetch(`/api/songs${params.size > 0 ? `?${params.toString()}` : ""}`);
  if (!response.ok) {
    throw new Error("Unable to load songs.");
  }

  const data = await response.json();
  songs = data.songs;
  renderSongList();

  if (selectedSongId == null || songs.length === 0) {
    return;
  }

  const exists = songs.some((song) => song.id === selectedSongId);
  if (!exists) {
    return;
  }

  await loadSong(selectedSongId);
}

async function loadSong(songId) {
  setStatus("Loading song...");
  const response = await fetch(`/api/songs/${songId}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Unable to load song.");
  }

  setFormSong(data.song);
  setStatus("Ready");
}

songSearch.addEventListener("input", () => {
  renderSongList();
});

initialFilterInput.addEventListener("change", () => {
  loadSongLibrary().catch((error) => {
    setStatus(error.message, true);
  });
});

newSongButton.addEventListener("click", () => {
  setFormSong(null);
  resetDirtyState("Ready");
});

addSectionButton.addEventListener("click", () => {
  sectionsContainer.append(createSectionRow("", ""));
  markPendingEdits();
});

shutdownSystemButton.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Shut down SongList and close the SQLite database? Connected leader and user pages will disconnect.",
  );
  if (!confirmed) {
    return;
  }

  try {
    shutdownSystemButton.disabled = true;
    setStatus("Shutting down...");
    const response = await fetch("/api/shutdown", {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to shut down the system.");
    }

    setStatus("System shutting down. SQLite database will be closed.");
  } catch (error) {
    shutdownSystemButton.disabled = false;
    setStatus(error.message, true);
  }
});

importFileInput.addEventListener("change", async () => {
  const [file] = importFileInput.files || [];
  if (!file) {
    return;
  }

  try {
    importSourceInput.value = await file.text();
    setImportStatus(`Loaded ${file.name}. Review the text, then import it into the editor.`);
  } catch (error) {
    setImportStatus(error.message || "Unable to read that file.", true);
  }
});

importSongButton.addEventListener("click", () => {
  try {
    if (importFormatSelect.value !== "ultimate-guitar") {
      throw new Error("That import format is not available yet.");
    }

    const importedSong = parseUltimateGuitarImport(importSourceInput.value);
    applyImportedSongData(importedSong);
    setImportStatus(
      `Imported ${Object.keys(importedSong.sections).length} section(s). Section order: ${importedSong.sectionOrder.join(", ")}.`,
    );
  } catch (error) {
    setImportStatus(error.message, true);
  }
});

deleteSongButton.addEventListener("click", async () => {
  if (activeSongId == null) {
    return;
  }

  const song = songs.find((entry) => entry.id === activeSongId);
  if (!song && !activeSong) {
    setStatus("Song not found.", true);
    return;
  }

  const targetSong = song || activeSong;
  const confirmation = window.prompt(
    `Type the song title to delete it:\n\n${targetSong.title}`,
    "",
  );
  if (confirmation === null) {
    return;
  }

  if (confirmation.trim() !== targetSong.title) {
    setStatus("Delete cancelled: title did not match.", true);
    return;
  }

  try {
    setStatus("Deleting...");
    const response = await fetch(`/api/songs/${activeSongId}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to delete song.");
    }

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
    const payload = getFormPayload();
    setStatus("Saving...");

    const isEditing = activeSongId != null;
    const response = await fetch(isEditing ? `/api/songs/${activeSongId}` : "/api/songs", {
      method: isEditing ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save song.");
    }

    setFormSong(data.song);
    await loadSongLibrary(data.song.id);
    setFormSong(data.song);
    resetDirtyState("Saved");
  } catch (error) {
    setStatus(error.message, true);
  }
});

songForm.addEventListener("input", () => {
  markPendingEdits();
});

async function init() {
  await loadSongLibrary();

  if (songs.length > 0) {
    await loadSong(songs[0].id);
  } else {
    setFormSong(null);
    setStatus("Ready");
  }
}

init().catch((error) => {
  setStatus(error.message, true);
});

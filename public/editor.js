const songList = document.getElementById("song-list");
const songSearch = document.getElementById("song-search");
const newSongButton = document.getElementById("new-song-button");
const saveStatus = document.getElementById("save-status");
const editorTitle = document.getElementById("editor-title");
const songForm = document.getElementById("song-form");
const initialFilterInput = document.getElementById("initial-filter-input");
const songTitleInput = document.getElementById("song-title-input");
const songAuthorsInput = document.getElementById("song-authors-input");
const songCcliInput = document.getElementById("song-ccli-input");
const songInitialInput = document.getElementById("song-initial-input");
const sectionOrderInput = document.getElementById("section-order-input");
const sectionsContainer = document.getElementById("sections-container");
const saveSongButton = document.getElementById("save-song-button");
const deleteSongButton = document.getElementById("delete-song-button");
const addSectionButton = document.getElementById("editor-add-section-button");

let songs = [];
let activeSongId = null;
let activeSong = null;
let dirtyTrackingSuspended = false;
let hasPendingEdits = false;

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
  if (!window.confirm(`Delete "${targetSong.title}"? This cannot be undone.`)) {
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

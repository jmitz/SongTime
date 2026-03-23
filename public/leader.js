const songSelect = document.getElementById("song-select");
const songTitle = document.getElementById("song-title");
const sectionLabel = document.getElementById("section-label");
const songContent = document.getElementById("song-content");
const leaderCount = document.getElementById("leader-count");
const userCount = document.getElementById("user-count");
const editModeToggle = document.getElementById("edit-mode-toggle");
const editStatus = document.getElementById("edit-status");
const leaderEditActions = document.getElementById("leader-edit-actions");
const newChordInput = document.getElementById("new-chord-input");
const insertChordButton = document.getElementById("insert-chord-button");
const deleteChordButton = document.getElementById("delete-chord-button");
const saveChordsButton = document.getElementById("save-chords-button");
const resetChordsButton = document.getElementById("reset-chords-button");

let socket;
let suppressScrollBroadcast = false;
let selectedSongId = null;
let currentSong = null;
let currentSection = null;
let currentSectionIndex = 0;
let isSaving = false;
let draftSectionKey = null;
let draftSectionLines = null;
let draftDirty = false;
let dragState = null;
let measuredCharacterWidth = null;
let selectedChord = null;
let insertMode = false;

function resolveSection(song, section, sectionIndex = 0) {
  if (section) {
    return section;
  }

  if (song?.sections && song.sectionOrder?.length) {
    const sectionId = song.sectionOrder[sectionIndex] || song.sectionOrder[0];
    if (sectionId && song.sections[sectionId]) {
      return {
        id: sectionId,
        ...song.sections[sectionId],
      };
    }
  }

  return null;
}

function formatSectionLabel(section) {
  if (!section) {
    return "";
  }

  if (section.label) {
    return section.label;
  }

  if (/^\d+$/.test(section.id)) {
    return `Verse ${section.id}`;
  }

  const match = section.id.match(/^([A-Za-z]+)(\d*)$/);
  if (!match) {
    return section.id;
  }

  const lookup = {
    V: "Verse",
    C: "Chorus",
    B: "Bridge",
    E: "Ending",
  };
  const description = lookup[match[1].toUpperCase()] || match[1].toUpperCase();
  return match[2] ? `${description} ${match[2]}` : description;
}

function getCurrentSectionKey(song = currentSong, section = currentSection) {
  if (!song || !section) {
    return null;
  }

  return `${song.id}:${section.id}`;
}

function parseChordLine(line) {
  const chords = [];
  const pattern = /\[([^[\]]+)\]/g;
  let lyricLine = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    lyricLine += line.slice(lastIndex, match.index);
    chords.push({
      text: match[1],
      position: lyricLine.length,
      order: chords.length,
    });
    lastIndex = pattern.lastIndex;
  }

  lyricLine += line.slice(lastIndex);

  return {
    lyrics: lyricLine,
    chords,
  };
}

function parseChordContent(content) {
  return String(content || "").split("\n").map(parseChordLine);
}

function serializeChordLine(line) {
  const lyrics = line?.lyrics || "";
  const chords = Array.isArray(line?.chords) ? [...line.chords] : [];
  const normalized = chords
    .map((chord, index) => ({
      text: chord.text,
      position: Math.max(0, Math.min(lyrics.length, Number(chord.position) || 0)),
      order: chord.order ?? index,
    }))
    .sort((left, right) => left.position - right.position || left.order - right.order);

  let result = "";
  let cursor = 0;

  for (const chord of normalized) {
    result += lyrics.slice(cursor, chord.position);
    result += `[${chord.text}]`;
    cursor = chord.position;
  }

  result += lyrics.slice(cursor);
  return result;
}

function serializeChordContent(lines) {
  return (lines || []).map(serializeChordLine).join("\n");
}

function getCharacterWidth() {
  if (measuredCharacterWidth) {
    return measuredCharacterWidth;
  }

  const probe = document.createElement("span");
  probe.textContent = "0000000000";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.font = window.getComputedStyle(songContent).font;
  songContent.append(probe);
  measuredCharacterWidth = probe.getBoundingClientRect().width / 10 || 10;
  probe.remove();
  return measuredCharacterWidth;
}

function invalidateCharacterWidth() {
  measuredCharacterWidth = null;
}

function resetDraft(content = currentSection?.content || "") {
  draftSectionKey = getCurrentSectionKey();
  draftSectionLines = parseChordContent(content);
  draftDirty = false;
}

function ensureDraftForCurrentSection() {
  const currentKey = getCurrentSectionKey();
  if (!currentKey) {
    draftSectionKey = null;
    draftSectionLines = null;
    draftDirty = false;
    return;
  }

  if (draftSectionKey !== currentKey || !draftSectionLines) {
    resetDraft();
  }
}

function setEditStatus(message, isError = false) {
  editStatus.textContent = message;
  editStatus.classList.toggle("pill-error", isError);
}

function clearSelectedChord() {
  selectedChord = null;
}

function findChordIndex(lineIndex, chordOrder) {
  return draftSectionLines?.[lineIndex]?.chords.findIndex((chord) => chord.order === chordOrder) ?? -1;
}

function getNextChordOrder(line) {
  if (!line?.chords?.length) {
    return 0;
  }

  return Math.max(...line.chords.map((chord) => chord.order)) + 1;
}

function isEditModeEnabled() {
  return editModeToggle.checked;
}

function updateEditControls() {
  const enabled = isEditModeEnabled();
  leaderEditActions.hidden = !enabled;
  newChordInput.disabled = !enabled || isSaving;
  insertChordButton.disabled = !enabled || isSaving;
  deleteChordButton.disabled = !enabled || isSaving || !selectedChord;
  saveChordsButton.disabled = !enabled || !draftDirty || isSaving;
  resetChordsButton.disabled = !enabled || isSaving || !draftSectionLines;
  insertChordButton.classList.toggle("button-danger", insertMode);
  insertChordButton.classList.toggle("button-secondary", !insertMode);
}

function syncEditPanel() {
  const enabled = isEditModeEnabled();

  if (!enabled) {
    insertMode = false;
    clearSelectedChord();
    setEditStatus("Edit mode off");
    updateEditControls();
    return;
  }

  if (!currentSection) {
    setEditStatus("No section selected", true);
    updateEditControls();
    return;
  }

  ensureDraftForCurrentSection();

  if (isSaving) {
    setEditStatus("Saving...");
  } else if (insertMode) {
    setEditStatus("Click a lyric line to place the new chord");
  } else if (draftDirty) {
    setEditStatus("Unsaved chord changes");
  } else {
    setEditStatus("Drag chords in the song view");
  }

  updateEditControls();
}

function createChordRow(line, lineIndex, editable) {
  const row = document.createElement("div");
  row.className = "leader-chord-row";

  if (!line.lyrics && line.chords.length === 0) {
    row.append(document.createElement("br"));
    return row;
  }

  const track = document.createElement("div");
  track.className = "leader-chord-track";
  track.dataset.lineIndex = String(lineIndex);
  if (editable && insertMode) {
    track.classList.add("leader-chord-track-insert");
  }

  const columns = Math.max(
    1,
    line.lyrics.length,
    ...line.chords.map((chord) => chord.position + chord.text.length),
  );
  track.style.width = `${columns * getCharacterWidth()}px`;

  const lyric = document.createElement("span");
  lyric.className = "leader-lyric-line";
  lyric.textContent = line.lyrics || " ";
  track.append(lyric);

  const sortedChords = [...line.chords].sort((left, right) => left.position - right.position || left.order - right.order);
  sortedChords.forEach((chord) => {
    const marker = document.createElement(editable ? "button" : "span");
    marker.className = "leader-chord-marker";
    marker.textContent = chord.text;
    marker.style.left = `${chord.position * getCharacterWidth()}px`;
    marker.dataset.lineIndex = String(lineIndex);
    marker.dataset.chordOrder = String(chord.order);
    if (
      editable &&
      selectedChord &&
      selectedChord.lineIndex === lineIndex &&
      selectedChord.chordOrder === chord.order
    ) {
      marker.classList.add("leader-chord-marker-selected");
    }

    if (editable) {
      marker.type = "button";
      marker.classList.add("leader-chord-marker-draggable");
      marker.setAttribute("aria-label", `Drag chord ${chord.text}`);
    }

    track.append(marker);
  });

  row.append(track);
  return row;
}

function renderChordContent(lines, editable = false) {
  const fragment = document.createDocumentFragment();

  lines.forEach((line, lineIndex) => {
    fragment.append(createChordRow(line, lineIndex, editable));
  });

  return fragment;
}

function renderSong(song, section) {
  selectedSongId = song.id;
  currentSong = song;
  currentSection = section;
  songTitle.textContent = song.title;
  sectionLabel.textContent = formatSectionLabel(section);

  if (isEditModeEnabled()) {
    ensureDraftForCurrentSection();
  }

  const renderedLines =
    isEditModeEnabled() && draftSectionKey === getCurrentSectionKey()
      ? draftSectionLines
      : parseChordContent(section?.content || "");

  songContent.replaceChildren(renderChordContent(renderedLines, isEditModeEnabled()));
  syncEditPanel();
}

function renderSongOptions(songs) {
  const previousSelection = selectedSongId ?? songSelect.value;
  songSelect.innerHTML = "";

  for (const song of songs) {
    const option = document.createElement("option");
    option.value = song.id;
    option.textContent = song.title;
    songSelect.append(option);
  }

  if (previousSelection) {
    songSelect.value = String(previousSelection);
  }
}

function applyState(state) {
  leaderCount.textContent = String(state.leaderCount);
  userCount.textContent = String(state.userCount);

  if (!state.currentSong) {
    return;
  }

  currentSectionIndex = state.currentSectionIndex;
  renderSong(state.currentSong, resolveSection(state.currentSong, state.currentSection, state.currentSectionIndex));
  songSelect.value = state.currentSongId;
  applyScroll(state.scrollRatio);
}

function applyScroll(scrollRatio) {
  suppressScrollBroadcast = true;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ top: maxScroll * scrollRatio, behavior: "auto" });
  window.setTimeout(() => {
    suppressScrollBroadcast = false;
  }, 50);
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "register", role: "leader" }));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      applyState(message.payload);
    }

    if (message.type === "scroll") {
      applyScroll(message.payload.scrollRatio);
    }

    if (message.type === "songs") {
      renderSongOptions(message.payload.songs);
    }
  });

  socket.addEventListener("close", () => {
    window.setTimeout(connect, 1000);
  });
}

function changeSongSelection(step) {
  const currentIndex = songSelect.selectedIndex;
  if (currentIndex < 0) {
    return;
  }

  const nextIndex = Math.max(0, Math.min(songSelect.options.length - 1, currentIndex + step));
  if (nextIndex === currentIndex) {
    return;
  }

  songSelect.selectedIndex = nextIndex;
  socket.send(JSON.stringify({ type: "set-song", songId: songSelect.value }));
}

function startDrag(event) {
  if (!isEditModeEnabled() || !draftSectionLines) {
    return;
  }

  const marker = event.target.closest(".leader-chord-marker-draggable");
  if (!marker) {
    return;
  }

  const lineIndex = Number(marker.dataset.lineIndex);
  const chordOrder = Number(marker.dataset.chordOrder);
  const track = marker.closest(".leader-chord-track");
  if (!Number.isInteger(lineIndex) || !Number.isInteger(chordOrder) || !track) {
    return;
  }

  const chordIndex = draftSectionLines?.[lineIndex]?.chords.findIndex((chord) => chord.order === chordOrder);
  if (!Number.isInteger(chordIndex) || chordIndex < 0) {
    return;
  }

  event.preventDefault();
  insertMode = false;
  selectedChord = { lineIndex, chordOrder };
  dragState = {
    pointerId: event.pointerId,
    marker,
    track,
    lineIndex,
    chordIndex,
  };

  marker.classList.add("leader-chord-marker-active");
  setEditStatus("Dragging chord");
  updateEditControls();
  window.addEventListener("pointermove", handleDragMove);
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);
}

function handleDragMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const line = draftSectionLines?.[dragState.lineIndex];
  if (!line) {
    return;
  }

  const trackRect = dragState.track.getBoundingClientRect();
  const nextPosition = Math.max(
    0,
    Math.min(line.lyrics.length, Math.round((event.clientX - trackRect.left) / getCharacterWidth())),
  );
  const chord = line.chords[dragState.chordIndex];
  if (!chord || chord.position === nextPosition) {
    return;
  }

  chord.position = nextPosition;
  draftDirty = true;
  dragState.marker.style.left = `${nextPosition * getCharacterWidth()}px`;
  setEditStatus("Unsaved chord changes");
  updateEditControls();
}

function finishDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  dragState.marker.classList.remove("leader-chord-marker-active");
  dragState = null;
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", finishDrag);
  window.removeEventListener("pointercancel", finishDrag);

  if (currentSong && currentSection) {
    renderSong(currentSong, currentSection);
  }
}

function selectChord(marker) {
  const lineIndex = Number(marker.dataset.lineIndex);
  const chordOrder = Number(marker.dataset.chordOrder);
  if (!Number.isInteger(lineIndex) || !Number.isInteger(chordOrder)) {
    return;
  }

  insertMode = false;
  selectedChord = { lineIndex, chordOrder };
  renderSong(currentSong, currentSection);
}

function insertChordAtTrack(track, clientX) {
  if (!draftSectionLines) {
    return;
  }

  const chordText = newChordInput.value.trim();
  if (!chordText) {
    setEditStatus("Enter a chord to insert", true);
    newChordInput.focus();
    return;
  }

  const lineIndex = Number(track.dataset.lineIndex);
  const line = draftSectionLines[lineIndex];
  if (!Number.isInteger(lineIndex) || !line) {
    return;
  }

  const trackRect = track.getBoundingClientRect();
  const nextPosition = Math.max(
    0,
    Math.min(line.lyrics.length, Math.round((clientX - trackRect.left) / getCharacterWidth())),
  );
  const chordOrder = getNextChordOrder(line);
  line.chords.push({
    text: chordText,
    position: nextPosition,
    order: chordOrder,
  });

  draftDirty = true;
  insertMode = false;
  selectedChord = { lineIndex, chordOrder };
  renderSong(currentSong, currentSection);
  setEditStatus("Chord inserted");
}

function deleteSelectedChord() {
  if (!selectedChord || !draftSectionLines) {
    return;
  }

  const chordIndex = findChordIndex(selectedChord.lineIndex, selectedChord.chordOrder);
  if (chordIndex < 0) {
    clearSelectedChord();
    renderSong(currentSong, currentSection);
    return;
  }

  draftSectionLines[selectedChord.lineIndex].chords.splice(chordIndex, 1);
  draftDirty = true;
  clearSelectedChord();
  renderSong(currentSong, currentSection);
  setEditStatus("Chord deleted");
}

async function saveChordChanges() {
  if (!currentSong || !currentSection || !draftSectionLines) {
    setEditStatus("No section selected", true);
    return;
  }

  isSaving = true;
  syncEditPanel();

  try {
    const updatedSections = Object.fromEntries(
      Object.entries(currentSong.sections).map(([sectionId, section]) => [
        sectionId,
        {
          ...section,
          content: sectionId === currentSection.id ? serializeChordContent(draftSectionLines) : section.content,
        },
      ]),
    );

    const response = await fetch(`/api/songs/${currentSong.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: currentSong.title,
        ccliNum: currentSong.ccliNum || "",
        sectionOrder: currentSong.sectionOrder,
        sections: updatedSections,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save section.");
    }

    currentSong = data.song;
    currentSection = resolveSection(data.song, null, currentSectionIndex);
    resetDraft(currentSection?.content || "");
    insertMode = false;
    clearSelectedChord();
    renderSong(data.song, currentSection);
    setEditStatus("Chord changes saved");
  } catch (error) {
    setEditStatus(error.message, true);
  } finally {
    isSaving = false;
    updateEditControls();
  }
}

songSelect.addEventListener("change", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ type: "set-song", songId: songSelect.value }));
});

editModeToggle.addEventListener("change", () => {
  if (isEditModeEnabled()) {
    ensureDraftForCurrentSection();
    insertMode = false;
    clearSelectedChord();
  }

  if (currentSong && currentSection) {
    renderSong(currentSong, currentSection);
    return;
  }

  syncEditPanel();
});

saveChordsButton.addEventListener("click", () => {
  saveChordChanges();
});

insertChordButton.addEventListener("click", () => {
  insertMode = !insertMode;
  if (insertMode) {
    clearSelectedChord();
  }
  renderSong(currentSong, currentSection);
});

deleteChordButton.addEventListener("click", () => {
  deleteSelectedChord();
});

resetChordsButton.addEventListener("click", () => {
  if (!currentSection) {
    return;
  }

  resetDraft(currentSection.content || "");
  insertMode = false;
  clearSelectedChord();
  renderSong(currentSong, currentSection);
  setEditStatus("Draft reset");
});

songContent.addEventListener("pointerdown", startDrag);
songContent.addEventListener("click", (event) => {
  if (!isEditModeEnabled()) {
    return;
  }

  const marker = event.target.closest(".leader-chord-marker-draggable");
  if (marker) {
    selectChord(marker);
    return;
  }

  const track = event.target.closest(".leader-chord-track");
  if (track && insertMode) {
    insertChordAtTrack(track, event.clientX);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }

  if (isEditModeEnabled() && selectedChord && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    deleteSelectedChord();
    return;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  if (event.code === "Space" || event.key === " " || event.key === "ArrowRight") {
    event.preventDefault();
    socket.send(JSON.stringify({ type: "next-section" }));
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    socket.send(JSON.stringify({ type: "previous-section" }));
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    changeSongSelection(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    changeSongSelection(-1);
  }
});

window.addEventListener("scroll", () => {
  if (suppressScrollBroadcast || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const scrollRatio = Math.max(0, Math.min(1, window.scrollY / maxScroll));
  socket.send(JSON.stringify({ type: "scroll", scrollRatio }));
});

window.addEventListener("resize", () => {
  invalidateCharacterWidth();
  if (currentSong && currentSection) {
    renderSong(currentSong, currentSection);
  }
});

async function init() {
  const response = await fetch("/api/songs");
  if (!response.ok) {
    throw new Error("Unable to load songs.");
  }

  const data = await response.json();
  renderSongOptions(data.songs);
  syncEditPanel();
  connect();
}

init().catch((error) => {
  songTitle.textContent = "Unable to load songs";
  songContent.textContent = error.message;
});

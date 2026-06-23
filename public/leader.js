const songSelect = document.getElementById("song-select");
const songTitle = document.getElementById("song-title");
const songMeta = document.getElementById("song-meta");
const sectionLabel = document.getElementById("section-label");
const songContent = document.getElementById("song-content");
const addCurrentSongButton = document.getElementById("add-current-song-button");
const leaderPanelMenuButton = document.getElementById("leader-panel-menu-button");
const leaderPanelMenu = document.getElementById("leader-panel-menu");
const showSetlistPanelButton = document.getElementById("show-setlist-panel-button");
const showCcliLogPanelButton = document.getElementById("show-ccli-log-panel-button");
const showInfoPanelButton = document.getElementById("show-info-panel-button");
const showSelectionPanelButton = document.getElementById("show-selection-panel-button");
const leaderSelectionPanel = document.getElementById("leader-selection-panel");
const leaderInfoPanel = document.getElementById("leader-info-panel");
const setlistPanel = document.getElementById("setlist-panel");
const setlistGenerateButton = document.getElementById("setlist-generate-button");
const setlistClearButton = document.getElementById("setlist-clear-button");
const setlistPerformingToggle = document.getElementById("setlist-performing-toggle");
const setlistStatus = document.getElementById("setlist-status");
const setlistList = document.getElementById("setlist-list");
const ccliLogPanel = document.getElementById("ccli-log-panel");
const ccliLogStatus = document.getElementById("ccli-log-status");
const ccliLogList = document.getElementById("ccli-log-list");
const copyCcliLogButton = document.getElementById("copy-ccli-log-button");
const clearCcliLogButton = document.getElementById("clear-ccli-log-button");
const leaderCount = document.getElementById("leader-count");
const userCount = document.getElementById("user-count");
const editModeButton = document.getElementById("edit-mode-button");
const songLockedToggle = document.getElementById("song-locked-toggle");
const leaderEditPanel = document.getElementById("leader-edit-panel");
const editStatus = document.getElementById("edit-status");
const closeEditPanelButton = document.getElementById("close-edit-panel-button");
const leaderEditActions = document.getElementById("leader-edit-actions");
const newChordInput = document.getElementById("new-chord-input");
const insertChordButton = document.getElementById("insert-chord-button");
const deleteChordButton = document.getElementById("delete-chord-button");
const saveChordsButton = document.getElementById("save-chords-button");
const resetChordsButton = document.getElementById("reset-chords-button");
const songStage = document.querySelector(".song-stage");

let socket;
let suppressScrollBroadcast = false;
let selectedSongId = null;
let currentSong = null;
let currentSection = null;
let currentSectionIndex = 0;
let currentSectionPartIndex = 0;
let isSaving = false;
let draftSectionKey = null;
let draftSectionLines = null;
let draftDirty = false;
const draftSections = new Map();
let dragState = null;
let measuredCharacterWidth = null;
let selectedChord = null;
let insertMode = false;
let isUpdatingLock = false;
let editModeEnabled = false;
let setList = [];
let eligibleSetlistSongs = [];
let isSavingSetlist = false;
let performanceLog = null;
let isUpdatingPerformance = false;
let draggedSetlistSongId = null;
let suppressSetlistClickSongId = null;
const MAX_LEADER_SECTION_LINES = 6;
const MIN_SWIPE_DISTANCE = 48;
const MAX_SWIPE_OFF_AXIS = 42;
const LEADER_PANEL_STORAGE_KEY = "songlist-leader-panel";
let swipeState = null;
const storedLeaderPanel = window.localStorage.getItem(LEADER_PANEL_STORAGE_KEY);
let activeLeaderPanel =
  storedLeaderPanel === "ccli" ||
  storedLeaderPanel === "info" ||
  storedLeaderPanel === "selection" ||
  storedLeaderPanel === "none"
    ? storedLeaderPanel
    : "setlist";
let isLeaderPanelMenuOpen = false;

function getSongStatusColor(song) {
  if (!song?.audit?.initial) {
    return "#9c3d27";
  }

  if (!song?.audit?.chordPlay) {
    return "#2455b5";
  }

  return "#2a2118";
}

function isSongLocked(song = currentSong) {
  return Boolean(song?.audit?.chordPlay);
}

function setSetlistStatus(message, isError = false) {
  setlistStatus.textContent = message;
  setlistStatus.classList.toggle("pill-error", isError);
}

function setCcliLogStatus(message, isError = false) {
  ccliLogStatus.textContent = message;
  ccliLogStatus.classList.toggle("pill-error", isError);
}

function applyLeaderPanelMenuVisibility() {
  leaderPanelMenu.hidden = !isLeaderPanelMenuOpen;
  leaderPanelMenuButton.setAttribute("aria-expanded", String(isLeaderPanelMenuOpen));
}

function closeLeaderPanelMenu() {
  isLeaderPanelMenuOpen = false;
  applyLeaderPanelMenuVisibility();
}

function setActiveLeaderPanel(panel) {
  activeLeaderPanel =
    panel === "ccli" || panel === "info" || panel === "selection" || panel === "none" ? panel : "setlist";
  window.localStorage.setItem(LEADER_PANEL_STORAGE_KEY, activeLeaderPanel);
  leaderSelectionPanel.hidden = activeLeaderPanel !== "selection";
  leaderInfoPanel.hidden = activeLeaderPanel !== "info";
  setlistPanel.hidden = activeLeaderPanel !== "setlist";
  ccliLogPanel.hidden = activeLeaderPanel !== "ccli";
  showSelectionPanelButton.classList.toggle(
    "leader-panel-menu-item-active",
    activeLeaderPanel === "selection",
  );
  showInfoPanelButton.classList.toggle("leader-panel-menu-item-active", activeLeaderPanel === "info");
  showSetlistPanelButton.classList.toggle("leader-panel-menu-item-active", activeLeaderPanel === "setlist");
  showCcliLogPanelButton.classList.toggle("leader-panel-menu-item-active", activeLeaderPanel === "ccli");
  showSelectionPanelButton.setAttribute("aria-pressed", String(activeLeaderPanel === "selection"));
  showInfoPanelButton.setAttribute("aria-pressed", String(activeLeaderPanel === "info"));
  showSetlistPanelButton.setAttribute("aria-pressed", String(activeLeaderPanel === "setlist"));
  showCcliLogPanelButton.setAttribute("aria-pressed", String(activeLeaderPanel === "ccli"));
  showSelectionPanelButton.textContent = `${activeLeaderPanel === "selection" ? "✓ " : ""}Selection/Edit`;
  showInfoPanelButton.textContent = `${activeLeaderPanel === "info" ? "✓ " : ""}Info`;
  showSetlistPanelButton.textContent = `${activeLeaderPanel === "setlist" ? "✓ " : ""}Set List`;
  showCcliLogPanelButton.textContent = `${activeLeaderPanel === "ccli" ? "✓ " : ""}CCLI Log`;
}

function getActiveSetlistIndex(songId = currentSong?.id) {
  return setList.findIndex((entry) => entry.songId === songId);
}

function updateSetlistControls() {
  const hasEligibleSongs = eligibleSetlistSongs.length > 0;
  const currentSongId = currentSong?.id;
  const currentSongEligible = eligibleSetlistSongs.some((song) => song.id === currentSongId);
  const alreadyIncluded = setList.some((entry) => entry.songId === currentSongId);

  addCurrentSongButton.disabled =
    isSavingSetlist || !currentSongEligible || !Number.isInteger(currentSongId) || alreadyIncluded;
  setlistGenerateButton.disabled = isSavingSetlist || !hasEligibleSongs;
  setlistClearButton.disabled = isSavingSetlist || setList.length === 0;
  setlistPerformingToggle.disabled = isSavingSetlist || isUpdatingPerformance || !currentSong;
  copyCcliLogButton.disabled = isUpdatingPerformance || !performanceLog || performanceLog.songs.length === 0;
  clearCcliLogButton.disabled = isUpdatingPerformance || !performanceLog;
}

function isPerformingMode() {
  return Boolean(performanceLog?.active);
}

function applyPerformingMode() {
  const active = isPerformingMode();
  setlistPerformingToggle.checked = active;
  document.body.classList.toggle("performing-mode", active);
}

function getNextSetlistSongId(currentSongId = currentSong?.id) {
  const activeIndex = getActiveSetlistIndex(currentSongId);
  if (activeIndex < 0 || activeIndex >= setList.length - 1) {
    return null;
  }

  return setList[activeIndex + 1]?.songId ?? null;
}

function getPreviousSetlistSongId(currentSongId = currentSong?.id) {
  const activeIndex = getActiveSetlistIndex(currentSongId);
  if (activeIndex <= 0) {
    return null;
  }

  return setList[activeIndex - 1]?.songId ?? null;
}

function goLiveToSong(songId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const normalizedSongId = String(songId);
  songSelect.value = normalizedSongId;
  syncSongSelectColor(normalizedSongId);
  socket.send(JSON.stringify({ type: "set-song", songId: normalizedSongId }));
}

function syncSongSelectColor(songId = songSelect.value) {
  const song = currentSong && String(currentSong.id) === String(songId) ? currentSong : null;
  const selectedSong = song || Array.from(songSelect.options).find((option) => option.value === String(songId));
  songSelect.style.color = selectedSong?.dataset?.color || getSongStatusColor(song);
}

function disableEditMode() {
  if (!editModeEnabled) {
    return;
  }

  editModeEnabled = false;
  insertMode = false;
  clearSelectedChord();
  cancelDrag();
}

function enableEditMode() {
  if (editModeEnabled || isSongLocked() || !currentSong) {
    syncEditPanel();
    return;
  }

  editModeEnabled = true;
  ensureDraftForCurrentSection();
  insertMode = false;
  clearSelectedChord();
}

function resolveSection(song, section, sectionIndex = 0) {
  if (section) {
    return section;
  }

  if (song?.sections && song.sectionOrder?.length) {
    const sectionId = song.sectionOrder[sectionIndex];
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

function formatSongMeta(song) {
  const parts = [];

  if (song?.authors) {
    parts.push(song.authors);
  }

  if (song?.ccliNum) {
    parts.push(`CCLI ${song.ccliNum}`);
  }

  return parts.join(" • ");
}

function getCurrentSectionKey(song = currentSong, section = currentSection) {
  if (!song || !section) {
    return null;
  }

  return `${song.id}:${section.id}`;
}

function getSectionById(song, sectionId) {
  if (!song || !sectionId || !song.sections?.[sectionId]) {
    return null;
  }

  return {
    id: sectionId,
    ...song.sections[sectionId],
  };
}

function getNextSection(song, sectionIndex = currentSectionIndex) {
  if (!song?.sectionOrder?.length) {
    return null;
  }

  const nextSectionId = song.sectionOrder[sectionIndex + 1];
  return getSectionById(song, nextSectionId);
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

function splitSectionLines(lines, maxLines = MAX_LEADER_SECTION_LINES) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const limit = Math.max(1, maxLines);
  const partCount = Math.max(1, Math.ceil(safeLines.length / limit));
  const baseSize = Math.floor(safeLines.length / partCount);
  const remainder = safeLines.length % partCount;
  const parts = [];
  let startIndex = 0;

  for (let index = 0; index < partCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    parts.push({
      startIndex,
      lines: safeLines.slice(startIndex, startIndex + size),
    });
    startIndex += size;
  }

  if (parts.length === 0) {
    parts.push({
      startIndex: 0,
      lines: [],
    });
  }

  return parts;
}

function formatSectionPartLabel(label, partNumber, totalParts) {
  if (totalParts <= 1) {
    return label;
  }

  return `${label} Part ${partNumber}`;
}

function getRenderedSectionLines(song, section, selected = false) {
  const sectionKey = getCurrentSectionKey(song, section);
  if (selected && draftSectionKey === sectionKey) {
    return draftSectionLines;
  }

  return parseChordContent(section?.content || "");
}

function getSectionParts(section, song = currentSong, { selected = false } = {}) {
  return splitSectionLines(getRenderedSectionLines(song, section, selected));
}

function clampSectionPartIndex(section = currentSection, song = currentSong) {
  const sectionParts = getSectionParts(section, song);
  currentSectionPartIndex = Math.max(0, Math.min(currentSectionPartIndex, sectionParts.length - 1));
  return sectionParts;
}

function getCurrentSectionPart(section = currentSection, song = currentSong) {
  const sectionParts = clampSectionPartIndex(section, song);
  return {
    sectionParts,
    currentPart: sectionParts[currentSectionPartIndex] || sectionParts[0],
  };
}

function getAdjacentSectionPart(song, sectionIndex, partIndex, direction) {
  if (!song?.sectionOrder?.length) {
    return null;
  }

  const step = direction >= 0 ? 1 : -1;
  let targetSectionIndex = sectionIndex;
  let targetPartIndex = partIndex + step;

  while (targetSectionIndex >= 0 && targetSectionIndex < song.sectionOrder.length) {
    const targetSection = getSectionById(song, song.sectionOrder[targetSectionIndex]);
    if (!targetSection) {
      return null;
    }

    const sectionParts = getSectionParts(targetSection, song);
    if (targetPartIndex >= 0 && targetPartIndex < sectionParts.length) {
      return {
        section: targetSection,
        sectionIndex: targetSectionIndex,
        partIndex: targetPartIndex,
        part: sectionParts[targetPartIndex],
        partCount: sectionParts.length,
      };
    }

    targetSectionIndex += step;
    if (step > 0) {
      targetPartIndex = 0;
    } else {
      if (targetSectionIndex < 0) {
        break;
      }
      const previousSection = getSectionById(song, song.sectionOrder[targetSectionIndex]);
      const previousParts = getSectionParts(previousSection, song);
      targetPartIndex = previousParts.length - 1;
    }
  }

  return null;
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

function resetDraft(content = currentSection?.content || "", song = currentSong, section = currentSection) {
  draftSectionKey = getCurrentSectionKey(song, section);
  draftSectionLines = parseChordContent(content);
  draftDirty = false;
  if (draftSectionKey) {
    draftSections.set(draftSectionKey, {
      lines: draftSectionLines,
      dirty: false,
    });
  }
}

function ensureDraftForCurrentSection() {
  const currentKey = getCurrentSectionKey();
  if (!currentKey) {
    draftSectionKey = null;
    draftSectionLines = null;
    draftDirty = false;
    return;
  }

  if (draftSectionKey === currentKey && draftSectionLines) {
    return;
  }

  const existingDraft = draftSections.get(currentKey);
  if (existingDraft) {
    draftSectionKey = currentKey;
    draftSectionLines = existingDraft.lines;
    draftDirty = existingDraft.dirty;
    return;
  }

  resetDraft();
}

function setDraftDirty(nextDirty) {
  draftDirty = nextDirty;
  if (draftSectionKey && draftSectionLines) {
    draftSections.set(draftSectionKey, {
      lines: draftSectionLines,
      dirty: nextDirty,
    });
  }
}

function clearDraftsForSong(songId = currentSong?.id) {
  if (!songId) {
    draftSections.clear();
    return;
  }

  for (const key of draftSections.keys()) {
    if (key.startsWith(`${songId}:`)) {
      draftSections.delete(key);
    }
  }
}

function setCurrentSectionById(sectionId) {
  const section = getSectionById(currentSong, sectionId);
  if (!section) {
    return;
  }

  currentSection = section;
  currentSectionIndex = Math.max(0, currentSong.sectionOrder.indexOf(sectionId));
  currentSectionPartIndex = 0;
  ensureDraftForCurrentSection();
  insertMode = false;
  clearSelectedChord();
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

function getRenderedChords(line) {
  const visibleLyricsLength = (line?.lyrics || "").replace(/\s+$/u, "").length;
  let trailingCursor = visibleLyricsLength;

  return [...(line?.chords || [])]
    .sort((left, right) => left.position - right.position || left.order - right.order)
    .map((chord) => {
      let renderPosition = chord.position;

      // Keep end-of-line chords from stacking on top of each other when the lyric
      // text has already ended and the stored spacing is narrower than the label width.
      if (renderPosition >= visibleLyricsLength) {
        renderPosition = Math.max(renderPosition, trailingCursor);
        trailingCursor = renderPosition + chord.text.length + 1;
      }

      return {
        ...chord,
        renderPosition,
      };
    });
}

function getNextChordOrder(line) {
  if (!line?.chords?.length) {
    return 0;
  }

  return Math.max(...line.chords.map((chord) => chord.order)) + 1;
}

function isEditModeEnabled() {
  return editModeEnabled;
}

function cancelDrag() {
  if (!dragState) {
    return;
  }

  dragState.marker.classList.remove("leader-chord-marker-active");
  dragState = null;
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", finishDrag);
  window.removeEventListener("pointercancel", finishDrag);
}

function updateEditControls() {
  const enabled = isEditModeEnabled();
  const locked = isSongLocked();

  editModeButton.hidden = locked;
  editModeButton.disabled = locked || isSaving || !currentSong;
  editModeButton.textContent = enabled ? "Editing chords" : "Edit chords";
  editModeButton.setAttribute("aria-pressed", String(enabled));
  editModeButton.classList.toggle("button-toggle-active", enabled);
  songLockedToggle.disabled = enabled || isSaving || isUpdatingLock || !currentSong;
  songLockedToggle.checked = locked;
  leaderEditPanel.hidden = !enabled;
  leaderEditActions.hidden = !enabled;
  closeEditPanelButton.disabled = isSaving;
  newChordInput.disabled = !enabled || isSaving || locked;
  insertChordButton.disabled = !enabled || isSaving || locked;
  deleteChordButton.disabled = !enabled || isSaving || locked || !selectedChord;
  saveChordsButton.disabled = !enabled || !draftDirty || isSaving || locked;
  resetChordsButton.disabled = !enabled || isSaving || locked || !draftSectionLines;
  insertChordButton.classList.toggle("button-danger", insertMode);
  insertChordButton.classList.toggle("button-secondary", !insertMode);
}

function syncEditPanel() {
  const enabled = isEditModeEnabled();
  const locked = isSongLocked();

  if (enabled && locked) {
    disableEditMode();
    setEditStatus("Song locked");
    updateEditControls();
    return;
  }

  if (!enabled) {
    insertMode = false;
    clearSelectedChord();
    setEditStatus(locked ? "Song locked" : "Edit mode off");
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
    setEditStatus(`Editing ${formatSectionLabel(currentSection)} in the full song view`);
  }

  updateEditControls();
}

function createChordRow(line, lineIndex, editable, sectionId = "") {
  const row = document.createElement("div");
  row.className = "leader-chord-row";

  if (!line.lyrics && line.chords.length === 0) {
    row.append(document.createElement("br"));
    return row;
  }

  const track = document.createElement("div");
  track.className = "leader-chord-track";
  track.dataset.lineIndex = String(lineIndex);
  track.dataset.sectionId = sectionId;
  if (editable && insertMode) {
    track.classList.add("leader-chord-track-insert");
  }

  const renderedChords = getRenderedChords(line);
  const columns = Math.max(
    1,
    line.lyrics.length,
    ...renderedChords.map((chord) => chord.renderPosition + chord.text.length),
  );
  track.style.width = `${columns * getCharacterWidth()}px`;

  const lyric = document.createElement("span");
  lyric.className = "leader-lyric-line";
  lyric.textContent = line.lyrics || " ";
  track.append(lyric);

  renderedChords.forEach((chord) => {
    const marker = document.createElement(editable ? "button" : "span");
    marker.className = "leader-chord-marker";
    marker.textContent = chord.text;
    marker.style.left = `${chord.renderPosition * getCharacterWidth()}px`;
    marker.dataset.lineIndex = String(lineIndex);
    marker.dataset.chordOrder = String(chord.order);
    marker.dataset.sectionId = sectionId;
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

function renderChordContent(lines, editable = false, sectionId = "", lineOffset = 0) {
  const fragment = document.createDocumentFragment();

  lines.forEach((line, lineIndex) => {
    fragment.append(createChordRow(line, lineOffset + lineIndex, editable, sectionId));
  });

  return fragment;
}

function renderAllSections(song) {
  const fragment = document.createDocumentFragment();

  song.sectionOrder.forEach((sectionId) => {
    const section = getSectionById(song, sectionId);
    if (!section) {
      return;
    }

    const selected = currentSection?.id === sectionId;
    const sectionParts = getSectionParts(section, song, { selected });

    sectionParts.forEach((part, partIndex) => {
      const sectionCard = document.createElement("section");
      sectionCard.className = "leader-section-card";
      sectionCard.dataset.sectionId = sectionId;
      if (selected) {
        sectionCard.classList.add("leader-section-card-active");
      }

      const heading = document.createElement("p");
      heading.className = "leader-section-heading";
      heading.textContent = formatSectionPartLabel(
        formatSectionLabel(section),
        partIndex + 1,
        sectionParts.length,
      );
      sectionCard.append(heading);

      const sectionBody = document.createElement("div");
      sectionBody.className = "leader-section-body";
      sectionBody.append(renderChordContent(part.lines, selected, sectionId, part.startIndex));
      sectionCard.append(sectionBody);

      fragment.append(sectionCard);
    });
  });

  return fragment;
}

function renderLiveSection(section, title, className = "", { showHeading = true, showSectionName = true } = {}) {
  const card = document.createElement("section");
  card.className = "leader-live-section";
  if (className) {
    card.classList.add(className);
  }

  const { currentPart, sectionParts } = getCurrentSectionPart(section);
  const sectionNameLabel = formatSectionPartLabel(
    formatSectionLabel(section),
    currentSectionPartIndex + 1,
    sectionParts.length,
  );

  if (showHeading) {
    const heading = document.createElement("p");
    heading.className = "leader-live-section-heading";
    heading.textContent = title;
    card.append(heading);
  }

  if (showSectionName) {
    const sectionName = document.createElement("h3");
    sectionName.className = "leader-live-section-name";
    sectionName.textContent = sectionNameLabel;
    card.append(sectionName);
  }

  const body = document.createElement("div");
  body.className = "leader-live-section-body";
  body.append(renderChordContent(currentPart?.lines || [], false, section?.id || "", currentPart?.startIndex || 0));
  card.append(body);

  return card;
}

function renderQueuedLiveSection(section, title, className, partIndex) {
  const sectionParts = getSectionParts(section);
  const safePartIndex = Math.max(0, Math.min(partIndex, sectionParts.length - 1));
  const part = sectionParts[safePartIndex] || sectionParts[0];
  const card = document.createElement("section");
  card.className = "leader-live-section";
  if (className) {
    card.classList.add(className);
  }

  const heading = document.createElement("p");
  heading.className = "leader-live-section-heading";
  heading.textContent = title;
  card.append(heading);

  const sectionName = document.createElement("h3");
  sectionName.className = "leader-live-section-name";
  sectionName.textContent = formatSectionPartLabel(
    formatSectionLabel(section),
    safePartIndex + 1,
    sectionParts.length,
  );
  card.append(sectionName);

  const body = document.createElement("div");
  body.className = "leader-live-section-body";
  body.append(renderChordContent(part?.lines || [], false, section?.id || "", part?.startIndex || 0));
  card.append(body);

  return card;
}

function renderSong(song, section) {
  selectedSongId = song.id;
  currentSong = song;
  currentSection = section;
  songTitle.textContent = song.title;
  songMeta.textContent = formatSongMeta(song);
  if (!section) {
    sectionLabel.textContent = "";
    songContent.classList.toggle("leader-content-editing", false);
    songContent.replaceChildren();
    syncEditPanel();
    return;
  }

  const { sectionParts } = getCurrentSectionPart(section, song);
  sectionLabel.textContent = isEditModeEnabled()
    ? currentSection
      ? `Editing ${formatSectionLabel(currentSection)}`
      : "All sections"
    : formatSectionPartLabel(formatSectionLabel(section), currentSectionPartIndex + 1, sectionParts.length);
  songContent.classList.toggle("leader-content-editing", isEditModeEnabled());

  if (isEditModeEnabled()) {
    ensureDraftForCurrentSection();
    songContent.replaceChildren(renderAllSections(song));
  } else {
    const currentSectionCard = renderLiveSection(section, "Current Section", "leader-live-section-current", {
      showHeading: false,
      showSectionName: false,
    });
    const nextDisplay = getAdjacentSectionPart(song, currentSectionIndex, currentSectionPartIndex, 1);

    if (nextDisplay) {
      songContent.replaceChildren(
        currentSectionCard,
        renderQueuedLiveSection(
          nextDisplay.section,
          nextDisplay.sectionIndex === currentSectionIndex ? "Next Part" : "Next Section",
          "leader-live-section-next",
          nextDisplay.partIndex,
        ),
      );
    } else {
      songContent.replaceChildren(currentSectionCard);
    }
  }

  syncEditPanel();
}

function renderSongOptions(songs) {
  const previousSelection = selectedSongId ?? songSelect.value;
  songSelect.innerHTML = "";

  for (const song of songs) {
    const option = document.createElement("option");
    option.value = song.id;
    option.textContent = song.title;
    option.style.color = getSongStatusColor(song);
    option.dataset.color = option.style.color;
    songSelect.append(option);
  }

  if (previousSelection) {
    songSelect.value = String(previousSelection);
  }

  syncSongSelectColor(songSelect.value);
}

function renderSetlist() {
  setlistList.innerHTML = "";
  const activeIndex = getActiveSetlistIndex();
  const visibleEntries = setList.filter((entry, index) => !isPerformingMode() || activeIndex < 0 || index >= activeIndex);

  if (visibleEntries.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "muted";
    emptyState.textContent =
      setList.length === 0
        ? "Add the current song or generate a set list to keep a leader-ready order."
        : "All songs in this set have been completed.";
    setlistList.append(emptyState);
    updateSetlistControls();
    return;
  }

  visibleEntries.forEach((entry) => {
    const index = setList.findIndex((setListEntry) => setListEntry.songId === entry.songId);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "setlist-pill";
    item.draggable = !isSavingSetlist;
    item.dataset.songId = String(entry.songId);
    item.textContent = entry.title;
    item.style.color = getSongStatusColor(entry);
    if (index === activeIndex) {
      item.classList.add("setlist-pill-active");
    }

    item.addEventListener("click", () => {
      if (suppressSetlistClickSongId === entry.songId) {
        suppressSetlistClickSongId = null;
        return;
      }

      goLiveToSong(entry.songId);
    });
    item.addEventListener("dragstart", (event) => {
      if (isSavingSetlist) {
        event.preventDefault();
        return;
      }

      draggedSetlistSongId = entry.songId;
      suppressSetlistClickSongId = entry.songId;
      item.classList.add("setlist-pill-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(entry.songId));
    });
    item.addEventListener("dragend", () => {
      draggedSetlistSongId = null;
      item.classList.remove("setlist-pill-dragging");
      clearSetlistDropTargets();
      window.setTimeout(() => {
        suppressSetlistClickSongId = null;
      }, 0);
    });
    item.addEventListener("dragover", (event) => {
      if (!canDropOnSetlistSong(entry.songId)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearSetlistDropTargets();
      item.classList.add("setlist-pill-drop-target");
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("setlist-pill-drop-target");
    });
    item.addEventListener("drop", (event) => {
      if (!canDropOnSetlistSong(entry.songId)) {
        return;
      }

      event.preventDefault();
      item.classList.remove("setlist-pill-drop-target");
      moveSetlistSongBySongId(draggedSetlistSongId, entry.songId);
    });

    setlistList.append(item);
  });

  updateSetlistControls();
}

function formatPerformanceTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildCcliLogText(log = performanceLog) {
  if (!log) {
    return "";
  }

  const lines = [];
  lines.push(`Event started: ${formatPerformanceTimestamp(log.startedAt)}`);
  lines.push(`Event ended: ${log.endedAt ? formatPerformanceTimestamp(log.endedAt) : "In progress"}`);
  lines.push("");

  if (!Array.isArray(log.songs) || log.songs.length === 0) {
    lines.push("No songs recorded.");
    return lines.join("\n");
  }

  log.songs.forEach((song, index) => {
    lines.push(`${index + 1}. ${song.title}`);
    lines.push(`CCLI: ${song.ccliNum || "Missing"}`);
    lines.push(`Authors: ${song.authors || "Unknown"}`);
    lines.push(`Times played: ${song.playCount}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function renderCcliLog() {
  ccliLogList.innerHTML = "";

  if (!performanceLog) {
    setCcliLogStatus("No event recorded yet");
    updateSetlistControls();
    return;
  }

  const statusMessage = performanceLog.active
    ? `Event started ${formatPerformanceTimestamp(performanceLog.startedAt)}`
    : `Last event ended ${formatPerformanceTimestamp(performanceLog.endedAt || performanceLog.startedAt)}`;
  setCcliLogStatus(statusMessage);

  if (!performanceLog.songs.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "muted";
    emptyState.textContent = performanceLog.active
      ? "Songs will appear here as they are played."
      : "This event did not record any songs.";
    ccliLogList.append(emptyState);
    updateSetlistControls();
    return;
  }

  performanceLog.songs.forEach((song, index) => {
    const item = document.createElement("div");
    item.className = "ccli-log-entry";

    const header = document.createElement("div");
    header.className = "ccli-log-entry-header";

    const title = document.createElement("span");
    title.className = "ccli-log-entry-title";
    title.textContent = `${index + 1}. ${song.title}`;

    const count = document.createElement("span");
    count.className = "pill";
    count.textContent = song.playCount > 1 ? `${song.playCount} plays` : "Played";

    header.append(title, count);

    const meta = document.createElement("div");
    meta.className = "ccli-log-entry-meta";
    meta.textContent = [
      song.authors || "Unknown author",
      song.ccliNum ? `CCLI ${song.ccliNum}` : "Missing CCLI number",
      `First played ${formatPerformanceTimestamp(song.firstPlayedAt)}`,
    ].join(" • ");

    item.append(header, meta);
    ccliLogList.append(item);
  });

  updateSetlistControls();
}

function applySetlistPayload(payload) {
  setList = Array.isArray(payload?.setList) ? payload.setList : [];
  eligibleSetlistSongs = Array.isArray(payload?.eligibleSongs) ? payload.eligibleSongs : eligibleSetlistSongs;
  performanceLog = payload?.performanceLog ?? performanceLog;
  renderSetlist();
  renderCcliLog();

  if (!isSavingSetlist) {
    setSetlistStatus(setList.length > 0 ? "Set list ready" : "Set list is empty");
  }
}

async function saveSetlist(songIds, statusMessage = "Saving set list...") {
  isSavingSetlist = true;
  setSetlistStatus(statusMessage);
  updateSetlistControls();
  renderSetlist();

  try {
    const response = await fetch("/api/setlist", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ songIds }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save set list.");
    }

    applySetlistPayload(data);
    setSetlistStatus(songIds.length > 0 ? "Set list saved" : "Set list cleared");
  } catch (error) {
    setSetlistStatus(error.message, true);
  } finally {
    isSavingSetlist = false;
    updateSetlistControls();
    renderSetlist();
  }
}

function addCurrentSongToSetlist() {
  const songId = currentSong?.id;
  const currentSongEligible = eligibleSetlistSongs.some((song) => song.id === songId);
  if (!Number.isInteger(songId) || !currentSongEligible || setList.some((entry) => entry.songId === songId)) {
    updateSetlistControls();
    return;
  }

  saveSetlist([...setList.map((entry) => entry.songId), songId], "Adding song...");
}

function generateSetlistFromCheckedSongs() {
  saveSetlist(
    eligibleSetlistSongs.map((song) => song.id),
    "Generating set list...",
  );
}

function moveSetlistSong(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= setList.length || fromIndex === toIndex) {
    return;
  }

  const nextSongIds = setList.map((entry) => entry.songId);
  const [movedSongId] = nextSongIds.splice(fromIndex, 1);
  nextSongIds.splice(toIndex, 0, movedSongId);
  saveSetlist(nextSongIds, "Updating set list...");
}

function clearSetlistDropTargets() {
  setlistList.querySelectorAll(".setlist-pill-drop-target").forEach((pill) => {
    pill.classList.remove("setlist-pill-drop-target");
  });
}

function canDropOnSetlistSong(targetSongId) {
  return Number.isInteger(draggedSetlistSongId) && draggedSetlistSongId !== targetSongId && !isSavingSetlist;
}

function moveSetlistSongBySongId(sourceSongId, targetSongId) {
  const fromIndex = setList.findIndex((entry) => entry.songId === sourceSongId);
  const toIndex = setList.findIndex((entry) => entry.songId === targetSongId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return;
  }

  moveSetlistSong(fromIndex, toIndex);
}

async function setPerformingMode(nextValue) {
  isUpdatingPerformance = true;
  updateSetlistControls();

  try {
    const response = await fetch(nextValue ? "/api/performance/start" : "/api/performance/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nextValue ? { songId: currentSong?.id } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to update event status.");
    }

    performanceLog = data.performanceLog ?? null;
    applyPerformingMode();
    renderSetlist();
    renderCcliLog();
  } catch (error) {
    setSetlistStatus(error.message, true);
    setCcliLogStatus(error.message, true);
    applyPerformingMode();
  } finally {
    isUpdatingPerformance = false;
    updateSetlistControls();
  }
}

async function copyCcliLog() {
  const logText = buildCcliLogText();
  if (!logText) {
    return;
  }

  await navigator.clipboard.writeText(logText);
  setCcliLogStatus("CCLI log copied");
}

async function clearCcliLog() {
  isUpdatingPerformance = true;
  updateSetlistControls();

  try {
    const response = await fetch("/api/performance-log", {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to clear CCLI log.");
    }

    performanceLog = data.performanceLog ?? null;
    applyPerformingMode();
    renderSetlist();
    renderCcliLog();
  } catch (error) {
    setCcliLogStatus(error.message, true);
  } finally {
    isUpdatingPerformance = false;
    updateSetlistControls();
  }
}

async function finishPerformanceSet() {
  await setPerformingMode(false);
  await saveSetlist([], "Clearing completed set...");
}

function applyState(state) {
  leaderCount.textContent = String(state.leaderCount);
  userCount.textContent = String(state.userCount);
  performanceLog = state.performanceLog ?? performanceLog;
  applyPerformingMode();
  renderCcliLog();
  if (Array.isArray(state.setList)) {
    setList = state.setList;
    renderSetlist();
  }

  if (!state.currentSong) {
    return;
  }

  if (isEditModeEnabled() && state.currentSong.audit?.chordPlay) {
    disableEditMode();
  }

  const songChanged = currentSong?.id !== state.currentSong.id;
  currentSectionIndex = state.currentSectionIndex;
  currentSectionPartIndex = Number.isInteger(state.currentSectionPartIndex) ? state.currentSectionPartIndex : 0;

  let nextSection = resolveSection(state.currentSong, state.currentSection, state.currentSectionIndex);
  if (isEditModeEnabled()) {
    if (songChanged) {
      clearDraftsForSong(currentSong?.id);
    } else if (nextSection && currentSection?.id) {
      nextSection = getSectionById(state.currentSong, currentSection.id) || nextSection;
    }
  }

  renderSong(state.currentSong, nextSection);
  songSelect.value = state.currentSongId;
  syncSongSelectColor(state.currentSongId);
  if (!isEditModeEnabled()) {
    applyScroll(state.scrollRatio);
  }
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
      if (!isEditModeEnabled()) {
        applyScroll(message.payload.scrollRatio);
      }
    }

    if (message.type === "songs") {
      renderSongOptions(message.payload.songs);
    }

    if (message.type === "setlist") {
      applySetlistPayload(message.payload);
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

function canTriggerLeaderNavigation() {
  return !isEditModeEnabled() && socket && socket.readyState === WebSocket.OPEN;
}

function goToNextLeaderStep() {
  if (!canTriggerLeaderNavigation()) {
    return;
  }

  if (isPerformingMode() && currentSong?.sectionOrder?.length) {
    const nextDisplay = getAdjacentSectionPart(currentSong, currentSectionIndex, currentSectionPartIndex, 1);
    if (!nextDisplay) {
      const nextSetlistSongId = getNextSetlistSongId();
      if (nextSetlistSongId != null) {
        goLiveToSong(nextSetlistSongId);
        return;
      }

      finishPerformanceSet().catch((error) => {
        setSetlistStatus(error.message, true);
      });
      return;
    }
  }

  socket.send(JSON.stringify({ type: "next-section" }));
}

function goToPreviousLeaderStep() {
  if (!canTriggerLeaderNavigation()) {
    return;
  }

  if (isPerformingMode() && !getAdjacentSectionPart(currentSong, currentSectionIndex, currentSectionPartIndex, -1)) {
    const previousSetlistSongId = getPreviousSetlistSongId();
    if (previousSetlistSongId != null) {
      goLiveToSong(previousSetlistSongId);
      return;
    }
  }

  socket.send(JSON.stringify({ type: "previous-section" }));
}

function goToNextSongSelection() {
  if (!canTriggerLeaderNavigation()) {
    return;
  }

  changeSongSelection(1);
}

function goToPreviousSongSelection() {
  if (!canTriggerLeaderNavigation()) {
    return;
  }

  changeSongSelection(-1);
}

function isSwipeTargetInteractive(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, button, a, label"));
}

function clearSwipeState() {
  swipeState = null;
}

function handleSwipeGesture(deltaX, deltaY) {
  if (Math.abs(deltaY) > MAX_SWIPE_OFF_AXIS || Math.abs(deltaX) < MIN_SWIPE_DISTANCE) {
    return;
  }

  if (deltaX < 0) {
    goToNextLeaderStep();
    return;
  }

  goToPreviousLeaderStep();
}

function handleSongStageTouchStart(event) {
  if (isEditModeEnabled() || !songStage || event.touches.length !== 1 || isSwipeTargetInteractive(event.target)) {
    clearSwipeState();
    return;
  }

  const touch = event.touches[0];
  swipeState = {
    touchId: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
  };
}

function handleSongStageTouchMove(event) {
  if (!swipeState) {
    return;
  }

  const touch = Array.from(event.touches).find((item) => item.identifier === swipeState.touchId);
  if (!touch) {
    clearSwipeState();
    return;
  }

  const deltaX = touch.clientX - swipeState.startX;
  const deltaY = touch.clientY - swipeState.startY;
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < MIN_SWIPE_DISTANCE) {
    return;
  }

  if (Math.abs(deltaY) <= MAX_SWIPE_OFF_AXIS) {
    event.preventDefault();
  } else {
    clearSwipeState();
  }
}

function handleSongStageTouchEnd(event) {
  if (!swipeState) {
    return;
  }

  const touch = Array.from(event.changedTouches).find((item) => item.identifier === swipeState.touchId);
  if (!touch) {
    clearSwipeState();
    return;
  }

  const deltaX = touch.clientX - swipeState.startX;
  const deltaY = touch.clientY - swipeState.startY;
  clearSwipeState();
  handleSwipeGesture(deltaX, deltaY);
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
  setDraftDirty(true);
  dragState.marker.style.left = `${nextPosition * getCharacterWidth()}px`;
  setEditStatus("Unsaved chord changes");
  updateEditControls();
}

function finishDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  cancelDrag();

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

  setDraftDirty(true);
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
  setDraftDirty(true);
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
    clearDraftsForSong(data.song.id);
    currentSection = getSectionById(data.song, currentSection?.id) || resolveSection(data.song, null, currentSectionIndex);
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

async function setSongLocked(locked) {
  if (!currentSong) {
    return;
  }

  isUpdatingLock = true;
  updateEditControls();
  setEditStatus(locked ? "Locking song..." : "Unlocking song...");

  try {
    const response = await fetch(`/api/songs/${currentSong.id}/lock`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ locked }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to update song lock.");
    }

    currentSong = data.song;
    songLockedToggle.checked = isSongLocked(currentSong);
    syncSongSelectColor(currentSong.id);
    renderSong(currentSong, currentSection);
  } catch (error) {
    songLockedToggle.checked = isSongLocked(currentSong);
    setEditStatus(error.message, true);
  } finally {
    isUpdatingLock = false;
    updateEditControls();
  }
}

songSelect.addEventListener("change", () => {
  syncSongSelectColor(songSelect.value);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ type: "set-song", songId: songSelect.value }));
});

addCurrentSongButton.addEventListener("click", () => {
  addCurrentSongToSetlist();
});

applyLeaderPanelMenuVisibility();
setActiveLeaderPanel(activeLeaderPanel);

leaderPanelMenuButton.addEventListener("click", () => {
  isLeaderPanelMenuOpen = !isLeaderPanelMenuOpen;
  applyLeaderPanelMenuVisibility();
});

showSetlistPanelButton.addEventListener("click", () => {
  setActiveLeaderPanel(activeLeaderPanel === "setlist" ? "none" : "setlist");
  closeLeaderPanelMenu();
});

showCcliLogPanelButton.addEventListener("click", () => {
  setActiveLeaderPanel(activeLeaderPanel === "ccli" ? "none" : "ccli");
  closeLeaderPanelMenu();
});

showInfoPanelButton.addEventListener("click", () => {
  setActiveLeaderPanel(activeLeaderPanel === "info" ? "none" : "info");
  closeLeaderPanelMenu();
});

showSelectionPanelButton.addEventListener("click", () => {
  setActiveLeaderPanel(activeLeaderPanel === "selection" ? "none" : "selection");
  closeLeaderPanelMenu();
});

setlistGenerateButton.addEventListener("click", () => {
  generateSetlistFromCheckedSongs();
});

setlistClearButton.addEventListener("click", () => {
  saveSetlist([], "Clearing set list...");
});

applyPerformingMode();
setlistPerformingToggle.addEventListener("change", () => {
  setPerformingMode(setlistPerformingToggle.checked).catch((error) => {
    setCcliLogStatus(error.message, true);
  });
});

copyCcliLogButton.addEventListener("click", () => {
  copyCcliLog().catch((error) => {
    setCcliLogStatus(error.message, true);
  });
});

clearCcliLogButton.addEventListener("click", () => {
  clearCcliLog().catch((error) => {
    setCcliLogStatus(error.message, true);
  });
});

editModeButton.addEventListener("click", () => {
  if (isEditModeEnabled()) {
    disableEditMode();
  } else {
    enableEditMode();
  }

  if (currentSong && currentSection) {
    renderSong(currentSong, currentSection);
    return;
  }

  syncEditPanel();
});

closeEditPanelButton.addEventListener("click", () => {
  disableEditMode();

  if (currentSong && currentSection) {
    renderSong(currentSong, currentSection);
    return;
  }

  syncEditPanel();
});

songLockedToggle.addEventListener("change", () => {
  if (isEditModeEnabled()) {
    songLockedToggle.checked = isSongLocked();
    return;
  }

  setSongLocked(songLockedToggle.checked);
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

document.addEventListener("click", (event) => {
  if (
    isLeaderPanelMenuOpen &&
    !leaderPanelMenu.contains(event.target) &&
    !leaderPanelMenuButton.contains(event.target)
  ) {
    closeLeaderPanelMenu();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }

  if (event.key === "Escape" && isLeaderPanelMenuOpen) {
    closeLeaderPanelMenu();
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

  if (isEditModeEnabled()) {
    return;
  }

  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    goToNextLeaderStep();
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    goToNextSongSelection();
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goToPreviousSongSelection();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    goToPreviousLeaderStep();
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    goToNextLeaderStep();
  }
});

if (songStage) {
  songStage.addEventListener("touchstart", handleSongStageTouchStart, { passive: true });
  songStage.addEventListener("touchmove", handleSongStageTouchMove, { passive: false });
  songStage.addEventListener("touchend", handleSongStageTouchEnd, { passive: true });
  songStage.addEventListener("touchcancel", clearSwipeState, { passive: true });
}

window.addEventListener("scroll", () => {
  if (isEditModeEnabled() || suppressScrollBroadcast || !socket || socket.readyState !== WebSocket.OPEN) {
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

songContent.addEventListener("click", (event) => {
  if (!isEditModeEnabled()) {
    return;
  }

  const sectionCard = event.target.closest(".leader-section-card");
  if (sectionCard?.dataset.sectionId && sectionCard.dataset.sectionId !== currentSection?.id) {
    setCurrentSectionById(sectionCard.dataset.sectionId);
    renderSong(currentSong, currentSection);
    return;
  }
});

async function init() {
  const [songsResponse, setlistResponse] = await Promise.all([
    fetch("/api/songs"),
    fetch("/api/setlist"),
  ]);

  if (!songsResponse.ok) {
    throw new Error("Unable to load songs.");
  }

  if (!setlistResponse.ok) {
    throw new Error("Unable to load set list.");
  }

  const songsData = await songsResponse.json();
  const setlistData = await setlistResponse.json();
  renderSongOptions(songsData.songs);
  applySetlistPayload(setlistData);
  syncEditPanel();
  connect();
}

init().catch((error) => {
  songTitle.textContent = "Unable to load songs";
  songContent.textContent = error.message;
});

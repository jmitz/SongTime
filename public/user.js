const songTitle = document.getElementById("song-title");
const songMeta = document.getElementById("song-meta");
const sectionLabel = document.getElementById("section-label");
const songContent = document.getElementById("song-content");
const connectionStatus = document.getElementById("connection-status");
const openUserMenuButton = document.getElementById("open-user-menu-button");
const userMenuPanel = document.getElementById("user-menu-panel");
const showChordsToggle = document.getElementById("show-chords");
const openPickPanelButton = document.getElementById("open-pick-panel-button");
const userPickPanel = document.getElementById("user-pick-panel");
const closePickPanelButton = document.getElementById("close-pick-panel-button");
const pickSongSearch = document.getElementById("pick-song-search");
const pickPanelStatus = document.getElementById("pick-panel-status");
const pickSongList = document.getElementById("pick-song-list");

let socket;
let currentSong = null;
let currentSection = null;
let scrollSpeed = 1;
let lastScrollTimestamp = null;
let setList = [];
let eligiblePickSongs = [];
let isUserMenuOpen = false;
let isPickPanelOpen = false;
let isSubmittingPick = false;

const STORAGE_KEY = "songlist-show-chords";
const PICK_PANEL_STORAGE_KEY = "songlist-user-pick-panel-open";
const MAX_SCROLL_SPEED = 60;
function getShowChords() {
  return showChordsToggle.checked;
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

  if (song?.content) {
    return {
      id: "1",
      type: "verse",
      content: song.content,
    };
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

function toLyricsOnly(content) {
  return content
    .replace(/\[[^[\]]+\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function updateChordlessLayout(content = songContent.textContent || "") {
  if (getShowChords()) {
    songContent.style.removeProperty("--user-lyrics-font-size");
    songContent.style.removeProperty("--user-lyrics-max-width");
    return;
  }

  // Reset the lyric block to the full stage width before measuring so repeated
  // updates do not compound a previously shrunken max-width.
  songContent.style.setProperty("--user-lyrics-max-width", "100%");
  songContent.style.setProperty("--user-lyrics-font-size", "clamp(1.5rem, 3vw, 3rem)");
}

function parseChordSegments(line) {
  const segments = [];
  const pattern = /\[([^[\]]+)\]/g;
  let lastIndex = 0;
  let pendingChord = "";
  let match;

  while ((match = pattern.exec(line)) !== null) {
    const lyricText = line.slice(lastIndex, match.index);
    if (lyricText || pendingChord) {
      segments.push({
        chord: pendingChord,
        lyric: lyricText,
      });
    }

    pendingChord = match[1];
    lastIndex = pattern.lastIndex;
  }

  const trailingLyric = line.slice(lastIndex);
  if (trailingLyric || pendingChord || segments.length === 0) {
    segments.push({
      chord: pendingChord,
      lyric: trailingLyric,
    });
  }

  return segments;
}

function addSpacingToTrailingChordSegments(segments) {
  let lastLyricIndex = -1;

  for (let index = 0; index < segments.length; index += 1) {
    if ((segments[index].lyric || "").trim()) {
      lastLyricIndex = index;
    }
  }

  if (lastLyricIndex < 0 || lastLyricIndex >= segments.length - 1) {
    return segments;
  }

  return segments.map((segment, index) => {
    if (index <= lastLyricIndex || !segment.chord) {
      return segment;
    }

    return {
      ...segment,
      trailingChord: true,
    };
  });
}

function renderChordContent(content) {
  const fragment = document.createDocumentFragment();
  const lines = String(content || "").split("\n");

  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "chord-row";

    if (line === "") {
      row.append(document.createElement("br"));
      fragment.append(row);
      continue;
    }

    const segments = addSpacingToTrailingChordSegments(parseChordSegments(line));
    const hasChords = segments.some((segment) => segment.chord);

    if (!hasChords) {
      row.textContent = line;
      fragment.append(row);
      continue;
    }

    for (const segment of segments) {
      const wrapper = document.createElement("span");
      wrapper.className = "chord-segment";
      if (segment.trailingChord) {
        wrapper.classList.add("chord-segment-trailing");
      }

      const chord = document.createElement("span");
      chord.className = "chord-marker";
      chord.textContent = segment.chord || " ";
      if (!segment.chord) {
        chord.classList.add("chord-marker-empty");
      }

      const lyric = document.createElement("span");
      lyric.className = "lyric-segment";
      lyric.textContent = segment.lyric || " ";

      wrapper.append(chord, lyric);
      row.append(wrapper);
    }

    fragment.append(row);
  }

  return fragment;
}

function renderSong(song, section) {
  currentSong = song;
  currentSection = section;
  songTitle.textContent = song.title;
  songMeta.textContent = formatSongMeta(song);
  sectionLabel.textContent = "";

  if (!section) {
    songContent.replaceChildren();
    songContent.textContent = "";
    songContent.classList.toggle("with-chords", getShowChords());
    songContent.classList.toggle("with-inline-chords", getShowChords());
    updateChordlessLayout("");
    return;
  }

  const fragment = document.createDocumentFragment();
  song.sectionOrder.forEach((sectionId) => {
    const songSection = song.sections?.[sectionId];
    if (!songSection) {
      return;
    }

    const sectionCard = document.createElement("section");
    sectionCard.className = "user-section-card";
    sectionCard.dataset.sectionId = sectionId;
    if (section.id === sectionId) {
      sectionCard.classList.add("user-section-card-active");
    }

    const heading = document.createElement("h2");
    heading.className = "user-section-heading";
    heading.textContent = formatSectionLabel({ id: sectionId, ...songSection });
    sectionCard.append(heading);

    const body = document.createElement("div");
    body.className = "user-section-body";
    if (getShowChords()) {
      body.append(renderChordContent(songSection.content));
    } else {
      body.textContent = toLyricsOnly(songSection.content);
    }
    sectionCard.append(body);
    fragment.append(sectionCard);
  });

  songContent.replaceChildren(fragment);
  updateChordlessLayout();

  songContent.classList.toggle("with-chords", getShowChords());
  songContent.classList.toggle("with-inline-chords", getShowChords());
  if (getShowChords()) {
    updateChordlessLayout("");
  }
}

function setScrollSpeed(nextSpeed) {
  if (!Number.isFinite(nextSpeed)) {
    return;
  }

  scrollSpeed = Math.round(Math.max(0, Math.min(MAX_SCROLL_SPEED, nextSpeed)) * 10) / 10;
}

function applyScroll(scrollRatio) {
  const maxScroll = Math.max(0, songContent.scrollHeight - songContent.clientHeight);
  songContent.scrollTop = maxScroll * Math.max(0, Math.min(1, scrollRatio));
}

function getScrollLineHeight() {
  const line = songContent.querySelector(".chord-row, .user-section-body");
  if (!line) {
    return 0;
  }

  const styles = window.getComputedStyle(line);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  return Number.isFinite(lineHeight) ? lineHeight : Number.parseFloat(styles.fontSize) * 1.8;
}

function animateSongScroll(timestamp) {
  if (lastScrollTimestamp !== null && scrollSpeed > 0) {
    const elapsedSeconds = Math.min((timestamp - lastScrollTimestamp) / 1000, 0.25);
    const maxScroll = Math.max(0, songContent.scrollHeight - songContent.clientHeight);
    if (maxScroll > 0 && songContent.scrollTop < maxScroll) {
      const pixelsPerSecond = (getScrollLineHeight() * scrollSpeed) / 60;
      songContent.scrollTop = Math.min(maxScroll, songContent.scrollTop + pixelsPerSecond * elapsedSeconds);
    }
  }

  lastScrollTimestamp = timestamp;
  window.requestAnimationFrame(animateSongScroll);
}

function setStatus(text) {
  connectionStatus.textContent = text;
}

function setPickStatus(text, isError = false) {
  pickPanelStatus.textContent = text;
  pickPanelStatus.hidden = !text;
  pickPanelStatus.classList.toggle("pill-error", isError);
}

function applyUserMenuVisibility() {
  userMenuPanel.hidden = !isUserMenuOpen;
  openUserMenuButton.setAttribute("aria-expanded", String(isUserMenuOpen));
}

function openUserMenu() {
  isUserMenuOpen = true;
  applyUserMenuVisibility();
}

function closeUserMenu() {
  isUserMenuOpen = false;
  applyUserMenuVisibility();
}

function isSongAlreadyPicked(songId) {
  return setList.some((entry) => entry.songId === songId);
}

function applyPickPanelVisibility() {
  userPickPanel.hidden = !isPickPanelOpen;
  openPickPanelButton.setAttribute("aria-expanded", String(isPickPanelOpen));
}

function openPickPanel() {
  isPickPanelOpen = true;
  window.localStorage.setItem(PICK_PANEL_STORAGE_KEY, "true");
  applyPickPanelVisibility();
}

function closePickPanel() {
  isPickPanelOpen = false;
  window.localStorage.setItem(PICK_PANEL_STORAGE_KEY, "false");
  applyPickPanelVisibility();
}

function getFilteredPickSongs() {
  const query = (pickSongSearch.value || "").trim().toLowerCase();
  if (!query) {
    return eligiblePickSongs;
  }

  return eligiblePickSongs.filter((song) => {
    const haystack = `${song.title} ${song.authors || ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderPickSongList() {
  pickSongList.innerHTML = "";
  const visibleSongs = getFilteredPickSongs();

  if (eligiblePickSongs.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "muted";
    emptyState.textContent = "No audience-ready songs are available right now.";
    pickSongList.append(emptyState);
    return;
  }

  if (visibleSongs.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "muted";
    emptyState.textContent = "No songs match that search.";
    pickSongList.append(emptyState);
    return;
  }

  visibleSongs.forEach((song) => {
    const item = document.createElement("div");
    item.className = "user-pick-item";

    const meta = document.createElement("div");
    meta.className = "user-pick-meta";

    const title = document.createElement("strong");
    title.textContent = song.title;
    meta.append(title);

    if (song.authors) {
      const authors = document.createElement("span");
      authors.className = "muted";
      authors.textContent = song.authors;
      meta.append(authors);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary";

    if (isSongAlreadyPicked(song.id)) {
      button.textContent = "In set list";
      button.disabled = true;
    } else {
      button.textContent = "Suggest";
      button.disabled = isSubmittingPick;
      button.addEventListener("click", () => {
        suggestSong(song.id);
      });
    }

    item.append(meta, button);
    pickSongList.append(item);
  });
}

function applyPickPayload(payload) {
  setList = Array.isArray(payload?.setList) ? payload.setList : setList;
  eligiblePickSongs = Array.isArray(payload?.eligibleSongs) ? payload.eligibleSongs : eligiblePickSongs;
  renderPickSongList();
}

async function loadPickableSongs() {
  const response = await fetch("/api/user-song-picks");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to load songs.");
  }

  applyPickPayload(data);
  setPickStatus(eligiblePickSongs.length > 0 ? "" : "No audience-ready songs");
}

async function suggestSong(songId) {
  isSubmittingPick = true;
  setPickStatus("Adding your song...");
  renderPickSongList();

  try {
    const response = await fetch("/api/user-song-picks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ songId }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to add song.");
    }

    applyPickPayload(data);
    setPickStatus("Song added to the set list");
  } catch (error) {
    setPickStatus(error.message, true);
  } finally {
    isSubmittingPick = false;
    renderPickSongList();
  }
}

showChordsToggle.checked = window.localStorage.getItem(STORAGE_KEY) === "true";
isPickPanelOpen = window.localStorage.getItem(PICK_PANEL_STORAGE_KEY) === "true";
applyPickPanelVisibility();

showChordsToggle.addEventListener("change", () => {
  window.localStorage.setItem(STORAGE_KEY, String(showChordsToggle.checked));
  if (currentSong && currentSection) {
    renderSong(currentSong, currentSection);
  }
});

window.addEventListener("resize", () => {
  if (currentSong && currentSection && !getShowChords()) {
    updateChordlessLayout();
  }
});

openUserMenuButton.addEventListener("click", () => {
  if (isUserMenuOpen) {
    closeUserMenu();
    return;
  }

  openUserMenu();
});

openPickPanelButton.addEventListener("click", () => {
  closeUserMenu();

  if (isPickPanelOpen) {
    closePickPanel();
    return;
  }

  openPickPanel();
});

closePickPanelButton.addEventListener("click", () => {
  closePickPanel();
});

pickSongSearch.addEventListener("input", () => {
  renderPickSongList();
});

document.addEventListener("click", (event) => {
  if (
    isUserMenuOpen &&
    !userMenuPanel.contains(event.target) &&
    !openUserMenuButton.contains(event.target)
  ) {
    closeUserMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeUserMenu();
  }
});

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener("open", () => {
    setStatus("Live");
    socket.send(JSON.stringify({ type: "register", role: "user" }));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      if (Array.isArray(message.payload.setList)) {
        setList = message.payload.setList;
        renderPickSongList();
      }
      renderSong(
        message.payload.currentSong,
        resolveSection(message.payload.currentSong, message.payload.currentSection, message.payload.currentSectionIndex),
      );
      setScrollSpeed(message.payload.scrollSpeed);
      applyScroll(message.payload.scrollRatio);
    }

    if (message.type === "scroll" && scrollSpeed > 0) {
      applyScroll(message.payload.scrollRatio);
    }

    if (message.type === "scroll-speed") {
      setScrollSpeed(message.payload.scrollSpeed);
    }

    if (message.type === "setlist") {
      applyPickPayload({
        setList: message.payload.setList,
        eligibleSongs: message.payload.eligibleSongs?.filter(
          (song) => Boolean(song?.audit?.initial) && Boolean(song?.audit?.chordPlay),
        ),
      });
    }
  });

  socket.addEventListener("close", () => {
    setStatus("Reconnecting...");
    window.setTimeout(connect, 1000);
  });
}

loadPickableSongs().catch((error) => {
  setPickStatus(error.message, true);
});

connect();
window.requestAnimationFrame(animateSongScroll);

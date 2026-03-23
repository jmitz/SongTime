const songSelect = document.getElementById("song-select");
const songTitle = document.getElementById("song-title");
const sectionLabel = document.getElementById("section-label");
const songContent = document.getElementById("song-content");
const leaderCount = document.getElementById("leader-count");
const userCount = document.getElementById("user-count");

let socket;
let suppressScrollBroadcast = false;
let selectedSongId = null;

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

function renderSong(song, section) {
  selectedSongId = song.id;
  songTitle.textContent = song.title;
  sectionLabel.textContent = formatSectionLabel(section);
  songContent.textContent = section?.content || "";
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

songSelect.addEventListener("change", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ type: "set-song", songId: songSelect.value }));
});

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

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
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

async function init() {
  const response = await fetch("/api/songs");
  const data = await response.json();
  renderSongOptions(data.songs);

  connect();
}

init().catch((error) => {
  songTitle.textContent = "Unable to load songs";
  songContent.textContent = error.message;
});

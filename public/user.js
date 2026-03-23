const songTitle = document.getElementById("song-title");
const sectionLabel = document.getElementById("section-label");
const songContent = document.getElementById("song-content");
const connectionStatus = document.getElementById("connection-status");
const showChordsToggle = document.getElementById("show-chords");

let socket;
let allowScroll = true;
let currentSong = null;
let currentSection = null;

const STORAGE_KEY = "songlist-show-chords";

function getShowChords() {
  return showChordsToggle.checked;
}

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

function toLyricsOnly(content) {
  return content
    .replace(/\[[^[\]]+\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderSong(song, section) {
  currentSong = song;
  currentSection = section;
  songTitle.textContent = song.title;
  sectionLabel.textContent = formatSectionLabel(section);
  songContent.textContent = getShowChords() ? section?.content || "" : toLyricsOnly(section?.content || "");
  songContent.classList.toggle("with-chords", getShowChords());
}

function applyScroll(scrollRatio) {
  allowScroll = false;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ top: maxScroll * scrollRatio, behavior: "smooth" });
  window.setTimeout(() => {
    allowScroll = true;
  }, 250);
}

function setStatus(text) {
  connectionStatus.textContent = text;
}

showChordsToggle.checked = window.localStorage.getItem(STORAGE_KEY) === "true";
showChordsToggle.addEventListener("change", () => {
  window.localStorage.setItem(STORAGE_KEY, String(showChordsToggle.checked));
  if (currentSong && currentSection) {
    renderSong(currentSong, currentSection);
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
      renderSong(
        message.payload.currentSong,
        resolveSection(message.payload.currentSong, message.payload.currentSection, message.payload.currentSectionIndex),
      );
      applyScroll(message.payload.scrollRatio);
    }

    if (message.type === "scroll" && allowScroll) {
      applyScroll(message.payload.scrollRatio);
    }
  });

  socket.addEventListener("close", () => {
    setStatus("Reconnecting...");
    window.setTimeout(connect, 1000);
  });
}

connect();

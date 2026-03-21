const songTitle = document.getElementById("song-title");
const songContent = document.getElementById("song-content");
const connectionStatus = document.getElementById("connection-status");
const showChordsToggle = document.getElementById("show-chords");

let socket;
let allowScroll = true;
let currentSong = null;

const STORAGE_KEY = "songlist-show-chords";

function getShowChords() {
  return showChordsToggle.checked;
}

function renderSong(song) {
  currentSong = song;
  songTitle.textContent = song.title;
  songContent.textContent = getShowChords() ? song.chorded : song.lyrics;
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
  if (currentSong) {
    renderSong(currentSong);
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
      renderSong(message.payload.currentSong);
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

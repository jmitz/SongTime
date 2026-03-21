const songSelect = document.getElementById("song-select");
const songTitle = document.getElementById("song-title");
const songContent = document.getElementById("song-content");
const leaderCount = document.getElementById("leader-count");
const userCount = document.getElementById("user-count");

let socket;
let suppressScrollBroadcast = false;

function renderSong(song) {
  songTitle.textContent = song.title;
  songContent.textContent = song.chorded;
}

function applyState(state) {
  leaderCount.textContent = String(state.leaderCount);
  userCount.textContent = String(state.userCount);

  if (!state.currentSong) {
    return;
  }

  renderSong(state.currentSong);
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

  for (const song of data.songs) {
    const option = document.createElement("option");
    option.value = song.id;
    option.textContent = song.title;
    songSelect.append(option);
  }

  connect();
}

init().catch((error) => {
  songTitle.textContent = "Unable to load songs";
  songContent.textContent = error.message;
});

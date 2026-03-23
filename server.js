const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { initializeDatabase } = require("./db/sqlite");

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const { dbPath, repository } = initializeDatabase();

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

if (repository.songs.length === 0) {
  throw new Error(`No songs found in SQLite database at ${dbPath}`);
}

const state = {
  currentSongId: repository.songs[0].id,
  currentSectionIndex: 0,
  scrollRatio: 0,
  leaderCount: 0,
  userCount: 0,
};

function getCurrentSong() {
  return repository.getSong(state.currentSongId) || repository.songs[0];
}

function getCurrentSection(song = getCurrentSong()) {
  const sectionId = song.sectionOrder[state.currentSectionIndex] || song.sectionOrder[0];
  return sectionId
    ? {
        id: sectionId,
        label: repository.getSectionLabel(sectionId),
        ...song.sections[sectionId],
      }
    : null;
}

function serializeState() {
  const currentSong = getCurrentSong();
  return {
    currentSongId: currentSong.id,
    currentSectionIndex: state.currentSectionIndex,
    scrollRatio: state.scrollRatio,
    currentSong,
    currentSection: getCurrentSection(currentSong),
    leaderCount: state.leaderCount,
    userCount: state.userCount,
  };
}

app.get("/api/songs", (req, res) => {
  const initialQuery = req.query.initial;
  const initialFilter =
    initialQuery === "true" ? true : initialQuery === "false" ? false : null;

  res.json({
    songs: repository.listSongSummaries({ initial: initialFilter }),
  });
});

app.get("/api/songs/:id", (req, res) => {
  const song = repository.getSong(req.params.id);
  if (!song) {
    res.status(404).json({ error: "Song not found." });
    return;
  }

  res.json({
    song,
    sectionTypes: repository.sectionTypes,
  });
});

app.get("/api/section-types", (_req, res) => {
  res.json({ sectionTypes: repository.sectionTypes });
});

function handleSongMutation(req, res, saveSong) {
  try {
    const song = saveSong(req.body);
    if (!song) {
      res.status(404).json({ error: "Song not found." });
      return;
    }

    if (song.id === state.currentSongId) {
      const maxIndex = Math.max(0, song.sectionOrder.length - 1);
      state.currentSectionIndex = Math.min(maxIndex, state.currentSectionIndex);
      broadcastState();
    }

    broadcastSongs();

    res.json({
      song,
      songs: repository.listSongSummaries(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

app.post("/api/songs", (req, res) => {
  handleSongMutation(req, res, (payload) => repository.createSong(payload));
});

app.put("/api/songs/:id", (req, res) => {
  handleSongMutation(req, res, (payload) => repository.updateSong(req.params.id, payload));
});

app.delete("/api/songs/:id", (req, res) => {
  try {
    const deletedSong = repository.deleteSong(req.params.id);
    if (!deletedSong) {
      res.status(404).json({ error: "Song not found." });
      return;
    }

    if (deletedSong.id === state.currentSongId) {
      const fallbackSong = repository.songs[0];
      state.currentSongId = fallbackSong.id;
      state.currentSectionIndex = 0;
      state.scrollRatio = 0;
      broadcastState();
    }

    broadcastSongs();

    res.json({
      deletedSongId: deletedSong.id,
      songs: repository.listSongSummaries(),
      currentSongId: state.currentSongId,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/state", (_req, res) => {
  res.json(serializeState());
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, songs: repository.songs.length, dbPath });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

function broadcastState() {
  broadcast({ type: "state", payload: serializeState() });
}

function broadcastSongs() {
  broadcast({
    type: "songs",
    payload: {
      songs: repository.listSongSummaries(),
    },
  });
}

wss.on("connection", (socket) => {
  socket.role = null;
  socket.send(JSON.stringify({ type: "state", payload: serializeState() }));

  socket.on("message", (buffer) => {
    let message;
    try {
      message = JSON.parse(buffer.toString());
    } catch (_error) {
      return;
    }

    if (message.type === "register" && (message.role === "leader" || message.role === "user")) {
      if (socket.role === "leader") {
        state.leaderCount = Math.max(0, state.leaderCount - 1);
      } else if (socket.role === "user") {
        state.userCount = Math.max(0, state.userCount - 1);
      }

      socket.role = message.role;
      if (socket.role === "leader") {
        state.leaderCount += 1;
      } else {
        state.userCount += 1;
      }
      broadcastState();
      return;
    }

    if (socket.role !== "leader") {
      return;
    }

    if (message.type === "set-song" && typeof message.songId === "string") {
      const song = repository.getSong(message.songId);
      if (!song) {
        return;
      }

      state.currentSongId = song.id;
      state.currentSectionIndex = 0;
      state.scrollRatio = 0;
      broadcastState();
      return;
    }

    if (message.type === "next-section") {
      const song = getCurrentSong();
      const maxIndex = Math.max(0, song.sectionOrder.length - 1);
      state.currentSectionIndex = Math.min(maxIndex, state.currentSectionIndex + 1);
      state.scrollRatio = 0;
      broadcastState();
      return;
    }

    if (message.type === "previous-section") {
      state.currentSectionIndex = Math.max(0, state.currentSectionIndex - 1);
      state.scrollRatio = 0;
      broadcastState();
      return;
    }

    if (message.type === "scroll" && typeof message.scrollRatio === "number") {
      const scrollRatio = Math.max(0, Math.min(1, message.scrollRatio));
      state.scrollRatio = scrollRatio;
      broadcast({ type: "scroll", payload: { scrollRatio } });
    }
  });

  socket.on("close", () => {
    if (socket.role === "leader") {
      state.leaderCount = Math.max(0, state.leaderCount - 1);
    } else if (socket.role === "user") {
      state.userCount = Math.max(0, state.userCount - 1);
    }
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`SongList app listening on http://localhost:${PORT} using SQLite at ${dbPath}`);
});

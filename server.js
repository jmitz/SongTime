const path = require("path");
const http = require("http");
const dns = require("dns").promises;
const os = require("os");
const express = require("express");
const { WebSocketServer } = require("ws");
const { initializeDatabase } = require("./db/sqlite");

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_HOST = (process.env.PUBLIC_HOST || "").trim();
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT || PORT);
const { db, dbPath, repository } = initializeDatabase();

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

if (repository.songs.length === 0) {
  throw new Error(`No songs found in SQLite database at ${dbPath}`);
}

const state = {
  currentSongId: repository.songs[0].id,
  currentSectionIndex: 0,
  currentSectionPartIndex: 0,
  scrollRatio: 0,
  scrollSpeed: 3,
  leaderCount: 0,
  userCount: 0,
};

function getCurrentSong() {
  return repository.getSong(state.currentSongId) || repository.songs[0];
}

function getCurrentSection(song = getCurrentSong()) {
  const sectionId = song.sectionOrder[state.currentSectionIndex];
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
    currentSectionPartIndex: state.currentSectionPartIndex,
    scrollRatio: state.scrollRatio,
    scrollSpeed: state.scrollSpeed,
    currentSong,
    currentSection: getCurrentSection(currentSong),
    setList: repository.listSetlist(),
    performanceLog: repository.getPerformanceLog(),
    leaderCount: state.leaderCount,
    userCount: state.userCount,
  };
}

function recordSongForActivePerformance(songId = state.currentSongId) {
  const performanceLog = repository.getPerformanceLog();
  if (!performanceLog?.active) {
    return performanceLog;
  }

  return repository.recordPerformanceSong(songId);
}

function getSystemInterfaceIpAddress() {
  const interfaces = os.networkInterfaces();
  let firstExternalAddress = null;

  for (const networkInterface of Object.values(interfaces)) {
    for (const address of networkInterface || []) {
      if (address.internal) {
        continue;
      }

      if (!firstExternalAddress) {
        firstExternalAddress = address.address;
      }

      if (address.family === "IPv4") {
        return address.address;
      }
    }
  }

  return firstExternalAddress;
}

async function getSystemIpAddress() {
  try {
    const { address } = await dns.lookup("host.docker.internal", { family: 4 });
    if (address) {
      return address;
    }
  } catch (_error) {
    // Ignore hostname lookup failures and fall back to local interface inspection.
  }

  return getSystemInterfaceIpAddress();
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

app.get("/api/setlist", (_req, res) => {
  res.json({
    setList: repository.listSetlist(),
    eligibleSongs: repository.listSongSummaries({ initial: true }),
    performanceLog: repository.getPerformanceLog(),
  });
});

app.get("/api/performance-log", (_req, res) => {
  res.json({
    performanceLog: repository.getPerformanceLog(),
  });
});

app.get("/api/user-song-picks", (_req, res) => {
  res.json({
    setList: repository.listSetlist(),
    eligibleSongs: repository.listSongSummaries({ initial: true, chordPlay: true }),
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
      state.currentSectionPartIndex = 0;
      broadcastState();
    }

    broadcastSongs();
    broadcastSetlist();

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

app.patch("/api/songs/:id/lock", (req, res) => {
  try {
    const song = repository.setSongLocked(req.params.id, Boolean(req.body?.locked));
    if (!song) {
      res.status(404).json({ error: "Song not found." });
      return;
    }

    if (song.id === state.currentSongId) {
      broadcastState();
    }

    broadcastSongs();
    broadcastSetlist();

    res.json({
      song,
      songs: repository.listSongSummaries(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/setlist", (req, res) => {
  try {
    const setList = repository.saveSetlist(req.body?.songIds || []);
    broadcastSetlist();
    broadcastState();
    res.json({
      setList,
      eligibleSongs: repository.listSongSummaries({ initial: true }),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/performance/start", (req, res) => {
  try {
    const performanceLog = repository.startPerformanceEvent(req.body?.songId ?? state.currentSongId);
    broadcastState();
    res.json({ performanceLog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/performance/stop", (_req, res) => {
  try {
    const performanceLog = repository.stopPerformanceEvent();
    broadcastState();
    res.json({ performanceLog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/performance-log", (_req, res) => {
  try {
    const performanceLog = repository.clearPerformanceLog();
    broadcastState();
    res.json({ performanceLog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/user-song-picks", (req, res) => {
  try {
    const setList = repository.addSongToSetlist(req.body?.songId);
    broadcastSetlist();
    broadcastState();
    res.json({
      setList,
      eligibleSongs: repository.listSongSummaries({ initial: true, chordPlay: true }),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
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
      state.currentSectionPartIndex = 0;
      state.scrollRatio = 0;
      broadcastState();
    }

    broadcastSongs();
    broadcastSetlist();

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

app.get("/api/system-info", async (_req, res) => {
  const ipAddress = PUBLIC_HOST || (await getSystemIpAddress()) || null;

  res.json({
    ipAddress,
    port: PUBLIC_PORT,
  });
});

app.post("/api/shutdown", (_req, res) => {
  res.json({ ok: true });
  setImmediate(() => shutdown("editor request"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, songs: repository.songs.length, dbPath });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
let isShuttingDown = false;
let isDatabaseClosed = false;

function closeDatabase() {
  if (isDatabaseClosed) {
    return;
  }

  isDatabaseClosed = true;
  db.close();
}

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

function broadcastSetlist() {
  broadcast({
    type: "setlist",
    payload: {
      setList: repository.listSetlist(),
      eligibleSongs: repository.listSongSummaries({ initial: true }),
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

      const songChanged = state.currentSongId !== song.id;
      state.currentSongId = song.id;
      state.currentSectionIndex = 0;
      state.currentSectionPartIndex = 0;
      state.scrollRatio = 0;
      state.scrollSpeed = 0;
      if (songChanged) {
        recordSongForActivePerformance(song.id);
      }
      broadcastState();
      return;
    }

    if (message.type === "next-section") {
      const song = getCurrentSong();
      const maxIndex = Math.max(0, song.sectionOrder.length - 1);
      if (state.currentSectionIndex < maxIndex) {
        state.currentSectionIndex += 1;
      }
      state.currentSectionPartIndex = 0;
      state.scrollRatio = 0;
      broadcastState();
      return;
    }

    if (message.type === "previous-section") {
      state.currentSectionIndex = Math.max(0, state.currentSectionIndex - 1);
      state.currentSectionPartIndex = 0;
      state.scrollRatio = 0;
      broadcastState();
      return;
    }

    if (message.type === "scroll" && typeof message.scrollRatio === "number") {
      if (state.scrollSpeed <= 0) {
        return;
      }

      const scrollRatio = Math.max(0, Math.min(1, message.scrollRatio));
      state.scrollRatio = scrollRatio;
      broadcast({ type: "scroll", payload: { scrollRatio } });
      return;
    }

    if (message.type === "set-scroll-speed" && typeof message.scrollSpeed === "number") {
      state.scrollSpeed = Math.max(0, Math.min(60, message.scrollSpeed));
      broadcast({ type: "scroll-speed", payload: { scrollSpeed: state.scrollSpeed } });
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

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down SongList.`);

  for (const client of wss.clients) {
    client.close();
  }

  const forceShutdownTimer = setTimeout(() => {
    closeDatabase();
    process.exit(1);
  }, 5000);
  forceShutdownTimer.unref();

  wss.close(() => {
    server.close((error) => {
      clearTimeout(forceShutdownTimer);
      closeDatabase();
      process.exit(error ? 1 : 0);
    });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("exit", closeDatabase);

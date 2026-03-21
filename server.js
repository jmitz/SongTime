const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const SONGBOOK_PATH = path.join(__dirname, "documents", "SongBook-extracted.md");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);

function isPageNumber(line) {
  return /^\d+$/.test(line.trim());
}

function isChordToken(token) {
  return /^[A-G](#|b)?(m|maj|min|sus|aug|dim|add)?\d*(\/[A-G](#|b)?)?$/.test(token);
}

function looksLikeChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  const chordTokens = tokens.filter(isChordToken).length;
  return chordTokens > 0 && chordTokens / tokens.length >= 0.6;
}

function toLyricsOnly(content) {
  return content
    .split("\n")
    .filter((line) => !isPageNumber(line))
    .filter((line) => !looksLikeChordLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseSongs(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const songs = [];
  const pattern = /^##\s+(.+)\n+```text\n([\s\S]*?)\n```/gm;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const title = match[1].trim();
    const chorded = match[2].trim();
    songs.push({
      id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      title,
      chorded,
      lyrics: toLyricsOnly(chorded),
    });
  }

  return songs;
}

const markdown = fs.readFileSync(SONGBOOK_PATH, "utf8");
const songs = parseSongs(markdown);

if (songs.length === 0) {
  throw new Error(`No songs found in ${SONGBOOK_PATH}`);
}

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const state = {
  currentSongId: songs[0].id,
  scrollRatio: 0,
  leaderCount: 0,
  userCount: 0,
};

function getCurrentSong() {
  return songs.find((song) => song.id === state.currentSongId) || songs[0];
}

function serializeState() {
  return {
    currentSongId: state.currentSongId,
    scrollRatio: state.scrollRatio,
    currentSong: getCurrentSong(),
    leaderCount: state.leaderCount,
    userCount: state.userCount,
  };
}

app.get("/api/songs", (_req, res) => {
  res.json({
    songs: songs.map((song) => ({
      id: song.id,
      title: song.title,
    })),
  });
});

app.get("/api/state", (_req, res) => {
  res.json(serializeState());
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, songs: songs.length });
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
      const song = songs.find((item) => item.id === message.songId);
      if (!song) {
        return;
      }

      state.currentSongId = song.id;
      state.scrollRatio = 0;
      broadcastState();
      return;
    }

    if (message.type === "scroll" && typeof message.scrollRatio === "number") {
      state.scrollRatio = Math.max(0, Math.min(1, message.scrollRatio));
      broadcast({ type: "scroll", payload: { scrollRatio: state.scrollRatio } });
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
  console.log(`SongList app listening on http://localhost:${PORT}`);
});

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const SONGBOOK_PATH = path.join(__dirname, "documents", "SongBook-extracted.md");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const SONG_OVERRIDES = {
  "as-the-deer": {
    sections: {
      "1": {
        type: "verse",
        content: "[C]As the d[G]eer panteth [Am]for the w[Em]ater,\n[F]So my soul lo[G]ngeth [C]aft[G]er you.\n[C]You a[G]lone are my h[Am]eart's d[Em]esire\n[F]And I lon[G]g to wo[C]rship you.",
      },
      "2": {
        type: "verse",
        content: "[C]I love Y[G]ou more than g[Am]old or [Em]silver\n[F]Only You[G] can[C] sa[G]tisfy\n[C]You a[G]lone are the [Am]real joy g[Em]iver\n[F]And t[G]he appl[C]e of my eye.",
      },
      "3": {
        type: "verse",
        content: "[C]You're my fr[G]iend, and You are my br[Am]other\n[F]Even thou[G]gh You are a [C]Kin[G]g.\n[C]I love y[G]ou more than any ot[Am]her\n[F]So much mo[G]re than anyt[C]hing.",
      },
      C: {
        type: "chorus",
        content: "[Am]You alone are my str[F]ength, my sh[C]ield.\n[F]To You alone will my sp[Am]irit yi[Dm]eld.[E]\n[C]You a[G]lone are my h[Am]eart's d[Em]esire\n[F]And I lon[G]g to wo[C]rship you.",
      },
    },
    sectionOrder: ["1", "C", "2", "C", "3", "C"],
  },
};

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

function insertInlineChords(chordLine, lyricLine) {
  const chordMatches = [...chordLine.matchAll(/\S+/g)].filter((match) => isChordToken(match[0]));
  if (chordMatches.length === 0) {
    return lyricLine;
  }

  let result = "";
  let cursor = 0;

  for (const match of chordMatches) {
    const insertAt = Math.max(cursor, Math.min(match.index ?? 0, lyricLine.length));
    result += lyricLine.slice(cursor, insertAt);
    result += `[${match[0]}]`;
    cursor = insertAt;
  }

  result += lyricLine.slice(cursor);
  return result;
}

function toInlineContent(content) {
  const lines = content.split("\n");
  const mergedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isPageNumber(line)) {
      continue;
    }

    if (looksLikeChordLine(line)) {
      const nextLine = lines[index + 1];
      if (typeof nextLine === "string" && nextLine.trim() !== "" && !isPageNumber(nextLine) && !looksLikeChordLine(nextLine)) {
        mergedLines.push(insertInlineChords(line, nextLine));
        index += 1;
        continue;
      }

      const inlineChordLine = line
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => (isChordToken(token) ? `[${token}]` : token))
        .join(" ");
      mergedLines.push(inlineChordLine);
      continue;
    }

    mergedLines.push(line);
  }

  return mergedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function toLyricsOnly(content) {
  return content
    .replace(/\[[^[\]]+\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createDefaultSections(content) {
  return {
    "1": {
      type: "verse",
      content,
    },
  };
}

function parseSongs(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const songs = [];
  const pattern = /^##\s+(.+)\n+```text\n([\s\S]*?)\n```/gm;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const title = match[1].trim();
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const content = toInlineContent(match[2].trim());
    const override = SONG_OVERRIDES[id];
    const sections = override?.sections || createDefaultSections(content);
    const sectionOrder = override?.sectionOrder || Object.keys(sections);
    songs.push({
      id,
      title,
      content,
      sections,
      sectionOrder,
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
  currentSectionIndex: 0,
  scrollRatio: 0,
  leaderCount: 0,
  userCount: 0,
};

function getCurrentSong() {
  return songs.find((song) => song.id === state.currentSongId) || songs[0];
}

function getCurrentSection(song = getCurrentSong()) {
  const sectionId = song.sectionOrder[state.currentSectionIndex] || song.sectionOrder[0];
  return {
    id: sectionId,
    ...song.sections[sectionId],
  };
}

function serializeState() {
  const currentSong = getCurrentSong();
  return {
    currentSongId: state.currentSongId,
    currentSectionIndex: state.currentSectionIndex,
    scrollRatio: state.scrollRatio,
    currentSong,
    currentSection: getCurrentSection(currentSong),
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

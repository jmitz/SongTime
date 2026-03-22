const fs = require("fs");

const SONG_OVERRIDES = {
  "as-the-deer": {
    ccliNum: "1431",
    sections: {
      "1": {
        type: "verse",
        content:
          "[C]As the d[G]eer panteth [Am]for the w[Em]ater,\n[F]So my soul lo[G]ngeth [C]aft[G]er you.\n[C]You a[G]lone are my h[Am]eart's d[Em]esire\n[F]And I lon[G]g to wo[C]rship you.",
      },
      "2": {
        type: "verse",
        content:
          "[C]I love Y[G]ou more than g[Am]old or [Em]silver\n[F]Only You[G] can[C] sa[G]tisfy\n[C]You a[G]lone are the [Am]real joy g[Em]iver\n[F]And t[G]he appl[C]e of my eye.",
      },
      "3": {
        type: "verse",
        content:
          "[C]You're my fr[G]iend, and You are my br[Am]other\n[F]Even thou[G]gh You are a [C]Kin[G]g.\n[C]I love y[G]ou more than any ot[Am]her\n[F]So much mo[G]re than anyt[C]hing.",
      },
      C: {
        type: "chorus",
        content:
          "[Am]You alone are my str[F]ength, my sh[C]ield.\n[F]To You alone will my sp[Am]irit yi[Dm]eld.[E]\n[C]You a[G]lone are my h[Am]eart's d[Em]esire\n[F]And I lon[G]g to wo[C]rship you.",
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

function createUniqueSongId(title, slugCounts) {
  const baseId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const nextCount = (slugCounts.get(baseId) || 0) + 1;
  slugCounts.set(baseId, nextCount);

  if (nextCount === 1) {
    return baseId;
  }

  return `${baseId}-${nextCount}`;
}

function parseSongs(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const songs = [];
  const slugCounts = new Map();
  const pattern = /^##\s+(.+)\n+```text\n([\s\S]*?)\n```/gm;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const title = match[1].trim();
    const id = createUniqueSongId(title, slugCounts);
    const content = toInlineContent(match[2].trim());
    const override = SONG_OVERRIDES[id];
    const sections = override?.sections || createDefaultSections(content);
    const sectionOrder = override?.sectionOrder || Object.keys(sections);

    songs.push({
      id,
      title,
      ccliNum: override?.ccliNum || "",
      content,
      lyrics: toLyricsOnly(content),
      sections,
      sectionOrder,
    });
  }

  return songs;
}

function loadSongsFromFile(songbookPath) {
  const markdown = fs.readFileSync(songbookPath, "utf8");
  return parseSongs(markdown);
}

function buildSeedData(songs) {
  const songRows = songs.map((song) => ({
    id: song.id,
    title: song.title,
    lyrics: song.lyrics,
    content: song.content,
  }));

  const sectionRows = [];
  const arrangementRows = [];

  for (const song of songs) {
    for (const [sectionId, section] of Object.entries(song.sections)) {
      sectionRows.push({
        song_id: song.id,
        section_id: sectionId,
        section_type: section.type,
        content: section.content,
      });
    }

    song.sectionOrder.forEach((sectionId, position) => {
      arrangementRows.push({
        song_id: song.id,
        position,
        section_id: sectionId,
      });
    });
  }

  return {
    songs: songRows,
    songSections: sectionRows,
    songArrangements: arrangementRows,
  };
}

module.exports = {
  buildSeedData,
  loadSongsFromFile,
  parseSongs,
};

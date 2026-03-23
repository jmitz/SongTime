function escapeSongHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderChordedSongHtml(content) {
  return String(content || "")
    .split("\n")
    .map((line) => {
      const html = escapeSongHtml(line).replace(
        /\[([^[\]]+)\]/g,
        '<span class="chord-token">$1</span>',
      );

      return `<p class="chord-line">${html || "&nbsp;"}</p>`;
    })
    .join("");
}

window.SongRender = {
  renderChordedSongHtml,
};

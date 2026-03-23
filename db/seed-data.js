const path = require("path");
const { loadSongsFromFile } = require("../lib/songbook");

const SONGBOOK_PATH = path.join(__dirname, "..", "documents", "SongBook-extracted.md");

function loadSeedData() {
  return loadSongsFromFile(SONGBOOK_PATH).map((song, index) => ({
    id: index + 1,
    title: song.title,
    authors: song.authors,
    ccli_num: song.ccliNum,
    lyrics_json: JSON.stringify(
      Object.fromEntries(
        Object.entries(song.sections).map(([sectionId, section]) => [sectionId, section.content]),
      ),
    ),
    section_order_json: JSON.stringify(song.sectionOrder),
  }));
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(loadSeedData(), null, 2)}\n`);
}

module.exports = {
  loadSeedData,
};

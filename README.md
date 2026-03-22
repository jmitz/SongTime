# SongList Realtime App

This is a Dockerized MVP for a shared songbook application with two views:

- `Leader`: sees songs with inline chords and controls the active song.
- `User`: sees the same active song without chords by default, with an option to show them.

The app uses a simple in-memory realtime session over WebSockets. That keeps the first version easy to run inside a single container.

## Run With Docker

```bash
docker build -t songlist-app .
docker run --rm -p 3000:3000 songlist-app
```

Or with Docker Compose:

```bash
docker compose up --build
```

Then open:

- `http://localhost:3000/leader.html`
- `http://localhost:3000/editor.html`
- `http://localhost:3000/user.html`

## Local Run Without Docker

```bash
npm install
npm start
```

## Continuous Integration

- `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests.
- It installs dependencies, checks `server.js`, verifies the DB seed output, builds the Docker image, starts the container, and confirms `/health` responds successfully.

## Local Auto-Redeploy On Commit

- If you want every local `git commit` to rebuild and restart the container on this machine, enable the versioned hook path once:

```bash
git config core.hooksPath .githooks
```

- After that, `.githooks/post-commit` will run `docker compose up --build -d` after each commit.
- You can also run the same behavior manually with:

```bash
./scripts/redeploy.sh
```

## Notes

- Song data is loaded from `documents/SongBook-extracted.md` and normalized into a single inline-chord lyrics field.
- Songs initialize into a local SQLite database at `data/songlist.db`.
- `editor.html` lets you create songs and edit titles, CCLI numbers, section order, and section content directly in that SQLite database.
- The live session stays in server memory for this single-instance app, so connected counts and the current position reset on restart.
- This version assumes route-based roles rather than authenticated users.
- The Docker image now installs dependencies with `npm ci`, runs as the non-root `node` user, and can also be started with `docker compose`.

## Database Foundation

- `db/schema.sql` now defines a single `songs` table with an integer `id`, a text `ccli_num`, and section metadata stored as JSON in the row.
- `db/seed-data.js` transforms the current markdown songbook into song rows for that table.
- `db/sqlite.js` creates the SQLite database, applies the schema, and seeds songs into it when the database is empty.
- `lib/songbook.js` now holds the parsing and normalization logic so the app and future database seed/import steps share the same source of truth.

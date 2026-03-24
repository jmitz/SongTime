# SongList Realtime App

This is a Dockerized MVP for a shared songbook application with two views:

- `Leader`: sees songs with inline chords and controls the active song.
- `User`: sees the same active song without chords by default, with an option to show them.

The app uses a simple in-memory realtime session over WebSockets. That keeps the first version easy to run inside a single container.

## Run With Docker

```bash
docker build -t songlist-app .
mkdir -p data
docker run --rm -p 3000:3000 \
  -v "$(pwd)/package.json:/app/package.json:ro" \
  -v "$(pwd)/package-lock.json:/app/package-lock.json:ro" \
  -v "$(pwd)/server.js:/app/server.js" \
  -v "$(pwd)/db:/app/db" \
  -v "$(pwd)/lib:/app/lib" \
  -v "$(pwd)/public:/app/public" \
  -v "$(pwd)/documents:/app/documents:ro" \
  -v "$(pwd)/data:/app/data" \
  songlist-app
```

Or with Docker Compose:

```bash
docker compose up --build
```

## Run With Windows Docker Desktop

Use these Docker Desktop settings for this project:

- Run Docker Desktop in `Linux containers` mode.
- Enable `Use the WSL 2 based engine` in `Settings > General`.
- In `Settings > Resources > WSL Integration`, enable integration for the distro where you work with this repo.
- Make sure the repo is stored in a location Docker can access cleanly.
- Make sure port `3000` is available on Windows.

Recommended repo locations:

- Best: inside your WSL filesystem, for example `/home/<you>/src/...`
- Also works: under `C:\...`, as long as Docker Desktop has access to that drive/folder

This project uses bind mounts from [compose.yaml](/home/jdmit/src/personal/SongList/compose.yaml), so Docker needs access to the repo files and the local `data/` folder.

Start it with:

```bash
docker compose up --build
```

If `data/` does not exist yet, create it first:

```bash
mkdir data
```

Then open:

- `http://localhost:3000/leader.html`
- `http://localhost:3000/editor.html`
- `http://localhost:3000/user.html`

Both Docker Compose and the `docker run` example above mount the local `data/` folder into the container, so SQLite changes persist in [data/songlist.db](/home/jdmit/src/personal/SongList/data/songlist.db) on your machine.
They also bind-mount the app files the container serves and executes, so local changes to `server.js`, `public/`, `db/`, `lib/`, and the packaged song documents are what the container uses at runtime.

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
- `editor.html` lets you create songs and edit titles, CCLI numbers, section order, and section content directly in that SQLite database, with an initial-edit filter backed by `songaudit`.
- Docker runs can use the same local `data/songlist.db` by mounting `./data` to `/app/data`.
- Docker Compose also bind-mounts the local web/server source files into `/app`, so the container uses your local copies of the app code and static assets.
- The live session stays in server memory for this single-instance app, so connected counts and the current position reset on restart.
- This version assumes route-based roles rather than authenticated users.
- The Docker image now installs dependencies with `npm ci`, runs as the non-root `node` user, and can also be started with `docker compose`.

## Database Foundation

- `db/schema.sql` defines the `songs` table with an integer `id`, text `authors`, a text `ccli_num`, and section metadata stored as JSON in the row, plus a `section_types` lookup table and a `songaudit` table for edit/check history and flags like `initial` and `chordPlay`.
- `db/seed-data.js` transforms the current markdown songbook into song rows for that table.
- `db/sqlite.js` creates the SQLite database, applies the schema, migrates the `authors` column onto existing song rows, and seeds songs into it when the database is empty.
- `lib/songbook.js` now holds the parsing and normalization logic so the app and future database seed/import steps share the same source of truth.

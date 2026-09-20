# SongList Realtime App

This is a Dockerized MVP for a shared songbook application with two views:

- `Leader`: sees songs with inline chords and controls the active song.
- `User`: sees the same active song without chords by default, with an option to show them.

The app uses a simple in-memory realtime session over WebSockets. That keeps the first version easy to run inside a single container.

## Administrator Access

Set `ADMIN_PASSWORD` before starting the Node app. Leader and editor pages prompt for username `admin` and this password. Audience viewing and song suggestions remain public. Administrative API calls and WebSocket leader controls enforce the same authentication.

For Docker Compose, create a local `.env` file (ignored by Git):

```dotenv
ADMIN_PASSWORD=replace-with-a-long-unique-password
```

For `npm start` or `docker run`, export `ADMIN_PASSWORD` in your shell. Node does not automatically load `.env`. Without a password, administrative access is disabled; audience pages and health checks remain available.

Browser sign-in issues an HttpOnly, SameSite session cookie valid for 12 hours; restarting the server invalidates it. Reload the leader/editor page to sign in again if needed. API clients can use HTTP Basic authentication with username `admin`. Use HTTPS when accessing the app across an untrusted network because Basic authentication does not encrypt credentials. The standalone Python editor accepts only local connections; use the Node editor for network access.
If HTTPS terminates at a reverse proxy, set `PUBLIC_ORIGIN` to the exact browser-facing origin, such as `https://songs.example.org`, so origin checks and secure cookies use the public address. Configure the proxy to forward WebSocket upgrades.

## Displayed Server Address

The address display uses the hostname and port in your browser when you open the app through a network address. When opening through `localhost`, the app uses `PUBLIC_HOST` and `PUBLIC_PORT`, or a local network interface for a non-container run. Docker cannot reliably discover the host's LAN address, so it does not display a container or gateway address as a fallback.

For local browser access with Docker Compose, add the host computer's current LAN address to `.env`, for example `PUBLIC_HOST=192.168.1.50`. Set `PUBLIC_PORT` if the published port differs from `3000`. Recreate the container after changing these values with `docker compose up -d`.

## Run With Docker

```bash
docker build -t songlist-app .
mkdir -p data
docker run --rm -p 3000:3000 \
  -e ADMIN_PASSWORD \
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
# Export ADMIN_PASSWORD in this shell first (see Administrator Access).
npm start
```

## Local Python Editor

You can edit the same SQLite song library with the standalone Python editor:

```bash
python3 song_editor.py
```

Then open `http://127.0.0.1:8765/` if your browser does not open automatically.

It opens `data/songlist.db` by default. To point at another database, pass:

```bash
python3 song_editor.py --db /path/to/songlist.db
```

If the Node or Docker app is already running, restart it after editing with this tool so its in-memory song list reloads from SQLite.
For an existing database with the old performance-history schema, start the updated Node app once before using the Python editor. The Python editor refuses the old cascading-delete schema to protect performance history.

## Continuous Integration

- `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests.
- It installs dependencies, runs `npm test`, checks `server.js`, verifies the DB seed output, builds the Docker image, starts the container, and confirms `/health` responds successfully.
- `npm test` covers database migration rollback, metadata preservation, performance snapshots, HTTP authorization, and malformed/unauthorized WebSocket messages. Tests use temporary databases and ephemeral server ports.

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
- Leader/editor actions require the configured administrator password. Audience clients cannot grant themselves leader privileges.
- The Docker image now installs dependencies with `npm ci`, runs as the non-root `node` user, and can also be started with `docker compose`.

## Database Foundation

- `db/schema.sql` defines the `songs` table with an integer `id`, text `authors`, a text `ccli_num`, and section metadata stored as JSON in the row, plus a `section_types` lookup table and a `songaudit` table for edit/check history and flags like `initial` and `chordPlay`.
- `db/seed-data.js` transforms the current markdown songbook into song rows for that table.
- `db/migrations.js` applies transactional, versioned schema migrations. Known older schemas are upgraded without discarding rows; unsupported or newer schemas stop startup with an error. Existing legacy tables are retained. Back up the database before upgrading; unsupported databases require an explicit migration, not deletion and reseeding.
- `db/sqlite.js` creates and seeds an empty database. Startup metadata backfills only empty author/CCLI fields and preserves saved nonempty values.
- Performance entries snapshot title, authors, and CCLI number when first recorded. Editing or deleting a library song preserves those entries; deleted songs leave a nullable reference. Existing history is backfilled from current song metadata during migration; previously deleted history cannot be recovered by this update.
- `lib/songbook.js` now holds the parsing and normalization logic so the app and future database seed/import steps share the same source of truth.

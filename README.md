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
- `http://localhost:3000/user.html`

## Local Run Without Docker

```bash
npm install
npm start
```

## Notes

- Song data is loaded from `documents/SongBook-extracted.md` and normalized into a single inline-chord lyrics field.
- Realtime state is not persisted yet. Restarting the container resets the current song and connected counts.
- This version assumes route-based roles rather than authenticated users.
- The Docker image now installs dependencies with `npm ci`, runs as the non-root `node` user, and can also be started with `docker compose`.

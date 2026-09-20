const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const { parseMessage } = require("../lib/ws-message");

const authorization = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;

async function startServer(t, password = "test-password") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "songlist-server-test-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PUBLIC_ORIGIN: "", PORT: "0", SQLITE_PATH: path.join(dir, "test.db"), ADMIN_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 5000);
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/listening on http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  return { url: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}` };
}

async function connect(t, url, options = {}) {
  const socket = new WebSocket(url, options);
  t.after(() => socket.terminate());
  // Attach before open to include the initial state.
  socket.messages = [];
  socket.on("message", (data) => socket.messages.push(JSON.parse(data)));
  await once(socket, "open");
  return socket;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for WebSocket state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("message parser rejects malformed values and unsupported fields", () => {
  for (const input of ["null", "[]", "5", '"register"', "{", '{}', '{"type":"register","role":"admin"}', '{"type":"scroll","scrollRatio":1e999}', '{"type":"set-song","songId":{}}']) {
    assert.equal(parseMessage(Buffer.from(input)), null, input);
  }
  assert.equal(parseMessage(Buffer.from('{"type":"next-section"}')).type, "next-section");
});

test("HTTP administration is protected while audience access stays public", async (t) => {
  const { url } = await startServer(t);
  for (const [method, route] of [
    ["POST", "/api/songs"], ["PUT", "/api/songs/1"], ["DELETE", "/api/songs/1"],
    ["PATCH", "/api/songs/1/lock"], ["PUT", "/api/setlist"], ["POST", "/api/performance/start"],
    ["POST", "/api/performance/stop"], ["DELETE", "/api/performance-log"], ["POST", "/api/shutdown"],
    ["DELETE", "/API/SONGS/1"], ["GET", "/leader.html"], ["GET", "/editor.html"],
  ]) {
    const response = await fetch(url + route, { method });
    assert.equal(response.status, 401, `${method} ${route}`);
  }
  assert.equal((await fetch(url + "/user.html")).status, 200);
  assert.equal((await fetch(url + "/api/user-song-picks")).status, 200);
  assert.equal((await fetch(url + "/leader.html", { headers: { authorization: "Basic invalid" } })).status, 401);
  const login = await fetch(url + "/leader.html", { headers: { authorization } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/i);
  const cookie = setCookie.split(";")[0];
  const payload = { title: "API test", authors: "Test", sections: { V1: { content: "Lyrics" } }, sectionOrder: ["V1"] };
  const create = await fetch(url + "/api/songs", {
    method: "POST", headers: { cookie, origin: url, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  assert.equal(create.status, 200);
  const { song } = await create.json();
  assert.equal((await fetch(url + `/api/songs/${song.id}`, { method: "DELETE", headers: { cookie, origin: "http://untrusted.example" } })).status, 403);
  assert.equal((await fetch(url + `/api/songs/${song.id}`, { method: "DELETE", headers: { cookie } })).status, 403);
  assert.equal((await fetch(url + `/api/songs/${song.id}`, { method: "DELETE", headers: { cookie, origin: url } })).status, 200);
});

test("WebSocket malformed input survives and leader control requires authentication", async (t) => {
  const { url, wsUrl } = await startServer(t);
  const audience = await connect(t, wsUrl);
  for (const input of ["null", "[]", "3", "{", '{}']) audience.send(input);
  audience.send(JSON.stringify({ type: "register", role: "user" }));
  await waitFor(() => audience.messages.some((m) => m.payload?.userCount === 1));
  assert.equal((await fetch(url + "/health")).status, 200);
  const closed = once(audience, "close");
  audience.send(JSON.stringify({ type: "register", role: "leader" }));
  assert.equal((await closed)[0], 1008);

  const login = await fetch(url + "/leader.html", { headers: { authorization } });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const leader = await connect(t, wsUrl, { headers: { cookie, origin: url } });
  leader.send(JSON.stringify({ type: "register", role: "leader" }));
  await waitFor(() => leader.messages.some((m) => m.payload?.leaderCount === 1));
  leader.send(JSON.stringify({ type: "set-scroll-speed", scrollSpeed: 9 }));
  await waitFor(() => leader.messages.some((m) => m.type === "scroll-speed" && m.payload.scrollSpeed === 9));
  leader.send('{"type":"set-scroll-speed","scrollSpeed":1e999}');
  leader.send(JSON.stringify({ type: "previous-section" }));
  await waitFor(() => leader.messages.some((m) => m.type === "state" && m.payload.scrollSpeed === 9));

  const crossOrigin = new WebSocket(wsUrl, { headers: { cookie, origin: "http://untrusted.example" } });
  crossOrigin.on("error", () => {});
  const rejected = await new Promise((resolve) => crossOrigin.once("unexpected-response", (_req, res) => { resolve(res.statusCode); res.resume(); crossOrigin.terminate(); }));
  assert.equal(rejected, 401);

  const oversized = await connect(t, wsUrl);
  const oversizedClosed = once(oversized, "close");
  oversized.send("x".repeat(20 * 1024));
  assert.equal((await oversizedClosed)[0], 1009);
  assert.equal((await fetch(url + "/health")).status, 200);
});

test("missing administrator configuration fails closed", async (t) => {
  const { url } = await startServer(t, "");
  assert.equal((await fetch(url + "/leader.html")).status, 503);
  assert.equal((await fetch(url + "/api/shutdown", { method: "POST" })).status, 503);
  assert.equal((await fetch(url + "/user.html")).status, 200);
});

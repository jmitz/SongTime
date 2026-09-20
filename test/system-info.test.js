const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../public/system-info.js"), "utf8");

async function display(location, data) {
  const element = {};
  let requests = 0;
  const context = vm.createContext({
    document: { querySelectorAll: () => [element] },
    window: { location },
    fetch: async () => { requests++; return { ok: true, json: async () => data }; },
  });
  await vm.runInContext(source, context);
  return { text: element.textContent, requests };
}

test("address display prefers the working browser address over stale server settings", async () => {
  assert.deepEqual(await display({ hostname: "192.168.1.25", host: "192.168.1.25:8080" }, { ipAddress: "192.168.0.142", port: 3000 }),
    { text: "192.168.1.25:8080", requests: 0 });
  assert.equal((await display({ hostname: "songs.example.org", host: "songs.example.org" }, {})).text, "songs.example.org");
});

test("localhost uses the configured LAN address and formats IPv6 correctly", async () => {
  assert.equal((await display({ hostname: "localhost" }, { ipAddress: "192.168.1.25", port: 3000 })).text, "192.168.1.25:3000");
  assert.equal((await display({ hostname: "[::1]" }, { ipAddress: "2001:db8::1", port: 3000 })).text, "[2001:db8::1]:3000");
  assert.match((await display({ hostname: "127.0.0.1" }, { ipAddress: null, port: 3000 })).text, /Set PUBLIC_HOST/);
});

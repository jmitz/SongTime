const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function run(t, { platform = "Linux", release = "6.8", address = "192.168.1.25", override = "", fail = "", args = [], script = "start.sh" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "songlist-start-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const commands = {
    uname: 'if [ "$1" = "-s" ]; then echo "$TEST_PLATFORM"; else echo "$TEST_RELEASE"; fi',
    ip: '[ -z "$TEST_FAIL" ] || exit 1; echo "1.1.1.1 via 192.168.1.1 dev eth0 src $TEST_ADDRESS uid 1000"',
    route: 'echo "interface: en0"',
    ipconfig: '[ "$1" = "getifaddr" ] && [ "$2" = "en0" ] || exit 1; echo "$TEST_ADDRESS"',
    "powershell.exe": 'printf "%s\\r\\n" "$TEST_ADDRESS"',
    docker: 'printf "COMPOSE_HOST=%s\\n" "$PUBLIC_HOST"; printf "ARG=%s\\n" "$@"',
  };
  for (const [name, command] of Object.entries(commands)) {
    fs.writeFileSync(path.join(directory, name), `#!/bin/sh\n${command}\n`, { mode: 0o755 });
  }
  return spawnSync("bash", [path.join(__dirname, "../scripts", script), ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PUBLIC_HOST: override,
      TEST_PLATFORM: platform, TEST_RELEASE: release, TEST_ADDRESS: address, TEST_FAIL: fail },
  });
}

test("startup passes Linux route address and options to Compose from any directory", (t) => {
  const result = run(t, { args: ["--no-build"] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /COMPOSE_HOST=192\.168\.1\.25/);
  assert.match(result.stdout, /ARG=compose\nARG=up\nARG=--build\nARG=-d\nARG=--no-build/);
});

test("startup uses Windows networking in WSL and the default interface on macOS", (t) => {
  for (const options of [
    { platform: "Linux", release: "6.6.87.2-microsoft-standard-WSL2", fail: "1" },
    { platform: "Darwin", fail: "1" },
    { platform: "MINGW64_NT-10.0", fail: "1" },
  ]) {
    const result = run(t, options);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /COMPOSE_HOST=192\.168\.1\.25\n/);
  }
});

test("explicit host overrides work even if detection is unavailable", (t) => {
  for (const options of [
    { override: "10.0.0.20", fail: "1" },
    { override: "10.0.0.21", fail: "1", args: ["--host", "10.0.0.20"] },
  ]) {
    const result = run(t, options);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /COMPOSE_HOST=10\.0\.0\.20/);
  }
});

test("failed detection or invalid addresses never starts Docker", (t) => {
  for (const options of [
    { fail: "1" }, { address: "" }, { address: "127.0.0.1" },
    { address: "169.254.1.2" }, { address: "192.168.1.999" }, { address: "not-an-address" },
    { args: ["--host"] },
  ]) {
    const result = run(t, options);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /COMPOSE_HOST=/);
  }
});

test("redeploy uses automatic host detection", (t) => {
  const result = run(t, { script: "redeploy.sh" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /COMPOSE_HOST=192\.168\.1\.25/);
});

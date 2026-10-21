const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { executablePath, createRunner } = require("../src/dummy-game.cjs");

test("bundled runner is a small Windows executable", () => {
    const source = path.join(__dirname, "..", "src", "dummy-game-win.exe");
    assert.ok(fs.statSync(source).size < 32 * 1024);
    assert.equal(fs.readFileSync(source).subarray(0, 2).toString(), "MZ");
});

test("game executable paths stay inside the dummy directory", () => {
    assert.deepEqual(executablePath("Example Game>Game.exe"), ["Example Game", "Game.exe"]);
    for (const name of ["../outside.exe", "C:\\outside.exe", "/outside.exe", "game>..>outside.exe", "game.sh"])
        assert.throws(() => executablePath(name));
});

test("runner copies, starts and stops one Wine game at a time", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbs-dummy-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "placeholder.exe");
    fs.writeFileSync(source, "dummy");
    const starts = [], stops = [], prefixes = [];
    const runner = createRunner({ source, dataDir: path.join(root, "games"),
        start: (command, args, opts) => {
            const child = new EventEmitter();
            child.pid = 100 + starts.length;
            starts.push({ command, args, opts });
            return child;
        },
        stopProcess: pid => stops.push(pid), stopPrefix: prefix => prefixes.push(prefix), log() {} });
    const plan = { questId: "1", appId: "2", exeName: "Example Game>Game.exe", name: "Example Game", running: false };
    assert.match(runner.ensure(plan), /Started Wine dummy for Example Game/);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].command, "wine");
    assert.equal(starts[0].opts.env.WINEPREFIX, path.join(root, "games", ".wineprefix"));
    assert.equal(fs.readFileSync(starts[0].args[0], "utf8"), "dummy");
    runner.ensure(plan);
    assert.equal(starts.length, 1);
    runner.ensure(null);
    assert.deepEqual(stops, [100]);
    assert.deepEqual(prefixes, [path.join(root, "games", ".wineprefix")]);
    runner.ensure({ ...plan, running: true });
    assert.equal(starts.length, 1);
});

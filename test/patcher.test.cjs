const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "patcher.cjs"), "utf8");

function loadPatcher(platform, env, home) {
    const module = { exports: {} };
    vm.runInNewContext(`(function (require, module, process) { ${source}\n})`, {
        console
    })(name => name === "os" ? { homedir: () => home } : require(name), module, { platform, env });
    return module.exports;
}

function fixture(root, relative) {
    const file = path.join(root, relative, "index.js");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "module.exports = require('./core.asar');\n");
    return file;
}

test("Windows patches the current module layout and restores it", t => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "orbs-win-"));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const file = fixture(temp, "Discord/app-1.0.1/modules/discord_desktop_core-1/discord_desktop_core");
    const patcher = loadPatcher("win32", { LOCALAPPDATA: temp }, temp);
    assert.equal(patcher.patch("C:\\orbs\\inject.cjs").length, 1);
    assert.equal(patcher.status()[0].target, "C:\\orbs\\inject.cjs");
    assert.equal(patcher.patch("C:\\orbs\\inject.cjs")[0].changed, false);
    assert.equal(patcher.unpatch()[0].changed, true);
    assert.equal(fs.readFileSync(file, "utf8"), "module.exports = require('./core.asar');\n");
    assert.equal(loadPatcher("win32", {}, temp).installs().length, 0);
});

test("Linux finds native and Flatpak installs across both module layouts", t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "orbs-linux-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const config = path.join(home, "custom-config");
    const native = fixture(config, "discord/app-1.0.2/modules/discord_desktop_core-1/discord_desktop_core");
    const flatpak = fixture(home, ".var/app/com.discordapp.Discord/config/discord/0.0.3/modules/discord_desktop_core");
    const patcher = loadPatcher("linux", { XDG_CONFIG_HOME: config }, home);
    const results = patcher.patch(path.join(home, "orbs", "inject.cjs"));
    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.file === native));
    assert.ok(results.some(r => r.file === flatpak));
    assert.ok(patcher.status().every(r => r.target === path.join(home, "orbs", "inject.cjs")));
    assert.ok(patcher.unpatch().every(r => r.changed));
    assert.equal(fs.readFileSync(native, "utf8"), "module.exports = require('./core.asar');\n");
    assert.equal(fs.readFileSync(flatpak, "utf8"), "module.exports = require('./core.asar');\n");
});


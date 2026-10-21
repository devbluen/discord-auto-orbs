// discord-orbs installer. `install`, `uninstall`, `status`, or no argument for a menu.
// Runs from source (`node src/cli.cjs`) or packaged as dist/discord-orbs.exe (`npm run build`).
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline/promises");
const { execFileSync, spawn } = require("child_process");

let sea = null;
try {
    const s = require("node:sea");
    if (s.isSea()) sea = s;
} catch { }

// The Wine dummy is Linux-only; the build leaves it out of the Windows exe (see scripts/build.js).
const LINUX = process.platform === "linux";
const PAYLOAD = ["quests.js", "inject.cjs", "patcher.cjs", ...(LINUX ? ["dummy-game.cjs"] : [])];
const BINARY_PAYLOAD = LINUX ? ["dummy-game-win.exe"] : [];
const INSTALL_DIR = process.platform === "linux"
    ? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "discord-orbs")
    : path.join(process.env.LOCALAPPDATA ?? os.homedir(), "discord-orbs");
const NOT_FOUND = process.platform === "linux"
    ? "No Discord desktop install found in your user config directory. Start Discord once, then retry."
    : "No Discord install found in %LOCALAPPDATA%.";

// Inside the exe only built-in modules can be required, so patcher.cjs runs from its asset.
function loadPatcher() {
    if (!sea) return require("./patcher.cjs");
    const mod = { exports: {} };
    new Function("module", "exports", "require", sea.getAsset("patcher.cjs", "utf8"))(mod, mod.exports, require);
    return mod.exports;
}
const patcher = loadPatcher();

// Packaged: the payload is extracted to %LOCALAPPDATA%\discord-orbs. From source: Discord
// loads straight from this repo's src/, so edits apply with a Ctrl+R in Discord.
function payloadDir() {
    if (!sea) return __dirname;
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    for (const f of PAYLOAD) fs.writeFileSync(path.join(INSTALL_DIR, f), sea.getAsset(f, "utf8"));
    for (const f of BINARY_PAYLOAD) {
        try { fs.writeFileSync(path.join(INSTALL_DIR, f), Buffer.from(sea.getAsset(f))); } catch { }
    }
    return INSTALL_DIR;
}

function running() {
    if (process.platform !== "win32") return [];
    let out = "";
    try { out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).toLowerCase(); } catch { }
    return patcher.installs().filter(f => out.includes(`"${f.exe.toLowerCase()}"`));
}

async function restart(flavors) {
    for (const f of flavors) {
        try { execFileSync("taskkill", ["/IM", f.exe, "/F"], { stdio: "ignore" }); } catch { }
    }
    await new Promise(r => setTimeout(r, 2000));
    for (const f of flavors) {
        spawn(path.join(f.root, "Update.exe"), ["--processStart", f.exe], { detached: true, stdio: "ignore" }).unref();
    }
}

function printStatus() {
    const installs = patcher.installs();
    if (!installs.length) return console.log(NOT_FOUND);
    const live = new Set(running().map(f => f.exe));
    for (const f of installs) console.log(`Discord ${f.name}${live.has(f.exe) ? " (running)" : ""}`);
    for (const { file, target } of patcher.status()) {
        const version = file.match(/(?:app-)?\d+\.\d+\.[^\\/]+/)?.[0] ?? path.basename(path.dirname(path.dirname(file)));
        console.log(`  ${version}: ${target ? `installed → ${target}` : "not installed"}`);
    }
}

async function install(ask) {
    const dir = payloadDir();
    const results = patcher.patch(path.join(dir, "inject.cjs"));
    if (!results.length) throw new Error(NOT_FOUND + " The discord_desktop_core module must be downloaded first.");
    console.log(`Installed in ${results.length} Discord version(s). Payload: ${dir}`);
    await offerRestart(ask, "apply it");
}

async function uninstall(ask) {
    const results = patcher.unpatch();
    console.log(`Removed from ${results.filter(r => r.changed).length} Discord version(s).`);
    if (sea) fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
    await offerRestart(ask, "finish removing it");
}

async function offerRestart(ask, why) {
    if (process.platform === "linux") return console.log(`Quit Discord completely and reopen it to ${why}.`);
    const live = running();
    if (!live.length) return console.log("Open Discord to use it.");
    const answer = await ask(`Restart Discord now to ${why}? [Y/n] `);
    if (/^n/i.test(answer.trim())) return console.log("Restart Discord yourself (tray icon → Quit, then open it).");
    await restart(live);
    console.log("Discord restarted.");
}

async function main() {
    const [command, ...flags] = process.argv.slice(2);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // `--yes` answers every question with the default, for scripted use.
    const ask = flags.includes("--yes") ? async () => "" : q => rl.question(q);

    try {
        if (command === "install") return await install(ask);
        if (command === "uninstall") return await uninstall(ask);
        if (command === "status") return printStatus();
        if (command) throw new Error(`Unknown command "${command}". Use install, uninstall or status.`);

        console.log("discord-orbs\n");
        printStatus();
        console.log("\n1) Install / update Discord\n2) Uninstall Discord\n3) Exit");
        const choice = (await ask("\nChoose: ")).trim();
        if (choice === "1") await install(ask);
        else if (choice === "2") await uninstall(ask);
        // Double-clicked exe: keep the window open so the result can be read.
        await ask("\nPress Enter to exit.");
    } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exitCode = 1;
        if (!command) await ask("\nPress Enter to exit.");
    } finally {
        rl.close();
    }
}

main();

// Launches a small Wine process with the executable name Discord recognizes.
// Used only by the official Discord client on Linux.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

function executablePath(name) {
    if (typeof name !== "string") throw new Error("Game has no Windows executable name");
    const parts = name.replaceAll(">", "/").replaceAll("\\", "/").split("/");
    if (!parts.length || parts.some(p => !p || p === "." || p === ".." || /[<>:"|?*\x00-\x1f]/.test(p)))
        throw new Error("Invalid game executable path");
    if (!/\.exe$/i.test(parts.at(-1))) throw new Error("Game executable is not an .exe file");
    return parts;
}

function gameDirectory(name) {
    if (typeof name !== "string") throw new Error("Game has no application name");
    const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim();
    if (!safe || safe === "." || safe === "..") throw new Error("Invalid game application name");
    return safe;
}

function findSource() {
    const candidates = [
        process.env.ORBS_DUMMY_EXE,
        path.join(__dirname, "dummy-game-win.exe")
    ];
    return candidates.find(file => file && fs.existsSync(file)) ?? null;
}

function createRunner({ source = findSource(), dataDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "discord-orbs", "dummies"),
    start = spawn, stopProcess = pid => process.kill(-pid, "SIGTERM"),
    stopPrefix = prefix => {
        const server = spawn("wineserver", ["-k"], { env: { ...process.env, WINEPREFIX: prefix }, stdio: "ignore" });
        server.on("error", () => {});
        server.unref();
    },
    log = console.log } = {}) {
    let current = null;
    let cooldownUntil = 0;
    const events = [];
    const prefix = path.join(dataDir, ".wineprefix");

    function stop() {
        if (!current) return;
        const { child } = current;
        current = null;
        try { stopProcess(child.pid); } catch { }
        try { stopPrefix(prefix); } catch { }
        cooldownUntil = Date.now() + 8000;
    }

    function ensure(plan) {
        if (!plan) return stop();
        if (!/^\d+$/.test(String(plan.appId)) || !/^\d+$/.test(String(plan.questId)))
            throw new Error("Invalid quest or application ID");
        const parts = executablePath(plan.exeName);
        if (current?.questId === plan.questId) {
            if (!plan.running && !current.warned && Date.now() - current.startedAt > 20_000) {
                current.warned = true;
                events.push(`Wine dummy is still running, but Discord has not detected ${plan.name} after 20 seconds.`);
            }
            return;
        }
        stop();
        if (plan.running || Date.now() < cooldownUntil) return;
        if (!source) throw new Error("Bundled dummy-game-win.exe was not found; set ORBS_DUMMY_EXE to a Windows executable");

        // Discord's executable rules can include the game installation directory.
        const file = path.join(dataDir, String(plan.appId), gameDirectory(plan.name), ...parts);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(source, file);
        const child = start("wine", [file], {
            stdio: ["ignore", "ignore", "pipe"], detached: true,
            env: { ...process.env, WINEPREFIX: prefix }
        });
        current = { questId: plan.questId, child, startedAt: Date.now(), warned: false };
        let stderr = "";
        child.stderr?.on("data", chunk => {
            stderr = (stderr + chunk.toString()).slice(-1000);
        });
        const message = `Started Wine dummy for ${plan.name}: ${file}`;
        log(`[orbs] ${message}`);
        child.on("exit", (code, signal) => {
            if (current?.child === child) {
                current = null;
                try { stopPrefix(prefix); } catch { }
                cooldownUntil = Date.now() + 30_000;
                const detail = stderr.trim().replace(/\s+/g, " ").slice(-300);
                events.push(`Wine dummy exited (code ${code ?? "none"}, signal ${signal ?? "none"})${detail ? `: ${detail}` : ""}`);
            }
        });
        child.on("error", error => {
            if (current?.child === child) {
                current = null;
                try { stopPrefix(prefix); } catch { }
            }
            cooldownUntil = Date.now() + 30_000;
            events.push(`Wine dummy failed: ${error.message}`);
            log(`[orbs] Wine dummy failed: ${error.message}`);
        });
        return message;
    }

    return { ensure, stop, drainEvents: () => events.splice(0) };
}

module.exports = { executablePath, gameDirectory, findSource, createRunner };

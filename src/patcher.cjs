// Finds Discord installs and adds/removes the line in discord_desktop_core that loads inject.cjs.
// Used by the installer and by inject.cjs itself (to re-apply after Discord updates).
const fs = require("fs");
const path = require("path");
const os = require("os");

const MARKER = "// discord-orbs";

const FLAVORS = [
    { name: "Stable", dir: "Discord", exe: "Discord.exe" },
    { name: "PTB", dir: "DiscordPTB", exe: "DiscordPTB.exe" },
    { name: "Canary", dir: "DiscordCanary", exe: "DiscordCanary.exe" }
];

function installs() {
    if (process.platform === "linux") {
        const home = os.homedir();
        const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
        const roots = [
            { base: config, label: "" },
            { base: path.join(home, ".var", "app", "com.discordapp.Discord", "config"), label: " (Flatpak)" },
            { base: path.join(home, "snap", "discord", "current", ".config"), label: " (Snap)" }
        ];
        const names = ["discord", "discordptb", "discordcanary"];
        return roots.flatMap(({ base, label }) => FLAVORS.map((f, i) => ({
            ...f, name: f.name + label, root: path.join(base, names[i])
        }))).filter(f => fs.existsSync(f.root));
    }
    if (process.platform !== "win32") return [];
    const base = process.env.LOCALAPPDATA;
    if (!base) return [];
    return FLAVORS.map(f => ({ ...f, root: path.join(base, f.dir) }))
        .filter(f => fs.existsSync(f.root));
}

// Every discord_desktop_core/index.js of every installed version, old app-* folders included.
function coreFiles() {
    return installs().flatMap(({ root }) =>
        fs.readdirSync(root).filter(d => /^app-|^\d+\.\d+\./.test(d)).flatMap(app => {
            const modules = path.join(root, app, "modules");
            if (!fs.existsSync(modules)) return [];
            return fs.readdirSync(modules)
                .filter(d => d === "discord_desktop_core" || d.startsWith("discord_desktop_core-"))
                .map(d => path.join(modules, d, d === "discord_desktop_core" ? "" : "discord_desktop_core", "index.js"))
                .filter(f => fs.existsSync(f));
        })
    );
}

const withoutMarker = text => text.split(/\r?\n/).filter(l => !l.includes(MARKER)).join("\n");

// The require is wrapped in try so Discord still starts if the payload folder disappears.
function patch(injectPath) {
    const line = `try { require(${JSON.stringify(injectPath)}); } catch (e) { console.error("[orbs]", e); } ${MARKER}`;
    return coreFiles().map(file => {
        const text = fs.readFileSync(file, "utf8");
        const next = `${line}\n${withoutMarker(text)}`;
        if (next !== text) fs.writeFileSync(file, next);
        return { file, changed: next !== text };
    });
}

function unpatch() {
    return coreFiles().map(file => {
        const text = fs.readFileSync(file, "utf8");
        const next = withoutMarker(text);
        if (next !== text) fs.writeFileSync(file, next);
        return { file, changed: next !== text };
    });
}

// Which inject.cjs each core file points at (null = not patched).
function status() {
    return coreFiles().map(file => {
        const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find(l => l.includes(MARKER));
        const quoted = line?.match(/require\(("(?:[^"\\]|\\.)*")\)/)?.[1];
        return { file, target: quoted ? JSON.parse(quoted) : null };
    });
}

module.exports = { MARKER, installs, coreFiles, patch, unpatch, status };

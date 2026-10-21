// Checks GitHub for a newer release. Used by inject.cjs (Discord's main process, which isn't
// bound by the page's CSP) and by the installer.
const fs = require("fs");
const path = require("path");

const REPO = "devbluen/discord-auto-quest";

// version.json sits next to the payload in exe installs; from source/tarball it's package.json.
function currentVersion(dir = __dirname) {
    for (const file of [path.join(dir, "version.json"), path.join(dir, "..", "package.json")]) {
        try { return JSON.parse(fs.readFileSync(file, "utf8")).version; } catch { }
    }
    return null;
}

const parts = v => String(v).replace(/^v/, "").split(/[.-]/).map(n => parseInt(n, 10) || 0);

function isNewer(latest, current) {
    const a = parts(latest), b = parts(current);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    }
    return false;
}

// Resolves to { current, latest, url } when a newer release exists, else null. Never throws.
async function checkForUpdate(current = currentVersion()) {
    if (!current) return null;
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
            headers: { "User-Agent": "discord-orbs", Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) return null;
        const release = await res.json();
        const latest = String(release.tag_name ?? "").replace(/^v/, "");
        return latest && isNewer(latest, current) ? { current, latest, url: release.html_url } : null;
    } catch {
        return null;
    }
}

module.exports = { REPO, currentVersion, isNewer, checkForUpdate };

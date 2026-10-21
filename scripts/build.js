// Builds dist/discord-orbs.exe: a Node single executable application (SEA) with the installer
// as its entry point and the payload it extracts (quests.js, inject.cjs, patcher.cjs) as assets.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postject from "postject";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const blob = join(dist, "sea-prep.blob");
const configPath = join(dist, "sea-config.json");
const exe = join(dist, process.platform === "win32" ? "discord-orbs.exe" : "discord-orbs");

// The Wine dummy only matters on Linux; the Windows exe never carries it.
const payload = ["quests.js", "inject.cjs", "patcher.cjs"];
if (process.platform === "linux") {
    payload.push("dummy-game.cjs");
    if (existsSync(join(src, "dummy-game-win.exe"))) payload.push("dummy-game-win.exe");
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

writeFileSync(configPath, JSON.stringify({
    main: join(src, "cli.cjs"),
    output: blob,
    disableExperimentalSEAWarning: true,
    assets: Object.fromEntries(payload.map(f => [f, join(src, f)]))
}, null, 2));

execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" });
copyFileSync(process.execPath, exe);
await postject.inject(exe, "NODE_SEA_BLOB", readFileSync(blob), {
    sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
});

rmSync(blob);
rmSync(configPath);
console.log(`\nBuilt ${exe}`);

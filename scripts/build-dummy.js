// Rebuilds the small Windows Wine runner when MinGW is available.
// Local Windows package builds use the bundled binary; releases compile it in CI.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "src", "dummy-game-win.c");
const output = join(root, "src", "dummy-game-win.exe");
const required = process.argv.includes("--required");

if (process.platform === "linux") {
    try {
        execFileSync("x86_64-w64-mingw32-gcc",
            ["-Os", "-s", "-mwindows", "-o", output, source], { stdio: "inherit" });
        console.log("Built dummy-game-win.exe from source.");
    } catch (error) {
        if (required || error.code !== "ENOENT") throw error;
        console.log("MinGW not installed; using the bundled dummy-game-win.exe.");
    }
} else if (required) {
    throw new Error("Building the dummy from source requires Linux and x86_64-w64-mingw32-gcc.");
}

if (!existsSync(output) || readFileSync(output).subarray(0, 2).toString() !== "MZ" || statSync(output).size > 64 * 1024)
    throw new Error("A small Windows dummy-game-win.exe is required for packaging.");

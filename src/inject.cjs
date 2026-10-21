// Loaded by Discord's main process (see patcher.cjs).
// Injects quests.js into the main window every time it loads.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { patch } = require("./patcher.cjs");

const SCRIPT = path.join(__dirname, "quests.js");
const dummyRunner = process.platform === "linux" ? require("./dummy-game.cjs").createRunner() : null;
let dummyTimer = null;
let polling = false;
let lastDummyError = null;

function watchDummyGames(win) {
    if (!dummyRunner) return;
    clearInterval(dummyTimer);
    const poll = async () => {
        if (polling || win.isDestroyed() || win.webContents.isDestroyed()) return;
        polling = true;
        try {
            const plan = await win.webContents.executeJavaScript("window.orbs?.dummyPlan?.() ?? null");
            const message = dummyRunner.ensure(plan);
            if (message) {
                lastDummyError = null;
                win.webContents.executeJavaScript(`window.orbs?.dummyEvent?.(${JSON.stringify(message)})`).catch(() => {});
            }
        } catch (e) {
            console.error("[orbs] Auto game:", e);
            if (e.message !== lastDummyError) {
                lastDummyError = e.message;
                win.webContents.executeJavaScript(`window.orbs?.dummyEvent?.(${JSON.stringify(`Auto game failed: ${e.message}`)})`).catch(() => {});
            }
        } finally { polling = false; }
    };
    dummyTimer = setInterval(poll, 5000);
    poll();
}

app.on("browser-window-created", (_, win) => {
    win.webContents.on("did-finish-load", () => {
        let url;
        try { url = new URL(win.webContents.getURL()); } catch { return; }
        // Main window only: skip the splash (file://) and call popouts.
        if (!/(^|\.)discord\.com$/.test(url.hostname) || url.pathname.startsWith("/popout")) return;

        let code;
        try { code = fs.readFileSync(SCRIPT, "utf8"); } catch { return; }
        win.webContents.executeJavaScript(code).catch(e => console.error("[orbs]", e));
        watchDummyGames(win);
    });
});

// Re-applies the patch to every installed Discord version, so a version an update has
// already downloaded keeps orbs on its first start.
const heal = () => {
    try { patch(__filename); } catch (e) { console.error("[orbs]", e); }
};
heal();
app.on("before-quit", heal);
app.on("before-quit", () => {
    clearInterval(dummyTimer);
    dummyRunner?.stop();
});

// Loaded by Discord's main process (see patcher.cjs).
// Injects quests.js into the main window every time it loads.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { patch } = require("./patcher.cjs");

const SCRIPT = path.join(__dirname, "quests.js");

app.on("browser-window-created", (_, win) => {
    win.webContents.on("did-finish-load", () => {
        let url;
        try { url = new URL(win.webContents.getURL()); } catch { return; }
        // Main window only: skip the splash (file://) and call popouts.
        if (!/(^|\.)discord\.com$/.test(url.hostname) || url.pathname.startsWith("/popout")) return;

        let code;
        try { code = fs.readFileSync(SCRIPT, "utf8"); } catch { return; }
        win.webContents.executeJavaScript(code).catch(e => console.error("[orbs]", e));
    });
});

// Re-applies the patch to every installed Discord version, so a version an update has
// already downloaded keeps orbs on its first start.
const heal = () => {
    try { patch(__filename); } catch (e) { console.error("[orbs]", e); }
};
heal();
app.on("before-quit", heal);

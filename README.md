# discord-orbs

Completes Discord quests from inside your own Discord app. No Canary, Vencord or third-party client needed.

## Executable

```
npm install
npm run build
```

This produces `dist/discord-orbs.exe`. When opened, it shows the current status and a menu:

1. **Install / update**: extracts the script to `%LOCALAPPDATA%\discord-orbs`, applies it to every installed Discord version and offers to restart Discord.
2. **Uninstall**: removes it from Discord and deletes `%LOCALAPPDATA%\discord-orbs`.

It also takes arguments: `discord-orbs.exe install|uninstall|status [--yes]`.

The exe is unsigned (it is `node.exe` with the script embedded), so Windows SmartScreen or your antivirus may warn about it.

## Development

`npm run autostart` installs pointing straight at this repo's `src/`, so any change applies with Ctrl+R in Discord without rerunning anything. `npm run autostart:remove` removes it and `npm run status` shows the current state.

`npm run check` syntax-checks every file.

## How it works

- Automatically accepts the quests it can complete (the **Auto-accept** button in the panel).
- Order: quests that give the most orbs per remaining minute first, then quests without orbs, shortest first.
- A panel in the bottom-right corner shows the queue, progress and errors. Its buttons are **Check now**, **Pause**, **Copy report** and **Claim**, which opens the quest so you can claim the reward.
- When Discord updates, the script re-applies itself to the new version if that version was already downloaded when Discord closed. If the panel disappears after an update, run the exe (or `npm run autostart`) again.

| Type | How |
| --- | --- |
| `WATCH_VIDEO` / `WATCH_VIDEO_ON_MOBILE` | sends video progress within the server's time limit |
| `PLAY_ON_DESKTOP` | fakes the game's process; Discord itself sends the heartbeats |
| `PLAY_ACTIVITY` | sends a heartbeat every 20 s using a DM or voice channel |

Not supported: `STREAM_ON_DESKTOP` (needs a real Go Live with someone else in the call) and achievement quests.

## Project layout

| File | Role |
| --- | --- |
| `src/quests.js` | Runs inside Discord's window: finds Discord's internal modules, accepts and completes quests, draws the panel |
| `src/inject.cjs` | Loaded by Discord's main process; injects `quests.js` into the main window and re-applies the patch after updates |
| `src/patcher.cjs` | Finds Discord installs and adds/removes the line in `discord_desktop_core/index.js` that loads `inject.cjs` |
| `src/cli.cjs` | Installer (menu and commands); the exe's entry point |
| `scripts/build.js` | Builds the exe as a Node single executable application |
## Security

- Never reads or sends your token: requests go through Discord's own internal HTTP client, to `discord.com` only.
- No debug port, and no code downloaded from anywhere.

**This violates Discord's Terms of Service.** Your account may have quests suspended or be banned. Use at your own risk.

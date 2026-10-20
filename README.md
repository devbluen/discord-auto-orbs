# discord-orbs

**English** · [Português](README.pt-BR.md)

Completes Discord quests from inside your own Discord app. No Canary, Vencord or third-party client needed.

## Install (easiest)

1. Go to [Releases](https://github.com/devbluen/discord-auto-quest/releases/latest) and download `discord-orbs.exe`.
2. Open it. If Windows shows "Windows protected your PC", click **More info** → **Run anyway** (the exe is unsigned).
3. Type `1` (Install / update) and press Enter, then `Y` to restart Discord.
4. In Discord, open the **Quests** page. A panel appears in the bottom-right corner and starts working.

To remove it: open the exe again and choose `2` (Uninstall).

## Build it yourself

Use this if you'd rather not run an exe built by someone else.

1. Install [Git](https://git-scm.com/download/win) and [Node.js 22 or newer](https://nodejs.org/) (the "LTS" button). Keep the default options.
2. Open **PowerShell** (Start menu → type `PowerShell`) and run, one line at a time:

   ```
   git clone https://github.com/devbluen/discord-auto-quest.git
   cd discord-auto-quest
   npm install
   npm run build
   ```

3. The exe is now at `discord-auto-quest\dist\discord-orbs.exe` (inside your user folder, e.g. `C:\Users\<you>\`). Open it and follow steps 2–4 of [Install](#install-easiest).

To update later, run inside the `discord-auto-quest` folder:

```
git pull
npm install
npm run build
```

and open the new exe again (`1`, Install / update).

## How it works

- Automatically accepts the quests it can complete (the **Auto-accept** button in the panel).
- Order: quests that give the most orbs per remaining minute first, then quests without orbs, shortest first.
- The panel shows the queue, progress and errors. Its buttons are **Check now**, **Pause**, **Copy report** and **Claim**, which opens the Quests page so you can claim the reward.
- A red badge on the panel (even minimized) counts the rewards ready to claim; hover it for the total orbs.
- Desktop notifications when a quest finishes, fails, or the whole queue is done. Clicking one opens the Quests page. Toggle them with **Notifications** in the panel.
- When Discord updates, the script re-applies itself to the new version if that version was already downloaded when Discord closed. If the panel disappears after an update, open the exe and install again.

| Type | How |
| --- | --- |
| `WATCH_VIDEO` / `WATCH_VIDEO_ON_MOBILE` | sends video progress within the server's time limit |
| `PLAY_ON_DESKTOP` | fakes the game's process; Discord itself sends the heartbeats |
| `PLAY_ACTIVITY` | sends a heartbeat every 20 s using a DM or voice channel |

Not supported: `STREAM_ON_DESKTOP` (needs a real Go Live with someone else in the call) and achievement quests.

## Something broke?

Click **Copy report** in the panel and paste it into a new [issue](https://github.com/devbluen/discord-auto-quest/issues). The report contains quest data and your Discord user ID, never your token.

## Development

- `npm run autostart` installs pointing straight at this repo's `src/`, so any change applies with Ctrl+R in Discord. `npm run autostart:remove` removes it and `npm run status` shows the current state.
- `npm run check` syntax-checks every file.
- `discord-orbs.exe` also takes arguments: `install|uninstall|status [--yes]`.
- Releases are published by the **Release** workflow, which only runs manually: Actions → Release → Run workflow, with a tag like `v1.0.0`.

| File | Role |
| --- | --- |
| `src/quests.js` | Runs inside Discord's window: finds Discord's internal modules, accepts and completes quests, draws the panel |
| `src/inject.cjs` | Loaded by Discord's main process; injects `quests.js` into the main window and re-applies the patch after updates |
| `src/patcher.cjs` | Finds Discord installs and adds/removes the line in `discord_desktop_core/index.js` that loads `inject.cjs` |
| `src/cli.cjs` | Installer (menu and commands); the exe's entry point |
| `scripts/build.js` | Builds the exe as a Node single executable application |
| `.github/workflows/release.yml` | Manual workflow that builds the exe and publishes a release |

## Security

- Never reads or sends your token: requests go through Discord's own internal HTTP client, to `discord.com` only.
- No debug port, and no code downloaded from anywhere.
- Each release ships a `discord-orbs.exe.sha256` checksum; it's built by GitHub Actions from the public source.

**This violates Discord's Terms of Service.** Your account may have quests suspended or be banned. Use at your own risk.

<img width="525" height="908" alt="image" src="https://github.com/user-attachments/assets/542b1cfe-5630-44a7-a100-75c27c5903f6" />

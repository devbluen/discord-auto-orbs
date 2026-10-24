# discord-orbs

**English** · [Português](README.pt-BR.md)

Completes Discord quests from inside the official Discord desktop app on Windows and Linux.
<img width="375" height="615" alt="image" src="https://github.com/user-attachments/assets/a1798c63-de7f-4b16-97e4-2aef5bd7a4d1" />

## Install (easiest)

1. Go to [Releases](https://github.com/devbluen/discord-auto-quest/releases/latest) and download `discord-orbs-<version>.exe` (e.g. `discord-orbs-1.2.0.exe`).
2. Open it. If Windows shows "Windows protected your PC", click **More info** → **Run anyway** (the exe is unsigned).
3. Type `1` (Install / update) and press Enter, then `Y` to restart Discord.
4. In Discord, open the **Quests** page. A panel appears in the bottom-right corner and starts working.

To remove it: open the exe again and choose `2` (Uninstall).

## Linux

Use the official Discord desktop app. Install Node.js 22 or newer. Download `discord-orbs-linux-<version>.tar.gz` from [Releases](https://github.com/devbluen/discord-auto-quest/releases/latest) and extract it, or clone this repository. Then run from the extracted `discord-auto-quest-<version>` folder (or the cloned `discord-auto-quest`):

```sh
node src/cli.cjs status
node src/cli.cjs install
```

Start Discord once before installing so its `discord_desktop_core` module exists. After installation, quit Discord completely (including the tray icon) and reopen it. Open **Quests** to see the panel. To remove the patch, run `node src/cli.cjs uninstall` and restart Discord.

The installer checks the Stable, PTB and Canary user config directories, including the official Flatpak and Snap paths. The Linux install loads the payload directly from this repository's `src/` directory, so keep it in place. [Discord's FAQ says Quest rewards cannot be earned on Linux](https://support.discord.com/hc/en-us/articles/22225719947543-Discord-Quests-FAQ), but [Linux users report credited game quests](https://www.reddit.com/r/DiscordQuests/comments/1v6jpt6/how_do_i_complete_the_path_quests_on_linux/) when the official desktop app detects a Windows game process running under Wine or Proton. A live test in this repository confirmed that official Discord detected a renamed Wine executable and accepted its first game heartbeat; completion after 900 seconds has not yet been verified.

For automatic game detection, install Wine. The official Discord client on Linux automatically copies the bundled small `dummy-game-win.exe` into a folder named after the game, under its published Windows executable name, launches one game at a time, and stops it after the quest finishes or fails. The panel reports early Wine exits and warns if Discord has not detected a running dummy after 20 seconds. The dummy opens only a one-pixel offscreen window. Its source is `src/dummy-game-win.c`; the binary is never committed. The release workflow compiles it from that source and ships it only in the Linux archive (the Windows exe doesn't need or include it). From a git clone on Linux, install MinGW (`gcc-mingw-w64-x86-64`) and run `npm run build:dummy`, or use the release archive, which already contains it. Set `ORBS_DUMMY_EXE` when launching Discord if you want to use a different Windows executable. If you start the game under Wine or Proton yourself, Auto game uses the already detected process. Discord must detect the game before this script accepts or tracks its quest.

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
- The panel shows the queue, progress and errors. Its buttons are **Check now**, **Pause**, **Copy report** and **Claim**, which opens the Quests page so you can claim the reward. On official Discord for Linux, game dummies start automatically when needed.
- A red badge on the panel (even minimized) counts the rewards ready to claim; hover it for the total orbs.
- Drag the orb (or the open panel by its header) anywhere; double-click the header to put it back in the corner. The position, language and toggles are remembered.
- English and Portuguese: follows Discord's language, or switch with the **EN/PT** button in the panel.
- Desktop notifications when a quest finishes, fails, or the whole queue is done. Clicking one opens the Quests page. Toggle them with **Notifications** in the panel.
- Update check: every 6 hours it looks for a newer [release](https://github.com/devbluen/discord-auto-quest/releases). If there is one, the panel shows **Update available** with a **Download** button and a desktop notification is sent once. The exe's menu also shows it.
- When Discord updates, the script re-applies itself to the new version if that version was already downloaded when Discord closed. If the panel disappears after an update, open the exe and install again.

| Type | How |
| --- | --- |
| `WATCH_VIDEO` / `WATCH_VIDEO_ON_MOBILE` | sends video progress within the server's time limit |
| `PLAY_ON_DESKTOP` | on official Discord for Windows, fakes the game's process; on official Discord for Linux, tracks a game Discord has detected |
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
| `.github/workflows/release.yml` | Manual workflow that builds the Windows installer and Linux archive, then publishes both |

## Security

- Never reads or sends your token: quest requests go through Discord's own internal HTTP client, to `discord.com` only.
- The only other request is the update check: an anonymous GET to `api.github.com/repos/devbluen/discord-auto-quest/releases/latest`, without any Discord data.
- No debug port, and no code downloaded from anywhere.
- Each release ships SHA-256 checksums for the Windows installer and Linux archive; both are built by GitHub Actions from the public source.

**This violates Discord's Terms of Service.** Your account may have quests suspended or be banned. Use at your own risk.

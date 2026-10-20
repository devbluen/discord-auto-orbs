// discord-orbs: completes Discord quests from inside your own client.
// Runs pasted into the console (Ctrl+Shift+I) or injected at startup by the installer.
// Never reads the token or talks to anything but discord.com: it uses Discord's own HTTP client.
(async () => {
    "use strict";

    const TAG = "%c[orbs]";
    const STYLE = "color:#5865F2;font-weight:bold";

    // Recent log lines, for the "Copy report" button.
    const history = [];
    const remember = (level, args) => {
        const text = args.map(a => (typeof a === "string" ? a : JSON.stringify(a)?.slice(0, 300))).join(" ");
        history.push(`${new Date().toLocaleTimeString()} ${level} ${text}`);
        if (history.length > 60) history.shift();
    };
    const log = (...a) => { remember("INFO", a); console.log(TAG, STYLE, ...a); };
    const warn = (...a) => { remember("WARN", a); console.warn(TAG, STYLE, ...a); };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const RECHECK_MS = 10 * 60_000;

    // Pasted again while an instance is running: just trigger a check on that one.
    if (window.orbs) return window.orbs.check();

    const state = {
        phase: "loading",     // loading | ready | error
        error: null,
        paused: false,
        gen: 0,               // bumped on pause; tasks from older generations stop on their own
        current: null,        // { id, progress, target }
        nextCheck: 0,
        wake: null,
        cleanups: new Set()
    };
    const done = new Set();
    const failed = new Map();       // questId -> reason
    const enrollFailed = new Map(); // questId -> reason
    const overrides = new Map();    // questId -> userStatus returned by enroll (the store can lag behind)
    let autoAccept = true;

    function wake() {
        state.wake?.();
    }

    window.orbs = {
        get running() { return state.phase === "ready" && !state.paused; },
        check() {
            failed.clear();
            enrollFailed.clear();
            state.paused = false;
            wake();
        },
        stop() {
            state.paused = true;
            state.gen++;
            for (const fn of state.cleanups) try { fn(); } catch { }
            state.cleanups.clear();
            log("Paused.");
        },
        start() {
            state.paused = false;
            wake();
            log("Resumed.");
        }
    };

    createPanel();

    /* ── webpack ─────────────────────────────────────────────── */

    // Discord ships more than one webpack runtime (Sentry has a tiny one); keep the biggest.
    function getRequire() {
        let req;
        if (!Array.isArray(window.webpackChunkdiscord_app)) return null;
        window.webpackChunkdiscord_app.push([[Symbol()], {}, r => {
            if (!req || Object.keys(r?.m ?? {}).length > Object.keys(req?.m ?? {}).length) req = r;
        }]);
        window.webpackChunkdiscord_app.pop();
        return req?.m ? req : null;
    }

    const exportsOf = exports => {
        if (!exports || (typeof exports !== "object" && typeof exports !== "function")) return [];
        return [exports, ...Object.values(exports)].filter(v => v && (typeof v === "object" || typeof v === "function"));
    };

    // Searches already-loaded modules (req.c) first. With `deep`, if not enough was found,
    // filters factories by their source text and requires only the matching ones.
    function findAll(req, filter, hints, deep, limit = Infinity) {
        const found = new Set();
        const check = exports => {
            for (const v of exportsOf(exports)) {
                if (found.size >= limit) return;
                try { if (filter(v)) found.add(v); } catch { }
            }
        };
        for (const mod of Object.values(req.c ?? {})) check(mod?.exports);
        if (!deep || found.size >= limit) return [...found];

        for (const [id, factory] of Object.entries(req.m)) {
            if (found.size >= limit) break;
            let src;
            try { src = String(factory); } catch { continue; }
            if (!hints.every(h => src.includes(h))) continue;
            try { check(req(id)); } catch { }
        }
        return [...found];
    }
    const find = (req, filter, hints, deep) => findAll(req, filter, hints, deep, 1)[0] ?? null;

    // `in` instead of reading the property: Discord's i18n Proxy returns something for any read
    // (and logs a warning), but doesn't trap `in`, so it gets skipped silently.
    const hasFns = (v, props) => props.every(p => p in v && typeof v[p] === "function");

    // Flux stores expose getName() with the original class name, which survives minification.
    const store = (req, re, props, deep) => find(req,
        v => hasFns(v, ["getName", ...props]) && re.test(v.getName()),
        props, deep);

    function resolveModules(deep) {
        const req = getRequire();
        if (!req) return null;
        const m = {
            QuestsStore: store(req, /^Quests?Store$/, ["getQuest"], deep),
            RunningGameStore: store(req, /^RunningGameStore$/, ["getRunningGames", "getGameForPID"], deep),
            ChannelStore: store(req, /^ChannelStore$/, ["getSortedPrivateChannels"], deep),
            GuildChannelStore: store(req, /^GuildChannelStore$/, ["getAllGuilds"], deep),
            // Several objects have get/post/...; all become candidates and are probed later.
            api: findAll(req, v => hasFns(v, ["get", "post", "put", "patch", "del"]), ["post", "patch", "del"], deep)
                .sort((a, b) => ("getAPIBaseURL" in b) - ("getAPIBaseURL" in a))
        };
        m.Dispatcher = m.QuestsStore?._dispatcher ?? null;
        return m;
    }

    // Injected at startup, the script runs before Discord finishes loading: wait for the modules.
    let mods, attempt = 0;
    for (; ;) {
        mods = resolveModules(attempt >= 20);
        const missing = mods
            ? Object.entries(mods).filter(([, v]) => !v || (Array.isArray(v) && !v.length)).map(([k]) => k)
            : ["webpack"];
        if (!missing.length) break;
        state.error = `attempt ${attempt + 1}/40, missing: ${missing.join(", ")}`;
        if (++attempt === 40) {
            state.phase = "error";
            state.error = `Modules not found: ${missing.join(", ")}`;
            return warn(state.error);
        }
        await sleep(3000);
    }
    const { QuestsStore, RunningGameStore, ChannelStore, GuildChannelStore, Dispatcher } = mods;

    // The API client is whichever candidate answers /users/@me with your user (a harmless GET).
    let api = null;
    for (const candidate of mods.api) {
        try {
            const res = await candidate.get({ url: "/users/@me" });
            if (res?.body?.id) { api = candidate; break; }
        } catch { }
    }
    if (!api) {
        state.phase = "error";
        state.error = `API client not found (${mods.api.length} candidate(s), none answered /users/@me)`;
        return warn(state.error);
    }
    state.phase = "ready";

    // Diagnostics: `copy(orbs.debug())` in the console copies the quests' shape (no token).
    window.orbs.debug = () => JSON.stringify({
        store: QuestsStore.getName?.(),
        questsType: Object.prototype.toString.call(QuestsStore.quests),
        quests: allQuests().slice(0, 8).map(q => ({
            id: q.id,
            name: nameOf(q),
            keys: Object.keys(q),
            userStatus: q.userStatus ?? q.user_status ?? null,
            override: overrides.get(q.id) ?? null,
            tasks: Object.keys(taskConfigOf(q)?.tasks ?? {}),
            rewards: q.config.rewardsConfig?.rewards ?? null,
            orbs: orbsOf(q),
            enrollFailed: enrollFailed.get(q.id) ?? null,
            failed: failed.get(q.id) ?? null
        }))
    }, null, 2);

    /* ── quests ──────────────────────────────────────────────── */

    const isDesktop = typeof window.DiscordNative !== "undefined";
    const SUPPORTED = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "PLAY_ACTIVITY"];

    const taskConfigOf = q => q.config.taskConfig ?? q.config.taskConfigV2;
    const pickTask = q => SUPPORTED.find(t => taskConfigOf(q)?.tasks?.[t]) ?? null;
    const targetOf = (q, task) => taskConfigOf(q)?.tasks?.[task]?.target ?? 0;
    // Store userStatus, also accepting the API's snake_case shape.
    const storeStatus = q => {
        const s = q.userStatus ?? q.user_status;
        if (!s) return null;
        return {
            enrolledAt: s.enrolledAt ?? s.enrolled_at ?? null,
            completedAt: s.completedAt ?? s.completed_at ?? null,
            claimedAt: s.claimedAt ?? s.claimed_at ?? null,
            progress: s.progress ?? {}
        };
    };
    const statusOf = q => {
        const s = storeStatus(q);
        return s?.enrolledAt ? s : overrides.get(q.id) ?? s ?? {};
    };
    // For game quests Discord itself sends the heartbeat, and only for quests the store already
    // knows are enrolled; enrolled only by the script, they wait for the store to catch up.
    const waitingStore = q => pickTask(q) === "PLAY_ON_DESKTOP" && !storeStatus(q)?.enrolledAt;
    const progressOf = (q, task) => statusOf(q).progress?.[task]?.value ?? 0;
    const nameOf = q => q.config.messages?.questName ?? q.id;
    const orbsOf = q => (q.config.rewardsConfig?.rewards ?? [])
        .reduce((sum, r) => sum + (r.orbQuantity ?? r.orb_quantity ?? 0), 0);
    const remainingOf = q => {
        const task = pickTask(q);
        return Math.max(1, targetOf(q, task) - progressOf(q, task));
    };
    const errMsg = e => {
        let msg = e?.body?.message ?? e?.message ?? (typeof e?.body === "string" ? e.body : null) ?? String(e);
        // HTML responses (the website's error page) collapse to their <title>.
        if (/<html/i.test(msg)) msg = `HTML: ${msg.match(/<title>([^<]*)/i)?.[1]?.trim() ?? "error page"}`;
        msg = msg.slice(0, 300);
        return e?.status ? `${e.status} ${msg}` : msg;
    };

    // Orb quests first, best orbs-per-second first; then the rest, shortest first.
    function byPriority(a, b) {
        const oa = orbsOf(a), ob = orbsOf(b);
        if ((oa > 0) !== (ob > 0)) return oa > 0 ? -1 : 1;
        if (oa > 0) {
            const diff = ob / remainingOf(b) - oa / remainingOf(a);
            if (diff) return diff;
        }
        return remainingOf(a) - remainingOf(b);
    }

    // `quests` changed shape across builds (Map, array, object); accept any.
    function allQuests() {
        const raw = QuestsStore.quests ?? QuestsStore.getQuests?.();
        const list = raw instanceof Map ? [...raw.values()]
            : Array.isArray(raw) ? raw
            : raw && typeof raw === "object" ? Object.values(raw)
            : [];
        return list.filter(q => q?.id && q?.config && new Date(q.config.expiresAt).getTime() > Date.now());
    }

    const pendingQuests = () => allQuests().filter(q =>
        statusOf(q).enrolledAt &&
        !statusOf(q).completedAt &&
        !done.has(q.id) &&
        !failed.has(q.id) &&
        pickTask(q) &&
        !waitingStore(q)
    ).sort(byPriority);

    // Only enrolls what the script can finish, so nothing is left stuck as enrolled.
    // Everything gets enrolled up front: video progress is capped by time since enrollment,
    // so videos further down the queue are ready to finish fast when their turn comes.
    const toEnroll = () => allQuests().filter(q =>
        !statusOf(q).enrolledAt &&
        !enrollFailed.has(q.id) &&
        pickTask(q)
    ).sort(byPriority);

    // Same body the client sends on "Accept Quest"; the returned userStatus is snake_case
    // and is converted to the store's shape.
    async function enroll(q) {
        try {
            const res = await api.post({
                url: `/quests/${q.id}/enroll`,
                body: {
                    location: 11,
                    is_targeted: false,
                    metadata_raw: null,
                    metadata_sealed: null,
                    traffic_metadata_raw: q.trafficMetadataRaw ?? null,
                    traffic_metadata_sealed: q.trafficMetadataSealed ?? null
                }
            });
            const s = res?.body?.user_status ?? res?.body ?? {};
            const enrolledAt = s.enrolled_at ?? s.enrolledAt;
            // Without enrolled_at we can't claim it worked: record the response for diagnostics.
            if (!enrolledAt) throw new Error(`unexpected response (${res?.status}): ${JSON.stringify(res?.body ?? res).slice(0, 200)}`);
            overrides.set(q.id, {
                enrolledAt,
                completedAt: s.completed_at ?? s.completedAt ?? null,
                claimedAt: s.claimed_at ?? s.claimedAt ?? null,
                progress: s.progress ?? {}
            });
            log(`"${nameOf(q)}" accepted.`);
        } catch (e) {
            enrollFailed.set(q.id, errMsg(e));
            warn(`"${nameOf(q)}" could not be accepted:`, errMsg(e), e?.body ?? "");
        }
        await sleep(1500);
    }

    // Discord only fetches quests when the Quests page opens (or on enroll):
    // react to any store change instead of waiting for the next cycle.
    let changeTimer;
    QuestsStore.addChangeListener?.(() => {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => { if (!state.current) wake(); }, 1500);
    });

    log("Ready. Panel in the bottom-right corner; orbs.check() forces a check.");

    for (; ;) {
        const e = state.paused || !autoAccept ? null : toEnroll()[0];
        if (e) {
            await enroll(e);
            continue;
        }
        const q = state.paused ? null : pendingQuests()[0];
        if (q) {
            await runQuest(q);
            continue;
        }
        state.nextCheck = Date.now() + RECHECK_MS;
        await new Promise(r => {
            const t = setTimeout(r, RECHECK_MS);
            state.wake = () => { clearTimeout(t); r(); };
        });
        state.wake = null;
    }

    async function runQuest(q) {
        const name = nameOf(q);
        const task = pickTask(q);
        const target = targetOf(q, task);
        const gen = state.gen;
        const alive = () => !state.paused && state.gen === gen;
        const report = progress => { state.current = { id: q.id, progress, target }; };

        log(`"${name}" → ${task} (${progressOf(q, task)}/${target}s, ${orbsOf(q)} orbs)`);
        report(progressOf(q, task));
        try {
            if (task.startsWith("WATCH_VIDEO")) await doVideo(q, task, target, alive, report);
            else if (task === "PLAY_ON_DESKTOP") await doGame(q, task, target, alive, report);
            else if (task === "PLAY_ACTIVITY") await doActivity(q, task, target, alive, report);
            if (alive()) {
                done.add(q.id);
                log(`"${name}" completed! Claim the reward on the Quests page.`);
            }
        } catch (e) {
            failed.set(q.id, errMsg(e));
            warn(`"${name}" failed:`, errMsg(e));
        } finally {
            state.current = null;
        }
    }

    /* ── tasks ───────────────────────────────────────────────── */

    // The server rejects timestamps too far ahead of real time since enrollment,
    // so progress never gets more than `maxFuture` seconds ahead of that.
    async function doVideo(q, task, target, alive, report) {
        const enrolledAt = new Date(statusOf(q).enrolledAt).getTime();
        const maxFuture = 10, speed = 7;
        let progress = progressOf(q, task), completed = false;

        while (alive() && progress < target) {
            const allowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
            if (allowed - progress >= speed) {
                const next = Math.min(target, progress + speed);
                const res = await api.post({ url: `/quests/${q.id}/video-progress`, body: { timestamp: next + Math.random() } });
                completed = res.body?.completed_at != null;
                progress = next;
                report(progress);
            }
            await sleep(1000);
        }
        if (alive() && !completed)
            await api.post({ url: `/quests/${q.id}/video-progress`, body: { timestamp: target } });
    }

    // Fakes the game's process running; Discord itself sends the quest heartbeats.
    async function doGame(q, task, target, alive, report) {
        if (!isDesktop) throw new Error("game quests only work in the desktop app, not the browser");

        const appId = taskConfigOf(q).tasks[task].applications?.[0]?.id ?? q.config.application?.id;
        if (!appId) throw new Error("quest has no application id");

        const res = await api.get({ url: `/applications/public?application_ids=${appId}` });
        const app = res.body?.[0];
        if (!app) throw new Error("application not found");
        const exeName = app.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? `${app.name}.exe`;

        const pid = Math.floor(Math.random() * 30000) + 1000;
        const fakeGame = {
            cmdLine: `C:\\Program Files\\${app.name}\\${exeName}`,
            exeName,
            exePath: `c:/program files/${app.name.toLowerCase()}/${exeName}`,
            hidden: false,
            isLauncher: false,
            id: appId,
            name: app.name,
            pid,
            pidPath: [pid],
            processName: app.name,
            start: Date.now()
        };

        // Newer builds also decide eligibility through these getters; patch whichever exist.
        const realGames = RunningGameStore.getRunningGames();
        const patches = {
            getRunningGames: () => [fakeGame],
            getGameForPID: p => (p === pid ? fakeGame : null),
            getVisibleGame: () => fakeGame,
            getVisibleRunningGames: () => [fakeGame],
            getCandidateGames: () => [fakeGame],
            getRunningDiscordApplicationIds: () => [appId]
        };
        const originals = {};
        for (const [k, fn] of Object.entries(patches)) {
            if (typeof RunningGameStore[k] !== "function") continue;
            originals[k] = RunningGameStore[k];
            RunningGameStore[k] = fn;
        }
        Dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: [fakeGame] });

        let resolveDone, lastBeat = Date.now(), progress = progressOf(q, task);
        const finished = new Promise(r => (resolveDone = r));
        const onBeat = data => {
            if (data.questId !== q.id) return;
            lastBeat = Date.now();
            progress = q.config.configVersion === 1
                ? data.userStatus.streamProgressSeconds
                : Math.floor(data.userStatus.progress?.[task]?.value ?? 0);
            report(progress);
            if (progress >= target) resolveDone();
        };
        Dispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat);

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            Dispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat);
            Object.assign(RunningGameStore, originals);
            Dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: RunningGameStore.getRunningGames() });
            resolveDone();
        };
        state.cleanups.add(cleanup);

        log(`  faking "${app.name}" running (~${Math.ceil((target - progress) / 60)} min).`);
        try {
            while (alive() && progress < target) {
                if (Date.now() - lastBeat > 3 * 60_000) throw new Error("Discord sent no heartbeat for 3 min");
                await Promise.race([finished, sleep(5000)]);
            }
        } finally {
            state.cleanups.delete(cleanup);
            cleanup();
        }
    }

    async function doActivity(q, task, target, alive, report) {
        const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id
            ?? Object.values(GuildChannelStore.getAllGuilds()).find(g => g?.VOCAL?.length)?.VOCAL[0].channel.id;
        if (!channelId) throw new Error("no channel available for the heartbeat");
        const streamKey = `call:${channelId}:1`;

        while (alive()) {
            const res = await api.post({ url: `/quests/${q.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
            const progress = res.body?.progress?.[task]?.value ?? 0;
            report(progress);
            if (progress >= target) {
                await api.post({ url: `/quests/${q.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                break;
            }
            await sleep(20_000);
        }
    }

    /* ── panel ───────────────────────────────────────────────── */

    // Expanded on the Quests page, a small pill everywhere else. Discord's DOM is React with
    // hashed class names, so the panel floats instead of being grafted into the page
    // (which would break on every Discord update).
    function createPanel() {
        const style = document.createElement("style");
        style.textContent = `
#orbs-panel{position:fixed;right:16px;bottom:16px;z-index:1000;width:340px;max-height:60vh;display:flex;flex-direction:column;background:var(--background-floating,#111214);color:var(--text-normal,#dbdee1);border:1px solid var(--border-subtle,#ffffff14);border-radius:8px;box-shadow:0 8px 24px #0006;font:14px/1.4 var(--font-primary,sans-serif)}
#orbs-panel.min{width:auto;max-width:340px}
#orbs-panel.min .status,#orbs-panel.min ul,#orbs-panel.min button{display:none}
#orbs-panel header{display:flex;align-items:center;gap:6px;padding:8px 10px 8px 12px;cursor:pointer;user-select:none}
#orbs-panel .t{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#orbs-panel button{background:var(--brand-500,#5865F2);color:#fff;border:0;border-radius:4px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
#orbs-panel button.sec{background:var(--background-modifier-accent,#4e5058)}
#orbs-panel .status{padding:0 12px 8px;font-size:13px;color:var(--text-muted,#949ba4)}
#orbs-panel ul{list-style:none;margin:0;padding:0 12px 10px;overflow:auto}
#orbs-panel li{padding:6px 0;border-top:1px solid var(--border-subtle,#ffffff0f)}
#orbs-panel .n{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#orbs-panel .s{font-size:12px;color:var(--text-muted,#949ba4)}
#orbs-panel .s.ok{color:var(--status-positive,#23a55a)}
#orbs-panel .s.err{color:var(--status-danger,#f23f43)}
#orbs-panel li button{margin-top:6px}
#orbs-panel .bar{height:4px;border-radius:2px;background:var(--background-modifier-accent,#4e5058);margin-top:4px;overflow:hidden}
#orbs-panel .bar i{display:block;height:100%;background:var(--status-positive,#23a55a);transition:width .5s}`;
        document.head.append(style);

        const el = (tag, cls, text) => {
            const e = document.createElement(tag);
            if (cls) e.className = cls;
            if (text != null) e.textContent = text;
            return e;
        };

        const panel = el("div");
        panel.id = "orbs-panel";
        const header = el("header");
        const title = el("span", "t", "orbs");
        const checkBtn = el("button", null, "Check now");
        const pauseBtn = el("button", "sec", "Pause");
        const acceptBtn = el("button", "sec");
        acceptBtn.title = "Automatically accept the quests the script can complete";
        header.append(title, checkBtn, pauseBtn);
        const status = el("div", "status");
        const copyBtn = el("button", "sec", "Copy report");
        const options = el("div", "status");
        options.style.display = "flex";
        options.style.gap = "6px";
        options.append(acceptBtn, copyBtn);
        const list = el("ul");
        panel.append(header, status, options, list);
        document.body.append(panel);

        // null = automatic (open on the Quests page); true/false = the user chose.
        let manualOpen = null, lastPath = location.pathname;
        const onQuestPage = () => /quest/i.test(location.pathname);

        header.addEventListener("click", e => {
            if (e.target.closest("button")) return;
            manualOpen = panel.classList.contains("min");
            render();
        });
        checkBtn.addEventListener("click", () => { window.orbs.check(); render(); });
        // The list is rebuilt every second; a delegated mousedown doesn't lose the click
        // if the button is recreated between press and release.
        list.addEventListener("mousedown", e => {
            const btn = e.target.closest("[data-claim]");
            if (btn) openQuest(btn.dataset.claim);
        });

        // In newer builds Discord's transitionTo is a loose function with a minified name;
        // it gives itself away through its own log message ("transitionTo - Transitioning to").
        let transitionTo;
        function findTransitionTo() {
            const req = getRequire();
            if (!req) return null;
            const router = find(req, v => hasFns(v, ["transitionTo", "replaceWith"]), ["transitionTo"], false);
            if (router) return path => router.transitionTo(path);
            for (const [id, factory] of Object.entries(req.m)) {
                let src;
                try { src = String(factory); } catch { continue; }
                if (!src.includes("Transitioning to")) continue;
                let exports;
                try { exports = req(id); } catch { continue; }
                const fns = Object.values(exports ?? {}).filter(v => typeof v === "function");
                const fn = fns.find(v => String(v).includes("transitionTo -")) ?? fns.find(v => String(v).includes("Transitioning to"));
                if (fn) return fn;
            }
            return null;
        }

        // Takes the path from Discord's own route table (its keys, like QUEST_HOME, survive
        // minification) instead of guessing; /quests/<id> isn't an in-app route and lands on
        // the friends list. Logs every quest route found, for the report.
        let questRoutes;
        function questPath(id) {
            if (questRoutes === undefined) {
                const req = getRequire();
                const routes = req && find(req, v => "QUEST_HOME" in v && "LOGIN" in v, ["QUEST_HOME"], false);
                questRoutes = routes ?? null;
                const seen = routes ? Object.keys(routes).filter(k => /QUEST/i.test(k)) : [];
                log("Quest routes:", seen.length ? seen.map(k => `${k}=${String(routes[k]).slice(0, 80)}`).join(" | ") : "none found");
            }
            const route = questRoutes?.QUEST_HOME;
            if (typeof route === "function") {
                try { return route(id); } catch { }
            }
            return typeof route === "string" ? route : "/quest-home";
        }

        // Without the router, push the URL into history and fire popstate (Discord's router
        // listens to it); location.assign would reload the whole app.
        function openQuest(id) {
            const path = questPath(id);
            transitionTo ??= findTransitionTo();
            if (transitionTo) {
                try { return transitionTo(path); } catch (e) { warn("transitionTo failed:", errMsg(e)); }
            }
            history.pushState(history.state, "", path);
            window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
        }

        // Everything needed for diagnosis: phase/error, quest shapes and the recent log.
        copyBtn.addEventListener("click", async () => {
            const report = [
                `orbs · ${new Date().toISOString()} · phase: ${state.phase}${state.error ? ` · ${state.error}` : ""}`,
                state.phase === "ready" ? window.orbs.debug() : "(quests unavailable: modules not loaded)",
                "--- log ---",
                ...history
            ].join("\n");
            try {
                if (window.DiscordNative?.clipboard?.copy) window.DiscordNative.clipboard.copy(report);
                else await navigator.clipboard.writeText(report);
                copyBtn.textContent = "Copied!";
            } catch {
                console.log(report);
                copyBtn.textContent = "Failed: see console";
            }
            setTimeout(() => (copyBtn.textContent = "Copy report"), 2000);
        });
        acceptBtn.addEventListener("click", () => {
            autoAccept = !autoAccept;
            if (autoAccept) wake();
            render();
        });
        pauseBtn.addEventListener("click", () => {
            state.paused ? window.orbs.start() : window.orbs.stop();
            render();
        });

        const fmt = s => {
            s = Math.max(0, Math.round(s));
            return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        };

        function questRow(q, queuePos) {
            const task = pickTask(q);
            const target = targetOf(q, task);
            const cur = state.current?.id === q.id ? state.current : null;
            const us = statusOf(q);
            const orbs = orbsOf(q);
            const reward = orbs ? `${orbs} orbs · ` : "";
            let rank, text, cls = "", pct = null;

            if (cur) {
                rank = 0; pct = cur.progress / target;
                text = `${reward}running · ${fmt(cur.progress)} / ${fmt(target)} (${task})`;
            } else if (us.claimedAt) {
                rank = 6; text = `${reward}reward claimed`; cls = "ok";
            } else if (us.completedAt || done.has(q.id)) {
                rank = 5; text = `${reward}completed · reward waiting`; cls = "ok";
            } else if (!us.enrolledAt && enrollFailed.has(q.id)) {
                rank = 2; text = `failed to accept: ${enrollFailed.get(q.id)}`; cls = "err";
            } else if (!us.enrolledAt && task && autoAccept) {
                rank = 1; text = `${reward}queued · will be accepted automatically`;
            } else if (!us.enrolledAt) {
                rank = 3; text = task ? "not accepted · turn on auto-accept or accept it manually" : "not accepted · unsupported type";
            } else if (!task) {
                rank = 4; text = `unsupported (${Object.keys(taskConfigOf(q)?.tasks ?? {}).join(", ")})`;
            } else if (waitingStore(q)) {
                rank = 1; text = `${reward}accepted · reopen the Quests page (or Ctrl+R) so Discord starts the game`;
            } else if (failed.has(q.id)) {
                rank = 2; text = `failed: ${failed.get(q.id)}`; cls = "err";
            } else {
                rank = 1; pct = progressOf(q, task) / target;
                text = `${reward}#${queuePos} in queue · ${fmt(progressOf(q, task))} / ${fmt(target)} (${task})`;
            }

            const li = el("li");
            li.append(el("div", "n", nameOf(q)), el("div", `s ${cls}`, text));
            if (rank === 5) {
                const claim = el("button", null, "Claim");
                claim.dataset.claim = q.id;
                li.append(claim);
            }
            if (pct != null) {
                const bar = el("div", "bar"), fill = el("i");
                fill.style.width = `${Math.min(100, pct * 100)}%`;
                bar.append(fill);
                li.append(bar);
            }
            return { rank, li };
        }

        function render() {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                manualOpen = null;
            }
            // On error it opens on any page, so the report can be seen and copied.
            const open = manualOpen ?? (onQuestPage() || state.phase === "error");
            panel.classList.toggle("min", !open);

            let summary;
            if (state.phase === "loading") summary = "loading…";
            else if (state.phase === "error") summary = "error";
            else if (state.paused) summary = "paused";
            else if (state.current) summary = `${Math.floor(state.current.progress / state.current.target * 100)}%`;
            else summary = "idle";
            title.textContent = `orbs · ${summary}`;
            pauseBtn.textContent = state.paused ? "Resume" : "Pause";
            acceptBtn.textContent = `Auto-accept: ${autoAccept ? "on" : "off"}`;
            checkBtn.disabled = pauseBtn.disabled = acceptBtn.disabled = state.phase !== "ready";
            if (!open) return;

            if (state.phase === "loading") status.textContent = `Waiting for Discord to load… ${state.error ? `(${state.error})` : ""}`;
            else if (state.phase === "error") status.textContent = state.error;
            else if (state.paused) status.textContent = "Paused. Click Resume to continue.";
            else if (state.current) status.textContent = `Running "${nameOf(QuestsStore.getQuest(state.current.id) ?? { config: {}, id: state.current.id })}"`;
            else status.textContent = `Nothing queued. Next check in ${fmt((state.nextCheck - Date.now()) / 1000)}.`;

            if (state.phase !== "ready") return list.replaceChildren();
            // Rows follow the same priority the runner uses, so the queue order is what you see.
            const quests = allQuests().sort(byPriority);
            const queue = new Map(pendingQuests().map((q, i) => [q.id, i + 1]));
            const rows = quests.map(q => questRow(q, queue.get(q.id))).sort((a, b) => a.rank - b.rank);
            if (!rows.length) {
                return list.replaceChildren(el("li", "s", "No quests loaded yet. Open Discord's Quests page."));
            }
            list.replaceChildren(...rows.map(r => r.li));
        }

        setInterval(render, 1000);
        render();
    }
})();

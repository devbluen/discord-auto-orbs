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
        destroyed: false,
        gen: 0,               // bumped on pause; tasks from older generations stop on their own
        current: null,        // { id, progress, target }
        nextCheck: 0,
        wake: null,
        cleanups: new Set(),
        perf: { renders: 0, totalMs: 0, maxMs: 0 } // panel render cost, shown in the report
    };
    const done = new Set();
    const failed = new Map();       // questId -> reason
    const enrollFailed = new Map(); // questId -> reason
    const overrides = new Map();    // questId -> userStatus returned by enroll (the store can lag behind)

    // Discord deletes window.localStorage after it boots; a throwaway iframe's localStorage is the
    // same origin's storage, so panel preferences survive restarts. Falls back to the session.
    const prefs = (() => {
        let store = null;
        try { store = window.localStorage; } catch { }
        if (!store) try {
            const frame = document.createElement("iframe");
            frame.style.display = "none";
            document.body.append(frame);
            store = frame.contentWindow.localStorage;
            frame.remove();
        } catch { }
        if (!store) try { store = window.sessionStorage; } catch { }
        return {
            get(key, fallback) {
                try { const v = store?.getItem(`orbs.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
            },
            set(key, value) {
                try { store?.setItem(`orbs.${key}`, JSON.stringify(value)); } catch { }
            }
        };
    })();

    let autoAccept = prefs.get("autoAccept", true);
    let notifications = prefs.get("notifications", true);

    /* ── i18n ────────────────────────────────────────────────── */

    // UI and notifications follow Discord's language (pt-BR → Portuguese, anything else → English)
    // unless the panel's language button overrides it. Logs and the report stay in English.
    const STRINGS = {
        en: {
            open: "Open orbs", minimize: "Minimize", checkNow: "Check now", pause: "Pause", resume: "Resume",
            autoAccept: "Auto-accept", autoAcceptTip: "Automatically accept the quests the script can complete",
            notifications: "Notifications", notificationsTip: "Desktop notifications when a quest finishes or fails",
            copyReport: "Copy report", copied: "Copied!", copyFailed: "Copy failed: report printed to the console",
            language: "Language: English (click for Português)", dragTip: "Drag to move · double-click to put it back in the corner",
            subConnecting: "Connecting to Discord…", subError: "Something went wrong", subPaused: "Paused",
            subRunning: "Running · {p}%", subIdle: "Idle · next check in {t}",
            connecting: "Connecting to Discord", findingModules: "Finding Discord's quest modules…",
            couldntStart: "Couldn't start", paused: "Paused", pausedDetail: "Resume to keep completing quests.",
            noQuests: "No quests yet", noQuestsDetail: "Open Discord's Quests page to load them.", openQuests: "Open Quests",
            caughtUp: "All caught up", caughtUpDetail: "New quests are picked up automatically.",
            left: "{d} left", update: "Update {v}", youHave: "You have {v}", download: "Download",
            ready: "Ready to claim", next: "Up next", attention: "Needs attention", other: "Other",
            claim: "Claim", retry: "Retry",
            video: "Video", game: "Game", activity: "Activity", quest: "Quest",
            claimed: "Reward claimed", claimedChip: "Claimed", completed: "Completed",
            wine: "Waiting for Discord to detect the Wine game", couldntAccept: "Couldn't accept: {e}",
            accepting: "{d} · accepting…", notAccepted: "Not accepted · turn on Auto-accept",
            gameUnavailable: "Game detection unavailable in this client", unsupported: "Unsupported quest type",
            reopen: "Reopen the Quests page so Discord starts the game",
            tipLoading: "loading", tipError: "error", tipPaused: "paused", tipRunning: "running {p}%", tipIdle: "idle",
            tipReady: n => `${n} reward${n === 1 ? "" : "s"} ready`, tipUpdate: "update {v} available",
            rewardsReady: n => `${n} reward${n === 1 ? "" : "s"} ready`,
            nCompleted: "{name} completed", orbsReady: "{n} orbs ready to claim.", rewardReady: "Reward ready to claim.",
            nFailed: "{name} failed", allDone: "All quests done",
            allDoneBody: v => `${v.n} reward${v.n === 1 ? "" : "s"} ready to claim${v.orbs ? ` · ${v.orbs} orbs` : ""}.`,
            notifyOn: "orbs notifications on", notifyOnBody: "You'll be notified when a quest finishes or fails.",
            updateTitle: "discord-orbs {v} available", updateBody: "You have {c}. Click to open the download page."
        },
        pt: {
            open: "Abrir orbs", minimize: "Minimizar", checkNow: "Verificar agora", pause: "Pausar", resume: "Retomar",
            autoAccept: "Auto-aceitar", autoAcceptTip: "Aceitar sozinho as missões que o script consegue completar",
            notifications: "Notificações", notificationsTip: "Notificações na área de trabalho quando uma missão termina ou falha",
            copyReport: "Copiar relatório", copied: "Copiado!", copyFailed: "Falha ao copiar: relatório impresso no console",
            language: "Idioma: Português (clique para English)", dragTip: "Arraste para mover · clique duas vezes para voltar ao canto",
            subConnecting: "Conectando ao Discord…", subError: "Algo deu errado", subPaused: "Pausado",
            subRunning: "Executando · {p}%", subIdle: "Ocioso · próxima verificação em {t}",
            connecting: "Conectando ao Discord", findingModules: "Procurando os módulos de missões do Discord…",
            couldntStart: "Não foi possível iniciar", paused: "Pausado", pausedDetail: "Retome para continuar completando missões.",
            noQuests: "Nenhuma missão ainda", noQuestsDetail: "Abra a página de Missões do Discord para carregá-las.", openQuests: "Abrir Missões",
            caughtUp: "Tudo em dia", caughtUpDetail: "Missões novas entram na fila automaticamente.",
            left: "faltam {d}", update: "Atualização {v}", youHave: "Você tem a {v}", download: "Baixar",
            ready: "Prontas para resgatar", next: "Próximas", attention: "Precisam de atenção", other: "Outras",
            claim: "Resgatar", retry: "Tentar de novo",
            video: "Vídeo", game: "Jogo", activity: "Atividade", quest: "Missão",
            claimed: "Recompensa resgatada", claimedChip: "Resgatada", completed: "Concluída",
            wine: "Esperando o Discord detectar o jogo no Wine", couldntAccept: "Não foi possível aceitar: {e}",
            accepting: "{d} · aceitando…", notAccepted: "Não aceita · ligue o Auto-aceitar",
            gameUnavailable: "Detecção de jogo indisponível neste cliente", unsupported: "Tipo de missão não suportado",
            reopen: "Reabra a página de Missões para o Discord iniciar o jogo",
            tipLoading: "carregando", tipError: "erro", tipPaused: "pausado", tipRunning: "executando {p}%", tipIdle: "ocioso",
            tipReady: n => `${n} recompensa${n === 1 ? "" : "s"} pronta${n === 1 ? "" : "s"}`, tipUpdate: "atualização {v} disponível",
            rewardsReady: n => `${n} recompensa${n === 1 ? "" : "s"} pronta${n === 1 ? "" : "s"}`,
            nCompleted: "{name} concluída", orbsReady: "{n} orbs prontos para resgatar.", rewardReady: "Recompensa pronta para resgatar.",
            nFailed: "{name} falhou", allDone: "Todas as missões concluídas",
            allDoneBody: v => `${v.n} recompensa${v.n === 1 ? "" : "s"} pronta${v.n === 1 ? "" : "s"} para resgatar${v.orbs ? ` · ${v.orbs} orbs` : ""}.`,
            notifyOn: "Notificações do orbs ligadas", notifyOnBody: "Você será avisado quando uma missão terminar ou falhar.",
            updateTitle: "discord-orbs {v} disponível", updateBody: "Você tem a {c}. Clique para abrir a página de download."
        }
    };
    let langPref = prefs.get("lang", null); // null = follow Discord
    const lang = () => langPref ?? (/^pt/i.test(document.documentElement?.lang || navigator.language || "") ? "pt" : "en");
    // t("key", { var }) with {var} placeholders; function entries handle plurals.
    function t(key, vars = {}) {
        const s = STRINGS[lang()][key] ?? STRINGS.en[key] ?? key;
        return typeof s === "function" ? s(vars) : s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
    }
    let finishedSinceIdle = 0;      // quests completed since the queue was last empty
    let update = null;              // { current, latest, url } from inject.cjs when GitHub has a newer release

    // Discord opens window.open() links in the default browser.
    const openReleasePage = () => update && window.open(update.url, "_blank");

    function wake() {
        state.wake?.();
    }

    let removeQuestListener, changeTimer;
    window.orbs = {
        get running() { return state.phase === "ready" && !state.paused; },
        // Called by inject.cjs (main process) after it checks GitHub; notifies once per version.
        updateAvailable(info) {
            if (!info?.latest || update?.latest === info.latest) return;
            update = info;
            log(`Update available: v${info.latest} (installed v${info.current}). ${info.url}`);
            notify(t("updateTitle", { v: `v${info.latest}` }), t("updateBody", { c: `v${info.current}` }), openReleasePage);
        },
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
        destroy() {
            if (state.destroyed) return;
            this.stop();
            state.destroyed = true;
            clearTimeout(changeTimer);
            removeQuestListener?.();
            panel.destroy();
            wake();
            delete window.orbs;
        },
        start() {
            state.paused = false;
            wake();
            log("Resumed.");
        }
    };

    const panel = createPanel();

    // Native desktop notification (Electron turns the web Notification into a Windows toast).
    // Clicking it brings Discord forward on the Quests page.
    function notify(title, body, onClick = () => panel.openQuests()) {
        if (!notifications || typeof Notification === "undefined") return;
        try {
            const n = new Notification(title, { body });
            n.onclick = () => {
                if (window.DiscordNative?.window?.focus) window.DiscordNative.window.focus();
                else window.focus();
                onClick();
            };
        } catch (e) {
            warn("Notification failed:", e?.message ?? e);
        }
    }

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
    const isDesktop = typeof window.DiscordNative !== "undefined" ||
        (typeof IS_DISCORD_DESKTOP !== "undefined" && IS_DISCORD_DESKTOP);
    let mods, attempt = 0;
    for (; !state.destroyed ;) {
        // The deep scan stringifies every webpack factory (tens of thousands): expensive enough to
        // stutter Discord, so after the cheap attempts it runs only every 5th try.
        mods = resolveModules(attempt >= 20 && attempt % 5 === 0);
        const missing = mods
            ? Object.entries(mods).filter(([k, v]) =>
                k !== "RunningGameStore" && (!v || (Array.isArray(v) && !v.length))).map(([k]) => k)
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
    if (state.destroyed) return;
    const { QuestsStore, RunningGameStore, ChannelStore, GuildChannelStore, Dispatcher } = mods;

    // The API client is whichever candidate answers /users/@me with your user (a harmless GET).
    let api = null;
    for (const candidate of mods.api) {
        if (state.destroyed) return;
        try {
            const res = await candidate.get({ url: "/users/@me" });
            if (res?.body?.id) { api = candidate; break; }
        } catch { }
    }
    if (state.destroyed) return;
    if (!api) {
        state.phase = "error";
        state.error = `API client not found (${mods.api.length} candidate(s), none answered /users/@me)`;
        return warn(state.error);
    }
    state.phase = "ready";
    state.error = null;

    // Diagnostics: `copy(orbs.debug())` in the console copies the quests' shape (no token).
    window.orbs.debug = () => JSON.stringify({
        store: QuestsStore.getName?.(),
        questsType: Object.prototype.toString.call(QuestsStore.quests),
        autoGame: isLinux && canRunGame,
        panelRender: {
            renders: state.perf.renders,
            avgMs: +(state.perf.totalMs / Math.max(1, state.perf.renders)).toFixed(2),
            maxMs: +state.perf.maxMs.toFixed(2)
        },
        detectedGames: (RunningGameStore?.getRunningGames?.() ?? []).map(game => ({
            id: game.id, name: game.name, exeName: game.exeName
        })),
        quests: allQuests().slice(0, 8).map(q => ({
            id: q.id,
            name: nameOf(q),
            gameAppId: gameAppIdOf(q) ?? null,
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

    // The official Linux client uses a game process detected by Discord.
    const isLinux = /Linux/i.test(navigator.userAgent);
    const canRunGame = isDesktop && !!RunningGameStore;
    const SUPPORTED = canRunGame
        ? ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "PLAY_ACTIVITY"]
        : ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ACTIVITY"];

    const taskConfigOf = q => q.config.taskConfig ?? q.config.taskConfigV2;
    const gameAppIdOf = q => taskConfigOf(q)?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id ?? q.config.application?.id;
    const detectedGameOf = q => {
        const id = gameAppIdOf(q);
        return id == null ? null : (RunningGameStore?.getRunningGames?.() ?? [])
            .find(game => String(game.id) === String(id)) ?? null;
    };
    const gameAppCache = new Map();
    // The Linux main process polls this to launch one Wine dummy for the next game quest.
    window.orbs.dummyPlan = async () => {
        if (!isLinux || !canRunGame || state.paused || state.destroyed ||
            [...failed.values()].some(reason => /401|unauthori[sz]ed/i.test(reason))) return null;
        const games = allQuests().filter(q =>
            pickTask(q) === "PLAY_ON_DESKTOP" && !statusOf(q).completedAt &&
            !done.has(q.id) && !failed.has(q.id) &&
            (statusOf(q).enrolledAt || autoAccept)).sort(byPriority);
        const q = games.find(q => q.id === state.current?.id) ?? games[0];
        if (!q) return null;
        const appId = gameAppIdOf(q);
        if (!appId) return null;
        if (!gameAppCache.has(appId))
            gameAppCache.set(appId, api.get({ url: `/applications/public?application_ids=${appId}` })
                .then(res => res.body?.[0] ?? null).catch(() => {
                    gameAppCache.delete(appId);
                    return null;
                }));
        const app = await gameAppCache.get(appId);
        if (state.paused || state.destroyed) return null;
        const exeName = app?.executables?.find(x => x.os === "win32")?.name;
        if (!exeName) return null;
        return { questId: q.id, appId, exeName, name: app.name, running: !!detectedGameOf(q) };
    };
    window.orbs.dummyEvent = message => log(message);
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
    // Completed but not claimed yet: what the badge counts.
    const claimable = () => allQuests().filter(q =>
        (statusOf(q).completedAt || done.has(q.id)) && !statusOf(q).claimedAt);
    const remainingOf = q => {
        const task = pickTask(q);
        return Math.max(1, targetOf(q, task) - progressOf(q, task));
    };
    const errMsg = e => {
        let msg = e?.body?.message ?? e?.message ?? (typeof e?.body === "string" ? e.body : null) ?? String(e);
        // HTML responses (the website's error page) collapse to their <title>.
        if (/<html/i.test(msg)) msg = `HTML: ${msg.match(/<title>([^<]*)/i)?.[1]?.trim() ?? "error page"}`;
        msg = msg.slice(0, 300);
        const code = e?.body?.code ?? e?.code;
        return `${e?.status ? `${e.status} ` : ""}${code != null ? `code ${code}: ` : ""}${msg}`;
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
        (pickTask(q) !== "PLAY_ON_DESKTOP" || !isLinux || detectedGameOf(q)) &&
        !waitingStore(q)
    ).sort(byPriority);

    // Only enrolls what the script can finish, so nothing is left stuck as enrolled.
    // Everything gets enrolled up front: video progress is capped by time since enrollment,
    // so videos further down the queue are ready to finish fast when their turn comes.
    const toEnroll = () => allQuests().filter(q =>
        !statusOf(q).enrolledAt &&
        !enrollFailed.has(q.id) &&
        pickTask(q) &&
        (pickTask(q) !== "PLAY_ON_DESKTOP" || !isLinux || detectedGameOf(q))
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
    const onQuestChange = () => {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => { if (!state.current) wake(); }, 1500);
    };
    QuestsStore.addChangeListener?.(onQuestChange);
    if (isLinux && canRunGame) Dispatcher.subscribe?.("RUNNING_GAMES_CHANGE", onQuestChange);
    removeQuestListener = () => {
        QuestsStore.removeChangeListener?.(onQuestChange);
        if (isLinux && canRunGame) Dispatcher.unsubscribe?.("RUNNING_GAMES_CHANGE", onQuestChange);
    };

    log("Ready. Panel in the bottom-right corner; orbs.check() forces a check.");

    for (; !state.destroyed ;) {
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
        if (finishedSinceIdle && !state.paused) {
            const ready = claimable();
            const orbs = ready.reduce((sum, r) => sum + orbsOf(r), 0);
            notify(t("allDone"), t("allDoneBody", { n: ready.length, orbs: orbs ? orbs.toLocaleString() : "" }));
            finishedSinceIdle = 0;
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
        const alive = () => !state.destroyed && !state.paused && state.gen === gen;
        const report = progress => { state.current = { id: q.id, progress, target }; };

        log(`"${name}" → ${task} (${progressOf(q, task)}/${target}s, ${orbsOf(q)} orbs)`);
        report(progressOf(q, task));
        try {
            if (task.startsWith("WATCH_VIDEO")) await doVideo(q, task, target, alive, report);
            else if (task === "PLAY_ON_DESKTOP") await doGame(q, task, target, alive, report);
            else if (task === "PLAY_ACTIVITY") await doActivity(q, task, target, alive, report);
            if (alive()) {
                done.add(q.id);
                finishedSinceIdle++;
                log(`"${name}" completed! Claim the reward on the Quests page.`);
                const orbs = orbsOf(q);
                notify(t("nCompleted", { name }), orbs ? t("orbsReady", { n: orbs.toLocaleString() }) : t("rewardReady"));
            }
        } catch (e) {
            failed.set(q.id, errMsg(e));
            warn(`"${name}" failed:`, errMsg(e));
            notify(t("nFailed", { name }), errMsg(e));
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
        if (!canRunGame) throw new Error("game detection is unavailable in this client");

        const appId = gameAppIdOf(q);
        if (!appId) throw new Error("quest has no application id");

        const res = await api.get({ url: `/applications/public?application_ids=${appId}` });
        const app = res.body?.[0];
        if (!app) throw new Error("application not found");
        const nativeGame = detectedGameOf(q);
        if (isLinux && !nativeGame)
            throw new Error(`Start ${app.name} under Wine/Proton and wait for Discord to detect it, then press Check now`);
        const executable = app.executables?.find(x => x.os === "win32");
        const exeName = executable?.name?.replace(">", "") ?? `${app.name}.exe`;
        const exePath = `c:/program files/${app.name.toLowerCase()}/${exeName}`;

        // Windows PIDs are always multiples of 4, so an odd one can never belong to a real
        // process: Discord's native side won't end up probing some unrelated running program.
        const pid = Math.floor(Math.random() * 15000) * 4 + 1001;
        const fakeGame = {
            cmdLine: `C:\\Program Files\\${app.name}\\${exeName}`,
            exeName,
            exePath,
            hidden: false,
            isLauncher: false,
            id: appId,
            executables: [{ os: "win32", name: exeName, is_launcher: false }],
            name: app.name,
            overlay: false,
            pid,
            pidPath: [pid],
            processName: app.name,
            sandboxed: false,
            start: Date.now()
        };

        // Keep Discord's native detection when a real process is already visible.
        const realGames = RunningGameStore.getRunningGames() ?? [];
        const withFake = games => [...(games ?? []), fakeGame];
        const patches = {
            getRunningGames: (...args) => withFake(originals.getRunningGames.apply(RunningGameStore, args)),
            getGameForPID: (p, ...args) => p === pid ? fakeGame : originals.getGameForPID.call(RunningGameStore, p, ...args),
            getVisibleGame: () => fakeGame,
            getVisibleRunningGames: (...args) => withFake(originals.getVisibleRunningGames.apply(RunningGameStore, args)),
            getCandidateGames: (...args) => withFake(originals.getCandidateGames.apply(RunningGameStore, args)),
            getRunningDiscordApplicationIds: (...args) => {
                const ids = originals.getRunningDiscordApplicationIds.apply(RunningGameStore, args);
                return ids instanceof Set ? new Set([...ids, appId]) : [...(ids ?? []), appId];
            }
        };
        const originals = {};
        if (!nativeGame) {
            for (const [k, fn] of Object.entries(patches)) {
                if (typeof RunningGameStore[k] !== "function") continue;
                originals[k] = RunningGameStore[k];
                RunningGameStore[k] = fn;
            }
            Dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [], added: [fakeGame], games: withFake(realGames) });
        }

        let resolveDone, lastBeat = Date.now(), progress = progressOf(q, task), beatError = null, beatFailures = 0;
        const finished = new Promise(r => (resolveDone = r));
        const onBeat = data => {
            if (data.questId !== q.id) return;
            lastBeat = Date.now();
            beatFailures = 0;
            progress = q.config.configVersion === 1
                ? data.userStatus.streamProgressSeconds
                : Math.floor(data.userStatus.progress?.[task]?.value ?? 0);
            report(progress);
            if (progress >= target) resolveDone();
        };
        const onBeatFailure = data => {
            if (data.questId !== q.id) return;
            const error = data.error ?? data;
            beatFailures++;
            const status = error.status ?? error.httpStatus;
            if ((status !== 429 && status >= 400 && status < 500) || beatFailures >= 5) {
                beatError = errMsg(error);
                resolveDone();
            } else {
                // Discord schedules another attempt on its own next heartbeat tick.
                if (progress > 0) lastBeat = Date.now();
                warn(`  game heartbeat attempt ${beatFailures} failed: ${errMsg(error)}; waiting for the next attempt.`);
            }
        };
        Dispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat);
        Dispatcher.subscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onBeatFailure);

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            Dispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat);
            Dispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onBeatFailure);
            if (!nativeGame) {
                Object.assign(RunningGameStore, originals);
                Dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: RunningGameStore.getRunningGames() });
            }
            resolveDone();
        };
        state.cleanups.add(cleanup);

        log(`  ${nativeGame ? "monitoring detected" : "faking"} "${app.name}" running (~${Math.ceil((target - progress) / 60)} min).`);
        try {
            while (alive() && progress < target) {
                if (beatError) throw new Error(`Discord rejected the game heartbeat: ${beatError}`);
                if (Date.now() - lastBeat > 3 * 60_000) throw new Error("Discord sent no heartbeat for 3 min");
                await Promise.race([finished, sleep(5000)]);
            }
        } finally {
            state.cleanups.delete(cleanup);
            cleanup();
        }
    }

    async function doActivity(q, task, target, alive, report) {
        const appId = taskConfigOf(q).tasks[task].applications?.[0]?.id ?? q.config.application?.id;
        const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id
            ?? Object.values(GuildChannelStore.getAllGuilds()).find(g => g?.VOCAL?.length)?.VOCAL[0].channel.id;
        if (!channelId) throw new Error("no channel available for the heartbeat");
        const streamKey = `call:${channelId}:1`;
        const body = { stream_key: streamKey, application_id: String(appId ?? ""), terminal: false };

        while (alive()) {
            const res = await api.post({ url: `/quests/${q.id}/heartbeat`, body });
            const progress = res.body?.progress?.[task]?.value ?? 0;
            report(progress);
            if (progress >= target) {
                await api.post({ url: `/quests/${q.id}/heartbeat`, body: { ...body, terminal: true } });
                break;
            }
            await sleep(20_000);
        }
    }

    /* ── panel ───────────────────────────────────────────────── */

    // A floating orb that opens into a card (open by itself on the Quests page) and can be
    // dragged anywhere. Discord's DOM is React with hashed class names, so the panel floats
    // instead of being grafted into the page (which would break on every Discord update).
    // Colors come from Discord's own theme variables, so it follows dark/light themes.
    function createPanel() {
        const style = document.createElement("style");
        style.textContent = `
#orbs-root{--o-bg:var(--background-floating,#111214);--o-bg2:var(--background-secondary,#2b2d31);--o-hover:var(--background-modifier-hover,#4e505833);--o-active:var(--background-modifier-active,#4e50584d);--o-line:var(--border-subtle,#ffffff14);--o-text:var(--text-normal,#dbdee1);--o-strong:var(--header-primary,#f2f3f5);--o-muted:var(--text-muted,#949ba4);--o-brand:var(--brand-500,#5865f2);--o-ok:var(--status-positive,#23a55a);--o-err:var(--status-danger,#f23f43);--o-warn:var(--status-warning,#f0b232);--o-orb:#8f6bff;
  position:fixed;right:20px;bottom:20px;width:52px;height:52px;z-index:1000;font-family:var(--font-primary,"gg sans","Noto Sans",sans-serif);font-size:14px;line-height:1.35;color:var(--o-text);-webkit-font-smoothing:antialiased}
#orbs-root *{box-sizing:border-box}
#orbs-root button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
#orbs-root button:disabled{opacity:.4;cursor:default}
#orbs-root :focus-visible{outline:2px solid var(--o-brand);outline-offset:2px}
#orbs-root .num{font-variant-numeric:tabular-nums}
#orbs-root.dragging,#orbs-root.dragging *{cursor:grabbing!important;user-select:none}

#orbs-root .pill{position:absolute;right:0;bottom:0;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:var(--o-bg);box-shadow:0 0 0 1px var(--o-line),0 8px 24px #0000004d;touch-action:none;transition:transform .18s cubic-bezier(.2,.8,.2,1),opacity .18s}
#orbs-root .pill:hover{transform:translateY(-2px)}
#orbs-root .pill:active{transform:scale(.96)}
#orbs-root.dragging .pill{transform:scale(1.06);transition:none}
#orbs-root.open .pill{transform:scale(.6);opacity:0;pointer-events:none}
#orbs-root .pill .ring{position:absolute;inset:0;transform:rotate(-90deg);opacity:0;transition:opacity .2s}
#orbs-root .pill.running .ring{opacity:1}
#orbs-root .pill .ring circle{fill:none;stroke-width:3}
#orbs-root .pill .ring .track{stroke:var(--o-line)}
#orbs-root .pill .ring .value{stroke:var(--o-orb);stroke-linecap:round;transition:stroke-dashoffset .6s ease}
#orbs-root .pill.error .ring{opacity:1}
#orbs-root .pill.error .ring .value{stroke:var(--o-err)}
#orbs-root .pill.paused>svg:not(.ring){filter:grayscale(1);opacity:.6}
#orbs-root .pill.loading>svg:not(.ring){animation:orbs-pulse 1.4s ease-in-out infinite}
#orbs-root .badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--o-err);color:#fff;font-size:12px;font-weight:700;line-height:20px;text-align:center;box-shadow:0 0 0 3px var(--background-primary,#313338);transform:scale(0);transition:transform .2s cubic-bezier(.2,1.4,.4,1)}
#orbs-root .badge.on{transform:scale(1)}
#orbs-root .dot{position:absolute;left:2px;bottom:2px;width:12px;height:12px;border-radius:50%;background:var(--o-brand);box-shadow:0 0 0 3px var(--background-primary,#313338);display:none}
#orbs-root .dot.on{display:block}

#orbs-root .card{position:absolute;right:0;bottom:0;width:360px;max-height:600px;display:flex;flex-direction:column;background:var(--o-bg);border-radius:12px;box-shadow:0 0 0 1px var(--o-line),0 16px 48px #00000066;overflow:hidden;transform-origin:bottom right;transform:translateY(8px) scale(.97);opacity:0;visibility:hidden;transition:transform .2s cubic-bezier(.2,.8,.2,1),opacity .16s,visibility 0s .2s}
#orbs-root.open .card{transform:none;opacity:1;visibility:visible;transition:transform .22s cubic-bezier(.2,.8,.2,1),opacity .16s}
#orbs-root.left .card{right:auto;left:0;transform-origin:bottom left}
#orbs-root.top .card{bottom:auto;top:0;transform-origin:top right;transform:translateY(-8px) scale(.97)}
#orbs-root.top.left .card{transform-origin:top left}
#orbs-root.top.open .card{transform:none}
#orbs-root.dragging .card{transition:none}

#orbs-root .head{display:flex;align-items:center;gap:10px;padding:14px 12px 12px 16px;cursor:grab;touch-action:none;user-select:none}
#orbs-root .head .who{flex:1;min-width:0}
#orbs-root .head h2{margin:0;font-size:16px;font-weight:700;color:var(--o-strong);letter-spacing:-.01em}
#orbs-root .head .sub{font-size:12px;color:var(--o-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#orbs-root .head .sub i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:1px;background:var(--o-muted)}
#orbs-root .head .sub.run i{background:var(--o-ok);box-shadow:0 0 0 0 var(--o-ok);animation:orbs-ping 1.8s infinite}
#orbs-root .head .sub.err i{background:var(--o-err)}
#orbs-root .head .sub.pause i{background:var(--o-warn)}
#orbs-root .ib{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:var(--interactive-normal,#b5bac1);transition:background .12s,color .12s}
#orbs-root .ib:hover:not(:disabled){background:var(--o-hover);color:var(--interactive-hover,#dbdee1)}
#orbs-root .ib:active:not(:disabled){background:var(--o-active)}
#orbs-root .ib.spin svg{animation:orbs-spin .7s cubic-bezier(.3,.6,.3,1)}

#orbs-root .body{overflow:auto;padding:0 12px 4px;scrollbar-width:thin;scrollbar-color:var(--scrollbar-thin-thumb,#1a1b1e) transparent}
#orbs-root .body::-webkit-scrollbar{width:8px}
#orbs-root .body::-webkit-scrollbar-thumb{background:var(--scrollbar-thin-thumb,#1a1b1e);border-radius:4px;border:2px solid transparent;background-clip:padding-box}

#orbs-root .hero{padding:14px;border-radius:10px;background:var(--o-bg2);margin-bottom:8px}
#orbs-root .hero .top{display:flex;align-items:center;gap:10px}
#orbs-root .hero .ico{background:var(--o-bg)}
#orbs-root .hero .name{flex:1;min-width:0;font-weight:600;color:var(--o-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#orbs-root .hero .big{height:8px;border-radius:4px;background:var(--o-line);margin:12px 0 8px;overflow:hidden}
#orbs-root .hero .big i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--o-brand),var(--o-orb));transition:width .6s ease;position:relative;overflow:hidden}
#orbs-root .hero .big i::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#ffffff40,transparent);transform:translateX(-100%);animation:orbs-shine 2.2s infinite}
#orbs-root .hero .meta{display:flex;justify-content:space-between;font-size:12px;color:var(--o-muted)}
#orbs-root .hero.empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:22px 14px;gap:6px}
#orbs-root .hero.empty .t{font-weight:600;color:var(--o-strong)}
#orbs-root .hero.empty .d{font-size:12px;color:var(--o-muted);max-width:260px;word-break:break-word}
#orbs-root .hero.empty.err .t{color:var(--o-err)}
#orbs-root .hero .act{margin-top:6px}

#orbs-root .banner{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;margin-bottom:8px;font-size:13px}
#orbs-root .banner .grow{flex:1;min-width:0}
#orbs-root .banner b{color:var(--o-strong);font-weight:600}
#orbs-root .banner.upd{background:color-mix(in srgb,var(--o-brand) 14%,transparent)}
#orbs-root .banner.upd svg{color:var(--o-brand)}

#orbs-root .btn{height:28px;padding:0 12px;border-radius:6px;background:var(--o-brand);color:#fff;font-size:13px;font-weight:600;white-space:nowrap;transition:filter .12s}
#orbs-root .btn:hover{filter:brightness(1.1)}
#orbs-root .btn:active{filter:brightness(.92)}
#orbs-root .btn.ok{background:var(--o-ok)}
#orbs-root .btn.ghost{background:var(--o-hover);color:var(--o-text)}

#orbs-root .sec{display:flex;align-items:center;gap:6px;margin:14px 4px 6px;font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--o-muted)}
#orbs-root .sec .c{font-weight:600;opacity:.8}
#orbs-root .sec .grow{flex:1}
#orbs-root .sec .orbs{text-transform:none;letter-spacing:0}
#orbs-root button.sec{width:calc(100% - 8px)}
#orbs-root button.sec:hover{color:var(--o-text)}
#orbs-root button.sec svg{transition:transform .15s}
#orbs-root button.sec.closed svg{transform:rotate(-90deg)}

#orbs-root ul{list-style:none;margin:0;padding:0}
#orbs-root li{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;transition:background .12s}
#orbs-root li:hover{background:var(--o-hover)}
#orbs-root .ico{flex:none;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;background:var(--o-bg2);color:var(--o-muted)}
#orbs-root li.ready .ico{color:var(--o-ok)}
#orbs-root li.err .ico{color:var(--o-err)}
#orbs-root li.warn .ico{color:var(--o-warn)}
#orbs-root li.dim{opacity:.55}
#orbs-root .txt{flex:1;min-width:0}
#orbs-root .txt .n{font-weight:500;color:var(--o-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#orbs-root .txt .m{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--o-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#orbs-root li.err .txt .m{color:var(--o-err)}
#orbs-root li.warn .txt .m{color:var(--o-warn)}
#orbs-root .mini{height:3px;border-radius:2px;background:var(--o-line);margin-top:6px;overflow:hidden}
#orbs-root .mini i{display:block;height:100%;background:var(--o-brand);border-radius:2px}
#orbs-root .orbs{display:inline-flex;align-items:center;gap:3px;color:var(--o-text);font-weight:600}
#orbs-root .chip{flex:none;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--o-bg2);color:var(--o-muted)}
#orbs-root .tag{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;background:var(--o-hover);color:var(--o-muted)}

#orbs-root .foot{display:flex;align-items:center;gap:14px;padding:10px 12px 12px 16px;border-top:1px solid var(--o-line)}
#orbs-root .sw{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--o-muted)}
#orbs-root .sw:hover{color:var(--o-text)}
#orbs-root .sw .k{width:30px;height:18px;border-radius:9px;background:var(--o-line);position:relative;transition:background .15s}
#orbs-root .sw .k::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .18s cubic-bezier(.2,.8,.2,1);box-shadow:0 1px 2px #0004}
#orbs-root .sw[aria-checked=true] .k{background:var(--o-ok)}
#orbs-root .sw[aria-checked=true] .k::after{transform:translateX(12px)}
#orbs-root .foot .end{margin-left:auto;display:flex;align-items:center;gap:2px}
#orbs-root .lang{height:32px;min-width:32px;padding:0 6px;border-radius:8px;font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--interactive-normal,#b5bac1);transition:background .12s,color .12s}
#orbs-root .lang:hover{background:var(--o-hover);color:var(--interactive-hover,#dbdee1)}
#orbs-root .foot .ib.done{color:var(--o-ok)}

@keyframes orbs-spin{to{transform:rotate(360deg)}}
@keyframes orbs-pulse{50%{transform:scale(.88);opacity:.7}}
@keyframes orbs-ping{70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes orbs-shine{60%,100%{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){#orbs-root *,#orbs-root *::after{animation:none!important;transition:none!important}}`;
        document.head.append(style);

        /* elements */

        const NS = "http://www.w3.org/2000/svg";
        const svgEl = (tag, attrs = {}) => {
            const e = document.createElementNS(NS, tag);
            for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
            return e;
        };
        // Stroke icons in the Lucide style (24×24, 2px, round caps), drawn as paths.
        const ICONS = {
            refresh: ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"],
            pause: ["M8 5v14", "M16 5v14"],
            play: ["M7 4.5v15l12-7.5z"],
            chevron: ["m6 9 6 6 6-6"],
            video: ["M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z", "M10 9.2v5.6l4.6-2.8z"],
            game: ["M6 12h4", "M8 10v4", "M15 13h.01", "M18 11h.01", "M17.3 6H6.7a4 4 0 0 0-4 3.6C2.6 10.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4a2 2 0 0 1 1.4-.6h4.4a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-5.6-.7-6.4a4 4 0 0 0-4-3.6z"],
            activity: ["M13 2 4 14h8l-1 8 9-12h-8z"],
            check: ["M20 6 9 17l-5-5"],
            alert: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8v4.5", "M12 16h.01"],
            gift: ["M3 9h18v4H3z", "M5 13h14v8H5z", "M12 9v12", "M12 9S10.5 3.5 7.5 4.5C5 5.4 7 9 12 9zM12 9s1.5-5.5 4.5-4.5C19 5.4 17 9 12 9z"],
            download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
            copy: ["M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"]
        };
        function icon(name, size = 16) {
            const s = svgEl("svg", {
                viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
                "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
            });
            for (const d of ICONS[name]) s.append(svgEl("path", { d }));
            return s;
        }
        // The orb itself: a glossy radial gradient (unique gradient id per instance).
        let orbSeq = 0;
        function orb(size) {
            const id = `orbs-grad-${++orbSeq}`;
            const s = svgEl("svg", { viewBox: "0 0 32 32", width: size, height: size, "aria-hidden": "true" });
            const grad = svgEl("radialGradient", { id, cx: "34%", cy: "28%", r: "78%" });
            for (const [offset, color] of [["0%", "#f4efff"], ["30%", "#b49cff"], ["70%", "#6243e6"], ["100%", "#2b1a8c"]])
                grad.append(svgEl("stop", { offset, "stop-color": color }));
            const defs = svgEl("defs");
            defs.append(grad);
            s.append(defs,
                svgEl("circle", { cx: 16, cy: 16, r: 14, fill: `url(#${id})` }),
                svgEl("ellipse", { cx: 11.5, cy: 10, rx: 4.6, ry: 2.6, fill: "#fff", opacity: ".55", transform: "rotate(-32 11.5 10)" }));
            return s;
        }
        const el = (tag, cls, ...children) => {
            const e = document.createElement(tag);
            if (cls) e.className = cls;
            for (const c of children) if (c != null) e.append(c);
            return e;
        };
        const label = (node, text) => {
            node.title = text;
            node.setAttribute("aria-label", text);
        };
        const iconButton = name => el("button", "ib", icon(name, 18));
        const toggle = () => {
            const text = el("span");
            const b = el("button", "sw", el("span", "k"), text);
            b.setAttribute("role", "switch");
            b.text = text;
            return b;
        };

        const root = el("div");
        root.id = "orbs-root";

        // Minimized: the orb, a progress ring, the ready-to-claim badge and an update dot.
        const RING = 2 * Math.PI * 24;
        const ring = svgEl("svg", { class: "ring", viewBox: "0 0 52 52" });
        const ringValue = svgEl("circle", { class: "value", cx: 26, cy: 26, r: 24, "stroke-dasharray": RING, "stroke-dashoffset": RING });
        ring.append(svgEl("circle", { class: "track", cx: 26, cy: 26, r: 24 }), ringValue);
        const badge = el("span", "badge num");
        const dot = el("span", "dot");
        const pill = el("button", "pill", ring, orb(30), badge, dot);

        // Expanded card.
        const headSubText = el("span");
        const headSub = el("div", "sub", el("i"), headSubText);
        const checkBtn = iconButton("refresh");
        const pauseBtn = iconButton("pause");
        const closeBtn = iconButton("chevron");
        const who = el("div", "who", el("h2", null, "Orbs"), headSub);
        const head = el("div", "head", orb(28), who, checkBtn, pauseBtn, closeBtn);
        const hero = el("div");
        const banners = el("div");
        const list = el("div");
        const body = el("div", "body", hero, banners, list);
        const acceptSw = toggle();
        const notifySw = toggle();
        const langBtn = el("button", "lang");
        const copyBtn = iconButton("copy");
        const foot = el("div", "foot", acceptSw, notifySw, el("div", "end", langBtn, copyBtn));
        const card = el("div", "card", head, body, foot);
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-label", "Orbs");

        root.append(card, pill);
        document.body.append(root);

        // Labels that don't depend on state; re-applied when the language changes.
        let textLang = null;
        function applyTexts() {
            textLang = lang();
            label(pill, t("open"));
            label(checkBtn, t("checkNow"));
            label(closeBtn, t("minimize"));
            label(copyBtn, t("copyReport"));
            label(langBtn, t("language"));
            langBtn.textContent = textLang === "pt" ? "PT" : "EN";
            acceptSw.text.textContent = t("autoAccept");
            acceptSw.title = t("autoAcceptTip");
            notifySw.text.textContent = t("notifications");
            notifySw.title = t("notificationsTip");
            who.title = t("dragTip");
            pauseShown = null;
            heroKey = lastBannerKey = lastSignature = null;
        }

        /* position & dragging */

        // Stored as the distance from the bottom-right corner and clamped to the window. The card
        // opens toward whichever side has more room, so the panel works anywhere on screen.
        const SIZE = 52, MARGIN = 8, HOME = { right: 20, bottom: 20 };
        const pos = { ...HOME, ...prefs.get("position", {}) };
        function place(right, bottom) {
            pos.right = Math.round(Math.min(Math.max(MARGIN, right), innerWidth - SIZE - MARGIN));
            pos.bottom = Math.round(Math.min(Math.max(MARGIN, bottom), innerHeight - SIZE - MARGIN));
            root.style.right = `${pos.right}px`;
            root.style.bottom = `${pos.bottom}px`;
            const top = pos.bottom > innerHeight / 2;
            root.classList.toggle("left", pos.right > innerWidth / 2);
            root.classList.toggle("top", top);
            // Top half: the card grows down from the orb's top edge; bottom half: up from its bottom edge.
            const room = top ? pos.bottom + SIZE - MARGIN : innerHeight - pos.bottom - MARGIN;
            card.style.maxHeight = `${Math.max(240, Math.min(600, room))}px`;
            card.style.width = `${Math.min(360, innerWidth - 2 * MARGIN)}px`;
        }
        place(pos.right, pos.bottom);
        const onResize = () => place(pos.right, pos.bottom);
        window.addEventListener("resize", onResize);

        // Pointer capture keeps the drag going even when the cursor outruns the panel. A press
        // that moves less than 4px is still a click.
        let drag = null, suppressClick = false;
        function dragStart(e) {
            if (e.button !== 0 || e.target.closest(".head button")) return;
            drag = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false };
            e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        function dragMove(e) {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            drag.moved = true;
            root.classList.add("dragging");
            place(drag.right - dx, drag.bottom - dy);
        }
        function dragEnd() {
            if (!drag) return;
            suppressClick = drag.moved;
            if (drag.moved) prefs.set("position", { right: pos.right, bottom: pos.bottom });
            drag = null;
            root.classList.remove("dragging");
        }
        for (const handle of [pill, head]) {
            handle.addEventListener("pointerdown", dragStart);
            handle.addEventListener("pointermove", dragMove);
            handle.addEventListener("pointerup", dragEnd);
            handle.addEventListener("pointercancel", dragEnd);
        }
        head.addEventListener("dblclick", e => {
            if (e.target.closest("button")) return;
            place(HOME.right, HOME.bottom);
            prefs.set("position", HOME);
        });

        /* behaviour */

        // null = automatic (open on the Quests page); true/false = the user chose.
        let manualOpen = null, lastPath = location.pathname, showOther = false;
        const onQuestPage = () => /quest/i.test(location.pathname);
        const setOpen = open => { manualOpen = open; render(); };

        pill.addEventListener("click", () => {
            if (suppressClick) return void (suppressClick = false);
            setOpen(true);
        });
        closeBtn.addEventListener("click", () => setOpen(false));
        card.addEventListener("keydown", e => { if (e.key === "Escape") setOpen(false); });
        checkBtn.addEventListener("click", () => {
            window.orbs.check();
            // Restart the spin animation on every click.
            checkBtn.classList.remove("spin");
            void checkBtn.offsetWidth;
            checkBtn.classList.add("spin");
            render();
        });
        pauseBtn.addEventListener("click", () => {
            state.paused ? window.orbs.start() : window.orbs.stop();
            render();
        });
        acceptSw.addEventListener("click", () => {
            autoAccept = !autoAccept;
            prefs.set("autoAccept", autoAccept);
            if (autoAccept) wake();
            render();
        });
        notifySw.addEventListener("click", async () => {
            notifications = !notifications;
            prefs.set("notifications", notifications);
            if (notifications && typeof Notification !== "undefined" && Notification.permission === "default") {
                try { await Notification.requestPermission(); } catch { }
            }
            if (notifications) notify(t("notifyOn"), t("notifyOnBody"));
            render();
        });
        langBtn.addEventListener("click", () => {
            langPref = lang() === "pt" ? "en" : "pt";
            prefs.set("lang", langPref);
            render();
        });

        // The list is rebuilt when it changes; a delegated mousedown doesn't lose the click
        // if a button is recreated between press and release.
        body.addEventListener("mousedown", e => {
            const target = e.target.closest("[data-claim],[data-action]");
            if (!target || e.button !== 0) return;
            if (target.dataset.claim !== undefined) openQuest(target.dataset.claim || undefined);
            else if (target.dataset.action === "retry") window.orbs.check();
            else if (target.dataset.action === "other") showOther = !showOther;
            else if (target.dataset.action === "update") openReleasePage();
            else if (target.dataset.action === "report") copyReport();
            lastSignature = null;
            render();
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
        async function copyReport() {
            const report = [
                `orbs · ${new Date().toISOString()} · phase: ${state.phase}${state.error ? ` · ${state.error}` : ""}`,
                state.phase === "ready" ? window.orbs.debug() : "(quests unavailable: modules not loaded)",
                "--- log ---",
                ...history
            ].join("\n");
            let ok = true;
            try {
                if (window.DiscordNative?.clipboard?.copy) window.DiscordNative.clipboard.copy(report);
                else await navigator.clipboard.writeText(report);
            } catch {
                ok = false;
                console.log(report);
            }
            copyBtn.replaceChildren(icon(ok ? "check" : "alert", 18));
            copyBtn.classList.toggle("done", ok);
            label(copyBtn, ok ? t("copied") : t("copyFailed"));
            setTimeout(() => {
                copyBtn.replaceChildren(icon("copy", 18));
                copyBtn.classList.remove("done");
                label(copyBtn, t("copyReport"));
            }, 1800);
        }
        copyBtn.addEventListener("click", copyReport);

        /* formatting */

        const clock = s => {
            s = Math.max(0, Math.round(s));
            return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        };
        const duration = s => (s >= 60 ? `${Math.ceil(s / 60)} min` : `${Math.max(0, Math.round(s))}s`);
        const TASKS = {
            WATCH_VIDEO: ["video", "video"],
            WATCH_VIDEO_ON_MOBILE: ["video", "video"],
            PLAY_ON_DESKTOP: ["game", "game"],
            PLAY_ACTIVITY: ["activity", "activity"]
        };
        // [icon, translated label]
        const taskOf = q => {
            const [ico, key] = TASKS[pickTask(q)] ?? ["alert", "quest"];
            return [ico, t(key)];
        };
        const orbAmount = n => el("span", "orbs num", orb(12), n.toLocaleString());

        // What each quest row shows. `group` decides the section, `tone` the color.
        function classify(q, queuePos) {
            const task = pickTask(q);
            const us = statusOf(q);
            const remaining = targetOf(q, task) - progressOf(q, task);
            if (us.claimedAt) return { group: "other", tone: "dim", detail: t("claimed"), chip: t("claimedChip") };
            if (us.completedAt || done.has(q.id)) return { group: "ready", tone: "ready", detail: t("completed"), action: "claim" };
            if (isLinux && task === "PLAY_ON_DESKTOP" && !detectedGameOf(q))
                return { group: "attention", tone: "warn", detail: t("wine") };
            if (!us.enrolledAt && enrollFailed.has(q.id))
                return { group: "attention", tone: "err", detail: t("couldntAccept", { e: enrollFailed.get(q.id) }), action: "retry" };
            if (!us.enrolledAt && task && autoAccept)
                return { group: "next", detail: t("accepting", { d: duration(remaining) }) };
            if (!us.enrolledAt && task)
                return { group: "attention", tone: "warn", detail: t("notAccepted") };
            if (!task) {
                const gameOnly = !!taskConfigOf(q)?.tasks?.PLAY_ON_DESKTOP;
                return { group: "other", tone: "dim", detail: t(gameOnly ? "gameUnavailable" : "unsupported") };
            }
            if (waitingStore(q))
                return { group: "attention", tone: "warn", detail: t("reopen") };
            if (failed.has(q.id))
                return { group: "attention", tone: "err", detail: failed.get(q.id), action: "retry" };
            const pct = progressOf(q, task) / Math.max(1, targetOf(q, task));
            return { group: "next", detail: t("left", { d: duration(remaining) }), chip: queuePos ? `#${queuePos}` : null, pct };
        }

        function questItem(q, c) {
            const [ico, taskLabel] = taskOf(q);
            const name = el("div", "n", nameOf(q));
            name.title = nameOf(q);
            const orbs = orbsOf(q);
            const meta = el("div", "m", orbs ? orbAmount(orbs) : null, el("span", "tag", taskLabel), c.detail);
            meta.title = c.detail;
            const txt = el("div", "txt", name, meta);
            if (c.pct > 0) {
                const fill = el("i");
                fill.style.width = `${Math.min(100, c.pct * 100)}%`;
                txt.append(el("div", "mini", fill));
            }
            let side = null;
            if (c.action === "claim") {
                side = el("button", "btn ok", t("claim"));
                side.dataset.claim = q.id;
            } else if (c.action === "retry") {
                side = el("button", "btn ghost", t("retry"));
                side.dataset.action = "retry";
            } else if (c.chip) {
                side = el("span", "chip num", c.chip);
            }
            return el("li", c.tone, el("div", "ico", icon(c.group === "ready" ? "gift" : c.tone === "err" ? "alert" : ico, 16)), txt, side);
        }

        function section(title, items, opts = {}) {
            if (!items.length) return [];
            const heading = opts.toggle
                ? el("button", `sec${showOther ? "" : " closed"}`, icon("chevron", 14), title, el("span", "c num", String(items.length)))
                : el("div", "sec", title, el("span", "c num", String(items.length)), opts.extra ? el("span", "grow") : null, opts.extra ?? null);
            if (opts.toggle) heading.dataset.action = "other";
            return opts.toggle && !showOther ? [heading] : [heading, el("ul", null, ...items)];
        }

        /* render */

        // Nothing to draw while Discord is minimized or in the tray; render time is tracked
        // so "Copy report" shows what the panel actually costs.
        let lastSignature = null, lastBannerKey = null, heroKey = null, heroParts = null, pauseShown = null;
        const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
        function render() {
            if (document.hidden) return;
            const started = now();
            draw();
            const ms = now() - started;
            state.perf.renders++;
            state.perf.totalMs += ms;
            state.perf.maxMs = Math.max(state.perf.maxMs, ms);
        }

        function draw() {
            if (textLang !== lang()) applyTexts();
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                manualOpen = null;
            }
            const ready = state.phase === "ready";
            // On error it opens on any page, so the problem can be seen and reported.
            const open = manualOpen ?? (onQuestPage() || state.phase === "error");
            root.classList.toggle("open", open);

            const cur = ready ? state.current : null;
            const pct = cur ? Math.min(1, cur.progress / Math.max(1, cur.target)) : 0;
            const claim = ready ? claimable() : [];
            const claimOrbs = claim.reduce((sum, q) => sum + orbsOf(q), 0);

            // Minimized orb.
            pill.className = `pill${cur ? " running" : ""}${state.phase === "error" ? " error" : ""}${state.paused ? " paused" : ""}${state.phase === "loading" ? " loading" : ""}`;
            ringValue.setAttribute("stroke-dashoffset", state.phase === "error" ? 0 : RING * (1 - pct));
            badge.textContent = claim.length > 9 ? "9+" : String(claim.length);
            badge.classList.toggle("on", claim.length > 0);
            dot.classList.toggle("on", !!update);
            pill.title = [
                "Orbs",
                state.phase === "loading" ? t("tipLoading") : state.phase === "error" ? t("tipError")
                    : state.paused ? t("tipPaused") : cur ? t("tipRunning", { p: Math.floor(pct * 100) }) : t("tipIdle"),
                claim.length ? `${t("tipReady", claim.length)}${claimOrbs ? ` · ${claimOrbs.toLocaleString()} orbs` : ""}` : null,
                update ? t("tipUpdate", { v: update.latest }) : null
            ].filter(Boolean).join(" · ");
            if (!open) return;

            // Header.
            const curQuest = cur ? (QuestsStore.getQuest?.(cur.id) ?? allQuests().find(q => q.id === cur.id)) : null;
            let sub, subTone = "";
            if (state.phase === "loading") sub = t("subConnecting");
            else if (state.phase === "error") { sub = t("subError"); subTone = "err"; }
            else if (state.paused) { sub = t("subPaused"); subTone = "pause"; }
            else if (cur) { sub = t("subRunning", { p: Math.floor(pct * 100) }); subTone = "run"; }
            else sub = t("subIdle", { t: clock((state.nextCheck - Date.now()) / 1000) });
            headSub.className = `sub ${subTone}`;
            headSubText.textContent = sub;
            if (pauseShown !== state.paused) {
                pauseShown = state.paused;
                pauseBtn.replaceChildren(icon(state.paused ? "play" : "pause", 18));
                label(pauseBtn, t(state.paused ? "resume" : "pause"));
            }
            checkBtn.disabled = pauseBtn.disabled = acceptSw.disabled = !ready;
            acceptSw.setAttribute("aria-checked", String(autoAccept));
            notifySw.setAttribute("aria-checked", String(notifications));

            // Hero: the running quest, or what the script is doing. Rebuilt only when its kind
            // changes; otherwise just the bar width and texts move (keeps the animations smooth).
            if (cur && curQuest) {
                if (heroKey !== `run:${cur.id}`) {
                    heroKey = `run:${cur.id}`;
                    const [ico, taskLabel] = taskOf(curQuest);
                    const name = el("div", "name", nameOf(curQuest));
                    name.title = nameOf(curQuest);
                    const orbs = orbsOf(curQuest);
                    heroParts = { fill: el("i"), done: el("span", "num"), left: el("span", "num") };
                    hero.className = "hero";
                    hero.replaceChildren(
                        el("div", "top", el("div", "ico", icon(ico, 16)), name, orbs ? orbAmount(orbs) : el("span", "tag", taskLabel)),
                        el("div", "big", heroParts.fill),
                        el("div", "meta", heroParts.done, heroParts.left));
                }
                heroParts.fill.style.width = `${pct * 100}%`;
                heroParts.done.textContent = `${clock(cur.progress)} / ${clock(cur.target)}`;
                heroParts.left.textContent = t("left", { d: duration(cur.target - cur.progress) });
            } else {
                let kind, title, detail, act = null;
                if (state.phase === "loading") {
                    kind = "loading";
                    title = t("connecting");
                    detail = state.error ?? t("findingModules");
                } else if (state.phase === "error") {
                    kind = "error";
                    title = t("couldntStart");
                    detail = state.error;
                    act = el("button", "btn ghost act", t("copyReport"));
                    act.dataset.action = "report";
                } else if (state.paused) {
                    kind = "paused";
                    title = t("paused");
                    detail = t("pausedDetail");
                } else if (!allQuests().length) {
                    kind = "empty";
                    title = t("noQuests");
                    detail = t("noQuestsDetail");
                    act = el("button", "btn act", t("openQuests"));
                    act.dataset.claim = "";
                } else {
                    kind = "idle";
                    title = t("caughtUp");
                    detail = t("caughtUpDetail");
                }
                if (heroKey !== kind) {
                    heroKey = kind;
                    heroParts = { detail: el("div", "d num") };
                    hero.className = `hero empty${kind === "error" ? " err" : ""}`;
                    hero.replaceChildren(kind === "error" ? el("div", "ico", icon("alert", 20)) : orb(40),
                        el("div", "t", title), heroParts.detail, ...(act ? [act] : []));
                }
                heroParts.detail.textContent = detail;
            }

            // Update banner.
            const bannerKey = update?.latest ?? "";
            if (bannerKey !== lastBannerKey) {
                lastBannerKey = bannerKey;
                const items = [];
                if (update) {
                    const get = el("button", "btn", t("download"));
                    get.dataset.action = "update";
                    items.push(el("div", "banner upd", icon("download", 18),
                        el("div", "grow", el("b", null, t("update", { v: update.latest })), el("div", null, t("youHave", { v: update.current }))),
                        get));
                }
                banners.replaceChildren(...items);
            }
            drawList(ready, cur, claimOrbs);
        }

        // Sections. Rows follow the same priority the runner uses.
        function drawList(ready, cur, readyOrbs) {
            if (!ready) {
                lastSignature = null;
                return list.replaceChildren();
            }
            const quests = allQuests().filter(q => q.id !== cur?.id).sort(byPriority);
            const queue = new Map(pendingQuests().map((q, i) => [q.id, i + 1]));
            const rows = quests.map(q => [q, classify(q, queue.get(q.id))]);
            // Re-render the list only when something visible changed (avoids a layout per second).
            const signature = JSON.stringify([showOther, readyOrbs, rows.map(([q, c]) => [q.id, c.group, c.tone, c.detail, c.chip, Math.round((c.pct ?? 0) * 100)])]);
            if (signature === lastSignature) return;
            lastSignature = signature;
            const by = g => rows.filter(([, c]) => c.group === g).map(([q, c]) => questItem(q, c));
            const next = rows.filter(([, c]) => c.group === "next")
                .sort(([a], [b]) => (queue.get(a.id) ?? 1e9) - (queue.get(b.id) ?? 1e9))
                .map(([q, c]) => questItem(q, c));
            list.replaceChildren(
                ...section(t("ready"), by("ready"), { extra: readyOrbs ? orbAmount(readyOrbs) : null }),
                ...section(t("next"), next),
                ...section(t("attention"), by("attention")),
                ...section(t("other"), by("other"), { toggle: true }));
        }

        const renderTimer = setInterval(render, 1000);
        render();
        return {
            openQuests: () => openQuest(),
            destroy: () => {
                clearInterval(renderTimer);
                window.removeEventListener("resize", onResize);
                root.remove();
                style.remove();
            }
        };
    }
})();

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
            video: "Video", game: "Game", activity: "Activity", stream: "Stream", quest: "Quest",
            streamNeeded: "Go Live (any window) with someone else in the call",
            streamAlone: "You're live: someone else needs to join the call",
            play: "Play", playUnavailable: "Unavailable in this client", playing: "Playing {name}",
            playingFor: "for {d}", nextIn: "next game in {d}", notPlaying: "Not playing",
            playPick: "Add games below to start", start: "Start", stop: "Stop", switchEvery: "Switch every",
            searchGames: "Search Discord's games…", loadingGames: "Loading Discord's game list…", noResults: "No games found",
            remove: "Remove", playCount: n => `${n} game${n === 1 ? "" : "s"}`,
            playHint: "Discord counts real time while it's open. One game adds hours played; several (rotated) add games played. The profile's game badges come from these.",
            farm: "Instant", run: "Run", farmGames: "games",
            farmHours: "Hours played", farmHoursHow: "{h} h on {name}, in a few minutes", farmHoursNeedGame: "Add a game above first",
            farmVariety: "Games played", farmVarietyHow: "100 random games, 2 min each",
            farmStream: "Hours streamed", farmStreamHow: "{h} h · needs a real Go Live with a viewer",
            farmRunning: "Crediting {done} / {total}",
            farmNeedLive: "Go Live first (any window, in a voice channel)",
            farmNeedViewer: "Someone needs to watch your stream (a second account works)",
            farmHint: "Sends the sessions straight to Discord's activity data. Badges update overnight, usually within 1–3 days, and only with Privacy & Safety → \"Use data to personalize\" on.",
            farmDone: "Badge farm finished", farmDoneBody: "{n} credited. Badges update within 1–3 days.",
            claimed: "Reward claimed", claimedChip: "Claimed", completed: "Completed",
            wine: "Waiting for Discord to detect the Wine game", couldntAccept: "Couldn't accept: {e}",
            accepting: "{d} · accepting…", notAccepted: "Not accepted · turn on Auto-accept",
            gameUnavailable: "Game detection unavailable in this client", unsupported: "Unsupported quest type",
            reopen: "Reopen the Quests page so Discord starts the game",
            badges: "Badges", badgesLoading: "Loading your profile…", badgesError: "Couldn't read your profile: {e}",
            badgeOwned: "You have it", badge_quest: "Quest", badgeQuestHow: "Complete any quest · the queue does it",
            badge_hypesquad: "HypeSquad", badgeHypeHow: "Free · pick a house", joining: "Joining…",
            badge_orbs: "Orbs", badgeOrbsHow: "Bought with orbs in the Shop", shop: "Shop",
            badge_activeDev: "Active Developer", badgeDevHow: "Needs an active bot", guide: "Guide",
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
            video: "Vídeo", game: "Jogo", activity: "Atividade", stream: "Transmissão", quest: "Missão",
            streamNeeded: "Transmita (qualquer janela) com outra pessoa na call",
            streamAlone: "Você está ao vivo: outra pessoa precisa entrar na call",
            play: "Jogar", playUnavailable: "Indisponível neste cliente", playing: "Jogando {name}",
            playingFor: "há {d}", nextIn: "próximo jogo em {d}", notPlaying: "Parado",
            playPick: "Adicione jogos abaixo para começar", start: "Iniciar", stop: "Parar", switchEvery: "Trocar a cada",
            searchGames: "Buscar nos jogos do Discord…", loadingGames: "Carregando a lista de jogos do Discord…", noResults: "Nenhum jogo encontrado",
            remove: "Remover", playCount: n => `${n} jogo${n === 1 ? "" : "s"}`,
            playHint: "O Discord conta tempo real enquanto está aberto. Um jogo soma horas jogadas; vários (alternando) somam jogos jogados. As insígnias de jogo do perfil vêm disso.",
            farm: "Instantâneo", run: "Rodar", farmGames: "jogos",
            farmHours: "Horas jogadas", farmHoursHow: "{h} h em {name}, em poucos minutos", farmHoursNeedGame: "Adicione um jogo acima primeiro",
            farmVariety: "Jogos jogados", farmVarietyHow: "100 jogos aleatórios, 2 min cada",
            farmStream: "Horas transmitidas", farmStreamHow: "{h} h · precisa de uma live real com alguém assistindo",
            farmRunning: "Creditando {done} / {total}",
            farmNeedLive: "Inicie uma transmissão primeiro (qualquer janela, num canal de voz)",
            farmNeedViewer: "Alguém precisa assistir sua live (uma segunda conta serve)",
            farmHint: "Manda as sessões direto para os dados de atividade do Discord. As insígnias atualizam de madrugada, geralmente em 1 a 3 dias, e só com Privacidade e Segurança → \"Usar dados para personalizar\" ligado.",
            farmDone: "Farm de insígnias concluído", farmDoneBody: "{n} creditados. As insígnias atualizam em 1 a 3 dias.",
            claimed: "Recompensa resgatada", claimedChip: "Resgatada", completed: "Concluída",
            wine: "Esperando o Discord detectar o jogo no Wine", couldntAccept: "Não foi possível aceitar: {e}",
            accepting: "{d} · aceitando…", notAccepted: "Não aceita · ligue o Auto-aceitar",
            gameUnavailable: "Detecção de jogo indisponível neste cliente", unsupported: "Tipo de missão não suportado",
            reopen: "Reabra a página de Missões para o Discord iniciar o jogo",
            badges: "Insígnias", badgesLoading: "Carregando seu perfil…", badgesError: "Não foi possível ler seu perfil: {e}",
            badgeOwned: "Você já tem", badge_quest: "Missão", badgeQuestHow: "Complete qualquer missão · a fila faz isso",
            badge_hypesquad: "HypeSquad", badgeHypeHow: "Grátis · escolha uma casa", joining: "Entrando…",
            badge_orbs: "Orbs", badgeOrbsHow: "Comprada com orbs na Loja", shop: "Loja",
            badge_activeDev: "Desenvolvedor Ativo", badgeDevHow: "Precisa de um bot ativo", guide: "Guia",
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
    let me = null;                  // the /users/@me answer from the API probe
    const badges = { list: null, error: null, busy: false }; // profile badges, for the Badges section
    let playCleanup = null;         // removes the Play session's fake game (set once it exists)

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
            playCleanup?.();
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
            if (res?.body?.id) { api = candidate; me = res.body; break; }
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

    // Badges an account can earn on its own: Quest (any completed quest), HypeSquad (a free
    // house, the same call Settings → HypeSquad makes), Orbs (bought in the Shop) and Active
    // Developer (needs a bot app). Read from the profile, i.e. what other people see.
    async function loadBadges() {
        try {
            const res = await api.get({ url: `/users/${me.id}/profile?with_mutual_guilds=false&with_mutual_friends=false` });
            badges.list = res.body?.badges ?? [];
            badges.error = null;
        } catch (e) {
            badges.error = errMsg(e);
        }
    }
    // house: 1 Bravery, 2 Brilliance, 3 Balance.
    async function joinHypeSquad(house) {
        if (badges.busy) return;
        badges.busy = true;
        try {
            await api.post({ url: "/hypesquad/online", body: { house_id: house } });
            log(`Joined HypeSquad house ${house}.`);
            // The profile takes a moment to show the new badge.
            await sleep(1500);
            await loadBadges();
        } catch (e) {
            badges.error = errMsg(e);
            warn("HypeSquad join failed:", errMsg(e));
        } finally {
            badges.busy = false;
        }
    }
    window.orbs.badges = () => badges.list;
    loadBadges();

    // Diagnostics: `copy(orbs.debug())` in the console copies the quests' shape (no token).
    window.orbs.debug = () => JSON.stringify({
        store: QuestsStore.getName?.(),
        questsType: Object.prototype.toString.call(QuestsStore.quests),
        autoGame: isLinux && canRunGame,
        stream: canStream ? streamState() : "unsupported (ApplicationStreamingStore not found)",
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

    // Stream quests are assisted: Discord only counts them while you really Go Live with
    // someone else in the voice channel, which a script can't fake. Once that's true, the
    // script only makes Discord read the stream as the quest's game. Optional stores: without
    // them stream quests just stay unsupported.
    const streamReq = getRequire();
    const StreamStore = streamReq && store(streamReq, /^ApplicationStreamingStore$/, ["getStreamerActiveStreamMetadata", "getCurrentUserActiveStream"], false);
    const VoiceStateStore = streamReq && store(streamReq, /^VoiceStateStore$/, ["getVoiceStatesForChannel"], false);
    const canStream = isDesktop && !!StreamStore;
    // "none" (not live), "alone" (live, nobody else in the call) or "ready".
    function streamState() {
        const stream = StreamStore?.getCurrentUserActiveStream?.();
        if (!stream) return "none";
        const states = VoiceStateStore?.getVoiceStatesForChannel?.(stream.channelId);
        const people = states instanceof Map ? states.size : Object.keys(states ?? {}).length;
        return VoiceStateStore && people < 2 ? "alone" : "ready";
    }

    // Order matters: a quest offering several tasks runs the first one listed here, and
    // streaming (which needs you) comes last.
    const SUPPORTED = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE",
        ...(canRunGame ? ["PLAY_ON_DESKTOP"] : []), "PLAY_ACTIVITY", ...(canStream ? ["STREAM_ON_DESKTOP"] : [])];

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
    const waitingStore = q => ["PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP"].includes(pickTask(q)) && !storeStatus(q)?.enrolledAt;
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
        // Stream quests only join the queue while you're live with company; until then they
        // wait in "Needs attention" without holding up the rest.
        (pickTask(q) !== "STREAM_ON_DESKTOP" || streamState() === "ready") &&
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
    // Going live (or someone joining the call) can unblock a stream quest right away.
    StreamStore?.addChangeListener?.(onQuestChange);
    VoiceStateStore?.addChangeListener?.(onQuestChange);
    removeQuestListener = () => {
        QuestsStore.removeChangeListener?.(onQuestChange);
        if (isLinux && canRunGame) Dispatcher.unsubscribe?.("RUNNING_GAMES_CHANGE", onQuestChange);
        StreamStore?.removeChangeListener?.(onQuestChange);
        VoiceStateStore?.removeChangeListener?.(onQuestChange);
    };

    /* ── fake games ──────────────────────────────────────────── */

    // Every fake game process (a game quest's, the Play session's) goes through one patch of
    // RunningGameStore, so both can run at once and removing one never unpatches the other.
    // Newer builds also decide eligibility through these getters; only existing ones are patched.
    const fakeGames = new Map(); // pid -> { game, priority }; the highest priority is "the" game
    let gameOriginals = null;
    const fakeList = () => [...fakeGames.values()].sort((a, b) => b.priority - a.priority).map(f => f.game);
    const callOriginal = (key, args) => gameOriginals[key].apply(RunningGameStore, args);
    const GAME_PATCHES = {
        getRunningGames: (...a) => [...(callOriginal("getRunningGames", a) ?? []), ...fakeList()],
        getGameForPID: (pid, ...a) => fakeGames.get(pid)?.game ?? callOriginal("getGameForPID", [pid, ...a]),
        getVisibleGame: (...a) => fakeList()[0] ?? callOriginal("getVisibleGame", a),
        getVisibleRunningGames: (...a) => [...(callOriginal("getVisibleRunningGames", a) ?? []), ...fakeList()],
        getCandidateGames: (...a) => [...(callOriginal("getCandidateGames", a) ?? []), ...fakeList()],
        getRunningDiscordApplicationIds: (...a) => {
            const ids = callOriginal("getRunningDiscordApplicationIds", a);
            const extra = fakeList().map(g => g.id);
            return ids instanceof Set ? new Set([...ids, ...extra]) : [...(ids ?? []), ...extra];
        }
    };

    // app: { name, executables } as returned by /applications/public or /applications/detectable.
    function makeFakeGame(app, appId) {
        const exeName = app.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? `${app.name}.exe`;
        // Windows PIDs are always multiples of 4, so an odd one can never belong to a real
        // process: Discord's native side won't end up probing some unrelated running program.
        const pid = Math.floor(Math.random() * 15000) * 4 + 1001;
        return {
            cmdLine: `C:\\Program Files\\${app.name}\\${exeName}`,
            exeName,
            exePath: `c:/program files/${app.name.toLowerCase()}/${exeName}`,
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
    }

    function addFakeGame(game, priority = 0) {
        if (!gameOriginals) {
            gameOriginals = {};
            for (const [key, fn] of Object.entries(GAME_PATCHES)) {
                if (typeof RunningGameStore[key] !== "function") continue;
                gameOriginals[key] = RunningGameStore[key];
                RunningGameStore[key] = fn;
            }
        }
        fakeGames.set(game.pid, { game, priority });
        Dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [], added: [game], games: RunningGameStore.getRunningGames() });
    }

    function removeFakeGame(game) {
        if (!fakeGames.delete(game.pid)) return;
        if (!fakeGames.size && gameOriginals) {
            Object.assign(RunningGameStore, gameOriginals);
            gameOriginals = null;
        }
        Dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [game], added: [], games: RunningGameStore.getRunningGames() });
    }

    /* ── play session ────────────────────────────────────────── */

    // Keeps fake games "running" so Discord counts playtime (one game) or games played (several,
    // rotated): what the profile's game badges are based on. Discord counts real time, so this
    // only works while Discord is open; the session resumes by itself after a restart.
    const canPlay = canRunGame && !isLinux;
    const play = {
        games: prefs.get("play.games", []),     // [{ id, name, exeName }]
        rotateMin: prefs.get("play.rotateMin", 30),
        running: false, index: 0, since: 0, current: null, timer: null,
        catalog: null, catalogLoading: false, error: null
    };
    const playSave = () => {
        prefs.set("play.games", play.games);
        prefs.set("play.rotateMin", play.rotateMin);
        prefs.set("play.running", play.running);
    };
    function playShow(index) {
        if (play.current) removeFakeGame(play.current);
        play.index = index % play.games.length;
        const g = play.games[play.index];
        play.current = makeFakeGame({ name: g.name, executables: [{ os: "win32", name: g.exeName }] }, g.id);
        play.since = Date.now();
        addFakeGame(play.current, 0);
        log(`Play: now "${g.name}".`);
    }
    function playStart() {
        if (!canPlay || !play.games.length) return;
        play.running = true;
        playShow(play.index);
        clearInterval(play.timer);
        // With several games, rotate so each one counts as played.
        play.timer = setInterval(() => {
            if (play.games.length > 1 && Date.now() - play.since >= play.rotateMin * 60_000) playShow(play.index + 1);
        }, 30_000);
        playSave();
    }
    function playStop() {
        clearInterval(play.timer);
        play.timer = null;
        if (play.current) removeFakeGame(play.current);
        play.current = null;
        play.running = false;
        playSave();
    }
    // On destroy the game goes away but the saved "running" stays, so the next load resumes.
    playCleanup = () => {
        clearInterval(play.timer);
        if (play.current) removeFakeGame(play.current);
        farm.stopping = true;
    };
    // Discord's list of games it can detect (large: fetched once, when the search is first used).
    async function loadCatalog() {
        if (play.catalog || play.catalogLoading) return;
        play.catalogLoading = true;
        try {
            const res = await api.get({ url: "/applications/detectable" });
            play.catalog = (res.body ?? [])
                .map(a => ({ id: a.id, name: a.name, exeName: a.executables?.find(x => x.os === "win32")?.name }))
                .filter(a => a.exeName);
            play.error = null;
        } catch (e) {
            play.error = errMsg(e);
        } finally {
            play.catalogLoading = false;
        }
    }
    function playSearch(query) {
        const q = query.trim().toLowerCase();
        if (!q || !play.catalog) return [];
        const starts = a => (a.name.toLowerCase().startsWith(q) ? 0 : 1);
        return play.catalog
            .filter(a => a.name.toLowerCase().includes(q) && !play.games.some(g => g.id === a.id))
            .sort((a, b) => starts(a) - starts(b) || a.name.length - b.name.length)
            .slice(0, 6);
    }
    function playAdd(id) {
        const app = play.catalog?.find(a => a.id === id);
        if (!app || play.games.some(g => g.id === id)) return;
        play.games.push(app);
        playSave();
    }
    function playRemove(id) {
        const i = play.games.findIndex(g => g.id === id);
        if (i < 0) return;
        const wasCurrent = play.running && play.index === i;
        play.games.splice(i, 1);
        if (!play.games.length) playStop();
        else if (wasCurrent) playShow(i);
        else if (i < play.index) play.index--;
        playSave();
    }
    if (canPlay && prefs.get("play.running", false)) playStart();

    /* ── badge farm (instant) ────────────────────────────────── */

    // Idea and event formats from BadgeFarmer (github.com/aboveproof/BadgeFarmer, MIT), itself
    // built on gameSessionSpoofer and discord-streamer. Instead of playing in real time, it posts
    // the analytics events the client sends for a finished game session (or a stream heartbeat)
    // to /science, which feeds the profile's activity badges. Discord processes them overnight,
    // so badges move within 1–3 days, and only with Privacy → "Use data to personalize" on.
    const SuperProps = find(getRequire(), v => hasFns(v, ["getSuperProperties"]), ["getSuperProperties"], false);
    const FARM_CHUNK_HOURS = 24, FARM_MAX_BACKDATE = 24 * 3_600_000, FARM_DELAY_MS = 600;
    const farm = {
        mode: null,          // "hours" | "variety" | "stream" while running
        done: 0, total: 0, error: null, stopping: false,
        targetHours: prefs.get("farm.targetHours", 5000)
    };
    let analyticsToken = null, analyticsAt = 0, eventSeq = Math.floor(Math.random() * 100_000);
    const uuid = () => crypto.randomUUID();

    // Not the login token: a separate analytics token /users/@me hands out on request.
    async function getAnalyticsToken() {
        if (analyticsToken && Date.now() - analyticsAt < 12 * 3_600_000) return analyticsToken;
        const res = await api.get({ url: "/users/@me?with_analytics_token=true" });
        if (typeof res.body?.analytics_token !== "string")
            throw new Error("Discord returned no analytics token (Privacy → \"Use data to personalize\" may be off)");
        analyticsToken = res.body.analytics_token;
        analyticsAt = Date.now();
        return analyticsToken;
    }
    // The client's own session ids, so events look like they came from this client.
    function clientSession() {
        let p = {};
        try { p = SuperProps?.getSuperProperties?.() ?? {}; } catch { }
        return {
            heartbeat: p.client_heartbeat_session_id ?? uuid(),
            launch: p.launch_signature ?? uuid(),
            locale: p.system_locale ?? "en-US"
        };
    }
    function fingerprintFor(id) {
        try {
            const seen = [...(RunningGameStore.getRunningGames?.() ?? []), ...(RunningGameStore.getGamesSeen?.(true) ?? [])];
            return seen.find(g => g.id === id && g.executableFingerprint)?.executableFingerprint ?? "";
        } catch { return ""; }
    }
    const science = async events => api.post({ url: "/science", body: { token: await getAnalyticsToken(), events } });

    // One finished session: initial heartbeat, launch, final heartbeat with the duration.
    async function creditPlaytime(game, durationMs, start) {
        const { heartbeat, launch, locale } = clientSession();
        const gameSession = uuid();
        const fingerprint = fingerprintFor(game.id);
        const beat = (duration, initial, at) => ({
            type: "running_game_heartbeat",
            properties: {
                client_track_timestamp: at, client_heartbeat_session_id: heartbeat, event_sequence_number: ++eventSeq,
                game_id: game.id, game_name: game.name, game_metadata: null, game_executable: game.exeName,
                game_detection_enabled: true, initial_heartbeat: initial, final_heartbeat: !initial,
                game_session_id: gameSession, duration_tracked_ms: duration, rtc_connection_id: null,
                media_session_id: null, launch_signature: launch, client_app_state: "focused", client_send_timestamp: at
            }
        });
        const launchEvent = {
            type: "launch_game",
            properties: {
                client_track_timestamp: start, client_heartbeat_session_id: heartbeat, event_sequence_number: ++eventSeq,
                game: game.name, game_id: game.id, verified: true, elevated: false, is_launcher: false,
                game_platform: "desktop", detection_method: "verified_game", is_overlay_enabled: false,
                is_overlay_game_enabled: true, is_overlay_game_source: "OOP_DEFAULT_DATABASE", fullscreen_type: "UNKNOWN",
                hardware_display_count: 1, overlay_method: "Disabled", activity_status_enabled: true,
                activity_status_shared_guilds: [], current_user_status: "online", game_detection_enabled: true,
                executable_path: game.exeName, voice_channel_id: null, voice_channel_type: null,
                voice_channel_bitrate: null, voice_channel_guild_id: null, hidden_by_distributor: false,
                game_metadata: null, client_performance_cpu: null, client_performance_memory: null, cpu_core_count: null,
                accessibility_features: 0, rendered_locale: locale, launch_signature: launch, client_rtc_state: null,
                client_app_state: "focused", client_send_timestamp: start,
                ...(fingerprint ? { executable_fingerprint: fingerprint } : {})
            }
        };
        await science([beat(0, true, start), launchEvent, beat(durationMs, false, start + durationMs)]);
    }

    async function withRetry(action) {
        for (let attempt = 0; ; attempt++) {
            try { return await action(); } catch (e) {
                if (attempt >= 2 || farm.stopping) throw e;
                await sleep(3000);
            }
        }
    }

    // Sessions are chained backwards from now so they don't overlap (start capped at 24 h ago).
    async function farmHours(game) {
        let cursor = Date.now();
        farm.total = farm.targetHours;
        while (!farm.stopping && farm.done < farm.total) {
            const hours = Math.min(FARM_CHUNK_HOURS, farm.total - farm.done);
            const start = cursor - hours * 3_600_000;
            cursor = start;
            await withRetry(() => creditPlaytime(game, hours * 3_600_000, Math.max(start, Date.now() - FARM_MAX_BACKDATE)));
            farm.done += hours;
            await sleep(FARM_DELAY_MS);
        }
    }

    // 100 random titles from Discord's catalog, a short session each.
    async function farmVariety() {
        await loadCatalog();
        if (!play.catalog) throw new Error(play.error ?? "game list unavailable");
        const pool = [...play.catalog];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const games = pool.slice(0, 100);
        let cursor = Date.now();
        farm.total = games.length;
        for (const game of games) {
            if (farm.stopping) break;
            const start = cursor - 2 * 60_000;
            cursor = start;
            await withRetry(() => creditPlaytime(game, 2 * 60_000, Math.max(start, Date.now() - FARM_MAX_BACKDATE)));
            farm.done++;
            await sleep(FARM_DELAY_MS);
        }
    }

    // Rides your real live stream (fake streams never count): every real minute claims 10 h.
    function liveStream() {
        const stream = StreamStore?.getCurrentUserActiveStream?.();
        if (!stream?.channelId) return null;
        let viewers = 0;
        try { viewers = StreamStore.getViewerIds?.(stream)?.length ?? 0; } catch { }
        return { guildId: stream.guildId ?? "0", channelId: stream.channelId, viewers };
    }
    async function farmStream() {
        const live = liveStream();
        if (!live) throw new Error(t("farmNeedLive"));
        if (!live.viewers) throw new Error(t("farmNeedViewer"));
        const heartbeat = uuid(), launch = uuid();
        const where = { guild_id: live.guildId, channel_id: live.channelId, channel_type: 2 };
        const post = events => science(events.map(ev => ({
            type: ev.type,
            properties: {
                client_track_timestamp: Date.now(), client_send_timestamp: Date.now(),
                client_heartbeat_session_id: heartbeat, launch_signature: launch,
                event_sequence_number: ++eventSeq, client_app_state: "focused", ...where, ...ev.properties
            }
        })));
        farm.total = farm.targetHours;
        await post([{ type: "media_session_joined" }, { type: "video_stream_started" }]);
        try {
            while (!farm.stopping && farm.done < farm.total) {
                if (!liveStream()) throw new Error(t("farmNeedLive"));
                const hours = Math.min(10, farm.total - farm.done);
                await withRetry(() => post([{
                    type: "video_stream_heartbeat",
                    properties: { duration_tracked_ms: hours * 3_600_000, total_duration_ms: (farm.done + hours) * 3_600_000 }
                }]));
                farm.done += hours;
                // One claim per real minute, checking for Stop every second.
                for (let s = 0; s < 60 && !farm.stopping && farm.done < farm.total; s++) await sleep(1000);
            }
        } finally {
            await post([{ type: "video_stream_ended", properties: { duration_ms: farm.done * 3_600_000 } }]).catch(() => { });
        }
    }

    async function farmStart(mode) {
        if (farm.mode) return;
        Object.assign(farm, { mode, done: 0, total: 0, error: null, stopping: false });
        // While crediting hours, Discord also shows you playing that game.
        const game = mode === "hours" ? play.games[0] : null;
        const shown = game ? makeFakeGame({ name: game.name, executables: [{ os: "win32", name: game.exeName }] }, game.id) : null;
        if (shown) addFakeGame(shown, 0);
        log(`Badge farm: ${mode} started.`);
        try {
            if (mode === "hours") await farmHours(game);
            else if (mode === "variety") await farmVariety();
            else if (mode === "stream") await farmStream();
            const unit = mode === "variety" ? t("farmGames") : "h";
            log(`Badge farm: ${mode} done, ${farm.done} ${unit}.`);
            notify(t("farmDone"), t("farmDoneBody", { n: `${farm.done.toLocaleString()} ${unit}` }));
        } catch (e) {
            farm.error = errMsg(e);
            warn(`Badge farm (${mode}) failed:`, errMsg(e));
        } finally {
            if (shown) removeFakeGame(shown);
            farm.mode = null;
        }
    }
    const farmStop = () => { farm.stopping = true; };

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
            else if (task === "STREAM_ON_DESKTOP") await doStream(q, task, target, alive, report);
            if (alive()) {
                done.add(q.id);
                finishedSinceIdle++;
                // The first completed quest grants the Quest badge.
                loadBadges();
                log(`"${name}" completed! Claim the reward on the Quests page.`);
                const orbs = orbsOf(q);
                notify(t("nCompleted", { name }), orbs ? t("orbsReady", { n: orbs.toLocaleString() }) : t("rewardReady"));
            }
        } catch (e) {
            // The stream ended mid-quest: not a failure, it waits for the next Go Live.
            if (e.code === "STREAM_ENDED") return log(`"${name}" paused: the stream ended (progress is kept).`);
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
        // Keep Discord's native detection when a real process is already visible. The quest's
        // game outranks a Play session game, so it's the one Discord treats as being played.
        const fakeGame = nativeGame ? null : makeFakeGame(app, appId);
        if (fakeGame) addFakeGame(fakeGame, 1);

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
            if (fakeGame) removeFakeGame(fakeGame);
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

    // You stream (any window) with someone in the call; Discord then sends the quest heartbeats
    // itself, and the only thing faked is which application the stream is of.
    async function doStream(q, task, target, alive, report) {
        const appId = taskConfigOf(q).tasks[task].applications?.[0]?.id ?? q.config.application?.id;
        if (!appId) throw new Error("quest has no application id");
        // Odd PID: never a real Windows process (see doGame).
        const pid = Math.floor(Math.random() * 15000) * 4 + 1001;
        const original = StreamStore.getStreamerActiveStreamMetadata;
        StreamStore.getStreamerActiveStreamMetadata = () => ({ id: appId, pid, sourceName: null });

        let lastBeat = Date.now(), progress = progressOf(q, task), beatError = null, beatFailures = 0, resolveDone;
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
        // Same tolerance as game quests: rate limits and server errors are retried by Discord,
        // a 4xx or five failures in a row end the quest.
        const onBeatFailure = data => {
            if (data.questId !== q.id) return;
            const error = data.error ?? data;
            const status = error.status ?? error.httpStatus;
            if ((status !== 429 && status >= 400 && status < 500) || ++beatFailures >= 5) {
                beatError = errMsg(error);
                resolveDone();
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
            StreamStore.getStreamerActiveStreamMetadata = original;
            resolveDone();
        };
        state.cleanups.add(cleanup);

        log(`  streaming as "${appId}" (~${Math.ceil((target - progress) / 60)} min). Keep the stream on and someone in the call.`);
        try {
            while (alive() && progress < target) {
                if (streamState() !== "ready") {
                    const err = new Error("stream ended");
                    err.code = "STREAM_ENDED";
                    throw err;
                }
                if (beatError) throw new Error(`Discord rejected the stream heartbeat: ${beatError}`);
                if (Date.now() - lastBeat > 3 * 60_000)
                    throw new Error("Discord sent no heartbeat for 3 min: it didn't accept the stream for this quest");
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
#orbs-root li.warn .txt .m,#orbs-root li.err .txt .m{white-space:normal;flex-wrap:wrap;row-gap:2px}
#orbs-root .mini{height:3px;border-radius:2px;background:var(--o-line);margin-top:6px;overflow:hidden}
#orbs-root .mini i{display:block;height:100%;background:var(--o-brand);border-radius:2px}
#orbs-root .orbs{display:inline-flex;align-items:center;gap:3px;color:var(--o-text);font-weight:600}
#orbs-root .chip{flex:none;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--o-bg2);color:var(--o-muted)}
#orbs-root .tag{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;background:var(--o-hover);color:var(--o-muted)}
#orbs-root .ico img{width:20px;height:20px;object-fit:contain}
#orbs-root .owned{display:flex;flex-wrap:wrap;gap:6px;padding:2px 8px 8px}
#orbs-root .owned img{width:22px;height:22px;object-fit:contain}
#orbs-root .houses{display:flex;gap:6px;margin-top:6px}
#orbs-root .house{height:24px;padding:0 8px;border-radius:6px;background:var(--o-hover);font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px;transition:background .12s}
#orbs-root .house:hover:not(:disabled){background:var(--o-active)}
#orbs-root .house.on{background:var(--o-brand);color:#fff}
#orbs-root .house i{width:8px;height:8px;border-radius:50%}
#orbs-root .searchbox{padding:6px 8px 4px}
#orbs-root .search{width:100%;height:32px;padding:0 10px;border:0;border-radius:8px;background:var(--input-background,var(--background-tertiary,#1e1f22));color:var(--o-text);font:inherit;font-size:13px;outline:none}
#orbs-root .search:focus{box-shadow:0 0 0 2px var(--o-brand)}
#orbs-root .search::placeholder{color:var(--o-muted)}
#orbs-root .chips{display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:12px;color:var(--o-muted)}
#orbs-root .chips button{height:22px;padding:0 8px;border-radius:6px;background:var(--o-hover);font-size:12px;font-weight:600;color:var(--o-text)}
#orbs-root .chips button.on{background:var(--o-brand);color:#fff}
#orbs-root .hint{padding:6px 8px 10px;font-size:12px;color:var(--o-muted)}
#orbs-root li .ib{width:28px;height:28px}
#orbs-root li.live .ico{color:var(--o-ok)}

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
            stream: ["M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5z", "M8 21h8", "M12 17v4"],
            check: ["M20 6 9 17l-5-5"],
            alert: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8v4.5", "M12 16h.01"],
            gift: ["M3 9h18v4H3z", "M5 13h14v8H5z", "M12 9v12", "M12 9S10.5 3.5 7.5 4.5C5 5.4 7 9 12 9zM12 9s1.5-5.5 4.5-4.5C19 5.4 17 9 12 9z"],
            download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
            shield: ["M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"],
            code: ["m8 8-4 4 4 4", "m16 8 4 4-4 4", "m13.5 5-3 14"],
            copy: ["M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
            x: ["M18 6 6 18", "m6 6 12 12"]
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
        // The Play section lives outside `list` (which is rebuilt) so the search box keeps its
        // text and focus while typing.
        const playHead = el("button", "sec closed");
        playHead.dataset.action = "play";
        const playStatus = el("ul");
        const playGames = el("ul");
        const playRotate = el("div", "chips");
        const playInput = el("input", "search");
        playInput.type = "text";
        playInput.spellcheck = false;
        const playResults = el("ul");
        const playHint = el("div", "hint");
        const farmHead = el("div", "sec");
        const farmRows = el("ul");
        const farmHint = el("div", "hint");
        const playContent = el("div", null, playStatus, playGames, playRotate, el("div", "searchbox", playInput), playResults, playHint,
            farmHead, farmRows, farmHint);
        const playBox = el("div", null, playHead, playContent);
        const body = el("div", "body", hero, banners, list, playBox);
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
        let manualOpen = null, lastPath = location.pathname, showOther = false, showBadges = false, showPlay = false;
        let playSig = null, statusSig = null, playHeadSig = null, farmSig = null;
        playInput.addEventListener("input", () => drawPlayResults());
        // The game list is big: fetched the first time the search box is used.
        playInput.addEventListener("focus", () => { if (!play.catalog) loadCatalog().then(drawPlayResults); });
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
            else if (target.dataset.action === "badges") {
                showBadges = !showBadges;
                // Opening the section re-reads the profile, so new badges show up.
                if (showBadges) loadBadges().then(() => { lastSignature = null; render(); });
            }
            else if (target.dataset.action === "hypesquad") joinHypeSquad(Number(target.dataset.house)).then(() => { lastSignature = null; render(); });
            else if (target.dataset.action === "shop") navigate(shopPath());
            else if (target.dataset.action === "devguide") window.open("https://discord.com/developers/active-developer", "_blank");
            else if (target.dataset.action === "play") showPlay = !showPlay;
            else if (target.dataset.action === "play-start") playStart();
            else if (target.dataset.action === "play-stop") playStop();
            else if (target.dataset.action === "play-remove") playRemove(target.dataset.id);
            else if (target.dataset.action === "play-rotate") {
                play.rotateMin = Number(target.dataset.min);
                playSave();
            } else if (target.dataset.action === "farm-run") {
                farmStart(target.dataset.mode).then(() => { farmSig = null; render(); });
            } else if (target.dataset.action === "farm-stop") {
                farmStop();
            } else if (target.dataset.action === "farm-target") {
                farm.targetHours = Number(target.dataset.h);
                prefs.set("farm.targetHours", farm.targetHours);
            } else if (target.dataset.action === "play-add") {
                playAdd(target.dataset.id);
                playInput.value = "";
                drawPlayResults();
            }
            else if (target.dataset.action === "update") openReleasePage();
            else if (target.dataset.action === "report") copyReport();
            lastSignature = playSig = statusSig = playHeadSig = farmSig = null;
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
        const openQuest = id => navigate(questPath(id));
        // The Shop's route from the same table (its key changed over time), else /shop.
        function shopPath() {
            questPath();
            const key = questRoutes && ["COLLECTIBLES_SHOP", "SHOP"].find(k => k in questRoutes);
            const route = key && questRoutes[key];
            if (typeof route === "function") {
                try { return route(); } catch { }
            }
            return typeof route === "string" ? route : "/shop";
        }
        function navigate(path) {
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
            PLAY_ACTIVITY: ["activity", "activity"],
            STREAM_ON_DESKTOP: ["stream", "stream"]
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
            // Enrolled stream quests wait for you to Go Live with company (see streamState).
            if (task === "STREAM_ON_DESKTOP" && us.enrolledAt && !waitingStore(q) && !failed.has(q.id) && streamState() !== "ready")
                return { group: "attention", tone: "warn", detail: t(streamState() === "alone" ? "streamAlone" : "streamNeeded") };
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

        // opts.toggle = { open, action } makes the title a collapse button; opts.count replaces
        // the item count; opts.extra goes on the right of the title.
        function section(title, items, opts = {}) {
            if (!items.length) return [];
            const count = el("span", "c num", opts.count ?? String(items.length));
            const heading = opts.toggle
                ? el("button", `sec${opts.toggle.open ? "" : " closed"}`, icon("chevron", 14), title, count)
                : el("div", "sec", title, count, opts.extra ? el("span", "grow") : null, opts.extra ?? null);
            if (opts.toggle) heading.dataset.action = opts.toggle.action;
            return opts.toggle && !opts.toggle.open ? [heading] : [heading, el("ul", null, ...items)];
        }

        // The badges an account can earn on its own (see loadBadges), matched by profile badge id.
        const BADGES = [
            { key: "quest", icon: "gift", how: "badgeQuestHow", match: id => id === "quest_completed" },
            { key: "hypesquad", icon: "shield", how: "badgeHypeHow", match: id => id.startsWith("hypesquad_house"), action: "hypesquad" },
            { key: "orbs", icon: "orb", how: "badgeOrbsHow", match: id => /orb/i.test(id), action: "shop" },
            { key: "activeDev", icon: "code", how: "badgeDevHow", match: id => id === "active_developer", action: "devguide" }
        ];
        const HOUSES = [[1, "Bravery", "#9c84ef"], [2, "Brilliance", "#f47b67"], [3, "Balance", "#45ddc0"]];
        const badgeImg = b => {
            const img = el("img");
            img.src = `https://cdn.discordapp.com/badge-icons/${b.icon}.png`;
            img.alt = img.title = b.description ?? b.id;
            return img;
        };

        function badgeItems() {
            if (!badges.list) {
                const text = badges.error ? t("badgesError", { e: badges.error }) : t("badgesLoading");
                return [el("li", badges.error ? "err" : "dim", el("div", "ico", icon(badges.error ? "alert" : "refresh", 16)),
                    el("div", "txt", el("div", "m", text)))];
            }
            const rows = BADGES.map(def => {
                const owned = badges.list.find(b => def.match(b.id));
                const txt = el("div", "txt", el("div", "n", t(`badge_${def.key}`)),
                    el("div", "m", owned ? (owned.description ?? t("badgeOwned")) : t(def.how)));
                let side = null;
                if (owned) {
                    side = el("span", "chip", "✓");
                } else if (def.action === "hypesquad") {
                    txt.append(el("div", "houses", ...HOUSES.map(([id, name, color]) => {
                        const dotEl = el("i");
                        dotEl.style.background = color;
                        const b = el("button", "house", dotEl, badges.busy ? t("joining") : name);
                        b.dataset.action = "hypesquad";
                        b.dataset.house = id;
                        b.disabled = badges.busy;
                        return b;
                    })));
                } else if (def.action) {
                    side = el("button", "btn ghost", t(def.action === "shop" ? "shop" : "guide"));
                    side.dataset.action = def.action;
                }
                return el("li", owned ? "ready" : "", el("div", "ico", owned ? badgeImg(owned) : def.icon === "orb" ? orb(18) : icon(def.icon, 16)), txt, side);
            });
            // The profile's other badges (Nitro, Boost…) as a strip above the four rows.
            const others = badges.list.filter(b => !BADGES.some(d => d.match(b.id)));
            if (others.length) rows.unshift(el("li", "owned", ...others.map(badgeImg)));
            if (badges.error) rows.push(el("li", "err", el("div", "ico", icon("alert", 16)),
                el("div", "txt", el("div", "m", t("badgesError", { e: badges.error })))));
            return rows;
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
            drawPlay(ready);
        }

        // Long durations for the Play session ("2 h 5 min").
        const longDuration = ms => {
            const m = Math.max(0, Math.round(ms / 60000));
            const h = Math.floor(m / 60);
            return h ? `${h} h ${m % 60} min` : `${m} min`;
        };
        const textRow = (cls, text) => el("li", cls, el("div", "txt", el("div", "m", text)));

        // Each part is rebuilt only when its text changes, never the search box.
        function drawPlay(ready) {
            playBox.style.display = ready ? "" : "none";
            if (!ready) return;
            const headSig = [showPlay, play.games.length, play.running, lang()].join("|");
            if (headSig !== playHeadSig) {
                playHeadSig = headSig;
                playHead.className = `sec${showPlay ? "" : " closed"}`;
                playHead.replaceChildren(icon("chevron", 14), t("play"),
                    el("span", "c num", play.running ? "●" : t("playCount", play.games.length)));
            }
            playContent.style.display = showPlay ? "" : "none";
            if (!showPlay) return;
            if (!canPlay) {
                if (statusSig !== "unavailable") {
                    statusSig = "unavailable";
                    playStatus.replaceChildren(textRow("dim", t("playUnavailable")));
                    for (const part of [playGames, playRotate, playResults]) part.replaceChildren();
                    playInput.parentElement.style.display = playHint.style.display = "none";
                }
                return;
            }

            // Status: what's being played, for how long, and when the rotation moves on.
            const elapsed = Date.now() - play.since;
            const live = play.running && play.current;
            const name = live ? t("playing", { name: play.current.name }) : t("notPlaying");
            const meta = live
                ? [t("playingFor", { d: longDuration(elapsed) }),
                    play.games.length > 1 ? t("nextIn", { d: longDuration(play.rotateMin * 60000 - elapsed) }) : null].filter(Boolean).join(" · ")
                : play.games.length ? "" : t("playPick");
            const sSig = [name, meta, play.running, play.games.length > 0, lang()].join("|");
            if (sSig !== statusSig) {
                statusSig = sSig;
                const btn = el("button", live ? "btn ghost" : "btn", t(live ? "stop" : "start"));
                btn.dataset.action = live ? "play-stop" : "play-start";
                btn.disabled = !play.games.length;
                playStatus.replaceChildren(el("li", live ? "live" : "",
                    el("div", "ico", icon(live ? "game" : "play", 16)),
                    el("div", "txt", el("div", "n", name), meta ? el("div", "m num", meta) : null), btn));
            }

            // Chosen games, and the rotation interval when there are several.
            const gSig = JSON.stringify([play.games.map(g => g.id), play.index, play.running, play.rotateMin, lang()]);
            if (gSig !== playSig) {
                playSig = gSig;
                playGames.replaceChildren(...play.games.map((g, i) => {
                    const rm = el("button", "ib", icon("x", 16));
                    rm.dataset.action = "play-remove";
                    rm.dataset.id = g.id;
                    label(rm, t("remove"));
                    const now = play.running && i === play.index;
                    return el("li", now ? "live" : "", el("div", "ico", icon("game", 16)),
                        el("div", "txt", el("div", "n", g.name), el("div", "m", g.exeName)), rm);
                }));
                playRotate.replaceChildren(...(play.games.length > 1 ? [t("switchEvery"), ...[10, 30, 60].map(min => {
                    const b = el("button", play.rotateMin === min ? "on" : "", `${min} min`);
                    b.dataset.action = "play-rotate";
                    b.dataset.min = min;
                    return b;
                })] : []));
            }
            playInput.placeholder = t("searchGames");
            playHint.textContent = t("playHint");
            drawFarm();
        }

        // Instant: hours, games and stream hours posted straight to Discord's activity data.
        function drawFarm() {
            const live = liveStream();
            const first = play.games[0];
            const sig = JSON.stringify([farm.mode, farm.done, farm.total, farm.error, farm.targetHours, first?.id, !!live, live?.viewers, lang()]);
            if (sig === farmSig) return;
            farmSig = sig;
            farmHead.textContent = t("farm");
            farmHint.textContent = t("farmHint");

            const targets = () => el("div", "houses", ...[100, 1000, 5000].map(h => {
                const b = el("button", `house${farm.targetHours === h ? " on" : ""}`, `${h.toLocaleString()} h`);
                b.dataset.action = "farm-target";
                b.dataset.h = h;
                b.disabled = !!farm.mode;
                return b;
            }));
            const row = (mode, iconName, title, detail, ready, extra) => {
                const running = farm.mode === mode;
                const meta = running
                    ? t("farmRunning", { done: farm.done.toLocaleString(), total: `${farm.total.toLocaleString()}${mode === "variety" ? "" : " h"}` })
                    : detail;
                const btn = el("button", running ? "btn ghost" : "btn", t(running ? "stop" : "run"));
                btn.dataset.action = running ? "farm-stop" : "farm-run";
                btn.dataset.mode = mode;
                btn.disabled = !running && (!!farm.mode || !ready);
                const txt = el("div", "txt", el("div", "n", title), el("div", "m num", meta), extra);
                if (running && farm.total) {
                    const fill = el("i");
                    fill.style.width = `${Math.min(100, farm.done / farm.total * 100)}%`;
                    txt.append(el("div", "mini", fill));
                }
                return el("li", running ? "live" : !ready ? "warn" : "", el("div", "ico", icon(iconName, 16)), txt, btn);
            };
            const h = farm.targetHours.toLocaleString();
            const streamDetail = !live ? t("farmNeedLive") : !live.viewers ? t("farmNeedViewer") : t("farmStreamHow", { h });
            const rows = [
                row("hours", "game", t("farmHours"), first ? t("farmHoursHow", { h, name: first.name }) : t("farmHoursNeedGame"), !!first, targets()),
                row("variety", "activity", t("farmVariety"), t("farmVarietyHow"), true),
                row("stream", "stream", t("farmStream"), streamDetail, !!live?.viewers)
            ];
            if (farm.error && !farm.mode) rows.push(textRow("err", farm.error));
            farmRows.replaceChildren(...rows);
        }

        function drawPlayResults() {
            const query = playInput.value;
            if (!query.trim()) return playResults.replaceChildren();
            if (!play.catalog) {
                if (!play.catalogLoading && !play.error) loadCatalog().then(drawPlayResults);
                return playResults.replaceChildren(play.error
                    ? textRow("err", t("badgesError", { e: play.error }).replace(/^[^:]+/, t("noResults")))
                    : textRow("dim", t("loadingGames")));
            }
            const found = playSearch(query);
            playResults.replaceChildren(...(found.length ? found.map(app => {
                const add = el("button", "btn ghost", "+");
                add.dataset.action = "play-add";
                add.dataset.id = app.id;
                return el("li", null, el("div", "ico", icon("game", 16)),
                    el("div", "txt", el("div", "n", app.name), el("div", "m", app.exeName)), add);
            }) : [textRow("dim", t("noResults"))]));
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
            const signature = JSON.stringify([showOther, showBadges, badges.list?.map(b => b.id), badges.error, badges.busy, readyOrbs,
                rows.map(([q, c]) => [q.id, c.group, c.tone, c.detail, c.chip, Math.round((c.pct ?? 0) * 100)])]);
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
                ...section(t("other"), by("other"), { toggle: { open: showOther, action: "other" } }),
                ...section(t("badges"), badgeItems(), {
                    toggle: { open: showBadges, action: "badges" },
                    count: badges.list ? `${BADGES.filter(d => badges.list.some(b => d.match(b.id))).length}/${BADGES.length}` : ""
                }));
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

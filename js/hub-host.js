/* ============================================================
   Game Show Central — host shell
   Owns the room (RoomHost), the lobby roster (RoomProtocol.lobbyReduce),
   the lobby UI and the host game iframe. State is ONE serialisable
   object saved to localStorage; peers, connections, iframes and timers
   live in module scope and never touch it.
   Runs only on the host page: with `?room=` present, boot() returns and
   hub-player.js takes the page instead.
   ============================================================ */

"use strict";

const HubHost = (function () {
  "use strict";

  const RP = globalThis.RoomProtocol;
  const NET = globalThis.RoomNet;
  // `?store=` gives the loopback harness its own slot; production uses the bare key.
  const STORE_KEY = "gsc-hub-state-v1" + storeSuffix();
  const SOUND_KEY = "gsc-sound";

  function storeSuffix() {
    if (typeof location === "undefined") return "";
    const raw = new URLSearchParams(location.search).get("store") || "";
    const clean = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
    return clean ? ":" + clean : "";
  }
  const FRAME_READY_MS = 8000; // a game page that never says `ready` is missing
  const BEEP_HZ = 660;
  const BEEP_MS = 120;

  /* ============ Serialisable state ============ */

  let state = {
    roomCode: null, activeGame: null, locked: false, maxPlayers: RP.DEFAULT_MAX_PLAYERS,
    lobby: { players: [], nextId: 1 }, night: HubNight.createNight(),
  };

  /* ============ Module state (never serialised) ============ */

  let lobby = RP.createLobbyState();
  let host = null;
  let roomStatus = { status: "closed", code: null, error: null, broker: "ok" };
  let frame = null;
  let frameBridge = null;
  let frameReady = false;
  // Phone payloads that arrive before the game iframe posts `ready` are queued
  // and flushed after `init` instead of being dropped (D2).
  const PENDING_MAX = 50;
  let pending = [];
  // Bumped on every host-frame mount and carried in `lobby` snapshots, so phones
  // remount their game frames after a hub refresh mid-game (fresh handshake).
  let frameSession = 0;
  let frameTimer = null;
  let frameError = "";
  let gameSubtitle = "";
  let popoverOpen = false;
  let soundOn = true;
  let audioCtx = null;
  let started = false; // has the host left the landing screen?

  /* ============ DOM helpers ============ */

  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(cls, text, onClick, label) {
    const b = el("button", cls, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  function show(node, visible) {
    if (node) node.classList.toggle("hidden", !visible);
  }

  /* ============ Persistence ============ */

  function persist() {
    const data = {
      roomCode: state.roomCode, activeGame: state.activeGame,
      locked: lobby.locked, maxPlayers: lobby.maxPlayers,
      lobby: RP.serializeLobby(lobby), night: state.night,
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (err) {
      setLandingError("Couldn't save this game night — browser storage is full or blocked.");
    }
  }

  function restore() {
    let saved = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch (err) { saved = null; }
    if (!saved || typeof saved !== "object") return;
    state.roomCode = RP.isRoomCode(saved.roomCode) ? saved.roomCode : null;
    state.activeGame = HubRegistry.find(saved.activeGame) ? saved.activeGame : null;
    state.night = HubNight.restoreNight(saved.night);
    lobby = RP.restoreLobby(saved.lobby);
    lobby = RP.lobbyReduce(lobby, { type: "setMax", n: saved.maxPlayers }).state;
    lobby = RP.lobbyReduce(lobby, { type: "lock", locked: saved.locked === true }).state;
    if (state.activeGame) lobby = RP.lobbyReduce(lobby, { type: "setGame", gameId: state.activeGame }).state;
    try { soundOn = localStorage.getItem(SOUND_KEY) !== "off"; } catch (err) { soundOn = true; }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    persist();
  }

  /* ============ Room lifecycle ============ */

  // The harness (tests/hub-harness.html) installs a fake peer factory on the
  // frame BEFORE calling __gscBoot(), so the real transport runs with fake wires.
  function ensureHost() {
    if (host) return host;
    host = globalThis.RoomHost.createRoomHost({
      onEvent: onRoomEvent, onStatus: onRoomStatus,
      peerFactory: globalThis.__gscPeerFactory,
      loadPeerJs: globalThis.__gscPeerFactory ? () => Promise.resolve() : undefined,
    });
    return host;
  }

  function openRoom(code) {
    ensureHost().open(code || state.roomCode || undefined);
    render();
  }

  function closeRoom() {
    if (host) host.close();
    // Every phone is gone: flip the roster to 🔴 without losing anybody, so the
    // host can still add scores by hand and a reopened room relinks them.
    for (const peerId of Object.keys(lobby.peers)) {
      lobby = RP.lobbyReduce(lobby, { type: "leave", peerId }).state;
    }
    setState({ roomCode: null });
    persist();
    render();
  }

  function onRoomStatus(s) {
    roomStatus = s;
    if (s.status === "open" && s.code !== state.roomCode) setState({ roomCode: s.code });
    if (s.status === "open") broadcastLobby();
    render();
  }

  function onRoomEvent(ev) {
    if (ev.type === "data") return onRoomData(ev);
    if (ev.type === "close") return reduce({ type: "leave", peerId: ev.peerId });
    if (ev.type === "stale") return reduce({ type: "status", peerId: ev.peerId, connected: !ev.stale });
    return undefined;
  }

  function onRoomData(ev) {
    const msg = ev.msg;
    if (msg.t === "join") {
      const known = !!lobby.peers[ev.peerId];
      reduce({ type: "join", peerId: ev.peerId, name: msg.name, avatar: msg.avatar, pid: msg.pid });
      if (!known) beep();
      return;
    }
    if (msg.t === "game") {
      if (msg.g !== state.activeGame) {
        console.warn("Hub: dropped a phone payload for", msg.g, "while", state.activeGame, "is on");
        return;
      }
      const pid = lobby.peers[ev.peerId];
      if (!pid || !frameBridge) return;
      if (frameReady) frameBridge.postMsg(pid, msg.m);
      else { pending.push({ pid, m: msg.m }); if (pending.length > PENDING_MAX) pending.shift(); } // D2
      return;
    }
    if (msg.t === "avatar") {
      // Avatar changes are cosmetic; the roster reducer owns names only, so the
      // phone keeps its picked emoji until it rejoins. (SHOULD, not implemented.)
      console.warn("Hub: avatar change ignored (not implemented)");
    }
  }

  /* ============ Lobby reducer plumbing ============ */

  function reduce(event) {
    const out = RP.lobbyReduce(lobby, event);
    lobby = out.state;
    applyEffects(out.effects);
    persist();
    render();
  }

  function applyEffects(effects) {
    for (const eff of effects) {
      if (eff.send) { if (host) host.send(eff.send.to, eff.send.msg); }
      else if (eff.broadcastLobby) broadcastLobby();
      else if (eff.close) { if (host) host.dropConnection(eff.close, true); }
      else if (eff.frame) sendToFrame(eff.frame);
    }
  }

  // Only peers still ON the roster get the snapshot: a just-kicked phone must
  // not receive the lobby that follows its `kicked` message and bounce back
  // into the game frame it was just removed from.
  function broadcastLobby() {
    if (host) host.broadcast({ ...RP.lobbySnapshot(lobby), session: frameSession }, (peerId) => !!lobby.peers[peerId]);
  }

  function sendToFrame(msg) {
    if (!frameBridge || !frameReady) return;
    if (msg.t === "player-join") frameBridge.postPlayerJoin(msg.player);
    else if (msg.t === "player-leave") frameBridge.postPlayerLeave(msg.pid);
    else if (msg.t === "player-status") frameBridge.postPlayerStatus(msg.pid, msg.connected);
  }

  function peerFor(pid) {
    for (const peerId of Object.keys(lobby.peers)) if (lobby.peers[peerId] === pid) return peerId;
    return null;
  }

  /* ============ The game iframe ============ */

  function pickGame(id) {
    const game = HubRegistry.find(id);
    if (!game) return;
    setState({ activeGame: id });
    gameSubtitle = "";
    frameError = "";
    mountFrame(game); // sets frameSession BEFORE the lobby broadcast below
    reduce({ type: "setGame", gameId: id }); // broadcasts the lobby → phones swap
    render();
    showSplash(game);
  }

  function mountFrame(game) {
    unmountFrame();
    const slot = $("game-frame-slot");
    slot.replaceChildren();
    frame = document.createElement("iframe");
    frame.className = "game-frame";
    frame.title = game.name;
    frame.setAttribute("allow", "screen-wake-lock; autoplay");
    frame.src = HubRegistry.hostUrl(game, roomStatus.code || state.roomCode || "");
    slot.appendChild(frame);
    frameReady = false;
    pending = [];
    frameSession = Date.now();
    frameBridge = GSCBridge.attachHostFrame(frame, frameApi());
    frameTimer = setTimeout(() => {
      frameTimer = null;
      if (frameReady) return;
      frameError = `${game.name} didn't load. Is games/${game.id}/index.html on the site yet?`;
      render();
    }, FRAME_READY_MS);
  }

  function frameApi() {
    return {
      onReady() {
        frameReady = true;
        if (frameTimer) clearTimeout(frameTimer);
        frameTimer = null;
        frameError = "";
        frameBridge.postInit({ code: roomStatus.code || state.roomCode, players: RP.playerList(lobby) });
        const queued = pending;
        pending = [];
        for (const q of queued) frameBridge.postMsg(q.pid, q.m); // phone intents that beat `ready` (D2)
        render();
      },
      onSend(pid, m) {
        if (!host || RP.payloadTooBig(m)) return;
        const env = RP.gameMsg(state.activeGame, m);
        if (pid === "*") host.broadcast(env, (peerId) => !!lobby.peers[peerId]);
        else {
          const peerId = peerFor(pid);
          if (peerId) host.send(peerId, env);
        }
      },
      onClose(pid) {
        const peerId = peerFor(pid);
        if (peerId && host) host.send(peerId, { v: 2, t: "conn-close", g: state.activeGame });
      },
      onExit() { leaveGame(); },
      onScores(scores) {
        setState({ night: HubNight.recordScores(state.night, state.activeGame, scores) });
        render();
      },
      onTitle(text) {
        gameSubtitle = typeof text === "string" ? text.slice(0, 60) : "";
        renderShellBar();
      },
    };
  }

  function unmountFrame() {
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = null;
    if (frameBridge) frameBridge.detach();
    frameBridge = null;
    frameReady = false;
    pending = [];
    frame = null;
    const slot = $("game-frame-slot");
    if (slot) slot.replaceChildren();
  }

  function leaveGame() {
    unmountFrame();
    gameSubtitle = "";
    frameError = "";
    popoverOpen = false;
    setState({ activeGame: null });
    reduce({ type: "setGame", gameId: null });
  }

  function confirmLeaveGame() {
    const game = HubRegistry.find(state.activeGame);
    const name = game ? game.name : "this game";
    openDialog({
      title: `Leave ${name}?`,
      body: "Its progress is saved in this browser, so you can pick it up again tonight.",
      confirmText: "Back to lobby",
      onConfirm: leaveGame,
    });
  }

  /* ============ Dialogs (role="dialog", built node by node) ============ */

  let dialogCloser = null;

  function openDialog(opts) {
    closeDialog();
    const root = $("dialog-root");
    const back = el("div", "dialog-backdrop");
    const box = el("div", "dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", opts.title);
    box.appendChild(el("h2", "dialog-title", opts.title));
    if (opts.body) box.appendChild(el("p", "dialog-body", opts.body));
    let input = null;
    if (opts.input) {
      input = el("input", "field-input");
      input.type = "text";
      input.maxLength = RP.NAME_MAX;
      input.value = opts.inputValue || "";
      input.setAttribute("aria-label", opts.input);
      box.appendChild(input);
    }
    const err = el("p", "error-msg");
    box.appendChild(err);
    const row = el("div", "dialog-row");
    row.appendChild(button("btn btn-ghost", "Cancel", closeDialog));
    row.appendChild(button("btn btn-gold", opts.confirmText || "OK", () => {
      const value = input ? input.value : null;
      if (input && !RP.sanitizeName(value)) { err.textContent = "Enter a name."; return; }
      closeDialog();
      opts.onConfirm(value);
    }));
    box.appendChild(row);
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") row.lastChild.click(); });
    back.appendChild(box);
    root.appendChild(back);
    (input || row.lastChild).focus();
    const onKey = (e) => { if (e.key === "Escape") closeDialog(); };
    document.addEventListener("keydown", onKey);
    dialogCloser = () => { document.removeEventListener("keydown", onKey); root.replaceChildren(); };
  }

  function closeDialog() {
    if (dialogCloser) dialogCloser();
    dialogCloser = null;
  }

  /* ============ Sound ============ */

  function toggleSound() {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off"); } catch (err) { /* ignore */ }
    render();
  }

  function beep() {
    if (!soundOn) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = BEEP_HZ;
      const t = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + BEEP_MS / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + BEEP_MS / 1000 + 0.02);
    } catch (err) { console.warn("Hub: beep failed", err); }
  }

  /* ============ Splash (decoration only) ============ */

  // A 1.2 s title card between the lobby and the game, so a switch on a shared
  // screen reads like a show coming back from the break. Purely decorative: the
  // node is pointer-events:none, no message or state waits on it, and it is
  // skipped entirely when the viewer asks for reduced motion (09 §3).
  const SPLASH_MS = 1200;
  let splashTimer = null;

  function showSplash(game) {
    const node = $("gsc-splash");
    if (!node || !game) return;
    if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    $("gsc-splash-title").textContent = game.name;
    $("gsc-splash-sub").textContent = game.tagline || "";
    node.dataset.gscGame = game.id; // wears that game's accent (shared/theme.css)
    node.classList.remove("hidden");
    if (splashTimer) clearTimeout(splashTimer);
    splashTimer = setTimeout(() => { splashTimer = null; node.classList.add("hidden"); }, SPLASH_MS);
  }

  /* ============ Rendering ============ */

  function joinUrl() {
    const code = roomStatus.code || state.roomCode;
    if (!code) return "";
    return `${location.origin}${location.pathname}?room=${code}`;
  }

  function connectedCount() {
    return lobby.order.filter((pid) => lobby.players[pid].connected).length;
  }

  function render() {
    const inGame = !!state.activeGame;
    show($("screen-landing"), !started);
    show($("screen-lobby"), started && !inGame);
    show($("screen-game"), started && inGame);
    show($("shell-bar"), started && inGame);
    document.body.classList.toggle("in-game", started && inGame);
    if (!started) { renderLandingGames(); return; }
    if (inGame) { renderShellBar(); renderPopover(); return; }
    renderRoomCard();
    renderRoster();
    renderTiles();
    renderNight();
  }

  function setLandingError(text) {
    const node = $("landing-error");
    if (node) node.textContent = text;
  }

  function renderLandingGames() {
    const list = $("landing-games");
    if (!list || list.childElementCount) return;
    for (const game of HubRegistry.all()) {
      const li = el("li", "landing-game");
      li.dataset.game = game.id; // styling hook only: css/hub.css draws the game's art from it
      li.appendChild(el("span", "landing-game-icon", game.icon));
      li.appendChild(el("span", "landing-game-name", game.name));
      list.appendChild(li);
    }
  }

  function renderRoomCard() {
    const code = roomStatus.code || state.roomCode;
    $("room-code").textContent = code || "— — — —";
    $("room-join-url").textContent = code ? joinUrl() : "Phones are off — open the room to let them in.";
    $("room-status").textContent = statusLine();
    $("room-error").textContent = roomStatus.status === "error" ? (roomStatus.error || "") : "";
    renderRoomControls();
  }

  function statusLine() {
    const n = connectedCount();
    if (roomStatus.status === "connecting") return "Opening the room…";
    if (roomStatus.status === "error") return "The room is closed.";
    if (roomStatus.status !== "open") return "Room closed — the games still work without phones.";
    const broker = NET ? NET.brokerLabel(roomStatus.broker) : "";
    const base = `${n} ${n === 1 ? "phone" : "phones"} connected`;
    return broker ? `${base} · ${broker}` : base;
  }

  function renderRoomControls() {
    const row = $("room-controls");
    row.replaceChildren();
    const open = roomStatus.status === "open";
    if (open) {
      row.appendChild(button("btn btn-ghost btn-small", "Copy link", copyLink));
      row.appendChild(button("btn btn-ghost btn-small", lobby.locked ? "🔒 Locked" : "Lock lobby",
        () => reduce({ type: "lock", locked: !lobby.locked }),
        lobby.locked ? "Unlock the lobby" : "Lock the lobby against new players"));
      row.appendChild(button("btn btn-ghost btn-small", "Close room", closeRoom));
    } else if (roomStatus.status === "connecting") {
      row.appendChild(el("p", "hint-msg", "Reaching the room server…"));
    } else {
      row.appendChild(button("btn btn-gold btn-small", "Open room", () => openRoom()));
    }
    row.appendChild(button("btn btn-ghost btn-small", soundOn ? "🔊 Sound on" : "🔇 Sound off", toggleSound));
  }

  function copyLink() {
    const url = joinUrl();
    if (!url) return;
    const done = (ok) => { $("room-status").textContent = ok ? "Join link copied." : `Copy this link: ${url}`; };
    try {
      navigator.clipboard.writeText(url).then(() => done(true)).catch(() => done(false));
    } catch (err) { done(false); }
  }

  function renderRoster() {
    const list = $("roster-list");
    list.replaceChildren();
    $("roster-count").textContent = `${lobby.order.length}/${lobby.maxPlayers}`;
    if (lobby.order.length === 0) {
      list.appendChild(el("li", "roster-empty", "Nobody yet — share the code, or add players by hand."));
    }
    for (const pid of lobby.order) list.appendChild(rosterRow(lobby.players[pid]));
    $("roster-hint").textContent = lobby.locked
      ? "The lobby is locked: new players can't join, but anyone who drops can come back."
      : "";
  }

  function rosterRow(player) {
    const li = el("li", "roster-row");
    const swatch = el("span", "roster-swatch");
    swatch.style.backgroundColor = player.color;
    swatch.setAttribute("aria-hidden", "true");
    li.appendChild(swatch);
    li.appendChild(el("span", "roster-avatar", player.avatar));
    li.appendChild(el("span", "roster-name", player.name));
    const dot = el("span", "roster-dot", player.connected ? "🟢" : "🔴");
    dot.setAttribute("aria-label", player.connected ? "Connected" : "Not connected");
    li.appendChild(dot);
    if (player.manual) {
      li.appendChild(el("span", "roster-tag", "no phone"));
      li.appendChild(button("btn btn-ghost btn-small", "Rename",
        () => openDialog({
          title: `Rename ${player.name}`, input: "New name", inputValue: player.name,
          confirmText: "Rename", onConfirm: (name) => reduce({ type: "rename", pid: player.pid, name }),
        }), `Rename ${player.name}`));
      li.appendChild(button("btn btn-danger btn-small", "Remove",
        () => reduce({ type: "remove", pid: player.pid }), `Remove ${player.name}`));
    } else {
      li.appendChild(button("btn btn-danger btn-small", "Kick",
        () => reduce({ type: "kick", pid: player.pid }), `Remove ${player.name} from the room`));
    }
    return li;
  }

  function renderTiles() {
    const list = $("game-tiles");
    list.replaceChildren();
    for (const game of HubRegistry.all()) list.appendChild(gameTile(game));
    $("tile-hint").textContent = "";
  }

  function gameTile(game) {
    const li = el("li", "game-tile");
    li.dataset.game = game.id; // styling hook only: css/hub.css draws the game's art from it
    li.style.setProperty("--tile-accent", game.accent);
    const head = el("div", "tile-head");
    head.appendChild(el("span", "tile-icon", game.icon));
    head.appendChild(el("span", "tile-name", game.name));
    li.appendChild(head);
    li.appendChild(el("p", "tile-tagline", game.tagline));
    const chips = el("ul", "tile-chips");
    chips.appendChild(chip(`phones: ${game.phone.join(" · ")}`));
    chips.appendChild(chip(`${game.players[0]}–${game.players[1]} players`));
    if (game.teams) chips.appendChild(chip("teams"));
    li.appendChild(chips);
    const hint = HubRegistry.playerHint(game, lobby.order.length);
    if (hint) li.appendChild(el("p", "tile-hint", hint));
    li.appendChild(button("btn btn-gold tile-play", "Play", () => pickGame(game.id), `Play ${game.name}`));
    return li;
  }

  function chip(text) {
    return el("li", "tile-chip", text);
  }

  function renderNight() {
    const card = $("night-card");
    const rows = HubNight.totals(state.night, RP.playerList(lobby));
    show(card, rows.length > 0);
    const list = $("night-list");
    list.replaceChildren();
    for (const row of rows) {
      const li = el("li", "night-row");
      const swatch = el("span", "roster-swatch");
      if (row.color) swatch.style.backgroundColor = row.color;
      swatch.setAttribute("aria-hidden", "true");
      li.appendChild(swatch);
      li.appendChild(el("span", "night-name", row.name));
      li.appendChild(el("span", "night-total", String(row.total)));
      list.appendChild(li);
    }
  }

  /* ============ Shell bar ============ */

  function renderShellBar() {
    const game = HubRegistry.find(state.activeGame);
    // Styling hook only: the bar wears the running game's accent (shared/theme.css).
    $("shell-bar").dataset.gscGame = game ? game.id : "hub";
    $("shell-game-name").textContent = game ? `${game.icon} ${game.name}` : "";
    $("shell-game-sub").textContent = frameError || gameSubtitle;
    $("shell-game-sub").classList.toggle("shell-sub-error", !!frameError);
    const broker = NET && roomStatus.status === "open" ? NET.brokerLabel(roomStatus.broker) : "";
    $("shell-broker").textContent = broker;
    const chipNode = $("shell-chip");
    const code = roomStatus.code || state.roomCode || "—";
    const n = connectedCount();
    chipNode.textContent = `${code} · ${n} 🔔${roomStatus.broker === "ok" ? "" : " · ⚠"}`;
    chipNode.setAttribute("aria-label", `Room ${code}, ${n} connected. Show room details`);
    chipNode.setAttribute("aria-expanded", popoverOpen ? "true" : "false");
  }

  function renderPopover() {
    const pop = $("shell-popover");
    show(pop, popoverOpen);
    if (!popoverOpen) return;
    pop.replaceChildren();
    pop.appendChild(el("p", "popover-url", joinUrl() || "Room closed"));
    const list = el("ul", "roster-list");
    for (const pid of lobby.order) list.appendChild(rosterRow(lobby.players[pid]));
    if (lobby.order.length === 0) list.appendChild(el("li", "roster-empty", "No players yet."));
    pop.appendChild(list);
    const row = el("div", "room-controls");
    row.appendChild(button("btn btn-ghost btn-small", lobby.locked ? "🔒 Locked" : "Lock lobby",
      () => reduce({ type: "lock", locked: !lobby.locked })));
    if (roomStatus.status === "open") row.appendChild(button("btn btn-ghost btn-small", "Close room", closeRoom));
    else row.appendChild(button("btn btn-gold btn-small", "Open room", () => openRoom()));
    pop.appendChild(row);
  }

  function togglePopover() {
    popoverOpen = !popoverOpen;
    renderShellBar();
    renderPopover();
  }

  /* ============ Boot ============ */

  function startHosting(withPhones) {
    started = true;
    setLandingError("");
    if (withPhones) openRoom();
    if (state.activeGame) {
      const game = HubRegistry.find(state.activeGame);
      if (game) mountFrame(game);
    }
    render();
  }

  function wire() {
    $("btn-host").addEventListener("click", () => startHosting(true));
    $("btn-no-phones").addEventListener("click", () => startHosting(false));
    $("btn-add-manual").addEventListener("click", () => openDialog({
      title: "Add a player without a phone",
      body: "They'll appear on the roster so games can score them; you play their turns for them.",
      input: "Player name", confirmText: "Add",
      onConfirm: (name) => reduce({ type: "addManual", name }),
    }));
    $("btn-reset-night").addEventListener("click", () => openDialog({
      title: "Reset tonight's scoreboard?",
      body: "Every game's reported standings are cleared. The games themselves keep their own scores.",
      confirmText: "Reset", onConfirm: () => { setState({ night: HubNight.resetNight() }); render(); },
    }));
    $("shell-lobby").addEventListener("click", confirmLeaveGame);
    $("shell-chip").addEventListener("click", togglePopover);
    document.addEventListener("click", (event) => {
      if (!popoverOpen) return;
      const pop = $("shell-popover");
      const chipNode = $("shell-chip");
      if (pop.contains(event.target) || chipNode.contains(event.target)) return;
      popoverOpen = false;
      renderShellBar();
      renderPopover();
    });
  }

  function boot() {
    const params = new URLSearchParams(location.search);
    if (params.has("room")) return; // phone page — hub-player.js owns it
    // Harness mode: hand the parent a boot hook so it can install fakes first.
    if (params.has("harness") && !globalThis.__gscBooted) {
      globalThis.__gscBoot = () => { globalThis.__gscBooted = true; realBoot(); };
      return;
    }
    realBoot();
  }

  function realBoot() {
    document.body.classList.add("host-mode");
    restore();
    wire();
    // A saved room code means the host was mid-night: reopen it so phones
    // reconnect on their own (Jeopardy's reload behaviour).
    if (state.roomCode) startHosting(true);
    else render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  return {
    openRoom, closeRoom, pickGame, leaveGame,
    _state: () => state,
    _lobby: () => lobby,
    _status: () => roomStatus,
    _event: onRoomEvent,
    _start: startHosting,
    _peers: () => ({ ...lobby.peers }),
    _frameReady: () => frameReady,
  };
})();

globalThis.HubHost = HubHost;

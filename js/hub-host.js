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
  // docs/22: the latest host view from the mounted frame, and the last
  // host-phone notice ("‹name› rejoined from another device …").
  const hostView = HubHostPhone.createViewHolder();
  let hostNotice = "";
  let hostNoticeTimer = null;
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

  // Icon insertion only (docs/21 §2.5): a shared/icons.js SVG in front of a
  // button's text label. No-ops if icons.js is not on the page.
  function withIcon(node, name) {
    if (node && globalThis.GSCIcons) globalThis.GSCIcons.prepend(node, name, { size: 18 });
    return node;
  }

  /** Connection status: a CSS dot (theme-components.css .gsc-status-dot) plus
      the word for screen readers. Filled = connected, hollow ring = away. */
  function statusDot(connected) {
    const wrap = el("span", "roster-status");
    const dot = el("span", connected ? "gsc-status-dot" : "gsc-status-dot is-away");
    dot.setAttribute("aria-hidden", "true");
    wrap.appendChild(dot);
    wrap.appendChild(el("span", "visually-hidden", connected ? "Connected" : "Away"));
    return wrap;
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
      reduce({ type: "join", peerId: ev.peerId, name: msg.name, avatar: msg.avatar, pid: msg.pid, hk: msg.hk });
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
      if (RP.isHost(lobby.players[pid])) return; // docs/22: a host phone is read-only; dropped, not queued
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
      else if (eff.notice === "host-demoted") showHostNotice(eff.pid);
    }
  }

  function showHostNotice(pid) {
    const p = lobby.players[pid];
    hostNotice = `${p ? p.name : "A player"} rejoined from another device — host phone role removed.`;
    if (hostNoticeTimer) clearTimeout(hostNoticeTimer);
    hostNoticeTimer = setTimeout(() => { hostNotice = ""; hostNoticeTimer = null; render(); }, 30000);
  }

  /** Contestants only: what a game sees (docs/22 §4.2). */
  function roomInfo() {
    const hostPhones = RP.hostPhoneList(lobby);
    return {
      code: roomStatus.code || state.roomCode, players: RP.playerList(lobby),
      hostPhones, answersPrivate: hostPhones.length > 0,
    };
  }

  /** The held host view goes to every bound host phone as an h:1 game payload. */
  function deliverHostView() {
    const view = hostView.get();
    if (!host || !view || !state.activeGame) return;
    const env = { v: 2, t: "game", g: state.activeGame, m: view, h: 1 };
    for (const peerId of Object.keys(lobby.peers)) {
      if (RP.isHost(lobby.players[lobby.peers[peerId]])) host.send(peerId, env);
    }
  }

  /** Never a host phone: a game's `send` and `broadcast` reach contestants only. */
  function isContestantPeer(peerId) {
    const pid = lobby.peers[peerId];
    return !!pid && !RP.isHost(lobby.players[pid]);
  }

  // Only peers still ON the roster get the snapshot: a just-kicked phone must
  // not receive the lobby that follows its `kicked` message and bounce back
  // into the game frame it was just removed from.
  function broadcastLobby() {
    if (host) host.broadcast({ ...RP.lobbySnapshot(lobby), session: frameSession }, (peerId) => !!lobby.peers[peerId]);
  }

  function sendToFrame(msg) {
    if (msg.t === "host-phones") {
      // A host phone joined, dropped, came back or was kicked: tell the game,
      // and hand every bound host phone the held view again.
      if (frameBridge && frameReady) frameBridge.postHostPhones(RP.hostPhoneList(lobby));
      deliverHostView();
      return;
    }
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
        frameBridge.postInit(roomInfo());
        const queued = pending;
        pending = [];
        for (const q of queued) frameBridge.postMsg(q.pid, q.m); // phone intents that beat `ready` (D2)
        render();
      },
      onSend(pid, m) {
        if (!host || RP.payloadTooBig(m)) return;
        const env = RP.gameMsg(state.activeGame, m);
        if (pid === "*") host.broadcast(env, isContestantPeer);
        else {
          const peerId = peerFor(pid);
          if (peerId && isContestantPeer(peerId)) host.send(peerId, env);
        }
      },
      onHostView(m) {
        if (RP.payloadTooBig(m)) return; // the SDK already caps at 16 KB
        if (hostView.set(m)) deliverHostView();
      },
      onClose(pid) {
        if (RP.isHost(lobby.players[pid])) return;
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
    hostView.clear(); // a host view belongs to the frame that made it
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
    renderShellBar(); // drop the game accent from the bar as soon as we are back in the lobby
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

  /* ============ Dialogs + sound (bodies in js/hub-ui.js) ============ */

  const openDialog = (opts) => HubUI.openDialog(opts);

  function toggleSound() {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off"); } catch (err) { /* ignore */ }
    render();
  }

  function beep() {
    if (soundOn) HubUI.beep();
  }

  /* ============ Splash (decoration only) ============ */

  // A 1.2 s title card between the lobby and the game, so a switch on a shared
  // screen reads like a show coming back from the break. Purely decorative: the
  // node is pointer-events:none, no message or state waits on it, and it is
  // skipped entirely when the viewer asks for reduced motion (09 §3).
  const SPLASH_MS = 600; // docs/21 §2.8: a plain 600 ms title card
  let splashTimer = null;

  function showSplash(game) {
    const node = $("gsc-splash");
    if (!node || !game) return;
    if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    $("gsc-splash-title").textContent = game.name;
    $("gsc-splash-sub").textContent = "";
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

  /** Connected CONTESTANTS (host phones are counted separately). */
  function connectedCount() {
    return lobby.order.filter((pid) => lobby.players[pid].connected && !RP.isHost(lobby.players[pid])).length;
  }

  function contestantCount() {
    return lobby.order.length - RP.hostPhoneList(lobby).length;
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
      cardBody(li, game, "landing-game");
      list.appendChild(li);
    }
  }

  /** Name (Anton), one factual line, plain capability tags. Shared by the
   *  landing cards (prefix "landing-game") and the lobby tiles ("tile"). */
  function cardBody(li, game, prefix) {
    li.style.setProperty("--tile-accent", game.accent);
    li.appendChild(el("h3", `${prefix}-name`, game.name));
    li.appendChild(el("p", `${prefix}-blurb`, game.blurb || game.tagline || ""));
    const tags = el("ul", "tile-chips");
    tags.appendChild(chip(`${game.players[0]}–${game.players[1]} players`));
    if (game.teams) tags.appendChild(chip("Teams"));
    tags.appendChild(chip(`Phones: ${game.phone.join(", ")}`));
    li.appendChild(tags);
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
      row.appendChild(withIcon(button("btn btn-ghost btn-small", "Copy link", copyLink), "copy"));
      row.appendChild(withIcon(button("btn btn-ghost btn-small", lobby.locked ? "Locked" : "Lock lobby",
        () => reduce({ type: "lock", locked: !lobby.locked }),
        lobby.locked ? "Unlock the lobby" : "Lock the lobby against new players"), "lock"));
      row.appendChild(button("btn btn-ghost btn-small", "Close room", closeRoom));
    } else if (roomStatus.status === "connecting") {
      row.appendChild(el("p", "hint-msg", "Reaching the room server…"));
    } else {
      row.appendChild(button("btn btn-gold btn-small", "Open room", () => openRoom()));
    }
    row.appendChild(withIcon(button("btn btn-ghost btn-small", soundOn ? "Sound" : "Sound off", toggleSound),
      soundOn ? "sound" : "sound-off"));
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
    const hosts = RP.hostPhoneList(lobby).length;
    const n = contestantCount();
    $("roster-count").textContent = `${n} ${n === 1 ? "player" : "players"}`
      + (hosts ? ` + ${hosts} host ${hosts === 1 ? "phone" : "phones"}` : "")
      + ` · ${lobby.order.length}/${lobby.maxPlayers}`;
    if (lobby.order.length === 0) {
      list.appendChild(el("li", "roster-empty", "Nobody yet — share the code, or add players by hand."));
    }
    for (const pid of lobby.order) list.appendChild(rosterRow(lobby.players[pid]));
    $("roster-hint").textContent = hostNotice || (lobby.locked
      ? "The lobby is locked: new players can't join, but anyone who drops can come back."
      : "");
  }

  function rosterRow(player) {
    const li = el("li", "roster-row");
    const swatch = el("span", "roster-swatch");
    swatch.style.backgroundColor = player.color;
    swatch.setAttribute("aria-hidden", "true");
    li.appendChild(swatch);
    li.appendChild(el("span", "roster-avatar", player.avatar));
    li.appendChild(el("span", "roster-name", player.name));
    li.appendChild(statusDot(player.connected));
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
      if (RP.isHost(player)) li.appendChild(el("span", "roster-tag roster-tag-host", "Host phone"));
      li.appendChild(roleButton(player));
      li.appendChild(button("btn btn-danger btn-small", "Kick",
        () => reduce({ type: "kick", pid: player.pid }), `Remove ${player.name} from the room`));
    }
    return li;
  }

  /** docs/22 §3: only the laptop grants the role, and only while no game runs. */
  function roleButton(player) {
    const isHost = RP.isHost(player);
    const full = !isHost && RP.hostPhoneList(lobby).length >= RP.MAX_HOST_PHONES;
    const b = withIcon(button("btn btn-ghost btn-small roster-role", isHost ? "Make player" : "Make host phone",
      () => setRole(player.pid, isHost ? "player" : "host"),
      isHost ? `Make ${player.name} a player again` : `Make ${player.name}'s phone the host phone`), "phone");
    const away = !isHost && !player.connected;
    b.disabled = !!state.activeGame || full || away;
    if (state.activeGame) b.title = "Go to the lobby to change roles";
    else if (full) b.title = "There are already two host phones";
    else if (away) b.title = "This phone is not connected right now";
    return b;
  }

  function setRole(pid, role) {
    hostNotice = "";
    reduce({ type: "setRole", pid, role, key: role === "host" ? HubHostPhone.newKey() : undefined });
  }

  function renderTiles() {
    const list = $("game-tiles");
    list.replaceChildren();
    for (const game of HubRegistry.all()) list.appendChild(gameTile(game));
    $("tile-hint").textContent = "";
  }

  function gameTile(game) {
    const li = el("li", "game-tile");
    cardBody(li, game, "tile");
    const hint = HubRegistry.playerHint(game, contestantCount());
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
    $("shell-game-name").textContent = game ? game.name : "";
    $("shell-game-sub").textContent = frameError || gameSubtitle;
    $("shell-game-sub").classList.toggle("shell-sub-error", !!frameError);
    const broker = NET && roomStatus.status === "open" ? NET.brokerLabel(roomStatus.broker) : "";
    $("shell-broker").textContent = hostNotice || broker;
    renderHostPhoneChip();
    const chipNode = $("shell-chip");
    const code = roomStatus.code || state.roomCode || "—";
    const n = connectedCount();
    chipNode.textContent = `Room ${code} · ${n} connected${roomStatus.broker === "ok" ? "" : " · check connection"}`;
    withIcon(chipNode, "phone");
    chipNode.setAttribute("aria-label", `Room ${code}, ${n} connected. Show room details`);
    chipNode.setAttribute("aria-expanded", popoverOpen ? "true" : "false");
  }

  /** "Host phone ●" (connected) / "Host phone ○" (away): shape + word, not colour alone. */
  function renderHostPhoneChip() {
    const node = $("shell-hostphone");
    if (!node) return;
    const list = RP.hostPhoneList(lobby);
    show(node, list.length > 0);
    if (!list.length) return;
    const on = list.some((p) => p.connected);
    node.textContent = `Host phone ${on ? "●" : "○"}`;
    node.classList.toggle("is-away", !on);
    node.setAttribute("aria-label", on ? "Host phone connected" : "Host phone away");
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
    row.appendChild(withIcon(button("btn btn-ghost btn-small", lobby.locked ? "Locked" : "Lock lobby",
      () => reduce({ type: "lock", locked: !lobby.locked })), "lock"));
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
    withIcon($("shell-lobby"), "lobby");
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

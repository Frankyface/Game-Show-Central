/* ============================================================
   Game Show Central — phone shell (`index.html?room=CODE`)
   Owns THE connection to the room (RoomPlayer), the join card, the
   waiting room and the phone-side game iframe. Nothing of the host UI
   is rendered: the body gets `player-mode` and hub-host.js bows out.
   Only {code, pid, name, avatar} is stored (`gsc-phone-v1`) so a
   refresh rejoins as the same player.
   ============================================================ */

"use strict";

const HubPlayer = (function () {
  "use strict";

  const RP = globalThis.RoomProtocol;
  // One phone = one browser, so the key is normally fixed. `?store=` gives the
  // loopback harness a separate slot per fake phone in the one shared origin.
  const STORE_KEY = "gsc-phone-v1" + storeSuffix();
  const FRAME_READY_MS = 8000;

  function storeSuffix() {
    if (typeof location === "undefined") return "";
    const raw = new URLSearchParams(location.search).get("store") || "";
    const clean = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
    return clean ? ":" + clean : "";
  }

  let transport = null;
  let me = { pid: null, name: "", color: null, avatar: null };
  let code = "";
  let avatarChoice = null;
  let roster = [];
  let activeGame = null;
  let screen = "join"; // join | waiting | play
  let notice = "";
  let dismissed = false; // kicked or the room closed: ignore anything still in flight
  let lastStatus = { phase: "idle", connected: false, message: "", showTips: false, tips: [] };
  let frame = null;
  let frameBridge = null;
  let frameReady = false;
  let frameTimer = null;

  /* ============ DOM helpers ============ */

  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(node, visible) {
    if (node) node.classList.toggle("hidden", !visible);
  }

  /* ============ Storage ============ */

  function readStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) { return {}; }
  }

  function writeStore(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
    catch (err) { notice = "Couldn't remember you on this phone — storage is full or blocked."; }
  }

  function clearStore() {
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
  }

  /* ============ Joining ============ */

  function join() {
    const typed = RP.normalizeRoomCode($("join-code").value);
    const name = RP.sanitizeName($("join-name").value);
    if (!typed) { setError("Enter the 4-letter room code."); return; }
    if (!name) { setError("Enter your name."); return; }
    setError("");
    code = typed;
    connect(name, readStore().code === typed ? readStore().pid : null);
  }

  function connect(name, pid) {
    if (!transport) {
      transport = globalThis.RoomPlayer.createRoomPlayer({
        onMessage: onRoomMessage,
        onStatus: onRoomStatus,
        onRejected: onRejected,
        peerFactory: globalThis.__gscPeerFactory,
        loadPeerJs: globalThis.__gscPeerFactory ? () => Promise.resolve() : undefined,
      });
    }
    transport.connect(code, name, pid, avatarChoice || readStore().avatar);
  }

  function leave() {
    dismissed = true;
    if (transport) transport.leave();
    clearStore();
    unmountFrame();
    me = { pid: null, name: "", color: null, avatar: null };
    roster = [];
    activeGame = null;
    screen = "join";
    notice = "";
    render();
  }

  function onRejected(reason) {
    setError(GSC.rejectText(reason));
    if (reason === "name-taken" || reason === "bad-name") clearStore();
    screen = "join";
    render();
  }

  function onRoomStatus(s) {
    lastStatus = s;
    if (frameBridge && frameReady) frameBridge.postStatus(s.connected);
    render();
  }

  function onRoomMessage(msg) {
    if (msg.t === "joined") return onJoined(msg);
    if (msg.t === "lobby") return onLobby(msg);
    if (msg.t === "game") return onGamePayload(msg);
    if (msg.t === "conn-close") {
      if (frameBridge && frameReady && msg.g === activeGame) frameBridge.postConnClose();
      return undefined;
    }
    if (msg.t === "room-closed") return ended("The host closed the room.");
    if (msg.t === "kicked") return ended("The host removed you from the room.");
    return undefined;
  }

  function onJoined(msg) {
    dismissed = false;
    me = { pid: msg.pid, name: msg.name, color: msg.color, avatar: msg.avatar };
    avatarChoice = msg.avatar;
    writeStore({ code, pid: msg.pid, name: msg.name, avatar: msg.avatar });
    setError("");
    if (screen === "join") screen = "waiting";
    vibrate(30);
    render();
  }

  function onLobby(msg) {
    if (dismissed) return;
    roster = msg.players;
    const next = msg.game;
    if (next === activeGame) { render(); return; }
    activeGame = next;
    const game = next ? HubRegistry.find(next) : null;
    if (game) mountFrame(game);
    else { unmountFrame(); screen = "waiting"; }
    render();
  }

  function onGamePayload(msg) {
    if (dismissed || msg.g !== activeGame) return;
    if (frameBridge && frameReady) frameBridge.postMsg(msg.m);
  }

  function ended(text) {
    dismissed = true;
    unmountFrame();
    clearStore();
    activeGame = null;
    roster = [];
    screen = "join";
    setError(text);
    render();
  }

  /* ============ The game iframe ============ */

  function mountFrame(game) {
    unmountFrame();
    screen = "play";
    const slot = $("phone-frame-slot");
    slot.replaceChildren();
    frame = document.createElement("iframe");
    frame.className = "phone-frame";
    frame.title = game.name;
    frame.setAttribute("allow", "screen-wake-lock");
    frame.src = HubRegistry.playerUrl(game, code, me.pid, me.name);
    slot.appendChild(frame);
    frameReady = false;
    frameBridge = GSCBridge.attachPlayerFrame(frame, {
      onReady() {
        frameReady = true;
        if (frameTimer) clearTimeout(frameTimer);
        frameTimer = null;
        notice = "";
        frameBridge.postInit(
          { pid: me.pid, name: me.name, color: me.color, avatar: me.avatar },
          { code },
        );
        frameBridge.postStatus(lastStatus.connected);
        render();
      },
      onSend(m) {
        if (!transport || RP.payloadTooBig(m)) return;
        transport.send(RP.gameMsg(activeGame, m));
      },
    });
    frameTimer = setTimeout(() => {
      frameTimer = null;
      if (frameReady) return;
      notice = `${game.name} didn't load on this phone. Ask the host to pick it again.`;
      render();
    }, FRAME_READY_MS);
  }

  function unmountFrame() {
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = null;
    if (frameBridge) frameBridge.detach();
    frameBridge = null;
    frameReady = false;
    frame = null;
    const slot = $("phone-frame-slot");
    if (slot) slot.replaceChildren();
  }

  /* ============ Rendering ============ */

  function setError(text) {
    const node = $("join-error");
    if (node) node.textContent = text || "";
  }

  function render() {
    show($("screen-join"), screen === "join");
    show($("screen-waiting"), screen === "waiting");
    show($("screen-play"), screen === "play");
    if (screen === "join") renderJoin();
    else if (screen === "waiting") renderWaiting();
    else renderPlay();
  }

  function renderJoin() {
    const btn = $("btn-join");
    const connecting = lastStatus.phase === "connecting";
    btn.disabled = connecting;
    btn.textContent = connecting ? lastStatus.attemptLabel : "Join";
    const note = $("join-note");
    note.textContent = lastStatus.inAppBrowser
      ? `Opened inside the ${lastStatus.inAppBrowser} app? Rooms may not connect — tap ⋯ and “Open in Safari/Chrome”.`
      : notice;
    if (lastStatus.phase === "failed" && lastStatus.message && !$("join-error").textContent) {
      setError(lastStatus.message);
    }
    renderTips();
  }

  function renderTips() {
    const box = $("join-tips");
    show(box, !!lastStatus.showTips);
    if (!lastStatus.showTips || box.childElementCount) return;
    box.appendChild(el("p", "join-tips-title", "Still can't connect? Try:"));
    const ul = el("ul", "join-tips-list");
    for (const tip of lastStatus.tips) ul.appendChild(el("li", null, tip));
    box.appendChild(ul);
  }

  function renderWaiting() {
    $("wait-avatar").textContent = me.avatar || "";
    $("wait-avatar").style.color = me.color || "";
    $("wait-title").textContent = `You're in, ${me.name}!`;
    const list = $("wait-roster");
    list.replaceChildren();
    for (const p of roster) {
      const li = el("li", "wait-row");
      const swatch = el("span", "roster-swatch");
      swatch.style.backgroundColor = p.color;
      swatch.setAttribute("aria-hidden", "true");
      li.appendChild(swatch);
      li.appendChild(el("span", "roster-avatar", p.avatar));
      li.appendChild(el("span", "roster-name", p.name + (p.pid === me.pid ? " (you)" : "")));
      li.appendChild(el("span", "roster-dot", p.connected ? "🟢" : "🔴"));
      list.appendChild(li);
    }
    $("wait-status").textContent = lastStatus.connected ? "" : "Reconnecting…";
  }

  function renderPlay() {
    const health = $("phone-health");
    health.classList.toggle("down", !lastStatus.connected);
    const banner = $("phone-banner");
    const down = !lastStatus.connected;
    show(banner, down || !!notice);
    banner.textContent = down ? "Reconnecting…" : notice;
  }

  function vibrate(ms) {
    try { if (navigator && typeof navigator.vibrate === "function") navigator.vibrate(ms); }
    catch (err) { /* best effort */ }
  }

  /* ============ Avatar picker ============ */

  function buildAvatars() {
    const box = $("join-avatars");
    box.replaceChildren();
    const stored = readStore().avatar;
    avatarChoice = RP.sanitizeAvatar(stored) || RP.AVATARS[Math.floor(Math.random() * RP.AVATARS.length)];
    for (const emoji of RP.AVATARS) {
      const b = el("button", "avatar-btn", emoji);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", `Avatar ${emoji}`);
      b.addEventListener("click", () => { avatarChoice = emoji; markAvatars(); });
      box.appendChild(b);
    }
    markAvatars();
  }

  function markAvatars() {
    const box = $("join-avatars");
    for (const b of Array.from(box.children)) {
      const on = b.textContent === avatarChoice;
      b.classList.toggle("chosen", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  /* ============ Boot ============ */

  function wire() {
    $("btn-join").addEventListener("click", join);
    $("join-name").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
    $("join-code").addEventListener("input", () => {
      const field = $("join-code");
      field.value = field.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4);
    });
    $("btn-leave").addEventListener("click", leave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && transport) transport.probe();
    });
  }

  function realBoot() {
    document.body.classList.add("player-mode");
    const params = new URLSearchParams(location.search);
    code = RP.normalizeRoomCode(params.get("room"));
    const saved = readStore();
    $("join-code").value = code || "";
    $("join-name").value = saved.name || "";
    buildAvatars();
    wire();
    render();
    // A stored session for this code rejoins on its own (spec §2.2).
    if (code && saved.code === code && saved.name) connect(saved.name, saved.pid);
  }

  function boot() {
    const params = new URLSearchParams(location.search);
    if (!params.has("room")) return; // host page
    if (params.has("harness") && !globalThis.__gscBooted) {
      globalThis.__gscBoot = () => { globalThis.__gscBooted = true; realBoot(); };
      return;
    }
    realBoot();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  return {
    join, leave,
    _me: () => ({ ...me }),
    _roster: () => roster.slice(),
    _screen: () => screen,
    _game: () => activeGame,
    _status: () => lastStatus,
    _frameReady: () => frameReady,
  };
})();

globalThis.HubPlayer = HubPlayer;

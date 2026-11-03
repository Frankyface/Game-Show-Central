/* ============================================================
   Press Your Luck — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the travelling
   light and the sound cues. All game rules live in pyl-core.js;
   this file only dispatches events into the reducer and asks
   pyl-view.js to paint the result. Every string reaches the page
   through textContent, and no Peer/DOM/timer handle is ever
   stored in the state.

   The one piece of choreography that lives here: a spin. The
   core resolves the square the instant STOP is pressed, then the
   screens are frozen on the state as it stood BEFORE the press
   until the travelling light actually arrives (`app.spin`).
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run cannot leave harness
 * boards (or a half-played game) in the real host's save on the same origin.
 * Anything but letters, digits and hyphens is stripped.
 */
function pylStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const PYL_STORAGE_KEY = `gsc-pyl-state-v1${pylStoreSuffix()}`;
const PYL_DEFAULT_NAMES = ["Player 1", "Player 2", "Player 3", "Player 4"];

let pylApp = pylFreshApp();
const pylListeners = [];

function pylFreshApp() {
  return {
    core: null,
    resumable: null,
    game: null,
    setup: { count: 3, names: PYL_DEFAULT_NAMES.slice(), assign: {}, settings: pylSettingsFor(null) },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    players: [],
    editorOpen: false,
    lobbyOpen: false,
    spin: null,
  };
}

/** Replace part of the app state, persist, repaint. */
function pylSet(patch) {
  pylApp = Object.assign({}, pylApp, patch);
  pylSave();
  pylRender();
}

function pylRender() {
  window.PylView.render(pylApp);
  pylDriveLight();
  pylListeners.forEach((fn) => {
    try { fn(pylApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** The idle light runs only while a spinner is actually waiting to press STOP. */
function pylDriveLight() {
  const state = pylApp.core;
  const board = state && state.phase === "board" && !pylApp.editorOpen && !pylApp.lobbyOpen;
  if (pylApp.spin) return;                     // a spin owns the light until it lands
  if (board && window.PylCore.canStop(state)) window.PylBoard.idle();
  else window.PylBoard.halt();
}

/* ============ Dispatch + cues ============ */

const PYL_CUES = { arm: "arm", buzz: "buzz", nextRound: "round", nextQuestion: "arm" };

function pylCue(event, before, after) {
  if (event.type === "judgeBuzz") { window.PylSound.play(event.correct ? "right" : "wrong"); return; }
  if (after.phase === "result") { window.PylSound.play("win"); return; }
  if (before.phase === "board" && after.phase === "roundDone") { window.PylSound.play("round"); return; }
  if (event.type === "revealPicks") {
    const gained = after.spins.some((n, i) => n > before.spins[i]);
    window.PylSound.play(gained ? "right" : "wrong");
    return;
  }
  const cue = Object.prototype.hasOwnProperty.call(PYL_CUES, event.type) ? PYL_CUES[event.type] : null;
  if (cue) window.PylSound.play(cue);
}

/** Send an event to the pure core, with the matching sound cue. */
function pylDispatch(event) {
  const state = pylApp.core;
  if (!state) return;
  if (event.type === "stop") { pylSpin(); return; }
  const next = window.PylCore.reduce(state, event, Math.random);
  if (next === state) return;
  pylCue(event, state, next);
  pylSet({ core: next, spin: null });
}

/* ============ A spin ============ */

/**
 * STOP. The core picks the square from `Math.random` right here; the light is
 * then walked to that exact index. Nothing about the result reaches the screen
 * (or a phone — pyl-room.js reads `app.spin` too) until it lands.
 */
function pylSpin() {
  const state = pylApp.core;
  if (!state || pylApp.spin || !window.PylCore.canStop(state)) return;
  const next = window.PylCore.reduce(state, { type: "stop" }, Math.random);
  if (next === state || !next.landing) return;
  pylSet({ core: next, spin: { frozen: state, landing: next.landing } });
  window.PylBoard.stopAt(next.landing.index, {
    onTick: () => window.PylSound.play("tick"),
    onDone: pylLand,
  });
}

/** The light has arrived: unfreeze the screens and play what was under it. */
function pylLand() {
  const spin = pylApp.spin;
  if (!spin) return;
  pylSet({ spin: null });
  const landing = spin.landing;
  if (landing.whammy) window.PylSound.play(landing.eliminated ? "outCue" : "whammy");
  else window.PylSound.play(landing.extraSpin ? "bonus" : "cash");
}

/* ============ Persistence ============ */

/** What goes to localStorage. `spin` is deliberately left out: a reload lands
    on the settled state rather than resuming an animation nobody can see. */
function pylSerialise() {
  return {
    core: pylApp.core, resumable: pylApp.resumable, game: pylApp.game,
    setup: pylApp.setup, source: pylApp.source, sourceKind: pylApp.sourceKind,
    sourceUrl: pylApp.sourceUrl, roomCode: pylApp.roomCode,
  };
}

function pylSave() {
  try {
    localStorage.setItem(PYL_STORAGE_KEY, JSON.stringify(pylSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    pylError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
const PYL_CORE_ARRAYS = ["players", "spins", "passed", "totals", "whammies", "out", "faces", "order", "history"];

/** Is this a state the reducer can safely be handed? A hand-edited or
    half-written save is REJECTED here rather than discovered by a handler
    dereferencing a missing field. */
function pylUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.PylCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object") return false;
  if (PYL_CORE_ARRAYS.some((k) => !Array.isArray(state[k]))) return false;
  const n = state.players.length;
  if (n < window.PylCore.MIN_PLAYERS || n > window.PylCore.MAX_PLAYERS) return false;
  if (["spins", "passed", "totals", "whammies", "out"].some((k) => state[k].length !== n)) return false;
  if (!Number.isInteger(state.round) || !Number.isInteger(state.qIndex)) return false;
  if (state.control !== null && !Number.isInteger(state.control)) return false;
  if (!state.q || typeof state.q !== "object") return false;
  if (state.faces.length !== window.PylCore.SQUARES) return false;
  try { window.PylCore.validateGame(state.game); } catch (err) { return false; }
  return true;
}

function pylLoadSaved() {
  try {
    const raw = localStorage.getItem(PYL_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.game) window.PylCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (saved.core !== null && saved.core !== undefined && !pylUsableCore(saved.core)) {
      console.warn("Ignoring a saved game with a damaged state object.");
      saved.core = null;
    }
    if (saved.resumable && !pylUsableCore(saved.resumable)) saved.resumable = null;
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

function pylError(message) {
  const node = $("pyl-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let pylLoadMessage = "";   // survives the pylSet() in pylBoot, which clears the banner

async function pylFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.PylCore.validateGame(game);
  return { game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function pylLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await pylFetchGame(url, `Custom board from ${url}`, "fetch");
    } catch (err) {
      const why = String(err.message || "").replace(/\.\s*$/, "");
      pylLoadMessage = `Could not load a board from ${url}: ${why}. Using the built-in board instead.`;
    }
  }
  try {
    return await pylFetchGame("board.json", "Built-in board (board.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = globalThis.PYL_DEFAULT_GAME;
    if (!offline) {
      pylLoadMessage = "No board could be loaded at all — open the editor and build one.";
      return { game: null, source: "No board loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in board (offline copy)", kind: "default", url: null };
  }
}

/** The settings the host is actually playing with: the file, plus their edits. */
function pylSettingsFor(game) {
  const base = game ? game.settings : window.PylCore.DEFAULT_SETTINGS;
  return {
    currency: base.currency,
    questionsPerRound: base.questionsPerRound,
    buzzSpins: base.buzzSpins,
    pickSpins: base.pickSpins,
    whammyLimit: base.whammyLimit,
    rounds: base.rounds,
    rotate: base.rotate,
  };
}

/** Adopt a validated game — from the editor, the library, a file, or a URL. */
function pylUseGame(game, source, kind) {
  const clean = window.PylCore.normalizeGame(game);
  // sourceUrl is cleared: this content no longer came from the ?game= link, so
  // a reload of that link must fetch it again rather than resurrect this copy.
  pylSet({
    game: clean, source: source || "Custom board", sourceKind: kind || "upload",
    sourceUrl: null, core: null, resumable: null, spin: null,
    setup: Object.assign({}, pylApp.setup, { settings: pylSettingsFor(clean) }),
  });
  pylError("");
}

function pylOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      pylUseGame(JSON.parse(String(reader.result)), `Custom board from ${file.name}`, "upload");
    } catch (err) {
      pylError(`That file is not a usable Press Your Luck board: ${err.message}`);
    }
  };
  reader.onerror = () => pylError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ The question-set library (cross-cutting 19 §2) ============ */

function pylMountLibrary() {
  const box = $("pyl-library");
  if (!box) return;
  const lib = window.GSCLibrary;
  if (!lib || typeof lib.mountPicker !== "function") {
    setText("pyl-library-note",
      "The set library needs shared/library.js, which isn’t loaded here. Use “Load a board file (.json)” instead.");
    return;
  }
  try {
    lib.mountPicker(box, {
      gameDir: ".",
      validate: (json) => window.PylCore.validateGame(json),
      onPick: (json, meta) => {
        const name = meta && meta.name ? meta.name : "library set";
        pylUseGame(json, `set: ${name}`, "library");
      },
    });
  } catch (err) {
    console.warn("The set picker could not be mounted:", err);
    setText("pyl-library-note", `The set library is unavailable: ${err.message}`);
  }
}

/* ============ Setup screen ============ */

function pylSetSetup(patch) {
  pylSet({ setup: Object.assign({}, pylApp.setup, patch) });
}

function pylSetSettings(patch) {
  pylSetSetup({ settings: Object.assign({}, pylApp.setup.settings, patch) });
}

/** Put a phone in a seat (or take it out with `null`). One phone, one seat. */
function pylAssign(pid, seat) {
  const assign = {};
  Object.keys(pylApp.setup.assign).forEach((key) => {
    if (key !== pid && pylApp.setup.assign[key] !== seat) assign[key] = pylApp.setup.assign[key];
  });
  const names = pylApp.setup.names.slice();
  if (seat !== null && seat !== undefined) {
    assign[pid] = seat;
    const player = pylApp.players.find((p) => p.pid === pid);
    // A seat still wearing its placeholder takes the phone's own name.
    if (player && names[seat] === PYL_DEFAULT_NAMES[seat]) names[seat] = player.name;
  }
  pylSetSetup({ assign, names });
}

function pylSetPlayers(players) {
  const list = Array.isArray(players) ? players : [];
  if (JSON.stringify(list) === JSON.stringify(pylApp.players)) return;
  pylSet({ players: list });
}

function pylSeatRoster() {
  const seats = [];
  for (let seat = 0; seat < pylApp.setup.count; seat += 1) {
    const pid = Object.keys(pylApp.setup.assign).find((key) => pylApp.setup.assign[key] === seat) || null;
    seats.push({ name: pylApp.setup.names[seat], pid });
  }
  return seats;
}

function pylStart() {
  try {
    if (!pylApp.game) throw new Error("The board is still loading — try again in a second.");
    const game = Object.assign({}, pylApp.game, { settings: pylApp.setup.settings });
    const state = window.PylCore.createState(game, pylSeatRoster(), undefined, Math.random);
    pylSet({
      core: window.PylCore.reduce(state, { type: "start" }, Math.random),
      resumable: null, spin: null,
    });
    pylError("");
  } catch (err) {
    pylError(err.message);
  }
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone seats would
 * otherwise be inherited by whoever is issued that pid next. A DIFFERENT room
 * code drops every phone seat and any game that depended on one; the same code
 * (a plain refresh) changes nothing.
 */
function pylBindRoom(code) {
  if (typeof code !== "string" || !code || pylApp.roomCode === code) return;
  if (pylApp.roomCode === null) { pylSet({ roomCode: code }); return; }
  const hadPhones = Object.keys(pylApp.setup.assign).length > 0;
  const dropped = hadPhones && !!(pylApp.core || pylApp.resumable);
  pylSet({
    roomCode: code,
    core: hadPhones ? null : pylApp.core,
    resumable: hadPhones ? null : pylApp.resumable,
    spin: null,
    setup: Object.assign({}, pylApp.setup, { assign: {} }),
  });
  if (dropped) {
    pylError("This is a new room, so the game in progress was cleared — the phone seats belonged to the old one.");
  }
}

/* ============ Game lobby (cross-cutting 19 §1) ============ */

function pylLobbyKeep() {
  window.PylBoard.halt();
  pylSet({ lobbyOpen: false, resumable: pylApp.core, core: null, spin: null });
}

function pylLobbyRestart() {
  window.PylBoard.halt();
  pylSet({ lobbyOpen: false, resumable: null, core: null, spin: null });
}

function pylResume() {
  if (!pylApp.resumable) return;
  pylSet({ core: pylApp.resumable, resumable: null, spin: null });
}

/* ============ Hotkeys ============ */

function pylIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

const PYL_QUESTION_KEYS = {
  a: () => pylDispatch({ type: "arm", on: !pylApp.core.q.armed }),
  y: () => pylDispatch({ type: "judgeBuzz", correct: true }),
  n: () => pylDispatch({ type: "judgeBuzz", correct: false }),
  r: () => pylDispatch({ type: "revealPicks" }),
  u: () => pylDispatch({ type: "undo" }),
  enter: () => pylDispatch({ type: pylApp.core.q.revealed && pylNextIsBoard() ? "toBoard" : "nextQuestion" }),
  1: () => pylDispatch({ type: "buzz", seat: 0 }),
  2: () => pylDispatch({ type: "buzz", seat: 1 }),
  3: () => pylDispatch({ type: "buzz", seat: 2 }),
  4: () => pylDispatch({ type: "buzz", seat: 3 }),
};

function pylNextIsBoard() {
  return window.PylCore.legalActions(pylApp.core).indexOf("toBoard") >= 0;
}

const PYL_BOARD_KEYS = {
  " ": () => pylSpin(),
  n: () => pylDispatch({ type: "nextSpinner" }),
  u: () => pylDispatch({ type: "undo" }),
};

const PYL_ROUND_KEYS = {
  enter: () => pylDispatch({ type: "nextRound" }),
  u: () => pylDispatch({ type: "undo" }),
};

const PYL_KEYMAPS = { question: PYL_QUESTION_KEYS, board: PYL_BOARD_KEYS, roundDone: PYL_ROUND_KEYS };

function pylOnKey(event) {
  if (pylIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (pylApp.editorOpen || pylApp.lobbyOpen) return;
  const state = pylApp.core;
  if (!state) return;
  const map = Object.prototype.hasOwnProperty.call(PYL_KEYMAPS, state.phase) ? PYL_KEYMAPS[state.phase] : null;
  if (!map) return;
  const key = event.key === "Enter" ? "enter" : (event.key === " " ? " " : String(event.key).toLowerCase());
  if (event.target && event.target.tagName === "BUTTON" && key !== " ") return;
  if (!Object.prototype.hasOwnProperty.call(map, key)) return;
  event.preventDefault();
  map[key]();
}

/* ============ Wiring ============ */

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function pylWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function pylWireSetup() {
  $("pyl-seat-count").addEventListener("change", (e) => {
    const count = Math.max(2, Math.min(4, Number(e.target.value) || 3));
    const assign = {};
    Object.keys(pylApp.setup.assign).forEach((pid) => {
      if (pylApp.setup.assign[pid] < count) assign[pid] = pylApp.setup.assign[pid];
    });
    pylSetSetup({ count, assign });
  });
  [0, 1, 2, 3].forEach((seat) => {
    $(`pyl-seat-${seat}`).addEventListener("input", (e) => {
      const names = pylApp.setup.names.slice();
      names[seat] = e.target.value.slice(0, window.PylCore.NAME_MAX);
      pylSetSetup({ names });
    });
  });
  $("pyl-roster").addEventListener("click", (event) => {
    const btn = event.target.closest ? event.target.closest(".seat-pick") : null;
    if (!btn) return;
    pylAssign(btn.dataset.pid, btn.dataset.seat === "none" ? null : Number(btn.dataset.seat));
  });
  const number = (id, key, lo, hi) => $(id).addEventListener("input", (e) => {
    const n = Math.round(Number(e.target.value));
    if (Number.isFinite(n) && n >= lo && n <= hi) pylSetSettings({ [key]: n });
  });
  number("pyl-set-qpr", "questionsPerRound", 1, 12);
  number("pyl-set-rounds", "rounds", 1, 6);
  number("pyl-set-buzz", "buzzSpins", 0, 10);
  number("pyl-set-pick", "pickSpins", 0, 10);
  number("pyl-set-limit", "whammyLimit", 1, 10);
  $("pyl-set-rotate").addEventListener("change", (e) => pylSetSettings({ rotate: e.target.checked }));
  $("btn-load-json").addEventListener("click", () => $("pyl-file").click());
  $("pyl-file").addEventListener("change", pylOnFile);
  pylWireButton("btn-start", pylStart);
  pylWireButton("btn-resume", pylResume);
}

function pylWireQuestion() {
  $("pyl-buzzbar").addEventListener("click", (event) => {
    const btn = event.target.closest ? event.target.closest(".buzz-btn") : null;
    if (!btn || btn.disabled) return;
    pylDispatch({ type: "buzz", seat: Number(btn.dataset.seat) });
  });
  $("pyl-picks").addEventListener("click", (event) => {
    const btn = event.target.closest ? event.target.closest(".pick-btn") : null;
    if (!btn || btn.disabled) return;
    pylDispatch({ type: "pick", seat: Number(btn.dataset.seat), idx: Number(btn.dataset.idx) });
  });
  pylWireButton("btn-arm", () => pylDispatch({ type: "arm", on: !pylApp.core.q.armed }));
  pylWireButton("btn-buzz-right", () => pylDispatch({ type: "judgeBuzz", correct: true }));
  pylWireButton("btn-buzz-wrong", () => pylDispatch({ type: "judgeBuzz", correct: false }));
  pylWireButton("btn-reveal", () => pylDispatch({ type: "revealPicks" }));
  pylWireButton("btn-next-question", () => pylDispatch({ type: "nextQuestion" }));
  pylWireButton("btn-to-board", () => pylDispatch({ type: "toBoard" }));
  pylWireButton("btn-q-undo", () => pylDispatch({ type: "undo" }));
  pylWireButton("btn-q-end", () => pylDispatch({ type: "finish" }));
}

function pylWireBoard() {
  pylWireButton("btn-stop", pylSpin);
  pylWireButton("btn-next-spinner", () => pylDispatch({ type: "nextSpinner" }));
  pylWireButton("btn-board-undo", () => pylDispatch({ type: "undo" }));
  pylWireButton("btn-board-end", () => pylDispatch({ type: "finish" }));
  $("pyl-pass").addEventListener("click", (event) => {
    const btn = event.target.closest ? event.target.closest(".pass-btn") : null;
    if (!btn) return;
    pylDispatch({ type: "pass", to: Number(btn.dataset.to) });
  });
}

function pylWireOverlays() {
  pylWireButton("btn-next-round", () => pylDispatch({ type: "nextRound" }));
  pylWireButton("btn-round-undo", () => pylDispatch({ type: "undo" }));
  pylWireButton("btn-round-end", () => pylDispatch({ type: "finish" }));
  pylWireButton("btn-play-again", () => pylSet({ core: null, resumable: null, spin: null }));
  pylWireButton("btn-result-undo", () => pylDispatch({ type: "undo" }));
  pylWireButton("btn-game-lobby", () => { if (pylApp.core) pylSet({ lobbyOpen: true }); });
  pylWireButton("btn-lobby-keep", pylLobbyKeep);
  pylWireButton("btn-lobby-restart", pylLobbyRestart);
  pylWireButton("btn-lobby-cancel", () => pylSet({ lobbyOpen: false }));
}

function pylWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.PylSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.PylSound.enabled));
  };
  sound.addEventListener("click", () => { window.PylSound.toggle(); paint(); });
  paint();
  const lobby = $("btn-game-lobby");
  if (lobby) lobby.disabled = false;
  document.addEventListener("keydown", pylOnKey);
  window.addEventListener("beforeunload", pylSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pylSave(); });
}

/* ============ Splash ============ */

const PYL_SPLASH_MS = 1200;
let pylSplashTimer = null;

/**
 * The 1.2 s title card the hub shows on a game switch, mirrored here so a
 * standalone open carries it too (copied from js/hub-host.js showSplash()).
 * Decorative only: `.gsc-splash` is `pointer-events: none`, and the whole
 * thing is skipped under prefers-reduced-motion and when embedded.
 */
function pylShowSplash() {
  const node = $("gsc-splash");
  if (!node) return;
  if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.body.classList.contains("gsc-embedded")) return;
  setText("gsc-splash-title", "Press Your Luck");
  setText("gsc-splash-sub", "Big money, big money — no Whammies!");
  node.dataset.gscGame = "press-your-luck";
  node.classList.remove("hidden");
  if (pylSplashTimer) clearTimeout(pylSplashTimer);
  pylSplashTimer = setTimeout(() => {
    pylSplashTimer = null;
    node.classList.add("hidden");
  }, PYL_SPLASH_MS);
}

/* ============ Boot ============ */

/**
 * An explicit ?game=URL always wins over the saved game unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old board when they follow a shared link.
 */
function pylChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.game && (!urlWon || saved.sourceUrl === wantUrl);
  const game = (useSaved && saved.game) || loaded.game;
  const patch = {
    game,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (saved && saved.setup) {
    patch.setup = Object.assign({}, pylApp.setup, saved.setup, {
      names: Array.isArray(saved.setup.names) ? saved.setup.names.slice() : PYL_DEFAULT_NAMES.slice(),
      settings: saved.setup.settings || pylSettingsFor(game),
    });
  } else {
    patch.setup = Object.assign({}, pylApp.setup, { settings: pylSettingsFor(game) });
  }
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved && saved.core) patch.core = saved.core;
  if (useSaved && saved.resumable) patch.resumable = saved.resumable;
  if (!useSaved && saved && (saved.core || saved.resumable) && !pylLoadMessage) {
    pylLoadMessage = "Loaded the board from the link, so the game in progress was cleared.";
  }
  return patch;
}

async function pylBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  pylShowSplash();                        // embedded and standalone, host and phone
  if (mode.endsWith("-player")) return;   // pyl-phone.js owns the phone page

  // Read the saved game BEFORE the first await: pyl-room.js seeds the roster as
  // soon as the shell sends `init`, and that write would otherwise clobber the
  // state we are about to restore.
  const saved = pylLoadSaved();

  pylWireSetup();
  pylWireQuestion();
  pylWireBoard();
  pylWireOverlays();
  pylWireChrome();
  pylMountLibrary();

  const loaded = await pylLoadContent();
  pylSet(pylChooseContent(saved, loaded));
  if (pylLoadMessage) pylError(pylLoadMessage);
}

/** The public surface pyl-editor.js / pyl-room.js / the harness build on. */
window.PylApp = {
  state: () => pylApp,
  core: () => pylApp.core,
  spin: () => pylApp.spin,
  dispatch: pylDispatch,
  press: pylSpin,
  set: pylSet,
  render: pylRender,
  useGame: pylUseGame,
  error: pylError,
  subscribe: (fn) => { if (typeof fn === "function") pylListeners.push(fn); },
  assign: pylAssign,
  setPlayers: pylSetPlayers,
  players: () => pylApp.players.slice(),
  start: pylStart,
  resume: pylResume,
  bindRoom: pylBindRoom,
  showSplash: pylShowSplash,
  storeSuffix: pylStoreSuffix,
  STORAGE_KEY: PYL_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { pylBoot().catch((err) => pylError(err.message)); });
} else {
  pylBoot().catch((err) => pylError(err.message));
}

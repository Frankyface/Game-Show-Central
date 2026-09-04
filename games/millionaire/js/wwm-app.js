/* ============================================================
   Millionaire — host glue
   Owns the app state (one serialisable object), persistence,
   the setup screen, the host's buttons and hotkeys, and the
   sound cues. All game rules live in wwm-core.js; this file only
   dispatches events into the reducer and asks wwm-view.js to
   paint the result. Every string reaches the page through
   textContent, and no Peer/DOM/timer handle is ever stored in the
   state.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness runs on `?store=harness` so a test run can never leave a
 * half-played game (or harness questions) in the real host's save on the same
 * origin. Anything but letters, digits and hyphens is stripped.
 */
function wwmStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const WWM_STORAGE_KEY = `gsc-wwm-state-v1${wwmStoreSuffix()}`;

/* ============ App state ============ */

let wwmApp = wwmFreshApp();
const wwmListeners = [];

function wwmFreshApp() {
  return {
    core: null,
    // The game the host stepped away from with "Keep this game". It is a plain
    // core snapshot, so an open audience window keeps its absolute deadline and
    // resuming lands exactly where they left off. Never a history mutation.
    resumable: null,
    game: null,
    setup: { players: [], fastestFinger: null, lifelines: null },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phoneCount: 0,
    editorOpen: false,
  };
}

/** Replace part of the app state, persist, repaint. */
function wwmSet(patch) {
  wwmApp = Object.assign({}, wwmApp, patch);
  wwmSave();
  wwmRender();
}

function wwmRender() {
  window.WwmView.render(wwmApp);
  wwmListeners.forEach((fn) => {
    try { fn(wwmApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** Send an event to the pure core, with the matching sound cue. */
function wwmDispatch(event) {
  const state = wwmApp.core;
  if (!state) return;
  const next = window.WwmCore.reduce(state, event, Math.random, Date.now());
  if (next === state) return;
  wwmCue(event, state, next);
  wwmSet({ core: next });
}

const WWM_CUES = {
  select: "select", lock: "lock", walkAway: "walk", fffOpen: "fff",
  useFifty: "lifeline", usePhone: "lifeline", useAudience: "lifeline", useSwitch: "lifeline",
};

function wwmCue(event, before, after) {
  void before;
  if (event.type === "reveal") {
    if (after.correct && after.outcome && after.outcome.reason === "million") window.WwmSound.play("million");
    else window.WwmSound.play(after.correct ? "correct" : "wrong");
    return;
  }
  const cue = WWM_CUES[event.type];
  if (cue) window.WwmSound.play(cue);
}

/* ============ Persistence ============ */

function wwmSerialise() {
  return {
    core: wwmApp.core, resumable: wwmApp.resumable,
    game: wwmApp.game, setup: wwmApp.setup, source: wwmApp.source,
    sourceKind: wwmApp.sourceKind, sourceUrl: wwmApp.sourceUrl, roomCode: wwmApp.roomCode,
  };
}

function wwmSave() {
  try {
    localStorage.setItem(WWM_STORAGE_KEY, JSON.stringify(wwmSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    wwmError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
const WWM_CORE_ARRAYS = ["roster", "contestants", "used", "removed", "history"];
const WWM_CORE_OBJECTS = ["lifelines", "audience", "phone", "fff"];

/** Is this a state the reducer can safely be handed? A hand-edited or
    half-written save is REJECTED here rather than discovered by a handler
    dereferencing a missing field. */
function wwmUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.WwmCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object") return false;
  if (WWM_CORE_ARRAYS.some((k) => !Array.isArray(state[k]))) return false;
  if (WWM_CORE_OBJECTS.some((k) => !state[k] || typeof state[k] !== "object" || Array.isArray(state[k]))) return false;
  if (!Number.isFinite(state.rung)) return false;
  const s = state.game.settings;
  if (!s || !Array.isArray(s.moneyTree) || !Array.isArray(state.game.questions)) return false;
  if (!Array.isArray(state.game.fastestFinger)) return false;
  if (state.phase === "hotseat" && !state.question) return false;
  return true;
}

function wwmLoadSaved() {
  try {
    const raw = localStorage.getItem(WWM_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.game) window.WwmCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (saved.resumable !== null && saved.resumable !== undefined && !wwmUsableCore(saved.resumable)) {
      console.warn("Ignoring a damaged resumable snapshot.");
      saved.resumable = null;
    }
    if (saved.core !== null && saved.core !== undefined && !wwmUsableCore(saved.core)) {
      console.warn("Ignoring a saved game with a damaged state object.");
      return Object.assign({}, saved, { core: null });
    }
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

function wwmError(message) {
  const node = $("wwm-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let wwmLoadMessage = "";   // survives the wwmSet() in wwmBoot, which clears the banner

async function wwmFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.WwmCore.validateGame(game);
  return { game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function wwmLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await wwmFetchGame(url, `Custom questions from ${url}`, "fetch");
    } catch (err) {
      wwmLoadMessage = `Could not load questions from ${url}: ${err.message}. Using the built-in set instead.`;
    }
  }
  try {
    return await wwmFetchGame("questions.json", "Built-in questions (questions.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = window.WWM_DEFAULT_GAME;
    if (!offline) {
      wwmLoadMessage = "No questions could be loaded at all — open the editor and build a set.";
      return { game: null, source: "No questions loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in questions (offline copy)", kind: "default", url: null };
  }
}

/** Adopt a validated game — from the editor, a file, or a URL. */
function wwmUseGame(game, source, kind) {
  window.WwmCore.validateGame(game);
  // sourceUrl is cleared: this content no longer came from the ?game= link, so
  // a reload of that link must fetch it again rather than resurrect this copy.
  wwmSet({
    game, source: source || "Custom questions", sourceKind: kind || "upload",
    sourceUrl: null, core: null, resumable: null,
    setup: Object.assign({}, wwmApp.setup, { fastestFinger: null, lifelines: null }),
  });
  wwmError("");
}

function wwmOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      wwmUseGame(JSON.parse(String(reader.result)), `Custom questions from ${file.name}`, "upload");
    } catch (err) {
      wwmError(`That file is not a usable Millionaire game: ${err.message}`);
    }
  };
  reader.onerror = () => wwmError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function wwmAddPlayer(name, pid, manual) {
  const clean = window.WwmCore.cleanText(name, window.WwmCore.NAME_MAX);
  if (!clean) { wwmError("Give the contestant a name first."); return false; }
  const players = wwmApp.setup.players;
  if (players.length >= window.WwmCore.MAX_CONTESTANTS) {
    wwmError(`That is the maximum of ${window.WwmCore.MAX_CONTESTANTS} contestants.`);
    return false;
  }
  if (players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    wwmError(`${clean} is already on the list — pick another name.`);
    return false;
  }
  const id = pid || `m${Date.now().toString(36)}${players.length}`;
  wwmSet({
    setup: Object.assign({}, wwmApp.setup, {
      players: players.concat([{ pid: id, name: clean, manual: manual !== false }]),
    }),
  });
  wwmError("");
  return true;
}

function wwmRemovePlayer(pid) {
  const players = wwmApp.setup.players.filter((p) => p.pid !== pid);
  wwmSet({ setup: Object.assign({}, wwmApp.setup, { players }) });
}

/** Does the file offer a Fastest Finger round, and does the host want it? */
function wwmFileHasFff() {
  return !!(wwmApp.game && Array.isArray(wwmApp.game.fastestFinger) && wwmApp.game.fastestFinger.length);
}

/** On by default only when phones are present (spec 08 §3: auto-off with none). */
function wwmWantsFastestFinger() {
  if (!wwmFileHasFff()) return false;
  if (typeof wwmApp.setup.fastestFinger === "boolean") return wwmApp.setup.fastestFinger;
  const fromFile = wwmApp.game.settings ? wwmApp.game.settings.fastestFinger : undefined;
  return fromFile !== false && wwmApp.phoneCount > 0;
}

function wwmLifelineOn(key) {
  const override = wwmApp.setup.lifelines;
  if (override && typeof override[key] === "boolean") return override[key];
  const fromFile = wwmApp.game && wwmApp.game.settings && wwmApp.game.settings.lifelines;
  if (fromFile && typeof fromFile[key] === "boolean") return fromFile[key];
  return window.WwmCore.DEFAULT_LIFELINES[key];
}

/** The game the reducer actually plays: the file with the host's toggles on top. */
function wwmEffectiveGame() {
  const game = JSON.parse(JSON.stringify(wwmApp.game));
  const lifelines = {};
  window.WwmCore.LIFELINE_KEYS.forEach((key) => { lifelines[key] = wwmLifelineOn(key); });
  game.settings = Object.assign({}, game.settings, { lifelines, fastestFinger: wwmWantsFastestFinger() });
  return game;
}

function wwmStart() {
  try {
    if (!wwmApp.game) throw new Error("Questions are still loading — try again in a second.");
    const players = wwmApp.setup.players.map((p) => ({ pid: p.pid, name: p.name }));
    const state = window.WwmCore.createState(wwmEffectiveGame(), players, {});
    wwmSet({
      core: window.WwmCore.reduce(state, { type: "start" }, Math.random, Date.now()),
      resumable: null,          // Start replaces whatever was on the shelf
    });
    wwmError("");
  } catch (err) {
    wwmError(err.message);
  }
}

/* ============ The game lobby (docs/19 §1) ============ */

/** A one-line description of what Resume would put back on screen. */
function wwmResumeNote(state) {
  if (!state) return "";
  const C = window.WwmCore;
  if (state.phase === "hotseat") {
    return `${C.nameOf(state, state.current)} on question ${C.playingRung(state)}`
      + ` for ${C.formatMoney(state, C.rungValue(state, C.playingRung(state)))}`;
  }
  if (state.phase === "fff") return "the Fastest Finger round";
  if (state.phase === "pick") return "choosing the next contestant";
  if (state.phase === "result" || state.phase === "standings") return "the standings";
  return "the game in progress";
}

function wwmOpenLobbyConfirm() {
  const state = wwmApp.core;
  setText("wwm-lobby-sub", state
    ? `Keep ${wwmResumeNote(state)} to come back to it, or start over with the same`
      + " contestants, questions and settings."
    : "Nothing is in progress — this just takes you to the setup screen.");
  show($("btn-lobby-keep"), !!state);
  show($("wwm-lobby-confirm"), true);
  const first = state ? $("btn-lobby-keep") : $("btn-lobby-restart");
  if (first) first.focus();
}

function wwmCloseLobbyConfirm() {
  show($("wwm-lobby-confirm"), false);
  const back = $("btn-game-lobby");
  if (back) back.focus();
}

/** Keep this game: park it on the shelf and show setup with a Resume button. */
function wwmLobbyKeep() {
  wwmCloseLobbyConfirm();
  if (!wwmApp.core) return;
  wwmSet({ resumable: wwmApp.core, core: null });
  wwmError("");
}

/** Start over: the game goes, the roster, content and settings stay. */
function wwmLobbyRestart() {
  wwmCloseLobbyConfirm();
  wwmSet({ core: null, resumable: null });
  wwmError("");
}

/** Put the parked game back exactly as it was, deadlines and all. */
function wwmResume() {
  const parked = wwmApp.resumable;
  if (!parked) return;
  wwmSet({ core: parked, resumable: null });
  wwmError("");
}

/* ============ Host actions ============ */

function wwmSelect(idx) { wwmDispatch({ type: "select", idx }); }

function wwmSeat(pid) {
  wwmDispatch({ type: "fffPick", pid });
  wwmDispatch({ type: "seat", pid });
}

const WWM_LIFELINE_EVENTS = {
  fifty: "useFifty", phone: "usePhone", audience: "useAudience", switch: "useSwitch",
};

function wwmUseLifeline(key) {
  const type = WWM_LIFELINE_EVENTS[key];
  if (type) wwmDispatch({ type });
}

/** The host says yes to whatever the contestant's phone asked for. */
function wwmConfirmRequest() {
  const state = wwmApp.core;
  if (!state || !state.request) return;
  const which = state.request.which;
  if (which === "walk") wwmDispatch({ type: "walkAway" });
  else wwmUseLifeline(which);
  wwmDispatch({ type: "clearRequest" });
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone contestants would
 * otherwise be inherited by whoever is issued that pid next. A different room
 * code drops every phone seat; contestants the host typed in keep their own ids
 * and stay. The same code (a plain refresh) changes nothing.
 */
function wwmBindRoom(code) {
  if (typeof code !== "string" || !code || wwmApp.roomCode === code) return;
  const manual = new Set(wwmApp.setup.players.filter((p) => p.manual).map((p) => p.pid));
  const players = wwmApp.setup.players.filter((p) => p.manual);
  let core = wwmApp.core;
  let resumable = wwmApp.resumable;
  let message = "";
  const fromOldRoom = (s) => !!s && s.contestants.some((c) => !manual.has(c.pid));
  if (fromOldRoom(core)) {
    core = null;
    message = "This is a new room, so the game in progress was cleared — the phone seats belonged to the old one.";
  }
  if (fromOldRoom(resumable)) resumable = null;
  wwmSet({ roomCode: code, core, resumable, setup: Object.assign({}, wwmApp.setup, { players }) });
  if (message) wwmError(message);
}

/* ============ Hotkeys ============ */

function wwmIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

const WWM_KEY_OPTIONS = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };

function wwmOnKey(event) {
  if (wwmIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (wwmApp.editorOpen) return;
  const state = wwmApp.core;
  if (!state || state.phase !== "hotseat") return;
  const key = String(event.key).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(WWM_KEY_OPTIONS, key)) {
    event.preventDefault();
    wwmSelect(WWM_KEY_OPTIONS[key]);
    return;
  }
  const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
  if (event.key === "Enter") { event.preventDefault(); wwmDispatch({ type: "lock" }); }
  else if (isSpace) { event.preventDefault(); wwmDispatch({ type: state.revealed ? "nextQuestion" : "reveal" }); }
  else if (key === "u") { event.preventDefault(); wwmDispatch({ type: "undo" }); }
}

/* ============ Wiring ============ */

function wwmWireSetup() {
  $("wwm-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (wwmAddPlayer($("wwm-player-name").value)) $("wwm-player-name").value = "";
  });
  $("btn-load-json").addEventListener("click", () => $("wwm-file").click());
  $("wwm-file").addEventListener("change", wwmOnFile);
  $("btn-start").addEventListener("click", wwmStart);
  $("btn-resume").addEventListener("click", wwmResume);
  $("wwm-fff").addEventListener("change", (e) => {
    wwmSet({ setup: Object.assign({}, wwmApp.setup, { fastestFinger: e.target.checked }) });
  });
  window.WwmCore.LIFELINE_KEYS.forEach((key) => {
    $(`wwm-ll-${key}`).addEventListener("change", (e) => {
      const lifelines = Object.assign({}, wwmApp.setup.lifelines || {});
      lifelines[key] = e.target.checked;
      wwmSet({ setup: Object.assign({}, wwmApp.setup, { lifelines }) });
    });
  });
}

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function wwmWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function wwmWireFff() {
  wwmWireButton("btn-fff-open", () => wwmDispatch({ type: "fffOpen" }));
  wwmWireButton("btn-fff-reveal", () => wwmDispatch({ type: "fffReveal" }));
  wwmWireButton("btn-fff-seat", () => {
    const state = wwmApp.core;
    if (state && state.fff.winner) wwmDispatch({ type: "seat", pid: state.fff.winner });
  });
  wwmWireButton("btn-fff-undo", () => wwmDispatch({ type: "undo" }));
}

function wwmWireHotseat() {
  wwmWireButton("btn-lock", () => wwmDispatch({ type: "lock" }));
  wwmWireButton("btn-reveal", () => wwmDispatch({ type: "reveal" }));
  wwmWireButton("btn-next", () => wwmDispatch({ type: "nextQuestion" }));
  wwmWireButton("btn-walk", () => wwmDispatch({ type: "walkAway" }));
  wwmWireButton("btn-undo", () => wwmDispatch({ type: "undo" }));
  wwmWireButton("btn-give-up", () => wwmDispatch({ type: "finish" }));
}

function wwmWireOverlays() {
  wwmWireButton("btn-audience-close", () => wwmDispatch({ type: "audienceClose" }));
  wwmWireButton("btn-phone-done", () => wwmDispatch({ type: "phoneDone" }));
  $("wwm-friend").addEventListener("input", (e) => wwmDispatch({ type: "phoneFriend", name: e.target.value }));
  $("wwm-audience-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pcts = [0, 1, 2, 3].map((i) => Number($(`wwm-pct-${i}`).value) || 0);
    wwmDispatch({ type: "audienceHostChart", pcts });
  });
  window.WwmTimer.setOnTick(() => window.WwmSound.play("tick"));
}

function wwmWireResult() {
  wwmWireButton("btn-next-contestant", () => wwmDispatch({ type: "nextContestant" }));
  wwmWireButton("btn-finish", () => wwmDispatch({ type: "finish" }));
  wwmWireButton("btn-result-undo", () => wwmDispatch({ type: "undo" }));
  wwmWireButton("btn-play-again", () => wwmSet({ core: null }));
}

function wwmWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.WwmSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.WwmSound.enabled));
  };
  sound.addEventListener("click", () => { window.WwmSound.toggle(); paint(); });
  paint();
  $("btn-game-lobby").addEventListener("click", wwmOpenLobbyConfirm);
  $("btn-lobby-keep").addEventListener("click", wwmLobbyKeep);
  $("btn-lobby-restart").addEventListener("click", wwmLobbyRestart);
  $("btn-lobby-cancel").addEventListener("click", wwmCloseLobbyConfirm);
  $("wwm-lobby-confirm").addEventListener("keydown", (e) => {
    if (e.key === "Escape") wwmCloseLobbyConfirm();
  });
  document.addEventListener("keydown", wwmOnKey);
  window.addEventListener("beforeunload", wwmSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) wwmSave(); });
}

/* ============ The question-set library (docs/19 §2) ============ */

let wwmPicker = null;

/**
 * Mount the shared picker under the Questions section. Everything it hands
 * back goes through this game's own validateGame before it becomes the
 * content, and a page opened from disk simply gets a plain-English line
 * instead of a picker (shared/library.js never throws).
 */
function wwmMountLibrary() {
  const box = $("wwm-library");
  const lib = window.GSCLibrary;
  if (!box || !lib || typeof lib.mountPicker !== "function") return;
  if (wwmPicker) wwmPicker.destroy();
  wwmPicker = lib.mountPicker(box, {
    gameDir: "",
    label: "Saved sets",
    validate: (json) => window.WwmCore.validateGame(json),
    onPick: (json, meta) => {
      try {
        wwmUseGame(json, `set: ${meta.name}`, "library");
      } catch (err) {
        wwmError(`That set could not be used: ${err.message}`);
      }
    },
  });
}

/* ============ Splash ============ */

const WWM_SPLASH_MS = 1200;
let wwmSplashTimer = null;

/**
 * The 1.2 s title card the hub shows on a game switch, mirrored here so the
 * embedded frame carries it too (copied from js/hub-host.js showSplash()).
 * Decorative only: `.gsc-splash` is `pointer-events: none`, and the whole
 * thing is skipped under prefers-reduced-motion.
 */
function wwmShowSplash() {
  const node = $("gsc-splash");
  if (!node) return;
  if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.body.classList.contains("gsc-embedded")) return; // the hub shows its own splash on switch
  setText("gsc-splash-title", "Millionaire");
  setText("gsc-splash-sub", "Fifteen questions. One hot seat.");
  node.dataset.gscGame = "millionaire";   // wears the game accent (shared/theme.css)
  node.classList.remove("hidden");
  if (wwmSplashTimer) clearTimeout(wwmSplashTimer);
  wwmSplashTimer = setTimeout(() => {
    wwmSplashTimer = null;
    node.classList.add("hidden");
  }, WWM_SPLASH_MS);
}

/* ============ Boot ============ */

/** Saved roster first, then any phone the shell added while we were loading. */
function wwmMergeRoster(savedSetup, current) {
  const players = (savedSetup.players || []).slice();
  current.forEach((p) => { if (!players.some((x) => x.pid === p.pid)) players.push(p); });
  return Object.assign({}, savedSetup, { players });
}

/**
 * An explicit ?game=URL always wins over the saved game unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old questions when they follow a shared link. A URL that failed to load
 * must not cost them their game as well as their questions.
 */
function wwmChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.game && (!urlWon || saved.sourceUrl === wantUrl);
  const patch = {
    game: (useSaved && saved.game) || loaded.game,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (saved && saved.setup) patch.setup = wwmMergeRoster(saved.setup, wwmApp.setup.players);
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved && saved.core) patch.core = saved.core;
  if (useSaved && saved.resumable) patch.resumable = saved.resumable;
  if (!useSaved && saved && saved.core && !wwmLoadMessage) {
    wwmLoadMessage = "Loaded the questions from the link, so the game in progress was cleared.";
  }
  return patch;
}

async function wwmBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  wwmShowSplash();                        // embedded and standalone, host and phone
  if (mode.endsWith("-player")) return;   // wwm-phone.js owns the phone page

  // Read the saved game BEFORE the first await: wwm-room.js seeds the roster as
  // soon as the shell sends `init`, and that write would otherwise clobber the
  // state we are about to restore.
  const saved = wwmLoadSaved();

  wwmWireSetup();
  wwmWireFff();
  wwmWireHotseat();
  wwmWireOverlays();
  wwmWireResult();
  wwmWireChrome();

  const loaded = await wwmLoadContent();
  wwmSet(wwmChooseContent(saved, loaded));
  wwmMountLibrary();
  if (wwmLoadMessage) wwmError(wwmLoadMessage);
}

/** The public surface wwm-editor.js / wwm-room.js / the harness build on. */
window.WwmApp = {
  state: () => wwmApp,
  core: () => wwmApp.core,
  dispatch: wwmDispatch,
  set: wwmSet,
  render: wwmRender,
  useGame: wwmUseGame,
  addPlayer: wwmAddPlayer,
  removePlayer: wwmRemovePlayer,
  error: wwmError,
  subscribe: (fn) => { if (typeof fn === "function") wwmListeners.push(fn); },
  select: wwmSelect,
  seat: wwmSeat,
  useLifeline: wwmUseLifeline,
  confirmRequest: wwmConfirmRequest,
  wantsFastestFinger: wwmWantsFastestFinger,
  lifelineOn: wwmLifelineOn,
  bindRoom: wwmBindRoom,
  showSplash: wwmShowSplash,
  storeSuffix: wwmStoreSuffix,
  openLobby: wwmOpenLobbyConfirm,
  resume: wwmResume,
  picker: () => wwmPicker,
  setPhoneCount: (n) => { if (n !== wwmApp.phoneCount) wwmSet({ phoneCount: Number(n) || 0 }); },
  STORAGE_KEY: WWM_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { wwmBoot().catch((err) => wwmError(err.message)); });
} else {
  wwmBoot().catch((err) => wwmError(err.message));
}

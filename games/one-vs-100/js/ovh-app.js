/* ============================================================
   1 vs 100 — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the answer-window
   clock and the sound cues. All game rules live in ovh-core.js;
   this file only dispatches events into the reducer and asks
   ovh-view.js to paint the result. Every string reaches the page
   through textContent, and no Peer/DOM/timer handle is ever
   stored in the state.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run cannot leave harness
 * questions (or a half-played game) in the real host's save on the same
 * origin. Anything but letters, digits and hyphens is stripped.
 */
function ovhStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const OVH_STORAGE_KEY = `gsc-ovh-state-v1${ovhStoreSuffix()}`;

let ovhApp = ovhFreshApp();
const ovhListeners = [];
let ovhClock = null;

function ovhFreshApp() {
  return {
    core: null,
    stashed: null,          // the "Keep this game" snapshot behind Resume (docs 19 §1)
    game: null,
    setup: {
      players: [], contestant: null, mobSource: "sim", mobSize: 20,
      secs: 20, bonus: 2, helps: { poll: true, ask: true, trust: true },
    },
    pick: null,             // the host's tentative option, before "Lock it in"
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phoneCount: 0,
    editorOpen: false,
  };
}

/** Replace part of the app state, persist, repaint. */
function ovhSet(patch) {
  ovhApp = Object.assign({}, ovhApp, patch);
  ovhSave();
  ovhRender();
}

function ovhRender() {
  window.OvhView.render(ovhApp);
  ovhListeners.forEach((fn) => {
    try { fn(ovhApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** Send an event to the pure core, with the matching sound cue. */
function ovhDispatch(event) {
  const state = ovhApp.core;
  if (!state) return;
  const next = window.OvhCore.reduce(state, event, Math.random, Date.now());
  if (next === state) return;
  ovhCue(event, state, next);
  // A new question, an undo or a lock all invalidate the host's pending pick.
  const keepPick = event.type === "usePoll" || event.type === "useAsk" || event.type === "simulateMob";
  ovhSet({ core: next, pick: keepPick ? ovhApp.pick : pickAfter(next) });
}

/** After a Trust the Mob the pick follows the core; otherwise it clears. */
function pickAfter(next) {
  return next.q && next.q.locked !== null ? next.q.locked : null;
}

const OVH_CUES = {
  openQuestion: "open", closeMob: "close", contestantLock: "lock", walk: "walk",
  usePoll: "help", useAsk: "help", useTrust: "help",
};

function ovhCue(event, before, after) {
  void before;
  if (event.type === "reveal") {
    if (after.outcome && after.outcome.reason === "win") window.OvhSound.play("win");
    else if (after.q.correct) {
      window.OvhSound.play("correct");
      if (after.q.eliminated.length) window.OvhSound.play("eliminate");
      if (after.q.earned) window.OvhSound.play("money");
    } else window.OvhSound.play("wrong");
    return;
  }
  const cue = OVH_CUES[event.type];
  if (cue) window.OvhSound.play(cue);
}

/* ============ Persistence ============ */

/**
 * The state as it goes to localStorage. A RUNNING answer window is written
 * PAUSED, with the time that was left at the moment of the save: an absolute
 * deadline would keep burning while the tab is closed, so a reload two minutes
 * later would come back to a window that had already run out. The live state
 * is untouched — saving never stops the host's clock — and `beforeunload` and
 * `visibilitychange` both save, so the frozen time is accurate.
 */
function ovhFreeze(state) {
  if (!state || !state.q || !state.q.open) return state;
  return Object.assign({}, state, { q: window.OvhCore.pauseWindow(state.q, Date.now()) });
}

function ovhSerialise() {
  return {
    core: ovhFreeze(ovhApp.core), stashed: ovhFreeze(ovhApp.stashed),
    game: ovhApp.game, setup: ovhApp.setup, source: ovhApp.source,
    sourceKind: ovhApp.sourceKind, sourceUrl: ovhApp.sourceUrl, roomCode: ovhApp.roomCode,
  };
}

function ovhSave() {
  try {
    localStorage.setItem(OVH_STORAGE_KEY, JSON.stringify(ovhSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    ovhError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
const OVH_CORE_ARRAYS = ["roster", "used", "history"];

/** Is this a state the reducer can safely be handed? A hand-edited or
    half-written save is REJECTED here rather than discovered by a handler
    dereferencing a missing field. */
function ovhUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.OvhCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object") return false;
  if (OVH_CORE_ARRAYS.some((k) => !Array.isArray(state[k]))) return false;
  if (!state.mob || !Array.isArray(state.mob.members)) return false;
  if (!state.q || typeof state.q !== "object" || !state.q.answers) return false;
  if (!state.helps || typeof state.helps !== "object") return false;
  if (!Number.isFinite(state.bank) || !Number.isInteger(state.qNumber)) return false;
  const s = state.game.settings;
  if (!s || !Array.isArray(s.ladder) || !Array.isArray(state.game.questions)) return false;
  if (state.phase === "question" && !state.q.question) return false;
  return true;
}

/** Belt and braces: pause a window a save from an older build left running. */
function ovhRestoreCore(state) {
  if (!state) return null;
  if (!ovhUsableCore(state)) {
    console.warn("Ignoring a saved game with a damaged state object.");
    return null;
  }
  return ovhFreeze(state);
}

function ovhLoadSaved() {
  try {
    const raw = localStorage.getItem(OVH_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.game) window.OvhCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    const damaged = (saved.core && !ovhUsableCore(saved.core)) || (saved.stashed && !ovhUsableCore(saved.stashed));
    saved.core = ovhRestoreCore(saved.core);
    saved.stashed = ovhRestoreCore(saved.stashed);
    if (damaged) ovhLoadMessage = "A saved game could not be read, so it was dropped. The questions are fine.";
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

function ovhError(message) {
  const node = $("ovh-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let ovhLoadMessage = "";   // survives the ovhSet() in ovhBoot, which clears the banner

async function ovhFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.OvhCore.validateGame(game);
  return { game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function ovhLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await ovhFetchGame(url, `Custom questions from ${url}`, "fetch");
    } catch (err) {
      ovhLoadMessage = `Could not load questions from ${url}: ${err.message}. Using the built-in set instead.`;
    }
  }
  try {
    return await ovhFetchGame("questions.json", "Built-in questions (questions.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = window.OVH_DEFAULT_GAME;
    if (!offline) {
      ovhLoadMessage = "No questions could be loaded at all — open the editor and build a set.";
      return { game: null, source: "No questions loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in questions (offline copy)", kind: "default", url: null };
  }
}

/** Adopt a validated game — from the editor, a file, a library set or a URL. */
function ovhUseGame(game, source, kind) {
  window.OvhCore.validateGame(game);
  // sourceUrl is cleared: this content no longer came from the ?game= link, so
  // a reload of that link must fetch it again rather than resurrect this copy.
  ovhSet({
    game, source: source || "Custom questions", sourceKind: kind || "upload",
    sourceUrl: null, core: null, stashed: null,
    setup: Object.assign({}, ovhApp.setup, ovhSettingsFrom(game)),
  });
  ovhError("");
}

/** The host's rule toggles follow a newly loaded file. */
function ovhSettingsFrom(game) {
  const s = window.OvhCore.normalizeGame(game).settings;
  return { secs: s.answerSeconds, bonus: s.bonusMultiplier, mobSize: s.mobSize, helps: Object.assign({}, s.helps) };
}

function ovhOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      ovhUseGame(JSON.parse(String(reader.result)), `Custom questions from ${file.name}`, "upload");
    } catch (err) {
      ovhError(`That file is not a usable 1 vs 100 game: ${err.message}`);
    }
  };
  reader.onerror = () => ovhError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function ovhAddPlayer(name, pid, manual) {
  const clean = window.OvhCore.cleanText(name, window.OvhCore.NAME_MAX);
  if (!clean) { ovhError("Give the player a name first."); return false; }
  const players = ovhApp.setup.players;
  if (players.length >= window.OvhCore.MAX_ROSTER) {
    ovhError(`That is the maximum of ${window.OvhCore.MAX_ROSTER} people in the room.`);
    return false;
  }
  if (players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    ovhError(`${clean} is already on the list — pick another name.`);
    return false;
  }
  const id = pid || `m${Date.now().toString(36)}${players.length}`;
  const next = players.concat([{ pid: id, name: clean, manual: manual !== false }]);
  ovhSet({
    setup: Object.assign({}, ovhApp.setup, {
      players: next,
      contestant: ovhApp.setup.contestant || id,
    }),
  });
  ovhError("");
  return true;
}

function ovhRemovePlayer(pid) {
  const players = ovhApp.setup.players.filter((p) => p.pid !== pid);
  const contestant = ovhApp.setup.contestant === pid ? (players[0] ? players[0].pid : null) : ovhApp.setup.contestant;
  ovhSet({ setup: Object.assign({}, ovhApp.setup, { players, contestant }) });
}

function ovhSetContestant(pid) {
  if (ovhApp.setup.contestant === pid) return;
  ovhSet({ setup: Object.assign({}, ovhApp.setup, { contestant: pid }) });
}

function ovhSetupPatch(patch) {
  ovhSet({ setup: Object.assign({}, ovhApp.setup, patch) });
}

/** The game the reducer actually plays: the file with the host's toggles on top. */
function ovhEffectiveGame() {
  const game = JSON.parse(JSON.stringify(ovhApp.game));
  game.settings = Object.assign({}, game.settings, {
    answerSeconds: ovhApp.setup.secs,
    bonusMultiplier: ovhApp.setup.bonus,
    mobSize: ovhApp.setup.mobSize,
    helps: Object.assign({}, ovhApp.setup.helps),
  });
  return game;
}

function ovhStart() {
  try {
    if (!ovhApp.game) throw new Error("Questions are still loading — try again in a second.");
    const players = ovhApp.setup.players.map((p) => ({ pid: p.pid, name: p.name }));
    if (!players.length) throw new Error("Add at least one player — somebody has to face the Mob.");
    const state = window.OvhCore.createState(ovhEffectiveGame(), players, {
      contestant: ovhApp.setup.contestant,
      simulated: ovhApp.setup.mobSource === "sim",
      mobSize: ovhApp.setup.mobSize,
    });
    const started = window.OvhCore.reduce(state, { type: "start" }, Math.random, Date.now());
    if (started.phase !== "question") throw new Error(started.notice || "The game could not start.");
    ovhSet({ core: started, stashed: null, pick: null });
    ovhError("");
  } catch (err) {
    ovhError(err.message);
  }
}

/* ============ Host actions ============ */

function ovhPickOption(idx) {
  const state = ovhApp.core;
  if (!state || !state.q.closed || state.q.revealed || state.q.locked !== null) return;
  ovhSet({ pick: ovhApp.pick === idx ? null : idx });
}

function ovhLock() {
  if (ovhApp.pick === null) { ovhError("Pick one of the three first."); return; }
  ovhError("");
  ovhDispatch({ type: "contestantLock", idx: ovhApp.pick });
}

/* ============ The Game lobby control (docs 19 §1) ============ */

function ovhLobbyOpen(on) {
  show($("ovh-lobby-modal"), on);
  if (on) {
    const first = $("btn-lobby-keep");
    if (first) first.focus();
  }
}

/** Keep: park the game behind Resume. Start over: drop it. Both keep the
    roster, the questions and the settings exactly as they are. */
function ovhLobbyChoice(keep) {
  ovhLobbyOpen(false);
  if (!ovhApp.core && !keep) { ovhSet({ stashed: null }); return; }
  ovhSet({ stashed: keep ? ovhFreeze(ovhApp.core) : null, core: null, pick: null, editorOpen: false });
  ovhError(keep
    ? "The game is parked — press Resume to pick it up exactly where it stopped."
    : "");
}

function ovhResume() {
  if (!ovhApp.stashed) return;
  ovhSet({ core: ovhApp.stashed, stashed: null, pick: null });
  ovhError("");
}

/* ============ The answer-window clock ============ */

const OVH_TICK_MS = 250;
let ovhLastSecond = null;

/**
 * One interval drives the block strip, the seconds line and the automatic
 * close when the window runs out. A restored save is paused, so this can never
 * fire on the first paint after a reload — the host presses Resume.
 */
function ovhStartClock() {
  if (ovhClock) return;
  ovhClock = setInterval(ovhTick, OVH_TICK_MS);
}

function ovhTick() {
  const state = ovhApp.core;
  if (!state || !state.q) return;
  const now = Date.now();
  window.OvhView.paintClock(ovhApp, now);
  if (!state.q.open) { ovhLastSecond = null; return; }
  const left = window.OvhCore.secondsLeft(state, now);
  if (left !== ovhLastSecond) {
    if (ovhLastSecond !== null && left > 0 && left <= 5) window.OvhSound.play("tick");
    ovhLastSecond = left;
  }
  if (window.OvhCore.windowExpired(state, now)) {
    ovhLastSecond = null;
    ovhDispatch({ type: "closeMob" });
  }
}

/* ============ Hotkeys ============ */

function ovhIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

const OVH_KEY_OPTIONS = { a: 0, b: 1, c: 2, 1: 0, 2: 1, 3: 2 };

function ovhOnKey(event) {
  if (ovhIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (ovhApp.editorOpen) return;
  const state = ovhApp.core;
  if (!state || state.phase !== "question") return;
  const key = String(event.key).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(OVH_KEY_OPTIONS, key)) {
    event.preventDefault();
    ovhPickOption(OVH_KEY_OPTIONS[key]);
    return;
  }
  const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
  if (event.key === "Enter") { event.preventDefault(); ovhLock(); }
  else if (isSpace) { event.preventDefault(); ovhSpace(state); }
  else if (key === "u") { event.preventDefault(); ovhDispatch({ type: "undo" }); }
}

/** Space is "the next obvious thing": open, close, reveal. */
function ovhSpace(state) {
  if (!state.q.open && !state.q.closed) ovhDispatch({ type: "openQuestion" });
  else if (state.q.open) ovhDispatch({ type: "closeMob" });
  else if (!state.q.revealed) ovhDispatch({ type: "reveal" });
}

/* ============ Wiring ============ */

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function ovhWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function ovhWireSetup() {
  $("ovh-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (ovhAddPlayer($("ovh-player-name").value)) $("ovh-player-name").value = "";
  });
  $("btn-load-json").addEventListener("click", () => $("ovh-file").click());
  $("ovh-file").addEventListener("change", ovhOnFile);
  $("btn-start").addEventListener("click", ovhStart);
  $("btn-resume").addEventListener("click", ovhResume);
  $("ovh-mob-phones").addEventListener("change", () => ovhSetupPatch({ mobSource: "phones" }));
  $("ovh-mob-sim").addEventListener("change", () => ovhSetupPatch({ mobSource: "sim" }));
  ovhWireNumber("ovh-mob-size", 1, 100, (n) => ovhSetupPatch({ mobSize: n }));
  ovhWireNumber("ovh-secs", 0, 120, (n) => ovhSetupPatch({ secs: n }));
  ovhWireNumber("ovh-bonus", 1, 10, (n) => ovhSetupPatch({ bonus: n }));
  window.OvhCore.HELP_KEYS.forEach((key) => {
    $(`ovh-help-${key}`).addEventListener("change", (e) => {
      const helps = Object.assign({}, ovhApp.setup.helps);
      helps[key] = e.target.checked;
      ovhSetupPatch({ helps });
    });
  });
}

/** A number field that refuses nonsense out loud instead of silently. */
function ovhWireNumber(id, lo, hi, apply) {
  const node = $(id);
  if (!node) return;
  node.addEventListener("change", () => {
    const n = Math.round(Number(node.value));
    if (!Number.isFinite(n) || n < lo || n > hi) {
      ovhError(`That field takes a whole number from ${lo} to ${hi}.`);
      ovhRender();
      return;
    }
    ovhError("");
    apply(n);
  });
}

function ovhWirePlay() {
  ovhWireButton("btn-open-window", () => ovhDispatch({ type: "openQuestion" }));
  ovhWireButton("btn-close-mob", () => ovhDispatch({ type: "closeMob" }));
  ovhWireButton("btn-help-poll", () => ovhDispatch({ type: "usePoll" }));
  ovhWireButton("btn-help-ask", () => ovhDispatch({ type: "useAsk" }));
  ovhWireButton("btn-help-trust", () => ovhDispatch({ type: "useTrust" }));
  ovhWireButton("btn-lock", ovhLock);
  ovhWireButton("btn-reveal", () => ovhDispatch({ type: "reveal" }));
  ovhWireButton("btn-continue", () => ovhDispatch({ type: "continue" }));
  ovhWireButton("btn-walk", () => ovhDispatch({ type: "walk" }));
  ovhWireButton("btn-undo", () => ovhDispatch({ type: "undo" }));
  ovhWireButton("btn-finish", () => ovhDispatch({ type: "finish" }));
  $("ovh-sim-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("ovh-sim-wrong").value;
    const n = raw === "" ? 0 : Math.round(Number(raw));
    const alive = ovhApp.core ? window.OvhCore.mobAlive(ovhApp.core) : 0;
    if (!Number.isFinite(n) || n < 0 || n > alive) {
      ovhError(`Enter a whole number from 0 to ${alive} — that is how many of the Mob are still in.`);
      return;
    }
    ovhError("");
    ovhDispatch({ type: "simulateMob", wrong: n });
  });
}

function ovhWireResult() {
  ovhWireButton("btn-standings", () => ovhDispatch({ type: "finish" }));
  ovhWireButton("btn-result-undo", () => ovhDispatch({ type: "undo" }));
  ovhWireButton("btn-play-again", () => ovhSet({ core: null, stashed: null, pick: null }));
}

function ovhWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.OvhSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.OvhSound.enabled));
  };
  sound.addEventListener("click", () => { window.OvhSound.toggle(); paint(); });
  paint();
  $("btn-game-lobby").addEventListener("click", () => ovhLobbyOpen(true));
  $("btn-lobby-keep").addEventListener("click", () => ovhLobbyChoice(true));
  $("btn-lobby-restart").addEventListener("click", () => ovhLobbyChoice(false));
  $("btn-lobby-cancel").addEventListener("click", () => ovhLobbyOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("ovh-lobby-modal").classList.contains("hidden")) ovhLobbyOpen(false);
    else ovhOnKey(e);
  });
  window.addEventListener("beforeunload", ovhSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) ovhSave(); });
}

/* ============ The question-set library (docs 19 §2) ============ */

let ovhLibraryHandle = null;

function ovhMountLibrary() {
  const box = $("ovh-library");
  if (!box) return;
  const lib = window.GSCLibrary;
  if (!lib || typeof lib.mountPicker !== "function") {
    box.replaceChildren(el("p", "hint",
      "The shared question-set library isn’t loaded on this page, so the shipped sets can’t be listed. "
      + "Load a set with “Load questions (.json)” from games/one-vs-100/sets/ instead."));
    return;
  }
  ovhLibraryHandle = lib.mountPicker(box, {
    gameDir: ".",
    validate: (json) => window.OvhCore.validateGame(json),
    onPick: (json, meta) => {
      try {
        ovhUseGame(json, `set: ${meta && meta.name ? meta.name : "library set"}`, "library");
      } catch (err) {
        ovhError(`That set could not be used: ${err.message}`);
      }
    },
  });
}

/* ============ Splash ============ */

const OVH_SPLASH_MS = 1200;
let ovhSplashTimer = null;

/**
 * The 1.2 s title card the hub shows on a game switch, mirrored here so the
 * standalone page carries it too. Decorative only: `.gsc-splash` is
 * `pointer-events: none`, it is skipped under prefers-reduced-motion, and the
 * embedded frame skips it because the hub shows its own.
 */
function ovhShowSplash() {
  const node = $("gsc-splash");
  if (!node) return;
  if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.body.classList.contains("gsc-embedded")) return;
  setText("gsc-splash-title", "1 vs 100");
  setText("gsc-splash-sub", "One player. The whole room is the Mob.");
  node.dataset.gscGame = "one-vs-100";
  node.classList.remove("hidden");
  if (ovhSplashTimer) clearTimeout(ovhSplashTimer);
  ovhSplashTimer = setTimeout(() => {
    ovhSplashTimer = null;
    node.classList.add("hidden");
  }, OVH_SPLASH_MS);
}

/* ============ Room binding ============ */

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone Mob would
 * otherwise be inherited by whoever is issued those pids next. A different room
 * code drops every phone seat; players the host typed in keep their own ids and
 * stay. The same code (a plain refresh) changes nothing.
 */
function ovhBindRoom(code) {
  if (typeof code !== "string" || !code || ovhApp.roomCode === code) return;
  const manual = new Set(ovhApp.setup.players.filter((p) => p.manual).map((p) => p.pid));
  const players = ovhApp.setup.players.filter((p) => p.manual);
  const usesPhones = (state) => !!state && (!state.mob.simulated
    || state.roster.some((p) => !manual.has(p.pid)));
  const dropped = usesPhones(ovhApp.core) || usesPhones(ovhApp.stashed);
  ovhSet({
    roomCode: code,
    core: usesPhones(ovhApp.core) ? null : ovhApp.core,
    stashed: usesPhones(ovhApp.stashed) ? null : ovhApp.stashed,
    setup: Object.assign({}, ovhApp.setup, {
      players,
      contestant: players.some((p) => p.pid === ovhApp.setup.contestant)
        ? ovhApp.setup.contestant : (players[0] ? players[0].pid : null),
    }),
  });
  if (dropped) {
    ovhError("This is a new room, so the game in progress was cleared — the phone seats belonged to the old one.");
  }
}

/* ============ Boot ============ */

/** Saved roster first, then any phone the shell added while we were loading. */
function ovhMergeRoster(savedSetup, current) {
  const players = (savedSetup.players || []).slice();
  current.forEach((p) => { if (!players.some((x) => x.pid === p.pid)) players.push(p); });
  return Object.assign({}, ovhApp.setup, savedSetup, { players });
}

/**
 * An explicit ?game=URL always wins over the saved game unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old questions when they follow a shared link. A URL that failed to load
 * must not cost them their game as well as their questions.
 */
function ovhChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.game && (!urlWon || saved.sourceUrl === wantUrl);
  const patch = {
    game: (useSaved && saved.game) || loaded.game,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (!useSaved && patch.game) Object.assign(patch, { setup: Object.assign({}, ovhApp.setup, ovhSettingsFrom(patch.game)) });
  if (saved && saved.setup) patch.setup = ovhMergeRoster(saved.setup, (patch.setup || ovhApp.setup).players);
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved) {
    patch.core = saved.core || null;
    patch.stashed = saved.stashed || null;
  } else if (saved && (saved.core || saved.stashed) && !ovhLoadMessage) {
    ovhLoadMessage = "Loaded the questions from the link, so the game in progress was cleared.";
  }
  return patch;
}

async function ovhBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  ovhShowSplash();
  if (mode.endsWith("-player")) return;   // ovh-phone.js owns the phone page

  // Read the saved game BEFORE the first await: ovh-room.js seeds the roster as
  // soon as the shell sends `init`, and that write would otherwise clobber the
  // state we are about to restore.
  const saved = ovhLoadSaved();

  ovhWireSetup();
  ovhWirePlay();
  ovhWireResult();
  ovhWireChrome();
  ovhStartClock();

  const loaded = await ovhLoadContent();
  ovhSet(ovhChooseContent(saved, loaded));
  ovhMountLibrary();
  if (ovhLoadMessage) ovhError(ovhLoadMessage);
}

/** The public surface ovh-editor.js / ovh-room.js / the harness build on. */
window.OvhApp = {
  state: () => ovhApp,
  core: () => ovhApp.core,
  dispatch: ovhDispatch,
  set: ovhSet,
  render: ovhRender,
  useGame: ovhUseGame,
  addPlayer: ovhAddPlayer,
  removePlayer: ovhRemovePlayer,
  setContestant: ovhSetContestant,
  pickOption: ovhPickOption,
  lock: ovhLock,
  start: ovhStart,
  resume: ovhResume,
  lobbyChoice: ovhLobbyChoice,
  error: ovhError,
  subscribe: (fn) => { if (typeof fn === "function") ovhListeners.push(fn); },
  bindRoom: ovhBindRoom,
  showSplash: ovhShowSplash,
  storeSuffix: ovhStoreSuffix,
  library: () => ovhLibraryHandle,
  setPhoneCount: (n) => { if (n !== ovhApp.phoneCount) ovhSet({ phoneCount: Number(n) || 0 }); },
  STORAGE_KEY: OVH_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { ovhBoot().catch((err) => ovhError(err.message)); });
} else {
  ovhBoot().catch((err) => ovhError(err.message));
}

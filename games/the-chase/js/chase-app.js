/* ============================================================
   The Chase — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the clocks and
   the sound cues. All game rules live in chase-rules.js; this
   file only dispatches events into the reducer and asks
   chase-view.js to paint the result. Every string reaches the
   page through textContent, and no Peer/DOM/timer handle is ever
   stored in the state.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run cannot leave harness
 * questions (or a half-played game) in the real host's save on the same origin.
 * Anything but letters, digits and hyphens is stripped.
 */
function chaseStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const CHASE_STORAGE_KEY = `gsc-chase-state-v1${chaseStoreSuffix()}`;
const CHASE_MAX_CONTESTANTS = 4;

/* ============ App state ============ */

let chaseApp = chaseFreshApp();
const chaseListeners = [];
let chaseClock = null;

function chaseFreshApp() {
  return {
    core: null,
    resumable: null,       // docs 19 §1: "Keep this game" parks the state here
    game: null,
    setup: {
      players: [],
      chaserMode: "host",
      chaserPid: "",
      chaserName: "The Chaser",
      shuffle: false,
      settingsTouched: false,
      settings: {
        steps: 7, startStep: 3, cashBuilderSeconds: 60, cashBuilderValue: 1000,
        higherMultiplier: 5, lowerDivisor: 2, finalSeconds: 120, headStartPerMember: 1,
      },
    },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phoneCount: 0,
    editorOpen: false,
    lobbyOpen: false,
  };
}

/** Replace part of the app state, persist, repaint. */
function chaseSet(patch) {
  chaseApp = Object.assign({}, chaseApp, patch);
  chaseSave();
  chaseRender();
}

function chaseRender() {
  window.ChaseView.render(chaseApp);
  if (chaseClock) chaseClock.refresh();
  chaseListeners.forEach((fn) => {
    try { fn(chaseApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** Send an event to the pure core, with the matching sound cue. */
function chaseDispatch(event) {
  const state = chaseApp.core;
  if (!state) return;
  const next = window.ChaseCore.reduce(state, event, Date.now());
  if (next === state) return;
  chaseCue(event, state, next);
  chaseSet({ core: next });
}

const CHASE_CUES = {
  offer: "offer", lock: "lock", cbStart: "start", finalTeamStart: "start",
  finalChaserStart: "start", nextQuestion: "deal", nextContestant: "deal",
};

function chaseCue(event, before, after) {
  if (event.type === "cbMark" || event.type === "finalTeamMark") { markCue(event, before, after); return; }
  if (event.type === "finalChaserMark") { chaserMarkCue(event, before, after); return; }
  if (event.type === "pushback") {
    window.ChaseSound.play(event.correct ? "pushback" : "wrong");
    return;
  }
  if (event.type === "revealContestant") { revealCue(before, after, "contestant"); return; }
  if (event.type === "revealChaser") { revealCue(before, after, "chaser"); return; }
  if (event.type === "cbExpired" || event.type === "finalTeamExpired") {
    window.ChaseSound.play("buzzer");
    return;
  }
  if (event.type === "finalChaserExpired") { window.ChaseSound.play("teamWins"); return; }
  if (Object.prototype.hasOwnProperty.call(CHASE_CUES, event.type)) {
    window.ChaseSound.play(CHASE_CUES[event.type]);
  }
}

function markCue(event, before, after) {
  window.ChaseSound.play(event.result === "correct" ? "correct"
    : (event.result === "pass" ? "pass" : "wrong"));
  void before; void after;
}

function chaserMarkCue(event, before, after) {
  if (after.phase === "result") { window.ChaseSound.play("chaserWins"); return; }
  if (event.result === "wrong") { window.ChaseSound.play("wrong"); return; }
  window.ChaseSound.play(event.result === "correct" ? "chaserStep" : "pass");
}

function revealCue(before, after, side) {
  const h = after.h2h;
  if (!h) return;
  if (h.outcome === "home") { window.ChaseSound.play("home"); return; }
  if (h.outcome === "caught") { window.ChaseSound.play("caught"); return; }
  const moved = h.moved[side];
  if (!moved) { window.ChaseSound.play("wrong"); return; }
  window.ChaseSound.play(side === "chaser" ? "chaserStep" : "stepDown");
}

/* ============ Persistence ============ */

function chaseSerialise() {
  return {
    core: chaseApp.core, resumable: chaseApp.resumable, game: chaseApp.game, setup: chaseApp.setup,
    source: chaseApp.source, sourceKind: chaseApp.sourceKind, sourceUrl: chaseApp.sourceUrl,
    roomCode: chaseApp.roomCode,
  };
}

function chaseSave() {
  try {
    localStorage.setItem(CHASE_STORAGE_KEY, JSON.stringify(chaseSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    chaseError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
function chaseUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.ChaseCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object" || !state.game.settings) return false;
  if (!state.order || !Array.isArray(state.order.rapid) || !Array.isArray(state.order.multi)) return false;
  if (!Array.isArray(state.contestants) || !state.contestants.length) return false;
  if (!Array.isArray(state.results) || state.results.length !== state.contestants.length) return false;
  if (!Array.isArray(state.history) || !state.chaser) return false;
  if (state.phase === "cashBuilder" && (!state.cb || !state.cb.clock)) return false;
  if (state.phase === "headToHead" && (!state.h2h || !state.h2h.locks)) return false;
  if ((state.phase === "finalTeam" || state.phase === "finalChaser")
    && (!state.final || !state.final.teamClock)) return false;
  return true;
}

/**
 * A running clock is a deadline in the PAST once the tab has been away, so
 * every restored round comes back paused with the time that was left: the host
 * presses Resume when the room is ready again (success state CH-I4).
 */
function chasePauseRestored(state) {
  if (!state) return state;
  const freeze = (clock) => {
    if (!clock) return clock;
    const left = clock.running && clock.deadline
      ? Math.max(0, clock.deadline - Date.now()) : clock.remainingMs;
    return { running: false, deadline: null, remainingMs: left };
  };
  const out = Object.assign({}, state);
  if (out.cb) out.cb = Object.assign({}, out.cb, { clock: freeze(out.cb.clock) });
  if (out.final) {
    out.final = Object.assign({}, out.final, {
      teamClock: freeze(out.final.teamClock),
      chaserClock: freeze(out.final.chaserClock),
    });
  }
  return out;
}

/**
 * A save we cannot use is always dropped — but never silently: the host is told
 * on the setup screen what happened, the way a failed `?game=` is.
 */
const CHASE_SAVE_UNREADABLE = "Your saved game couldn’t be read, so it was cleared";

function chaseLoadSaved() {
  try {
    const raw = localStorage.getItem(CHASE_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") {
      chaseNote(`${CHASE_SAVE_UNREADABLE} — this night starts fresh.`);
      return null;
    }
    if (saved.game) window.ChaseCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    const core = chaseUsableCore(saved.core) ? chasePauseRestored(saved.core) : null;
    const resumable = chaseUsableCore(saved.resumable) ? chasePauseRestored(saved.resumable) : null;
    if (saved.core && !core) {
      console.warn("Ignoring a saved game with a damaged state object.");
      chaseNote(`${CHASE_SAVE_UNREADABLE} — the questions and the team are still here.`);
    }
    return Object.assign({}, saved, { core, resumable });
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    chaseNote(`${CHASE_SAVE_UNREADABLE} — this night starts fresh.`);
    return null;
  }
}

function chaseError(message) {
  const node = $("chase-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let chaseLoadMessage = "";   // survives the chaseSet() in chaseBoot, which clears the banner

/** Add one sentence to the banner chaseBoot shows. Notes never overwrite. */
function chaseNote(text) {
  if (!text) return;
  chaseLoadMessage = chaseLoadMessage ? `${chaseLoadMessage} ${text}` : text;
}
// The first half of the ?game= failure banner. The second half depends on what
// chaseChooseContent settles on, so it is written there.
let chaseUrlFailure = "";

async function chaseFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.ChaseCore.validateGame(game);
  return { game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function chaseLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await chaseFetchGame(url, `Custom questions from ${url}`, "fetch");
    } catch (err) {
      chaseUrlFailure = `Could not load questions from ${url}: ${err.message}.`;
    }
  }
  try {
    return await chaseFetchGame("questions.json", "Built-in questions (questions.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = globalThis.CHASE_DEFAULT_GAME;
    if (!offline) {
      chaseLoadMessage = "No questions could be loaded at all — open the editor and build a set.";
      return { game: null, source: "No questions loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in questions (offline copy)", kind: "default", url: null };
  }
}

/**
 * A loaded file brings its own rules. They land in the setup screen so the host
 * can see and change them — unless the host has already touched a rule field,
 * in which case their choice wins.
 */
function chaseSettingsFromGame(game, setup) {
  if (!game || setup.settingsTouched) return setup.settings;
  const s = window.ChaseCore.settingsOf(game);
  const out = {};
  Object.keys(setup.settings).forEach((key) => { out[key] = s[key]; });
  return out;
}

/** Adopt a validated game — from the editor, a file, the library, or a URL. */
function chaseUseGame(game, source, kind) {
  window.ChaseCore.validateGame(game);
  const setup = Object.assign({}, chaseApp.setup);
  setup.settings = chaseSettingsFromGame(game, setup);
  setup.chaserName = window.ChaseCore.settingsOf(game).chaserName || setup.chaserName;
  chaseSet({ game, source: source || "Custom questions", sourceKind: kind || "upload",
    sourceUrl: null, core: null, resumable: null, setup });
  chaseError("");
}

function chaseOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      chaseUseGame(JSON.parse(String(reader.result)), `Custom questions from ${file.name}`, "upload");
    } catch (err) {
      chaseError(`That file is not a usable Chase game: ${err.message}`);
    }
  };
  reader.onerror = () => chaseError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ The question-set library (docs 19 §2) ============ */

function chaseMountLibrary() {
  const box = $("chase-library");
  if (!box) return;
  if (!window.GSCLibrary || typeof window.GSCLibrary.mountPicker !== "function") {
    box.replaceChildren(el("p", "hint",
      "The shared set library (shared/library.js) isn’t loaded, so the shipped sets can’t be listed. "
      + "Use “Load questions (.json)” with a file from games/the-chase/sets/ instead."));
    return;
  }
  window.GSCLibrary.mountPicker(box, {
    gameDir: "",
    label: "Question sets in the repo",
    validate: (json) => window.ChaseCore.validateGame(json),
    onPick: (json, meta) => chaseUseGame(json, `set: ${meta.name}`, "set"),
  });
}

/* ============ Setup screen ============ */

function chaseAddPlayer(name, pid, manual) {
  const clean = window.ChaseCore.cleanText(name, window.ChaseCore.NAME_MAX);
  if (!clean) { chaseError("Give the contestant a name first."); return false; }
  const players = chaseApp.setup.players;
  if (players.length >= CHASE_MAX_CONTESTANTS + 1) {
    chaseError(`That is enough for a team of ${CHASE_MAX_CONTESTANTS} and a Chaser.`);
    return false;
  }
  const twin = players.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (twin) {
    // A phone that shares a name with somebody the host typed in IS that person,
    // arriving with a phone. Take over the typed row instead of refusing a seat.
    if (manual === false && pid && twin.manual) return chaseAdoptSeat(twin, pid);
    chaseError(`${clean} is already on the list — pick another name.`);
    return false;
  }
  const id = pid || `m${Date.now().toString(36)}${players.length}`;
  chaseSet({ setup: Object.assign({}, chaseApp.setup, {
    players: players.concat([{ pid: id, name: clean, manual: manual !== false }]),
  }) });
  chaseError("");
  return true;
}

/** Hand a typed contestant's row to the phone that just joined under that name. */
function chaseAdoptSeat(row, pid) {
  const setup = chaseApp.setup;
  chaseSet({ setup: Object.assign({}, setup, {
    players: setup.players.map((p) => (p.pid === row.pid ? { pid, name: p.name, manual: false } : p)),
    chaserPid: setup.chaserPid === row.pid ? pid : setup.chaserPid,
  }) });
  chaseError("");
  return true;
}

function chaseRemovePlayer(pid) {
  const setup = chaseApp.setup;
  chaseSet({ setup: Object.assign({}, setup, {
    players: setup.players.filter((p) => p.pid !== pid),
    chaserPid: setup.chaserPid === pid ? "" : setup.chaserPid,
  }) });
}

/** Re-order the hot seats: the team plays in list order. */
function chaseMovePlayer(index, delta) {
  const players = chaseApp.setup.players.slice();
  const to = index + delta;
  if (index < 0 || index >= players.length || to < 0 || to >= players.length) return;
  const moved = players.splice(index, 1)[0];
  players.splice(to, 0, moved);
  chaseSet({ setup: Object.assign({}, chaseApp.setup, { players }) });
}

/** The game the reducer actually plays: the file with the host's rules on top. */
function chaseEffectiveGame() {
  const game = JSON.parse(JSON.stringify(chaseApp.game));
  game.settings = Object.assign({}, game.settings, chaseApp.setup.settings, {
    chaserIsHost: chaseApp.setup.chaserMode !== "player",
    chaserName: chaseApp.setup.chaserName || "The Chaser",
  });
  return game;
}

function chaseContestantsForCore() {
  const chaserPid = chaseApp.setup.chaserMode === "player" ? chaseApp.setup.chaserPid : "";
  return chaseApp.setup.players
    .filter((p) => p.pid !== chaserPid)
    .slice(0, CHASE_MAX_CONTESTANTS)
    .map((p) => ({ pid: p.pid, name: p.name }));
}

function chaseStart() {
  try {
    if (!chaseApp.game) throw new Error("Questions are still loading — try again in a second.");
    const contestants = chaseContestantsForCore();
    if (!contestants.length) throw new Error("Add at least one contestant before you start.");
    const player = chaseApp.setup.chaserMode === "player";
    if (player && !chaseApp.setup.chaserPid) throw new Error("Pick which player is the Chaser.");
    const state = window.ChaseCore.createState(chaseEffectiveGame(), {
      contestants,
      chaser: { isHost: !player, pid: chaseApp.setup.chaserPid, name: chaseApp.setup.chaserName },
      shuffle: !!chaseApp.setup.shuffle,
    });
    chaseSet({ core: window.ChaseCore.reduce(state, { type: "start" }, Date.now()), resumable: null });
    chaseError("");
  } catch (err) {
    chaseError(err.message);
  }
}

/* ============ The game-lobby button (docs 19 §1) ============ */

function chaseOpenLobby() {
  chaseSet({ lobbyOpen: true });
}

/** Keep: park the game in progress and show Resume on the setup screen. */
function chaseLobbyKeep() {
  // The parked game keeps its clocks frozen with the time that was left
  // (triage: clocks stored as remaining time), so Resume never loses a second.
  const parked = chaseApp.core ? chasePauseRestored(chaseApp.core) : chaseApp.resumable;
  chaseSet({ lobbyOpen: false, resumable: parked, core: null });
}

/** Start over: the game in progress goes; roster, questions and rules stay. */
function chaseLobbyStartOver() {
  chaseSet({ lobbyOpen: false, resumable: null, core: null });
}

function chaseResume() {
  if (!chaseApp.resumable) return;
  chaseSet({ core: chaseApp.resumable, resumable: null });
}

/* ============ Host actions ============ */

/** Start / pause whichever clock the phase in play owns. */
function chaseToggleClock() {
  const state = chaseApp.core;
  if (!state) return;
  const clock = chaseClockOf(state);
  if (!clock) return;
  const names = {
    cashBuilder: ["cbStart", "cbPause"],
    finalTeam: ["finalTeamStart", "finalTeamPause"],
    finalChaser: ["finalChaserStart", "finalChaserPause"],
  };
  const pair = Object.prototype.hasOwnProperty.call(names, state.phase) ? names[state.phase] : null;
  if (!pair) return;
  chaseDispatch({ type: clock.running ? pair[1] : pair[0] });
}

/** The clock the current phase is running, or null. */
function chaseClockOf(state) {
  if (!state) return null;
  if (state.phase === "cashBuilder" && state.cb) return state.cb.clock;
  if (state.phase === "finalTeam" && state.final) return state.final.teamClock;
  if (state.phase === "finalChaser" && state.final) return state.final.chaserClock;
  return null;
}

function chaseExpire() {
  const state = chaseApp.core;
  if (!state) return;
  const events = { cashBuilder: "cbExpired", finalTeam: "finalTeamExpired", finalChaser: "finalChaserExpired" };
  if (!Object.prototype.hasOwnProperty.call(events, state.phase)) return;
  chaseDispatch({ type: events[state.phase] });
}

/** The host locks a side's answer. The letter never reaches the screen. */
function chaseLock(side, idx) {
  chaseDispatch({ type: "lock", side, idx });
}

/** Judge the rapid-fire question in play, whichever round we are in. */
function chaseMark(result) {
  const state = chaseApp.core;
  if (!state) return;
  if (state.phase === "cashBuilder") { chaseDispatch({ type: "cbMark", result }); return; }
  if (state.phase === "finalTeam") { chaseDispatch({ type: "finalTeamMark", result }); return; }
  if (state.phase === "finalChaser") chaseDispatch({ type: "finalChaserMark", result });
}

/**
 * An intent from a phone. The host is still the judge: the core decides whether
 * this pid may act at all — it must be the contestant in the hot seat, or the
 * Chaser when a player is playing him, and the question must still be open.
 * Nothing a phone sends can judge, reveal or move a marker.
 * @param {string} pid @param {{t:string, idx:number}} msg
 */
function chasePhoneIntent(pid, msg) {
  const state = chaseApp.core;
  if (!state || msg.t !== "lock") return;
  const side = window.ChaseCore.lockSideFor(state, pid);
  if (!side) return;
  chaseDispatch({ type: "lock", side, idx: msg.idx });
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone players would
 * otherwise be inherited by whoever is issued that pid next. A different room
 * code drops every phone seat; contestants the host typed in keep their ids.
 */
function chaseBindRoom(code) {
  if (typeof code !== "string" || !code || chaseApp.roomCode === code) return;
  const manual = new Set(chaseApp.setup.players.filter((p) => p.manual).map((p) => p.pid));
  const players = chaseApp.setup.players.filter((p) => p.manual);
  let core = chaseApp.core;
  let resumable = chaseApp.resumable;
  let message = "";
  const phoneSeated = (st) => !!st && (st.contestants.some((c) => !manual.has(c.pid))
    || (st.chaser.pid && !manual.has(st.chaser.pid)));
  if (phoneSeated(core) || phoneSeated(resumable)) {
    core = phoneSeated(core) ? null : core;
    resumable = phoneSeated(resumable) ? null : resumable;
    message = "This is a new room, so the game in progress was cleared — the phone seats belonged "
      + "to the old one.";
  }
  chaseSet({ roomCode: code, core, resumable, setup: Object.assign({}, chaseApp.setup, {
    players,
    chaserPid: manual.has(chaseApp.setup.chaserPid) ? chaseApp.setup.chaserPid : "",
  }) });
  if (message) chaseError(message);
}

/* ============ Hotkeys ============ */

function chaseIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

function chaseIsSpace(event) {
  return event.key === " " || event.key === "Spacebar" || event.code === "Space";
}

function chaseOnKey(event) {
  if (chaseIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (chaseApp.editorOpen || chaseApp.lobbyOpen) return;
  const state = chaseApp.core;
  if (!state) return;
  const key = String(event.key).toLowerCase();
  if (key === "u") { event.preventDefault(); chaseDispatch({ type: "undo" }); return; }
  if (state.phase === "headToHead") { chaseBoardKey(event, key); return; }
  chaseRapidKey(event, key, state);
}

function chaseRapidKey(event, key, state) {
  if (event.key === "Enter") { event.preventDefault(); chaseToggleClock(); return; }
  if (state.phase === "finalChaser" && state.final && state.final.pushback) {
    if (chaseIsSpace(event)) { event.preventDefault(); chaseDispatch({ type: "pushback", correct: true }); return; }
    if (key === "w") { event.preventDefault(); chaseDispatch({ type: "pushback", correct: false }); return; }
  }
  if (chaseIsSpace(event)) { event.preventDefault(); chaseMark("correct"); return; }
  if (key === "w") { event.preventDefault(); chaseMark("wrong"); return; }
  if (key === "p") { event.preventDefault(); chaseMark("pass"); return; }
  if (key === "n") { event.preventDefault(); chaseDispatch({ type: "nextQuestion" }); }
}

function chaseBoardKey(event, key) {
  if (key === "1") { event.preventDefault(); chaseDispatch({ type: "revealContestant" }); return; }
  if (key === "2") { event.preventDefault(); chaseDispatch({ type: "revealChaser" }); return; }
  if (key !== "n") return;
  event.preventDefault();
  const h = chaseApp.core.h2h;
  chaseDispatch({ type: h && h.outcome ? "nextContestant" : "nextQuestion" });
}

/* ============ The clock ============ */

function chaseWireClock() {
  chaseClock = window.ChaseClock.create({
    els: [$("chase-cash-clock"), $("chase-final-clock")],
    getClock: () => chaseClockOf(chaseApp.core),
    onExpire: chaseExpire,
    onTick: () => window.ChaseSound.play("tick"),
  });
  chaseClock.start();
}

/* ============ The public surface ============ */

/** What chase-wire.js, chase-editor.js, chase-room.js and the harness build on. */
window.ChaseApp = {
  state: () => chaseApp,
  core: () => chaseApp.core,
  dispatch: chaseDispatch,
  set: chaseSet,
  render: chaseRender,
  useGame: chaseUseGame,
  addPlayer: chaseAddPlayer,
  removePlayer: chaseRemovePlayer,
  movePlayer: chaseMovePlayer,
  error: chaseError,
  subscribe: (fn) => { if (typeof fn === "function") chaseListeners.push(fn); },
  start: chaseStart,
  resume: chaseResume,
  lock: chaseLock,
  mark: chaseMark,
  toggleClock: chaseToggleClock,
  phoneIntent: chasePhoneIntent,
  bindRoom: chaseBindRoom,
  showSplash: () => window.ChaseView.showSplash(),
  storeSuffix: chaseStoreSuffix,
  setPhoneCount: (n) => { if (n !== chaseApp.phoneCount) chaseSet({ phoneCount: Number(n) || 0 }); },
  STORAGE_KEY: CHASE_STORAGE_KEY,
};

/* ============================================================
   Chain Reaction — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the Speed Chain
   clock and the sound cues. All game rules live in cr-core.js;
   this file only dispatches events into the reducer and asks
   cr-view.js to paint the result. Every string reaches the page
   through textContent, and no Peer/DOM/timer handle is ever
   stored in the state.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run cannot leave harness
 * chains (or a half-played game) in the real host's save on the same origin.
 * Anything but letters, digits and hyphens is stripped.
 */
function crStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const CR_STORAGE_KEY = `gsc-cr-state-v1${crStoreSuffix()}`;

let crApp = crFreshApp();
const crListeners = [];
let crClock = null;

function crFreshApp() {
  return {
    core: null,
    game: null,
    setup: { teamNames: ["Team Blue", "Team Pink"], assign: {}, settings: crSettingsFor(null) },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    players: [],
    editorOpen: false,
    peek: false,
  };
}

/** Replace part of the app state, persist, repaint. */
function crSet(patch) {
  crApp = Object.assign({}, crApp, patch);
  crSave();
  crRender();
}

function crRender() {
  window.CrView.render(crApp);
  if (crClock) crClock.refresh();
  crListeners.forEach((fn) => {
    try { fn(crApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/* ============ Dispatch + cues ============ */

const CR_CUES = { reveal: "tick", nextChain: "chain", speedStart: "start", speedExpired: "times" };

function crCue(event, before, after) {
  if (event.type === "judge") {
    window.CrSound.play(event.correct ? "reveal" : "wrong");
    return;
  }
  if (event.type === "speedMark") {
    window.CrSound.play(event.result === "got" ? "tick" : "wrong");
  }
  if (after.phase === "result") { window.CrSound.play("win"); return; }
  if (after.speed && after.speed.over && !(before.speed && before.speed.over)) {
    window.CrSound.play(after.speed.allClear ? "bonus" : "times");
    return;
  }
  if (before.phase === "chain" && after.phase === "chainDone") { window.CrSound.play("chain"); return; }
  const cue = Object.prototype.hasOwnProperty.call(CR_CUES, event.type) ? CR_CUES[event.type] : null;
  if (cue) window.CrSound.play(cue);
}

/** Send an event to the pure core, with the matching sound cue. */
function crDispatch(event) {
  const state = crApp.core;
  if (!state) return;
  const next = window.CrCore.reduce(state, event, Math.random, Date.now());
  if (next === state) return;
  crCue(event, state, next);
  // The peek is the host's private look at ONE word; it never survives a
  // judgement, an undo or a new target.
  const keepPeek = event.type === "guess" && next.target === state.target;
  crSet({ core: next, peek: keepPeek ? crApp.peek : false });
  if (crClock && event.type === "undo") crClock.reset();
}

/* ============ Persistence ============ */

/**
 * The state as it goes to localStorage. A RUNNING Speed Chain clock is written
 * PAUSED, with the time that was left at the moment of the save: an absolute
 * deadline would keep burning while the tab is closed, so a reload two minutes
 * later would come back to a round that had already ended (CR-2). The live
 * state is untouched — saving never stops the host's clock — and `beforeunload`
 * / `visibilitychange` both save, so the frozen time is accurate.
 */
function crSerialise() {
  const core = crApp.core;
  const frozen = core && core.speed && core.speed.started && !core.speed.over
    ? Object.assign({}, core, { speed: window.CrCore.pauseSpeed(core.speed, Date.now()) })
    : core;
  return {
    core: frozen, game: crApp.game, setup: crApp.setup, source: crApp.source,
    sourceKind: crApp.sourceKind, sourceUrl: crApp.sourceUrl, roomCode: crApp.roomCode,
  };
}

function crSave() {
  try {
    localStorage.setItem(CR_STORAGE_KEY, JSON.stringify(crSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    crError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
const CR_CORE_ARRAYS = ["teams", "scores", "chainOrder", "history"];

/** Is this a state the reducer can safely be handed? A hand-edited or
    half-written save is REJECTED here rather than discovered by a handler
    dereferencing a missing field. */
function crUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.CrCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object") return false;
  if (CR_CORE_ARRAYS.some((k) => !Array.isArray(state[k]))) return false;
  if (state.teams.length !== 2 || state.scores.length !== 2) return false;
  if (!Number.isInteger(state.chainIndex) || (state.control !== 0 && state.control !== 1)) return false;
  const s = state.game.settings;
  if (!s || !Array.isArray(s.values) || !Array.isArray(state.game.chains)) return false;
  if (!Array.isArray(state.game.speedChains)) return false;
  const needsChain = state.phase === "chain" || state.phase === "chainDone";
  if (needsChain && (!state.chain || !Array.isArray(state.chain.words))) return false;
  if (state.phase === "speed" && (!state.speed || !Array.isArray(state.speed.queue))) return false;
  if (state.phase === "sudden" && (!state.sudden || typeof state.sudden.word !== "string")) return false;
  return true;
}

function crLoadSaved() {
  try {
    const raw = localStorage.getItem(CR_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.game) window.CrCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (saved.core !== null && saved.core !== undefined && !crUsableCore(saved.core)) {
      console.warn("Ignoring a saved game with a damaged state object.");
      return Object.assign({}, saved, { core: null });
    }
    // Belt and braces for CR-2: crSerialise already freezes a running clock, but
    // a save written by an older build (or by hand) can still carry one. Pause
    // it here so a restored deadline can never expire on the first paint.
    if (saved.core && saved.core.speed && saved.core.speed.started && !saved.core.speed.over) {
      saved.core = Object.assign({}, saved.core, {
        speed: window.CrCore.pauseSpeed(saved.core.speed, Date.now()),
      });
    }
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

function crError(message) {
  const node = $("cr-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let crLoadMessage = "";   // survives the crSet() in crBoot, which clears the banner

async function crFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.CrCore.validateGame(game);
  return { game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function crLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await crFetchGame(url, `Custom chains from ${url}`, "fetch");
    } catch (err) {
      // The inner message usually ends in a full stop of its own.
      const why = String(err.message || "").replace(/\.\s*$/, "");
      crLoadMessage = `Could not load chains from ${url}: ${why}. Using the built-in set instead.`;
    }
  }
  try {
    return await crFetchGame("chains.json", "Built-in chains (chains.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = globalThis.CR_DEFAULT_GAME;
    if (!offline) {
      crLoadMessage = "No chains could be loaded at all — open the editor and build a set.";
      return { game: null, source: "No chains loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in chains (offline copy)", kind: "default", url: null };
  }
}

/** The settings the host is actually playing with: the file, plus their edits. */
function crSettingsFor(game) {
  const base = game ? game.settings : window.CrCore.DEFAULT_SETTINGS;
  return {
    currency: base.currency,
    values: base.values.slice(),
    speedSeconds: base.speedSeconds,
    speedPerWord: base.speedPerWord,
    speedAllClear: base.speedAllClear,
    speedAllClearLabel: base.speedAllClearLabel,
    revealOnWrong: base.revealOnWrong,
  };
}

/** Adopt a validated game — from the editor, a file, or a URL. */
function crUseGame(game, source, kind) {
  const clean = window.CrCore.normalizeGame(game);
  // sourceUrl is cleared: this content no longer came from the ?game= link, so
  // a reload of that link must fetch it again rather than resurrect this copy.
  crSet({
    game: clean, source: source || "Custom chains", sourceKind: kind || "upload",
    sourceUrl: null, core: null,
    setup: Object.assign({}, crApp.setup, { settings: crSettingsFor(clean) }),
  });
  crError("");
}

function crOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      crUseGame(JSON.parse(String(reader.result)), `Custom chains from ${file.name}`, "upload");
    } catch (err) {
      crError(`That file is not a usable Chain Reaction game: ${err.message}`);
    }
  };
  reader.onerror = () => crError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function crSetSetup(patch) {
  crSet({ setup: Object.assign({}, crApp.setup, patch) });
}

function crSetSettings(patch) {
  crSetSetup({ settings: Object.assign({}, crApp.setup.settings, patch) });
}

/** Put a phone on a team (or take it off with `null`). */
function crAssign(pid, team) {
  const assign = Object.assign({}, crApp.setup.assign);
  if (team === null || team === undefined) delete assign[pid];
  else assign[pid] = team;
  crSetSetup({ assign });
}

function crPidsFor(team) {
  return crApp.players
    .filter((p) => crApp.setup.assign[p.pid] === team)
    .map((p) => p.pid);
}

function crSetPlayers(players) {
  const list = Array.isArray(players) ? players : [];
  if (JSON.stringify(list) === JSON.stringify(crApp.players)) return;
  crSet({ players: list });
}

function crStart() {
  try {
    if (!crApp.game) throw new Error("Chains are still loading — try again in a second.");
    const teams = [0, 1].map((i) => ({
      name: crApp.setup.teamNames[i],
      pids: crPidsFor(i),
    }));
    const game = Object.assign({}, crApp.game, { settings: crApp.setup.settings });
    const state = window.CrCore.createState(game, teams, {});
    crSet({ core: window.CrCore.reduce(state, { type: "start" }, Math.random, Date.now()), peek: false });
    crError("");
  } catch (err) {
    crError(err.message);
  }
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone teams would
 * otherwise be inherited by whoever is issued that pid next. A DIFFERENT room
 * code drops every phone seat and any game that depended on one; the same code
 * (a plain refresh) changes nothing.
 *
 * Binding for the FIRST time only records the code. The room resolves after the
 * page has booted, so a host who has already put phones on teams (or opened a
 * room mid-game) must not have that thrown away by the first bind.
 */
function crBindRoom(code) {
  if (typeof code !== "string" || !code || crApp.roomCode === code) return;
  if (crApp.roomCode === null) { crSet({ roomCode: code }); return; }
  const hadPhones = Object.keys(crApp.setup.assign).length > 0;
  const dropped = hadPhones && !!crApp.core;
  crSet({
    roomCode: code,
    core: hadPhones ? null : crApp.core,
    peek: false,
    setup: Object.assign({}, crApp.setup, { assign: {} }),
  });
  if (dropped) {
    crError("This is a new room, so the game in progress was cleared — the phone teams belonged to the old one.");
  }
}

/* ============ Speed Chain clock ============ */

/**
 * The clock only runs while the round is running. A restored save is paused
 * (`started: false`, no deadline), so `speedExpired` can never fire on the
 * first paint after a reload — the host presses Start again and resumes.
 */
function crSpeedDeadline() {
  const state = crApp.core;
  if (!state || state.phase !== "speed" || !state.speed) return null;
  const sp = state.speed;
  if (!sp.started || sp.over) return null;
  return Number.isFinite(sp.deadline) ? sp.deadline : null;
}

/** What the clock shows when it is NOT running: 0 once the round is over, and
    otherwise whatever is left — the round length before it has ever started. */
function crSpeedSeconds() {
  const state = crApp.core;
  if (!state || !state.speed) return 0;
  const sp = state.speed;
  if (sp.over) return 0;
  const left = Number.isFinite(sp.remainingMs) ? sp.remainingMs : sp.seconds * 1000;
  return Math.ceil(left / 1000);
}

function crStartClock() {
  const node = $("cr-speed-clock");
  if (!node || !window.CrClock) return;
  crClock = window.CrClock.create({
    el: node,
    getDeadline: crSpeedDeadline,
    getSeconds: crSpeedSeconds,
    onExpire: () => crDispatch({ type: "speedExpired" }),
    onTick: () => window.CrSound.play("beat"),
  });
  crClock.start();
}

/* ============ Hotkeys ============ */

function crIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

const CR_CHAIN_KEYS = {
  t: () => crDispatch({ type: "reveal", direction: "top" }),
  b: () => crDispatch({ type: "reveal", direction: "bottom" }),
  y: () => crDispatch({ type: "judge", correct: true }),
  n: () => crDispatch({ type: "judge", correct: false }),
  p: () => crDispatch({ type: "passControl" }),
  u: () => crDispatch({ type: "undo" }),
};

const CR_SPEED_KEYS = {
  s: () => crDispatch({ type: "speedStart" }),
  y: () => crDispatch({ type: "speedMark", result: "got" }),
  p: () => crDispatch({ type: "speedMark", result: "pass" }),
  u: () => crDispatch({ type: "undo" }),
};

const CR_SUDDEN_KEYS = {
  r: () => crDispatch({ type: "reveal", direction: "top" }),
  y: () => crDispatch({ type: "judge", correct: true }),
  n: () => crDispatch({ type: "judge", correct: false }),
  p: () => crDispatch({ type: "passControl" }),
  u: () => crDispatch({ type: "undo" }),
};

const CR_KEYMAPS = { chain: CR_CHAIN_KEYS, speed: CR_SPEED_KEYS, sudden: CR_SUDDEN_KEYS };

function crOnKey(event) {
  if (crIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (crApp.editorOpen) return;
  const state = crApp.core;
  if (!state) return;
  if (state.phase === "chainDone") {
    if (String(event.key).toLowerCase() !== "u") return;
    event.preventDefault();
    crDispatch({ type: "undo" });
    return;
  }
  const map = Object.prototype.hasOwnProperty.call(CR_KEYMAPS, state.phase) ? CR_KEYMAPS[state.phase] : null;
  if (!map) return;
  const key = event.key === "Enter" ? "y" : String(event.key).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(map, key)) return;
  event.preventDefault();
  map[key]();
}

/* ============ Wiring ============ */

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function crWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function crParseValues(text) {
  return String(text).split(",")
    .map((part) => Math.round(Number(part.trim())))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, window.CrCore.DEFAULT_SETTINGS.values.length + 3);
}

function crWireSetup() {
  [0, 1].forEach((i) => {
    $(`cr-team-${i}`).addEventListener("input", (e) => {
      const names = crApp.setup.teamNames.slice();
      names[i] = e.target.value.slice(0, window.CrCore.NAME_MAX);
      crSetSetup({ teamNames: names });
    });
  });
  $("cr-set-values").addEventListener("input", (e) => {
    const values = crParseValues(e.target.value);
    if (values.length) crSetSettings({ values });
  });
  const number = (id, key, lo, hi) => $(id).addEventListener("input", (e) => {
    const n = Math.round(Number(e.target.value));
    if (Number.isFinite(n) && n >= lo && n <= hi) crSetSettings({ [key]: n });
  });
  number("cr-set-seconds", "speedSeconds", 10, 300);
  number("cr-set-per-word", "speedPerWord", 0, 1000000);
  number("cr-set-all-clear", "speedAllClear", 0, 1000000);
  $("cr-set-reveal-wrong").addEventListener("change", (e) => crSetSettings({ revealOnWrong: e.target.checked }));
  $("btn-load-json").addEventListener("click", () => $("cr-file").click());
  $("cr-file").addEventListener("change", crOnFile);
  $("btn-start").addEventListener("click", crStart);
}

function crWireChain() {
  crWireButton("btn-reveal-top", () => crDispatch({ type: "reveal", direction: "top" }));
  crWireButton("btn-reveal-bottom", () => crDispatch({ type: "reveal", direction: "bottom" }));
  crWireButton("btn-correct", () => crDispatch({ type: "judge", correct: true }));
  crWireButton("btn-wrong", () => crDispatch({ type: "judge", correct: false }));
  crWireButton("btn-pass", () => crDispatch({ type: "passControl" }));
  crWireButton("btn-undo", () => crDispatch({ type: "undo" }));
  crWireButton("btn-end", () => crDispatch({ type: "finish" }));
  crWireButton("btn-peek", () => crSet({ peek: !crApp.peek }));
  $("cr-guess").addEventListener("input", (e) => crDispatch({ type: "guess", text: e.target.value }));
}

function crWireSudden() {
  crWireButton("btn-sudden-reveal", () => crDispatch({ type: "reveal", direction: "top" }));
  crWireButton("btn-sudden-pass", () => crDispatch({ type: "passControl" }));
  crWireButton("btn-sudden-correct", () => crDispatch({ type: "judge", correct: true }));
  crWireButton("btn-sudden-wrong", () => crDispatch({ type: "judge", correct: false }));
  crWireButton("btn-sudden-undo", () => crDispatch({ type: "undo" }));
}

function crWireSpeed() {
  crWireButton("btn-speed-start", () => crDispatch({ type: "speedStart" }));
  crWireButton("btn-speed-got", () => crDispatch({ type: "speedMark", result: "got" }));
  crWireButton("btn-speed-pass", () => crDispatch({ type: "speedMark", result: "pass" }));
  crWireButton("btn-speed-done", () => crDispatch({ type: "finish" }));
  crWireButton("btn-speed-undo", () => crDispatch({ type: "undo" }));
}

function crWireInterstitial() {
  crWireButton("btn-next-chain", () => crDispatch({ type: "nextChain" }));
  crWireButton("btn-sudden", () => crDispatch({ type: "suddenDeath" }));
  crWireButton("btn-to-speed", () => crDispatch({ type: "toSpeed", team: null }));
  crWireButton("btn-inter-undo", () => crDispatch({ type: "undo" }));
  crWireButton("btn-inter-end", () => crDispatch({ type: "finish" }));
}

function crWireResult() {
  crWireButton("btn-play-again", () => crSet({ core: null, peek: false }));
  crWireButton("btn-result-undo", () => crDispatch({ type: "undo" }));
}

function crWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.CrSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.CrSound.enabled));
  };
  sound.addEventListener("click", () => { window.CrSound.toggle(); paint(); });
  paint();
  document.addEventListener("keydown", crOnKey);
  window.addEventListener("beforeunload", crSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) crSave(); });
}

/* ============ Splash ============ */

const CR_SPLASH_MS = 1200;
let crSplashTimer = null;

/**
 * The 1.2 s title card the hub shows on a game switch, mirrored here so a
 * standalone open carries it too (copied from js/hub-host.js showSplash()).
 * Decorative only: `.gsc-splash` is `pointer-events: none`, and the whole
 * thing is skipped under prefers-reduced-motion and when embedded.
 */
function crShowSplash() {
  const node = $("gsc-splash");
  if (!node) return;
  if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.body.classList.contains("gsc-embedded")) return;
  setText("gsc-splash-title", "Chain Reaction");
  setText("gsc-splash-sub", "Eight words. One chain. Two teams.");
  node.dataset.gscGame = "chain-reaction";
  node.classList.remove("hidden");
  if (crSplashTimer) clearTimeout(crSplashTimer);
  crSplashTimer = setTimeout(() => {
    crSplashTimer = null;
    node.classList.add("hidden");
  }, CR_SPLASH_MS);
}

/* ============ Boot ============ */

/**
 * An explicit ?game=URL always wins over the saved game unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old chains when they follow a shared link. A URL that failed to load
 * must not cost them their game as well as their chains.
 */
function crChooseContent(saved, loaded) {
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
    patch.setup = Object.assign({}, crApp.setup, saved.setup, {
      settings: saved.setup.settings || crSettingsFor(game),
    });
  } else {
    patch.setup = Object.assign({}, crApp.setup, { settings: crSettingsFor(game) });
  }
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved && saved.core) patch.core = saved.core;
  if (!useSaved && saved && saved.core && !crLoadMessage) {
    crLoadMessage = "Loaded the chains from the link, so the game in progress was cleared.";
  }
  return patch;
}

async function crBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  crShowSplash();                        // embedded and standalone, host and phone
  if (mode.endsWith("-player")) return;  // cr-phone.js owns the phone page

  // Read the saved game BEFORE the first await: cr-room.js seeds the roster as
  // soon as the shell sends `init`, and that write would otherwise clobber the
  // state we are about to restore.
  const saved = crLoadSaved();

  crWireSetup();
  crWireChain();
  crWireSudden();
  crWireSpeed();
  crWireInterstitial();
  crWireResult();
  crWireChrome();
  crStartClock();

  const loaded = await crLoadContent();
  crSet(crChooseContent(saved, loaded));
  if (crLoadMessage) crError(crLoadMessage);
}

/** The public surface cr-editor.js / cr-room.js / the harness build on. */
window.CrApp = {
  state: () => crApp,
  core: () => crApp.core,
  dispatch: crDispatch,
  set: crSet,
  render: crRender,
  useGame: crUseGame,
  error: crError,
  subscribe: (fn) => { if (typeof fn === "function") crListeners.push(fn); },
  assign: crAssign,
  setPlayers: crSetPlayers,
  players: () => crApp.players.slice(),
  start: crStart,
  bindRoom: crBindRoom,
  showSplash: crShowSplash,
  clock: () => crClock,
  storeSuffix: crStoreSuffix,
  STORAGE_KEY: CR_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { crBoot().catch((err) => crError(err.message)); });
} else {
  crBoot().catch((err) => crError(err.message));
}

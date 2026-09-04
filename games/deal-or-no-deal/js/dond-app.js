/* ============================================================
   Deal or No Deal — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, and the sound
   cues. All game rules live in dond-core.js; this file only
   dispatches events into the reducer and asks dond-view.js to
   paint the result. Every string reaches the page through
   textContent, and no Peer/DOM/timer handle is ever stored in the
   state.
   ============================================================ */

"use strict";

const DOND_STORAGE_KEY = "gsc-dond-state-v1";

/* ============ App state ============ */

let dondApp = dondFreshApp();
const dondListeners = [];

function dondFreshApp() {
  return {
    core: null,
    game: null,
    setup: { players: [], allowSwap: null, audienceAdvice: null },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phoneCount: 0,
    editorOpen: false,
    evShown: false,
  };
}

/** Replace part of the app state, persist, repaint. */
function dondSet(patch) {
  dondApp = Object.assign({}, dondApp, patch);
  dondSave();
  dondRender();
}

function dondRender() {
  window.DondView.render(dondApp);
  dondListeners.forEach((fn) => {
    try { fn(dondApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** Send an event to the pure core, with the matching sound cue. */
function dondDispatch(event) {
  const state = dondApp.core;
  if (!state) return;
  const next = window.DondCore.reduce(state, event, Math.random);
  if (next === state) return;
  dondCue(event, state, next);
  dondSet({ core: next, evShown: event.type === "bankerOffer" ? false : dondApp.evShown });
}

/* ============ Sound cues ============ */

const DOND_CUES = {
  pickCase: "pick", bankerOffer: "ring", deal: "deal", noDeal: "nodeal",
  revealOwn: "win", adviceVote: "vote", swap: "pick",
};

/** How long the flip runs before the sting lands. */
const DOND_STING_MS = 260;

function dondCue(event, before, after) {
  if (event.type === "openCase" || event.type === "revealRest") {
    dondOpenCue(before, after);
    return;
  }
  const cue = DOND_CUES[event.type];
  if (cue) window.DondSound.play(cue);
}

/**
 * A case is only good or bad news relative to what was still on the board: an
 * amount at or above the median of the sealed amounts is a groan, below it a
 * cheer. The click plays at once and the sting lands as the case finishes
 * flipping (the timer is local; nothing about it reaches the state).
 */
function dondOpenCue(before, after) {
  window.DondSound.play("open");
  const opened = window.DondCore.caseByN(after, after.lastOpened);
  if (!opened) return;
  const pool = window.DondCore.remainingAmounts(before).slice().sort((a, b) => a - b);
  if (!pool.length) return;
  const median = pool[Math.floor(pool.length / 2)];
  setTimeout(() => window.DondSound.play(opened.amount >= median ? "bad" : "good"), DOND_STING_MS);
}

/* ============ Persistence ============ */

function dondSerialise() {
  return {
    core: dondApp.core, game: dondApp.game, setup: dondApp.setup, source: dondApp.source,
    sourceKind: dondApp.sourceKind, sourceUrl: dondApp.sourceUrl, roomCode: dondApp.roomCode,
  };
}

function dondSave() {
  try {
    localStorage.setItem(DOND_STORAGE_KEY, JSON.stringify(dondSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    dondError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
const DOND_CORE_ARRAYS = ["roster", "contestants", "cases", "offers", "history"];

/** Is this a state the reducer can safely be handed? A hand-edited or
    half-written save is REJECTED here rather than discovered by a handler
    dereferencing a missing field. */
function dondUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.DondCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object") return false;
  if (DOND_CORE_ARRAYS.some((k) => !Array.isArray(state[k]))) return false;
  if (!state.advice || typeof state.advice !== "object" || Array.isArray(state.advice)) return false;
  if (!Number.isInteger(state.round) || !Number.isInteger(state.toOpen)) return false;
  const s = state.game.settings;
  if (!s || !Array.isArray(s.amounts) || !Array.isArray(s.rounds)) return false;
  const playing = ["pick", "round", "offer", "swap", "reveal"].indexOf(state.phase) >= 0;
  if (playing && state.cases.length !== s.amounts.length) return false;
  if (playing && !state.current) return false;
  return true;
}

function dondLoadSaved() {
  try {
    const raw = localStorage.getItem(DOND_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.game) window.DondCore.validateBoard(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (saved.core !== null && saved.core !== undefined && !dondUsableCore(saved.core)) {
      console.warn("Ignoring a saved game with a damaged state object.");
      return Object.assign({}, saved, { core: null });
    }
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

/**
 * Save on the way out — unless the saved game has been deleted while this page
 * was open. Without that check, clearing `gsc-dond-state-v1` from devtools and
 * reloading brought the old game straight back, because the page rewrote the
 * key on its own unload (tester N-D6).
 */
function dondSaveOnExit() {
  try {
    if (localStorage.getItem(DOND_STORAGE_KEY) === null) return;
  } catch (err) {
    console.warn("Could not check the saved game on the way out:", err);
  }
  dondSave();
}

function dondError(message) {
  const node = $("dond-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let dondLoadMessage = "";   // survives the dondSet() in dondBoot, which clears the banner

async function dondFetchBoard(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const board = await res.json();
  window.DondCore.validateBoard(board);
  return { game: board, source: label, kind, url: kind === "fetch" ? url : null };
}

async function dondLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await dondFetchBoard(url, `Custom board from ${url}`, "fetch");
    } catch (err) {
      dondLoadMessage = `Could not load a board from ${url}: ${err.message}. Using the built-in one instead.`;
    }
  }
  try {
    return await dondFetchBoard("board.json", "Built-in board (board.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = window.DOND_DEFAULT_BOARD;
    if (!offline) {
      dondLoadMessage = "No board could be loaded at all — open the editor and build one.";
      return { game: null, source: "No board loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in board (offline copy)", kind: "default", url: null };
  }
}

/** Adopt a validated board — from the editor, a file, or a URL. */
function dondUseBoard(board, source, kind) {
  window.DondCore.validateBoard(board);
  // sourceUrl is cleared: this content no longer came from the ?game= link, so
  // a reload of that link must fetch it again rather than resurrect this copy.
  dondSet({
    game: board, source: source || "Custom board", sourceKind: kind || "upload",
    sourceUrl: null, core: null,
    setup: Object.assign({}, dondApp.setup, { allowSwap: null, audienceAdvice: null }),
  });
  dondError("");
}

function dondOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      dondUseBoard(JSON.parse(String(reader.result)), `Custom board from ${file.name}`, "upload");
    } catch (err) {
      dondError(`That file is not a usable Deal or No Deal board: ${err.message}`);
    }
  };
  reader.onerror = () => dondError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function dondAddPlayer(name, pid, manual) {
  const clean = window.DondCore.cleanText(name, window.DondCore.NAME_MAX);
  if (!clean) { dondError("Give the contestant a name first."); return false; }
  const players = dondApp.setup.players;
  if (players.length >= window.DondCore.MAX_CONTESTANTS) {
    dondError(`That is the maximum of ${window.DondCore.MAX_CONTESTANTS} contestants.`);
    return false;
  }
  if (players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    dondError(`${clean} is already on the list — pick another name.`);
    return false;
  }
  const id = pid || `d${Date.now().toString(36)}${players.length}`;
  dondSet({
    setup: Object.assign({}, dondApp.setup, {
      players: players.concat([{ pid: id, name: clean, manual: manual !== false }]),
    }),
  });
  dondError("");
  return true;
}

function dondRemovePlayer(pid) {
  const players = dondApp.setup.players.filter((p) => p.pid !== pid);
  dondSet({ setup: Object.assign({}, dondApp.setup, { players }) });
}

/**
 * A rule the game will actually play with: the host's toggle first, then the
 * file, then the default.
 *
 * This deliberately does NOT look at how many phones are connected. Baking
 * "nobody is here yet" into the state at Start froze audience advice off for a
 * whole board, so a phone that joined a minute later never got a ballot even
 * though the host's own banner promised one (tester N-D3). Whether anyone can
 * vote is a rendering question, answered in DondView.renderAdvice; whether the
 * banker's call opens a ballot at all is this rule.
 */
function dondSettingOn(key) {
  const override = dondApp.setup[key];
  if (typeof override === "boolean") return override;
  const settings = dondApp.game && dondApp.game.settings;
  const fromFile = settings ? settings[key] : undefined;
  return fromFile === undefined ? true : !!fromFile;
}

/** The board the reducer actually plays: the file with the host's toggles on top. */
function dondEffectiveBoard() {
  const board = JSON.parse(JSON.stringify(dondApp.game));
  board.settings = Object.assign({}, board.settings, {
    allowSwap: dondSettingOn("allowSwap"),
    audienceAdvice: dondSettingOn("audienceAdvice"),
  });
  return board;
}

function dondStart() {
  try {
    if (!dondApp.game) throw new Error("The board is still loading — try again in a second.");
    const players = dondApp.setup.players.map((p) => ({ pid: p.pid, name: p.name }));
    const state = window.DondCore.createState(dondEffectiveBoard(), players, {});
    dondSet({ core: window.DondCore.reduce(state, { type: "start" }, Math.random) });
    dondError("");
  } catch (err) {
    dondError(err.message);
  }
}

/* ============ Host actions ============ */

/** One click on a case means "keep this one" or "open this one", by phase. */
function dondChooseCase(n) {
  const state = dondApp.core;
  if (!state) return;
  if (state.phase === "pick") dondDispatch({ type: "pickCase", n });
  else if (state.phase === "round") dondDispatch({ type: "openCase", n });
}

function dondToggleEv() {
  dondSet({ evShown: !dondApp.evShown });
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone contestants would
 * otherwise be inherited by whoever is issued that pid next. A different room
 * code drops every phone seat; contestants the host typed in keep their own ids
 * and stay. The same code (a plain refresh) changes nothing.
 */
function dondBindRoom(code) {
  if (typeof code !== "string" || !code || dondApp.roomCode === code) return;
  const manual = new Set(dondApp.setup.players.filter((p) => p.manual).map((p) => p.pid));
  const players = dondApp.setup.players.filter((p) => p.manual);
  let core = dondApp.core;
  let message = "";
  if (core && core.contestants.some((c) => !manual.has(c.pid))) {
    core = null;
    message = "This is a new room, so the game in progress was cleared — the phone seats belonged to the old one.";
  }
  dondSet({ roomCode: code, core, setup: Object.assign({}, dondApp.setup, { players }) });
  if (message) dondError(message);
}

/* ============ Hotkeys ============ */

function dondIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

/** Key → the event it dispatches, given the phase allows it. */
const DOND_KEYS = {
  b: () => ({ type: "bankerOffer" }),
  d: () => ({ type: "deal" }),
  n: () => ({ type: "noDeal" }),
  u: () => ({ type: "undo" }),
};

function dondOnKey(event) {
  if (dondIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (dondApp.editorOpen || !dondApp.core) return;
  const key = String(event.key).toLowerCase();
  const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
  if (isSpace) {
    event.preventDefault();
    const state = dondApp.core;
    if (state.phase !== "reveal") return;
    dondDispatch({ type: window.DondCore.revealOrder(state).length ? "revealRest" : "revealOwn" });
    return;
  }
  const build = DOND_KEYS[key];
  if (!build) return;
  event.preventDefault();
  dondDispatch(build());
}

/* ============ Wiring ============ */

function dondWireSetup() {
  $("dond-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (dondAddPlayer($("dond-player-name").value)) $("dond-player-name").value = "";
  });
  $("btn-load-json").addEventListener("click", () => $("dond-file").click());
  $("dond-file").addEventListener("change", dondOnFile);
  $("btn-start").addEventListener("click", dondStart);
  ["allowSwap", "audienceAdvice"].forEach((key) => {
    const id = key === "allowSwap" ? "dond-swap" : "dond-advice";
    $(id).addEventListener("change", (e) => {
      dondSet({ setup: Object.assign({}, dondApp.setup, { [key]: e.target.checked }) });
    });
  });
}

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function dondWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function dondWirePlay() {
  dondWireButton("btn-banker", () => dondDispatch({ type: "bankerOffer" }));
  dondWireButton("btn-swap-yes", () => dondDispatch({ type: "swap", yes: true }));
  dondWireButton("btn-swap-no", () => dondDispatch({ type: "swap", yes: false }));
  dondWireButton("btn-reveal-rest", () => dondDispatch({ type: "revealRest" }));
  dondWireButton("btn-reveal-own", () => dondDispatch({ type: "revealOwn" }));
  dondWireButton("btn-undo", () => dondDispatch({ type: "undo" }));
  dondWireButton("btn-give-up", () => dondDispatch({ type: "finish" }));
  dondWireButton("btn-seat-undo", () => dondDispatch({ type: "undo" }));
  dondWireButton("btn-seat-finish", () => dondDispatch({ type: "finish" }));
}

function dondWireBanker() {
  dondWireButton("btn-deal", () => dondDispatch({ type: "deal" }));
  dondWireButton("btn-no-deal", () => dondDispatch({ type: "noDeal" }));
  dondWireButton("btn-offer-undo", () => dondDispatch({ type: "undo" }));
  dondWireButton("btn-advice-toggle", () => {
    const state = dondApp.core;
    if (!state) return;
    dondDispatch({ type: state.advice.open ? "adviceClose" : "adviceOpen" });
  });
  dondWireButton("btn-ev", dondToggleEv);
}

function dondWireResult() {
  dondWireButton("btn-next-contestant", () => dondDispatch({ type: "nextContestant" }));
  dondWireButton("btn-finish", () => dondDispatch({ type: "finish" }));
  dondWireButton("btn-result-undo", () => dondDispatch({ type: "undo" }));
  dondWireButton("btn-play-again", () => dondSet({ core: null }));
}

function dondWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.DondSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.DondSound.enabled));
  };
  sound.addEventListener("click", () => { window.DondSound.toggle(); paint(); });
  paint();
  document.addEventListener("keydown", dondOnKey);
  window.addEventListener("beforeunload", dondSaveOnExit);
  document.addEventListener("visibilitychange", () => { if (document.hidden) dondSaveOnExit(); });
}

/* ============ Splash ============ */

const DOND_SPLASH_MS = 1200;
let dondSplashTimer = null;

/**
 * The 1.2 s title card the hub shows on a game switch, mirrored here so a
 * standalone page carries it too (copied from js/hub-host.js showSplash()).
 * Decorative only: `.gsc-splash` is `pointer-events: none`, and the whole
 * thing is skipped under prefers-reduced-motion.
 */
function dondShowSplash() {
  const node = $("gsc-splash");
  if (!node) return;
  if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.body.classList.contains("gsc-embedded")) return; // the hub shows its own
  setText("gsc-splash-title", "Deal or No Deal");
  setText("gsc-splash-sub", "Twenty-six cases. One banker.");
  node.dataset.gscGame = "deal-or-no-deal";
  node.classList.remove("hidden");
  if (dondSplashTimer) clearTimeout(dondSplashTimer);
  dondSplashTimer = setTimeout(() => {
    dondSplashTimer = null;
    node.classList.add("hidden");
  }, DOND_SPLASH_MS);
}

/* ============ Boot ============ */

/** Saved roster first, then any phone the shell added while we were loading. */
function dondMergeRoster(savedSetup, current) {
  const players = (savedSetup.players || []).slice();
  current.forEach((p) => { if (!players.some((x) => x.pid === p.pid)) players.push(p); });
  return Object.assign({}, savedSetup, { players });
}

/**
 * An explicit ?game=URL always wins over the saved board unless the save
 * already came from that same URL — otherwise a host who has played once
 * silently gets their old board when they follow a shared link. A URL that
 * failed to load must not cost them their game as well as their board.
 */
function dondChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.game && (!urlWon || saved.sourceUrl === wantUrl);
  const patch = {
    game: (useSaved && saved.game) || loaded.game,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (saved && saved.setup) patch.setup = dondMergeRoster(saved.setup, dondApp.setup.players);
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved && saved.core) patch.core = saved.core;
  if (!useSaved && saved && saved.core && !dondLoadMessage) {
    dondLoadMessage = "Loaded the board from the link, so the game in progress was cleared.";
  }
  return patch;
}

async function dondBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  dondShowSplash();                        // embedded and standalone, host and phone
  if (mode.endsWith("-player")) return;    // dond-phone.js owns the phone page

  // Read the saved game BEFORE the first await: dond-room.js seeds the roster
  // as soon as the shell sends `init`, and that write would otherwise clobber
  // the state we are about to restore.
  const saved = dondLoadSaved();

  dondWireSetup();
  dondWirePlay();
  dondWireBanker();
  dondWireResult();
  dondWireChrome();

  const loaded = await dondLoadContent();
  dondSet(dondChooseContent(saved, loaded));
  if (dondLoadMessage) dondError(dondLoadMessage);
}

/** The public surface dond-editor.js / dond-room.js / the harness build on. */
window.DondApp = {
  state: () => dondApp,
  core: () => dondApp.core,
  dispatch: dondDispatch,
  set: dondSet,
  render: dondRender,
  useBoard: dondUseBoard,
  useGame: dondUseBoard,
  addPlayer: dondAddPlayer,
  removePlayer: dondRemovePlayer,
  error: dondError,
  subscribe: (fn) => { if (typeof fn === "function") dondListeners.push(fn); },
  chooseCase: dondChooseCase,
  settingOn: dondSettingOn,
  effectiveBoard: dondEffectiveBoard,
  toggleEv: dondToggleEv,
  bindRoom: dondBindRoom,
  showSplash: dondShowSplash,
  setPhoneCount: (n) => { if (n !== dondApp.phoneCount) dondSet({ phoneCount: Number(n) || 0 }); },
  STORAGE_KEY: DOND_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { dondBoot().catch((err) => dondError(err.message)); });
} else {
  dondBoot().catch((err) => dondError(err.message));
}

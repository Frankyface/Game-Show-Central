/* ============================================================
   The Price Is Right — host glue
   Owns the app state (one serialisable object), persistence,
   the setup screen, the host's buttons and hotkeys, and the
   sound cues. All show rules live in tpir-core.js; this file only
   dispatches events into the reducer, waits for the one or two
   animations that must finish, and asks tpir-view.js /
   tpir-games.js to paint the result. Every string reaches the
   page through textContent, and no Peer/DOM/timer handle is ever
   stored in the state.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run cannot leave harness
 * prizes (or a half-played show) in the real host's save on the same origin.
 * Anything but letters, digits and hyphens is stripped.
 */
function tpirStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const TPIR_STORAGE_KEY = `gsc-tpir-state-v1${tpirStoreSuffix()}`;

let tpirApp = tpirFreshApp();
const tpirListeners = [];

function tpirFreshApp() {
  return {
    core: null,
    content: null,
    setup: { players: [], pricingGames: null },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phones: [],
    takeover: [],
    busy: false,
    editorOpen: false,
  };
}

/** Replace part of the app state, persist, repaint. */
function tpirSet(patch) {
  tpirApp = Object.assign({}, tpirApp, patch);
  tpirSave();
  tpirRender();
}

function tpirRender() {
  window.TpirView.render(tpirApp);
  tpirListeners.forEach((fn) => {
    try { fn(tpirApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/* ============ Dispatch ============ */

// The two events whose result must be watched before the host acts again.
const TPIR_ANIMATED = { spin: "wheel", plinkoDrop: "chip" };

// Moving on hands every phone its controls back (see tpirTakeOver).
const TPIR_CLEARS_TAKEOVER = new Set(["nextSegment", "rebid", "finish", "undo"]);

/**
 * Why the core would refuse each host button, in the host's own words. House
 * rule: every failure path surfaces a plain-English message.
 */
const TPIR_REFUSED = {
  bid: "That bid can’t be used — whole dollars from 1 to 999,999, and only before the reveal.",
  revealBids: "Nobody has bid yet.",
  rebid: "There is nothing to bid again on.",
  pickGame: "That pricing game isn’t available right now.",
  chGuess: "That price can’t be used right now.",
  plinkoAnswer: "That answer isn’t wanted right now.",
  plinkoDrop: "There is no chip left to drop.",
  l7Guess: "That digit can’t be used right now.",
  spin: "It isn’t that contestant’s spin.",
  spinAgain: "There is no second spin to take.",
  stay: "There is nothing to stay on.",
  showcasePass: "The showcases are already claimed.",
  showcaseBid: "That showcase bid can’t be used — whole dollars, and only before the reveal.",
  revealShowcase: "Both showcases need a bid before the reveal.",
  nextSegment: "Finish this part of the show first.",
  undo: "There is nothing left to undo.",
  finish: "The show has already finished.",
};

/** Which events belong to which phase, so a refusal explains the real reason. */
const TPIR_PHASE_EVENTS = {
  setup: ["start"],
  row: ["bid", "revealBids", "rebid", "nextSegment", "finish", "undo"],
  game: ["pickGame", "chGuess", "plinkoAnswer", "plinkoDrop", "l7Guess", "nextSegment", "finish", "undo"],
  showdown: ["spin", "spinAgain", "stay", "nextSegment", "finish", "undo"],
  showcase: ["showcasePass", "showcaseBid", "revealShowcase", "nextSegment", "finish", "undo"],
  standings: ["undo"],
};

/** The sentence to show when the core refuses a host action. */
function tpirRefusal(state, type) {
  const here = TPIR_PHASE_EVENTS[state.phase] || [];
  if (here.indexOf(type) < 0) return "That isn’t part of this bit of the show.";
  return TPIR_REFUSED[type] || "That isn’t a legal move right now.";
}

/**
 * Send an event to the pure core, with its sound cue and animation.
 * `source` is `"phone"` for an intent a player tapped: a phone's rejected tap
 * is ignored in silence, because the shared screen is not the place to report
 * somebody else's stray thumb.
 */
function tpirDispatch(event, source) {
  const state = tpirApp.core;
  if (!state) return;
  const fromPhone = source === "phone";
  if (tpirApp.busy) {
    if (!fromPhone) tpirError("Hold on — the board is still moving.");
    return;
  }
  const next = window.TpirCore.reduce(state, event, Math.random);
  if (next === state) {
    if (!fromPhone) tpirError(tpirRefusal(state, event.type));
    return;
  }
  tpirError("");
  const kind = TPIR_ANIMATED[event.type];
  // Claimed BEFORE the state lands so the repaint does not reveal the result.
  if (kind === "wheel") window.TpirView.beginSpin();
  if (kind === "chip") window.TpirGames.beginDrop();
  tpirCue(event, state, next);
  // "Take over" lasts for one segment only, so a phone that was silenced for
  // one pricing game gets its controls back for the next.
  const takeover = TPIR_CLEARS_TAKEOVER.has(event.type) ? [] : tpirApp.takeover;
  tpirSet({ core: next, busy: !!kind, takeover });
  if (kind === "wheel") window.TpirView.spinWheel(next, () => tpirAfterSpin(next));
  else if (kind === "chip") window.TpirGames.animate(event, state, next, () => tpirSet({ busy: false }));
}

const TPIR_CUES = {
  bid: "bid", revealBids: "reveal", rebid: "bad", pickGame: "good",
  spin: "spin", plinkoDrop: "tick", l7Guess: "coin", chGuess: "step",
};

function tpirCue(event, before, after) {
  if (event.type === "revealBids") {
    window.TpirSound.play(after.row.result && after.row.result.exact ? "fanfare" : "reveal");
    return;
  }
  if (event.type === "chGuess") {
    window.TpirSound.play(after.game.done ? (after.game.won ? "fanfare" : "fall") : "step");
    return;
  }
  if (event.type === "l7Guess") {
    window.TpirSound.play(after.game.done ? (after.game.won ? "fanfare" : "fall") : "coin");
    return;
  }
  if (event.type === "plinkoAnswer") {
    const last = after.game.answers[after.game.answers.length - 1];
    window.TpirSound.play(last && last.right ? "good" : "bad");
    return;
  }
  if (event.type === "nextSegment" && after.phase === "game") {
    window.TpirSound.play("comeOnDown");
    return;
  }
  if (event.type === "revealShowcase") {
    window.TpirSound.play(after.showcase.result.winner ? "fanfare" : "fall");
    return;
  }
  const cue = TPIR_CUES[event.type];
  if (cue) window.TpirSound.play(cue);
  void before;
}

/** The wheel has stopped: say what it landed on, then hand the host back. */
function tpirAfterSpin(state) {
  const spin = state.showdown.lastSpin;
  if (spin) {
    const total = spin.total;
    if (total === window.TpirCore.WHEEL_TARGET) window.TpirSound.play("fanfare");
    else if (total > window.TpirCore.WHEEL_TARGET) window.TpirSound.play("fall");
    else window.TpirSound.play("land");
  }
  tpirSet({ busy: false });
}

/* ============ Persistence ============ */

function tpirSerialise() {
  return {
    core: tpirApp.core, content: tpirApp.content, setup: tpirApp.setup, source: tpirApp.source,
    sourceKind: tpirApp.sourceKind, sourceUrl: tpirApp.sourceUrl, roomCode: tpirApp.roomCode,
    takeover: tpirApp.takeover,
  };
}

function tpirSave() {
  try {
    localStorage.setItem(TPIR_STORAGE_KEY, JSON.stringify(tpirSerialise()));
  } catch (err) {
    console.warn("Could not save the show:", err);
    tpirError("This browser can’t save the show — it still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
const TPIR_ARRAYS = ["roster", "comeOnDown", "showdownWinners", "history"];
const TPIR_OBJECTS = ["row", "game", "showdown", "showcase", "winnings", "used", "plan"];

/** A hand-edited or half-written save is REJECTED here rather than discovered
    by a handler dereferencing a missing field. */
function tpirUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.TpirCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.content || typeof state.content !== "object") return false;
  if (TPIR_ARRAYS.some((k) => !Array.isArray(state[k]))) return false;
  if (TPIR_OBJECTS.some((k) => !state[k] || typeof state[k] !== "object" || Array.isArray(state[k]))) return false;
  if (!Array.isArray(state.plan.segments) || !Number.isFinite(state.segmentIndex)) return false;
  const c = state.content;
  if (!c.settings || !Array.isArray(c.oneBid) || !Array.isArray(c.showcases)) return false;
  if (state.phase === "row" && !state.row.item) return false;
  return true;
}

function tpirLoadSaved() {
  try {
    const raw = localStorage.getItem(TPIR_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.content) window.TpirCore.validateGame(saved.content);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (saved.core !== null && saved.core !== undefined && !tpirUsableCore(saved.core)) {
      console.warn("Ignoring a saved show with a damaged state object.");
      return Object.assign({}, saved, { core: null });
    }
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved show:", err);
    return null;
  }
}

function tpirError(message) {
  const node = $("tpir-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let tpirLoadMessage = "";   // survives the tpirSet() in tpirBoot, which clears the banner
let tpirLoadFailure = null; // {url, reason} when an explicit ?game= could not be loaded

/** Trim trailing punctuation so a reason never lands as ".." in the banner. */
function tpirTidy(text) {
  return String(text === undefined || text === null ? "" : text).trim().replace(/[.\s]+$/, "");
}

async function tpirFetchContent(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.TpirCore.validateGame(game);
  return { content: game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function tpirLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await tpirFetchContent(url, `Custom prizes from ${url}`, "fetch");
    } catch (err) {
      // What happens next is not known yet: a saved file may still win. The
      // sentence is finished in tpirChooseContent, once the decision is made.
      tpirLoadFailure = { url, reason: tpirTidy(err.message) };
    }
  }
  try {
    return await tpirFetchContent("prizes.json", "Built-in prizes (prizes.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = globalThis.TPIR_DEFAULT_GAME;
    if (!offline) {
      tpirLoadMessage = "No prizes could be loaded at all — open the editor and build a set.";
      return { content: null, source: "No prizes loaded", kind: "none", url: null };
    }
    return { content: offline, source: "Built-in prizes (offline copy)", kind: "default", url: null };
  }
}

/** Adopt a validated prize file — from the editor, a file, or a URL. */
function tpirUseContent(content, source, kind) {
  window.TpirCore.validateGame(content);
  // sourceUrl is cleared: this content no longer came from the ?game= link, so
  // a reload of that link must fetch it again rather than resurrect this copy.
  tpirSet({
    content, source: source || "Custom prizes", sourceKind: kind || "upload",
    sourceUrl: null, core: null,
    setup: Object.assign({}, tpirApp.setup, { pricingGames: null }),
  });
  tpirError("");
}

function tpirOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      tpirUseContent(JSON.parse(String(reader.result)), `Custom prizes from ${file.name}`, "upload");
    } catch (err) {
      tpirError(`That file is not a usable Price Is Right game: ${err.message}`);
    }
  };
  reader.onerror = () => tpirError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function tpirAddPlayer(name, pid, manual) {
  const clean = window.TpirCore.cleanText(name, window.TpirCore.PLAYER_NAME_MAX);
  if (!clean) { tpirError("Give the player a name first."); return false; }
  const players = tpirApp.setup.players;
  if (players.length >= window.TpirCore.MAX_PLAYERS) {
    tpirError(`That is the maximum of ${window.TpirCore.MAX_PLAYERS} players.`);
    return false;
  }
  if (players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    tpirError(`${clean} is already in the line-up — pick another name.`);
    return false;
  }
  const id = pid || `t${Date.now().toString(36)}${players.length}`;
  tpirSet({
    setup: Object.assign({}, tpirApp.setup, {
      players: players.concat([{ pid: id, name: clean, manual: manual !== false }]),
    }),
  });
  tpirError("");
  return true;
}

function tpirRemovePlayer(pid) {
  const players = tpirApp.setup.players.filter((p) => p.pid !== pid);
  tpirSet({ setup: Object.assign({}, tpirApp.setup, { players }) });
}

/** Reorder the line-up: the first four sit in Contestants' Row. */
function tpirMovePlayer(pid, delta) {
  const players = tpirApp.setup.players.slice();
  const from = players.findIndex((p) => p.pid === pid);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= players.length) return;
  const [moved] = players.splice(from, 1);
  players.splice(to, 0, moved);
  tpirSet({ setup: Object.assign({}, tpirApp.setup, { players }) });
}

/** Is this pricing game switched on for tonight? */
function tpirGameOn(kind) {
  const content = tpirApp.content;
  if (!content || !Array.isArray(content[kind]) || !content[kind].length) return false;
  const override = tpirApp.setup.pricingGames;
  if (Array.isArray(override)) return override.indexOf(kind) >= 0;
  return content.settings.pricingGames.indexOf(kind) >= 0;
}

function tpirToggleGame(kind, on) {
  const list = window.TpirCore.GAME_KINDS.filter((k) => (k === kind ? on : tpirGameOn(k)));
  tpirSet({ setup: Object.assign({}, tpirApp.setup, { pricingGames: list }) });
}

/** The settings the reducer actually plays with: the file plus tonight's toggles. */
function tpirEffectiveSettings() {
  const base = tpirApp.content ? tpirApp.content.settings : window.TpirCore.DEFAULT_SETTINGS;
  const on = window.TpirCore.GAME_KINDS.filter(tpirGameOn);
  return Object.assign({}, base, { pricingGames: on.length ? on : base.pricingGames });
}

function tpirEffectiveContent() {
  const content = JSON.parse(JSON.stringify(tpirApp.content));
  content.settings = Object.assign({}, content.settings,
    { pricingGames: tpirEffectiveSettings().pricingGames });
  return content;
}

function tpirStart() {
  try {
    if (!tpirApp.content) throw new Error("Prizes are still loading — try again in a second.");
    const players = tpirApp.setup.players.map((p) => ({ pid: p.pid, name: p.name }));
    const state = window.TpirCore.createState(tpirEffectiveContent(), players, {});
    window.TpirGames.reset();
    tpirSet({ core: window.TpirCore.reduce(state, { type: "start" }, Math.random), takeover: [] });
    tpirError("");
  } catch (err) {
    tpirError(err.message);
  }
}

/* ============ Host entry: bids, guesses, chips ============ */

/**
 * Read a typed number and say plainly what is wrong with it. Returns null and
 * shows the message when the box is empty or the number is out of range —
 * `Number("")` is 0, which is finite, so an empty box must be caught here.
 */
function tpirTakeNumber(selector, range) {
  const input = document.querySelector(selector);
  const raw = input ? String(input.value).trim() : "";
  if (!raw) { tpirError(`Type ${range.what} first.`); return null; }
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    tpirError(`${range.What} has to be a whole number.`);
    return null;
  }
  if (value < range.min || value > range.max) {
    const show = (n) => (range.money ? tpirMoney(n) : String(n));
    tpirError(`${range.What} has to be between ${show(range.min)} and ${show(range.max)}.`);
    return null;
  }
  return value;
}

/** `$999,999` in whatever currency the loaded file uses. */
function tpirMoney(amount) {
  const currency = tpirApp.content && tpirApp.content.settings
    ? tpirApp.content.settings.currency : "$";
  return window.TpirCore.money(currency, amount);
}

function tpirSubmitBid(pid, kind) {
  const showcase = kind === "showcase";
  const form = showcase ? "tpir-sc-bids" : "tpir-bid-form";
  const amount = tpirTakeNumber(`#${form} .bid-input[data-pid="${pid}"]`, {
    what: "a whole-dollar bid", What: "A bid", money: true,
    min: 1, max: showcase ? window.TpirCore.MAX_PRICE : window.TpirCore.MAX_BID,
  });
  if (amount === null) return;
  tpirDispatch({ type: showcase ? "showcaseBid" : "bid", pid, amount });
}

/**
 * The Cliff Hangers price box. `range` comes from the field itself, so the
 * message always quotes the range the host can actually see.
 */
function tpirSubmitGuess(selector, range) {
  const limits = range || { min: 1, max: 99 };
  const amount = tpirTakeNumber(selector, {
    what: "a whole-dollar price", What: "A price", money: true,
    min: limits.min, max: limits.max,
  });
  if (amount === null) return;
  tpirDispatch({ type: "chGuess", amount });
}

function tpirDropChip(slot) {
  tpirDispatch({ type: "plinkoDrop", slot });
}

/** The host takes the controls away from a player's phone for this segment. */
function tpirTakeOver(pid) {
  if (!pid || tpirApp.takeover.indexOf(pid) >= 0) return;
  tpirSet({ takeover: tpirApp.takeover.concat([pid]) });
}

const tpirIsTakenOver = (pid) => tpirApp.takeover.indexOf(pid) >= 0;
const tpirHasPhone = (pid) => !!pid && tpirApp.phones.indexOf(pid) >= 0;

function tpirSetPhones(pids) {
  const next = Array.isArray(pids) ? pids.slice().sort() : [];
  if (next.join(",") === tpirApp.phones.slice().sort().join(",")) return;
  tpirSet({ phones: next });
}

/**
 * Bind the saved show to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed show's phone players would
 * otherwise be inherited by whoever is issued that pid next. A different room
 * code drops every phone seat; players the host typed in keep their own ids
 * and stay. The same code (a plain refresh) changes nothing.
 */
function tpirBindRoom(code) {
  if (typeof code !== "string" || !code || tpirApp.roomCode === code) return;
  const manual = new Set(tpirApp.setup.players.filter((p) => p.manual).map((p) => p.pid));
  const players = tpirApp.setup.players.filter((p) => p.manual);
  let core = tpirApp.core;
  let message = "";
  if (core && core.roster.some((r) => !manual.has(r.pid))) {
    core = null;
    message = "This is a new room, so the show in progress was cleared — the phone seats belonged to the old one.";
  }
  tpirSet({ roomCode: code, core, takeover: [], setup: Object.assign({}, tpirApp.setup, { players }) });
  if (message) tpirError(message);
}

/* ============ Hotkeys ============ */

function tpirIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

function tpirOnKey(event) {
  if (tpirIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (tpirApp.editorOpen || !tpirApp.core || tpirApp.busy) return;
  const key = String(event.key).toLowerCase();
  if (key === "u") { event.preventDefault(); tpirDispatch({ type: "undo" }); return; }
  if (key === "n") { event.preventDefault(); tpirDispatch({ type: "nextSegment" }); return; }
  if (key === "r" && tpirApp.core.phase === "row") { event.preventDefault(); tpirDispatch({ type: "revealBids" }); }
}

/* ============ Wiring ============ */

function tpirWireSetup() {
  $("tpir-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (tpirAddPlayer($("tpir-player-name").value)) $("tpir-player-name").value = "";
  });
  $("btn-load-json").addEventListener("click", () => $("tpir-file").click());
  $("tpir-file").addEventListener("change", tpirOnFile);
  $("btn-start").addEventListener("click", tpirStart);
  window.TpirCore.GAME_KINDS.forEach((kind) => {
    const box = $(`tpir-pg-${kind}`);
    if (box) box.addEventListener("change", (e) => tpirToggleGame(kind, e.target.checked));
  });
}

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function tpirWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function tpirWirePlay() {
  tpirWireButton("btn-reveal-bids", () => tpirDispatch({ type: "revealBids" }));
  tpirWireButton("btn-rebid", () => tpirDispatch({ type: "rebid" }));
  ["btn-row-next", "btn-game-next", "btn-sd-next", "btn-sc-next"].forEach((id) => {
    tpirWireButton(id, () => tpirDispatch({ type: "nextSegment" }));
  });
  tpirWireButton("btn-spin", () => tpirDispatch({ type: "spin" }));
  tpirWireButton("btn-spin-again", () => tpirDispatch({ type: "spinAgain" }));
  tpirWireButton("btn-stay", () => tpirDispatch({ type: "stay" }));
  tpirWireButton("btn-sc-take", () => tpirDispatch({ type: "showcasePass", pass: false }));
  tpirWireButton("btn-sc-pass", () => tpirDispatch({ type: "showcasePass", pass: true }));
  tpirWireButton("btn-sc-reveal", () => tpirDispatch({ type: "revealShowcase" }));
  tpirWireButton("btn-undo", () => tpirDispatch({ type: "undo" }));
  tpirWireButton("btn-finish", () => tpirDispatch({ type: "finish" }));
  tpirWireButton("btn-play-again", () => { window.TpirGames.reset(); tpirSet({ core: null, takeover: [] }); });
}

function tpirWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.TpirSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.TpirSound.enabled));
  };
  sound.addEventListener("click", () => { window.TpirSound.toggle(); paint(); });
  paint();
  document.addEventListener("keydown", tpirOnKey);
  window.addEventListener("beforeunload", tpirSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) tpirSave(); });
}

/* ============ Splash ============ */

const TPIR_SPLASH_MS = 1200;
let tpirSplashTimer = null;

/**
 * The 1.2 s title card the hub shows on a game switch, mirrored here so a
 * standalone page carries it too. Decorative only: `.gsc-splash` is
 * `pointer-events: none`, skipped under prefers-reduced-motion, and skipped
 * entirely when embedded because the hub is already showing its own.
 */
function tpirShowSplash() {
  const node = $("gsc-splash");
  if (!node) return;
  if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.body.classList.contains("gsc-embedded")) return;
  setText("gsc-splash-title", "The Price Is Right");
  setText("gsc-splash-sub", "Come on down.");
  node.dataset.gscGame = "price-is-right";
  node.classList.remove("hidden");
  if (tpirSplashTimer) clearTimeout(tpirSplashTimer);
  tpirSplashTimer = setTimeout(() => {
    tpirSplashTimer = null;
    node.classList.add("hidden");
  }, TPIR_SPLASH_MS);
}

/* ============ Boot ============ */

/** Saved line-up first, then any phone the shell added while we were loading. */
function tpirMergeRoster(savedSetup, current) {
  const players = (savedSetup.players || []).slice();
  current.forEach((p) => { if (!players.some((x) => x.pid === p.pid)) players.push(p); });
  return Object.assign({}, savedSetup, { players });
}

/**
 * An explicit ?game=URL always wins over the saved file unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old prizes when they follow a shared link. A URL that failed to load
 * must not cost them their show as well as their prizes.
 */
function tpirChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.content && (!urlWon || saved.sourceUrl === wantUrl);
  const patch = {
    content: (useSaved && saved.content) || loaded.content,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (saved && saved.setup) patch.setup = tpirMergeRoster(saved.setup, tpirApp.setup.players);
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (saved && Array.isArray(saved.takeover)) patch.takeover = saved.takeover;
  if (useSaved && saved.core) patch.core = saved.core;
  if (tpirLoadFailure) {
    tpirLoadMessage = `Could not load prizes from ${tpirLoadFailure.url}: ${tpirLoadFailure.reason}. `
      + (useSaved ? "Keeping the prizes already loaded." : "Using the built-in set instead.");
  } else if (!useSaved && saved && saved.core) {
    tpirLoadMessage = "Loaded the prizes from the link, so the show in progress was cleared.";
  }
  return patch;
}

async function tpirBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  tpirShowSplash();
  if (mode.endsWith("-player")) return;   // tpir-phone.js owns the phone page

  // Read the saved show BEFORE the first await: tpir-room.js seeds the line-up
  // as soon as the shell sends `init`, and that write would otherwise clobber
  // the state we are about to restore.
  const saved = tpirLoadSaved();

  tpirWireSetup();
  tpirWirePlay();
  tpirWireChrome();

  const loaded = await tpirLoadContent();
  tpirSet(tpirChooseContent(saved, loaded));
  if (tpirLoadMessage) tpirError(tpirLoadMessage);
}

/** The public surface tpir-editor.js / tpir-room.js / the harness build on. */
window.TpirApp = {
  state: () => tpirApp,
  core: () => tpirApp.core,
  dispatch: tpirDispatch,
  set: tpirSet,
  render: tpirRender,
  useContent: tpirUseContent,
  addPlayer: tpirAddPlayer,
  removePlayer: tpirRemovePlayer,
  movePlayer: tpirMovePlayer,
  error: tpirError,
  subscribe: (fn) => { if (typeof fn === "function") tpirListeners.push(fn); },
  submitBid: tpirSubmitBid,
  submitGuess: tpirSubmitGuess,
  dropChip: tpirDropChip,
  takeOver: tpirTakeOver,
  isTakenOver: tpirIsTakenOver,
  hasPhone: tpirHasPhone,
  setPhones: tpirSetPhones,
  gameOn: tpirGameOn,
  effectiveSettings: tpirEffectiveSettings,
  bindRoom: tpirBindRoom,
  showSplash: tpirShowSplash,
  start: tpirStart,
  STORAGE_KEY: TPIR_STORAGE_KEY,
  storeSuffix: tpirStoreSuffix,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { tpirBoot().catch((err) => tpirError(err.message)); });
} else {
  tpirBoot().catch((err) => tpirError(err.message));
}

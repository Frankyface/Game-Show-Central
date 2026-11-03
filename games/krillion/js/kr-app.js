/* ============================================================
   Krillion — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the clock hooks
   and the sound cues. All game rules live in kr-core.js; this
   file only dispatches events into the reducer and asks
   kr-view.js / kr-party.js to paint the result. Every string
   reaches the page through textContent, and no Peer, DOM or
   timer handle is ever stored in the state.

   Clocks: the core keeps a deadline; every save writes the
   clock FROZEN (as time remaining) and a reload thaws it, so a
   reload mid-prompt keeps exactly the seconds that were left.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run never touches the real
 * host's save on the same origin.
 */
function krStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const KR_STORAGE_KEY = `gsc-kr-state-v1${krStoreSuffix()}`;
const KR_MANUAL_PREFIX = "m";

let krApp = krFreshApp();
const krListeners = [];
let krPendingNote = "";

function krFreshApp() {
  return {
    core: null,
    resumable: null,          // the game kept by "Game lobby → Keep this game" (clock frozen)
    game: null,
    learnedLog: [],           // every "Add to this question" this session, for the editor
    setup: { players: [], mode: "deepDive", shuffle: true, settingsTouched: false,
      settings: window.KrCore.normalizeSettings({}), nextManual: 1 },
    source: "loading…", sourceKind: "default", sourceUrl: null,
    roomCode: null, phoneCount: 0,
    editorOpen: false, lobbyOpen: false, hideTyping: false, showList: false,
  };
}

/* ============ State plumbing ============ */

function krSet(patch) {
  krApp = Object.assign({}, krApp, patch);
  krSave();
  krRender();
}

function krRender() {
  window.KrView.render(krApp);
  krListeners.forEach((fn) => {
    try { fn(krApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
  window.KrClock.step();
}

/** Send an event to the pure core (stamped with `now`), with its sound cue. */
function krDispatch(event) {
  const state = krApp.core;
  if (!state) return;
  const stamped = Object.assign({ now: Date.now() }, event);
  const next = window.KrCore.reduce(state, stamped);
  if (next === state) return;
  krCue(stamped, state, next);
  const patch = { core: next };
  if (stamped.type === "remember" && next.learned.length > state.learned.length) {
    const item = next.learned[next.learned.length - 1];
    patch.learnedLog = krApp.learnedLog.concat([item]);
    patch.game = window.KrCore.applyLearned(krApp.game, [item]);
  }
  krSet(patch);
}

function krError(message) {
  const node = $("kr-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

function krNote(text) {
  krPendingNote = text;
  if ($("kr-error")) krError(text);
}

/* ============ Sound cues ============ */

const KR_NOTICE_CUES = { pass: "pass", heart: "heart", used: "miss", invalid: "miss", judge: "ping" };

function krRevealCue(next) {
  if (next.phase !== "reveal") return "bubble";
  const g = window.KrCore.revealOrder(next)[next.dive.revealed - 1];
  const tiers = window.KrCore.tiersOf(next);
  if (!g || !g.tier) return "miss";
  return g.tier === tiers[tiers.length - 1].id ? "abyss" : "bubble";
}

function krCue(event, before, after) {
  const S = window.KrSound;
  if (after.phase === "result" && before.phase !== "result") {
    if (event.type === "pufferPop") S.play("pop");
    S.play("fanfare");
    return;
  }
  const t = event.type;
  if (t === "answer" || t === "hostAnswer") S.play(after.phase === "reveal" ? "close" : "ping");
  else if (t === "openPrompt" || t === "pufferStart") S.play("dive");
  else if (t === "closePrompt") S.play("close");
  else if (t === "revealNext") S.play(krRevealCue(after));
  else if (t === "pufferPop") S.play("pop");
  else if ((t === "pufferAnswer" || t === "pufferJudge") && after.puffer && after.puffer.notice) {
    const kind = after.puffer.notice.kind;
    if (Object.prototype.hasOwnProperty.call(KR_NOTICE_CUES, kind)) S.play(KR_NOTICE_CUES[kind]);
  }
}

/* ============ Persistence ============ */

function krSerialise() {
  const now = Date.now();
  return {
    core: krApp.core ? window.KrCore.freeze(krApp.core, now) : null,
    resumable: krApp.resumable, game: krApp.game, learnedLog: krApp.learnedLog, setup: krApp.setup,
    source: krApp.source, sourceKind: krApp.sourceKind, sourceUrl: krApp.sourceUrl,
    roomCode: krApp.roomCode, hideTyping: krApp.hideTyping,
  };
}

function krSave() {
  try {
    localStorage.setItem(KR_STORAGE_KEY, JSON.stringify(krSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    krError("This browser can’t save the game — it still plays, but don’t reload this tab.");
  }
}

const KR_DIVE_PHASES = ["intro", "prompt", "reveal", "depth"];
const KR_PUFFER_PHASES = ["pufferReady", "puffer", "popped"];

/** Every field the reducer and the renderers dereference without a guard. */
function krUsableCore(c) {
  const K = window.KrCore;
  if (!c || typeof c !== "object" || K.PHASES.indexOf(c.phase) < 0) return false;
  if (!c.game || !c.game.settings || !Array.isArray(c.game.settings.tiers) || !Array.isArray(c.game.prompts)) return false;
  if (!Array.isArray(c.players) || c.players.length < 2 || !Array.isArray(c.order)) return false;
  if (!Array.isArray(c.history) || !Array.isArray(c.learned) || !Array.isArray(c.winners)) return false;
  if (KR_DIVE_PHASES.indexOf(c.phase) >= 0 && (!c.dive || typeof c.dive.answers !== "object")) return false;
  if (KR_PUFFER_PHASES.indexOf(c.phase) >= 0 && (!c.puffer || !Array.isArray(c.puffer.used))) return false;
  return true;
}

const KR_SAVE_UNREADABLE = "Your saved game couldn’t be read, so it was cleared";

function krLoadSaved() {
  try {
    const raw = localStorage.getItem(KR_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") throw new Error("not an object");
    if (saved.game) window.KrCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (!Array.isArray(saved.learnedLog)) saved.learnedLog = [];
    ["core", "resumable"].forEach((key) => {
      if (saved[key] !== null && saved[key] !== undefined && !krUsableCore(saved[key])) {
        console.warn(`Ignoring a saved ${key} with a damaged state object.`);
        krNote(`${KR_SAVE_UNREADABLE} — the prompts and the players are still here.`);
        saved[key] = null;
      }
    });
    if (saved.core) saved.core = window.KrCore.thaw(saved.core, Date.now());
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    krNote(`${KR_SAVE_UNREADABLE} — this game starts fresh.`);
    return null;
  }
}

/* ============ Room identity (the triage rule: saves are room-scoped) ============ */

/** Rename pids everywhere a core keeps them, history included. */
function krRekeyCore(c, map) {
  if (!c) return c;
  const re = (pid) => (Object.prototype.hasOwnProperty.call(map, pid) ? map[pid] : pid);
  const one = (s) => {
    const out = Object.assign({}, s, {
      players: s.players.map((p) => (Object.prototype.hasOwnProperty.call(map, p.pid)
        ? Object.assign({}, p, { pid: map[p.pid], manual: true }) : p)),
      winners: (s.winners || []).map(re),
    });
    if (s.dive) {
      const answers = {};
      Object.keys(s.dive.answers).forEach((pid) => { answers[re(pid)] = s.dive.answers[pid]; });
      out.dive = Object.assign({}, s.dive, { answers });
    }
    if (s.puffer) {
      out.puffer = Object.assign({}, s.puffer, {
        holder: re(s.puffer.holder), starter: re(s.puffer.starter), popped: s.puffer.popped && re(s.puffer.popped),
        pending: s.puffer.pending && Object.assign({}, s.puffer.pending, { pid: re(s.puffer.pending.pid) }),
        used: s.puffer.used.map((u) => Object.assign({}, u, { pid: re(u.pid) })),
      });
    }
    return out;
  };
  return Object.assign(one(c), { history: (c.history || []).map(one) });
}

/**
 * Shell pids restart at p1 in every room. When this save was made in another
 * room, its phone players become host-typed seats under fresh ids, so a new
 * p1 can never inherit somebody else's depth or answer. Same code: no change.
 */
function krBindRoom(code) {
  if (typeof code !== "string" || !code || krApp.roomCode === code) return;
  const map = {};
  let n = krApp.setup.nextManual || 1;
  const phones = (c) => (c ? c.players.filter((p) => !p.manual).map((p) => p.pid) : []);
  phones(krApp.core).concat(phones(krApp.resumable)).forEach((pid) => {
    if (!Object.prototype.hasOwnProperty.call(map, pid)) { map[pid] = `${KR_MANUAL_PREFIX}${n}`; n += 1; }
  });
  const players = krApp.setup.players.filter((p) => p.manual);
  krSet({
    roomCode: code, core: krRekeyCore(krApp.core, map), resumable: krRekeyCore(krApp.resumable, map),
    setup: Object.assign({}, krApp.setup, { players, nextManual: n }),
  });
}

/* ============ Content loading ============ */

async function krFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  krUseGame(await res.json(), label, kind, url);
}

/** An explicit ?game= URL wins over a saved file unless the save came from that URL. */
async function krLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    if (krApp.sourceKind === "url" && krApp.sourceUrl === url && krApp.game) return;
    try {
      await krFetchGame(url, `Prompts from ${url}`, "url");
      return;
    } catch (err) {
      krError(`Couldn’t load ${url}: ${err.message}. Falling back to the shipped prompts.`);
    }
  }
  if (krApp.game && krApp.sourceKind !== "default") return;
  try {
    await krFetchGame("prompts.json", "The shipped prompts", "default");
  } catch (err) {
    const offline = globalThis.KR_DEFAULT_GAME;
    if (!offline) { krError("No prompts could be loaded. Open the editor and add some."); return; }
    console.warn("Using the offline prompts:", err);
    krUseGame(offline, "The shipped prompts (offline copy)", "default", null);
  }
}

/** A file's settings become the setup's, unless the host changed them — tiers always follow the file. */
function krSettingsFor(game) {
  const fromFile = window.KrCore.settingsOf(game);
  const setup = krApp.setup;
  if (!setup.settingsTouched) return { settings: fromFile, mode: fromFile.mode };
  const sameTiers = fromFile.tiers.map((t) => t.id).join() === setup.settings.tiers.map((t) => t.id).join();
  return {
    settings: Object.assign({}, setup.settings, sameTiers ? {} : { tiers: fromFile.tiers }),
    mode: setup.mode,
  };
}

function krUseGame(game, source, kind, url) {
  window.KrCore.validateGame(game);
  const picked = krSettingsFor(game);
  krSet({
    game, source, sourceKind: kind || "custom", sourceUrl: url || null,
    setup: Object.assign({}, krApp.setup, picked),
  });
  krError(krPendingNote);
}

function krOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      krUseGame(JSON.parse(String(reader.result)), `Prompts from ${file.name}`, "file", null);
      krError("");
    } catch (err) {
      krError(`That file can’t be used: ${err.message}`);
    }
  };
  reader.onerror = () => krError("That file couldn’t be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup ============ */

function krSetSetup(patch) {
  krSet({ setup: Object.assign({}, krApp.setup, patch) });
}

/** Apply a settings change only if the core would accept it; otherwise say why. */
function krChangeSettings(change) {
  const next = change(JSON.parse(JSON.stringify(krApp.setup.settings)));
  try {
    const clean = window.KrCore.normalizeSettings(next);
    krError("");
    krSetSetup({ settings: clean, settingsTouched: true });
  } catch (err) {
    krError(err.message);
    krRender();
  }
}

function krAddPlayer(name, pid, manual) {
  const clean = window.KrCore.cleanText(name, window.KrCore.NAME_MAX);
  if (!clean || !pid) return;
  const players = krApp.setup.players;
  if (players.some((p) => p.pid === pid)) return;
  if (players.length >= window.KrCore.MAX_PLAYERS) {
    krError(`${window.KrCore.MAX_PLAYERS} players is the most Krillion can seat.`);
    return;
  }
  krSetSetup({ players: players.concat([{ pid, name: clean, manual: manual === true }]) });
}

function krAddManual(name) {
  const clean = window.KrCore.cleanText(name, window.KrCore.NAME_MAX);
  if (!clean) { krError("Type a name first."); return; }
  if (krApp.setup.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    krError(`There is already a player called ${clean}.`);
    return;
  }
  krError("");
  const n = krApp.setup.nextManual || 1;
  krApp = Object.assign({}, krApp, { setup: Object.assign({}, krApp.setup, { nextManual: n + 1 }) });
  krAddPlayer(clean, `${KR_MANUAL_PREFIX}${n}`, true);
}

function krRemovePlayer(pid) {
  krSetSetup({ players: krApp.setup.players.filter((p) => p.pid !== pid) });
}

/** The content the game plays with: the file plus the host's settings. */
function krEffectiveGame() {
  const game = JSON.parse(JSON.stringify(krApp.game));
  game.settings = Object.assign({}, krApp.setup.settings, { mode: krApp.setup.mode });
  return game;
}

function krStart() {
  krError("");
  if (!krApp.game) { krError("Load some prompts before you start."); return; }
  try {
    const state = window.KrCore.createState(krEffectiveGame(), {
      players: krApp.setup.players, mode: krApp.setup.mode, shuffle: !!krApp.setup.shuffle, rng: Math.random,
    });
    krSet({ core: window.KrCore.reduce(state, { type: "start" }), resumable: null, showList: false });
    window.KrSound.play("dive");
  } catch (err) {
    krError(err.message);
  }
}

/* ============ Game lobby control (docs/19 §1) ============ */

function krOpenLobby() {
  if (!krApp.core && !krApp.resumable) return;
  krSet({ lobbyOpen: true });
}

function krLobbyKeep() {
  const kept = krApp.core ? window.KrCore.freeze(krApp.core, Date.now()) : krApp.resumable;
  krSet({ lobbyOpen: false, resumable: kept, core: null, editorOpen: false });
}

function krLobbyRestart() {
  krSet({ lobbyOpen: false, resumable: null, core: null, editorOpen: false });
}

function krResume() {
  if (!krApp.resumable) return;
  krSet({ core: window.KrCore.thaw(krApp.resumable, Date.now()), resumable: null });
}

/* ============ Host actions ============ */

function krHostType() {
  const field = $("kr-type-text");
  const pid = $("kr-type-who").value;
  if (!field.value.trim()) { krError("Type their answer first."); return; }
  if (!window.KrCore.normaliseAnswer(field.value)) { krError("That answer has no letters or numbers in it."); return; }
  krError("");
  krDispatch({ type: "hostAnswer", pid, text: field.value });
  field.value = "";
  $("kr-type-who").value = "";       // the next render moves to the next player still to answer
  krRender();
  field.focus();
}

function krPufferType() {
  const field = $("kr-ptype-text");
  const c = krApp.core;
  if (!c || !c.puffer || !field.value.trim()) return;
  krDispatch({ type: "pufferAnswer", pid: c.puffer.holder, text: field.value });
  field.value = "";
  field.focus();
}

function krToggleClock() {
  const c = krApp.core;
  if (!c || !c.clock) return;
  krDispatch({ type: Number.isFinite(c.clock.deadline) ? "pauseClock" : "resumeClock" });
}

function krReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function krShowSplash(title, sub) {
  const node = $("gsc-splash");
  if (!node || krReducedMotion()) return;
  setText("gsc-splash-title", title);
  setText("gsc-splash-sub", sub);
  show(node, true);
  setTimeout(() => show(node, false), 600);
}

/* ============ Wiring ============ */

const KR_D = (type) => () => krDispatch({ type });

const KR_CLICKS = [
  ["btn-start", krStart], ["btn-resume", krResume],
  ["btn-open", KR_D("openPrompt")], ["btn-swap", KR_D("nextPrompt")],
  ["btn-close", KR_D("closePrompt")], ["btn-pause", krToggleClock], ["btn-ppause", krToggleClock],
  ["btn-reveal", KR_D("revealNext")], ["btn-next-prompt", KR_D("nextPrompt")],
  ["btn-pstart", KR_D("pufferStart")], ["btn-pop", KR_D("pufferPop")], ["btn-pnext", KR_D("nextRound")],
  ["btn-intro-undo", KR_D("undo")], ["btn-prompt-undo", KR_D("undo")], ["btn-reveal-undo", KR_D("undo")],
  ["btn-depth-undo", KR_D("undo")], ["btn-pundo", KR_D("undo")], ["btn-result-undo", KR_D("undo")],
  ["btn-intro-finish", KR_D("finish")], ["btn-prompt-finish", KR_D("finish")],
  ["btn-reveal-finish", KR_D("finish")], ["btn-depth-finish", KR_D("finish")], ["btn-pfinish", KR_D("finish")],
  ["btn-new-game", krLobbyRestart],
  ["btn-list", () => krSet({ showList: !krApp.showList })],
  ["btn-plist", () => krSet({ showList: !krApp.showList })],
  ["btn-game-lobby", krOpenLobby], ["btn-lobby-keep", krLobbyKeep],
  ["btn-lobby-restart", krLobbyRestart], ["btn-lobby-cancel", () => krSet({ lobbyOpen: false })],
  ["btn-load-json", () => $("kr-file").click()],
  ["btn-sound", () => { window.KrSound.toggle(); krRender(); }],
];

const KR_NUMBERS = [
  ["kr-set-seconds", (s, v) => { s.promptSeconds = v; }],
  ["kr-set-prompts", (s, v) => { s.promptsPerGame = v; }],
  ["kr-set-hearts", (s, v) => { s.puffer.hearts = v; }],
  ["kr-set-max", (s, v) => { s.puffer.maxHearts = v; }],
  ["kr-set-start", (s, v) => { s.puffer.startSeconds = v; }],
  ["kr-set-floor", (s, v) => { s.puffer.floorSeconds = v; }],
  ["kr-set-meter", (s, v) => { s.puffer.meterForHeart = v; }],
  ["kr-set-cap", (s, v) => { s.puffer.roundCap = v; }],
];

function krWireSetup() {
  KR_NUMBERS.forEach(([id, put]) => {
    $(id).addEventListener("change", (e) => krChangeSettings((s) => { put(s, Number(e.target.value)); return s; }));
  });
  $("kr-set-points").addEventListener("change", (e) => {
    const id = e.target && e.target.dataset ? e.target.dataset.tier : "";
    if (!id) return;
    krChangeSettings((s) => {
      s.tiers.forEach((t) => { if (t.id === id) t.points = Number(e.target.value); });
      return s;
    });
  });
  ["kr-mode-deep", "kr-mode-puffer"].forEach((id) => {
    $(id).addEventListener("change", (e) => {
      if (e.target.checked) krSetSetup({ mode: e.target.value, settingsTouched: true });
    });
  });
  $("kr-set-shuffle").addEventListener("change", (e) => krSetSetup({ shuffle: e.target.checked }));
  $("kr-add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    krAddManual($("kr-add-name").value);
    $("kr-add-name").value = "";
  });
  $("kr-file").addEventListener("change", krOnFile);
}

function krWireForms() {
  $("kr-type-form").addEventListener("submit", (e) => { e.preventDefault(); krHostType(); });
  $("kr-ptype-form").addEventListener("submit", (e) => { e.preventDefault(); krPufferType(); });
  $("kr-hide-typing").addEventListener("change", (e) => krSet({ hideTyping: e.target.checked }));
}

const KR_KEYS = {
  reveal: { r: "revealNext" },
  prompt: { c: "closePrompt" },
};

function krWireKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !krApp.core || krApp.editorOpen || krApp.lobbyOpen) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const key = String(e.key).toLowerCase();
    if (key === "u") { e.preventDefault(); krDispatch({ type: "undo" }); return; }
    const map = Object.prototype.hasOwnProperty.call(KR_KEYS, krApp.core.phase) ? KR_KEYS[krApp.core.phase] : null;
    if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return;
    e.preventDefault();
    krDispatch({ type: map[key] });
  });
}

function krMountLibrary() {
  const box = $("kr-library");
  if (!box || !window.GSCLibrary) return;
  window.GSCLibrary.mountPicker(box, {
    gameDir: "",
    label: "Saved sets",
    validate: (json) => window.KrCore.validateGame(json),
    onPick: (json, meta) => {
      try {
        krUseGame(json, `set: ${meta.name}`, "set", null);
        krError("");
      } catch (err) {
        krError(`That set can’t be used: ${err.message}`);
      }
    },
  });
}

function krWireClock() {
  window.KrClock.start({
    core: () => krApp.core,
    onExpire: (phase) => krDispatch({ type: phase === "puffer" ? "pufferPop" : "closePrompt" }),
    onTick: () => window.KrSound.play("tick"),
  });
  // Save once more when the tab hides or closes, so the frozen time is exact.
  window.addEventListener("pagehide", krSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) krSave(); });
}

/* ============ Boot ============ */

function krBoot() {
  const saved = krLoadSaved();
  if (saved) {
    krApp = Object.assign({}, krApp, saved, {
      setup: Object.assign({}, krFreshApp().setup, saved.setup || {}),
      editorOpen: false, lobbyOpen: false, showList: false,
    });
  }
  KR_CLICKS.forEach(([id, fn]) => {
    const node = $(id);
    if (node) node.addEventListener("click", fn);
  });
  krWireSetup();
  krWireForms();
  krWireKeys();
  krRender();
  krMountLibrary();
  krWireClock();
  krLoadContent().catch((err) => {
    console.warn("Content load failed:", err);
    krError(`Prompts could not be loaded: ${err.message}`);
  });
  if (krPendingNote) krError(krPendingNote);
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", krBoot);
  else krBoot();
}

window.KrApp = {
  state: () => krApp,
  core: () => krApp.core,
  set: krSet,
  error: krError,
  dispatch: krDispatch,
  subscribe: (fn) => { krListeners.push(fn); },
  useGame: krUseGame,
  addPlayer: krAddPlayer,
  addManual: krAddManual,
  removePlayer: krRemovePlayer,
  setPhoneCount: (n) => { if (n !== krApp.phoneCount) krSet({ phoneCount: n }); },
  bindRoom: krBindRoom,
  start: krStart,
  resume: krResume,
  showSplash: krShowSplash,
  save: krSave,
  storeSuffix: krStoreSuffix,
  STORAGE_KEY: KR_STORAGE_KEY,
};

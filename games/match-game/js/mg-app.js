/* ============================================================
   Match Game — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the Super Match
   spinner and the sound cues. All game rules live in
   mg-core.js; this file only dispatches events into the reducer
   and asks mg-view.js / mg-super.js to paint the result. Every
   string reaches the page through textContent, and no Peer, DOM
   or timer handle is ever stored in the state.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run cannot leave harness
 * prompts (or a half-played game) in the real host's save on the same origin.
 * Anything but letters, digits and hyphens is stripped.
 */
function mgStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const MG_STORAGE_KEY = `gsc-mg-state-v1${mgStoreSuffix()}`;
const MG_SPIN_MS = 900;

/* ============ App state ============ */

let mgApp = mgFreshApp();
const mgListeners = [];
let mgSpinTimer = null;

function mgFreshApp() {
  return {
    core: null,
    resumable: null,          // the game kept by "Game lobby → Keep this game"
    game: null,
    setup: {
      players: [],
      contestants: [{ name: "", pid: "" }, { name: "", pid: "" }],
      panel: [],
      shuffle: false,
      settingsTouched: false,
      settings: {
        panelSize: 6, rounds: 2, pointsPerMatch: 1,
        audienceValues: [500, 250, 100], multipliers: [10, 20, 30], secondRoundRule: false,
      },
    },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phoneCount: 0,
    editorOpen: false,
    lobbyOpen: false,
    hideTyping: false,
    spinning: false,
  };
}

/** Replace part of the app state, persist, repaint. */
function mgSet(patch) {
  mgApp = Object.assign({}, mgApp, patch);
  mgSave();
  mgRender();
}

function mgRender() {
  window.MgView.render(mgApp);
  mgListeners.forEach((fn) => {
    try { fn(mgApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** Send an event to the pure core, with the matching sound cue. */
function mgDispatch(event) {
  const state = mgApp.core;
  if (!state) return;
  const next = window.MgCore.reduce(state, event);
  if (next === state) return;
  mgCue(event, state, next);
  mgSet({ core: next });
}

const MG_CUES = {
  nextPrompt: "deal", nextContestant: "deal", tiebreak: "deal",
  revealNext: "flip", audienceAnswer: "vote", audienceClose: "board",
  pickPanelist: "deal", audienceOpen: "deal",
};

function mgCue(event, before, after) {
  if (event.type === "judge") { window.MgSound.play(event.match ? "match" : "miss"); return; }
  if (event.type === "hthJudge") { window.MgSound.play(event.match ? "payout" : "miss"); return; }
  if (event.type === "audiencePick") {
    window.MgSound.play(event.idx >= 0 ? "payout" : "miss");
    return;
  }
  if (event.type === "finish") { window.MgSound.play("game"); return; }
  if (Object.prototype.hasOwnProperty.call(MG_CUES, event.type)) {
    window.MgSound.play(MG_CUES[event.type]);
  }
  void before; void after;
}

/* ============ Persistence ============ */

function mgSerialise() {
  return {
    core: mgApp.core, resumable: mgApp.resumable, game: mgApp.game, setup: mgApp.setup,
    source: mgApp.source, sourceKind: mgApp.sourceKind, sourceUrl: mgApp.sourceUrl,
    roomCode: mgApp.roomCode, hideTyping: mgApp.hideTyping,
  };
}

function mgSave() {
  try {
    localStorage.setItem(MG_STORAGE_KEY, JSON.stringify(mgSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    mgError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
function mgUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.MgCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object" || !state.game.settings) return false;
  if (!Array.isArray(state.contestants) || state.contestants.length !== 2) return false;
  if (!Array.isArray(state.panel) || !state.panel.length) return false;
  if (!state.order || !Array.isArray(state.order.prompts)) return false;
  if (!Array.isArray(state.history) || !Array.isArray(state.matched)) return false;
  if (state.phase === "prompt" && (!state.current || !Array.isArray(state.current.order))) return false;
  const audience = ["audience", "audienceBoard"].indexOf(state.phase) >= 0;
  if (audience && (!state.audience || !Array.isArray(state.audience.submissions))) return false;
  if (["hthPrompt", "hthResult"].indexOf(state.phase) >= 0 && !state.hth) return false;
  return true;
}

const MG_SAVE_UNREADABLE = "Your saved game couldn’t be read, so it was cleared";

function mgLoadSaved() {
  try {
    const raw = localStorage.getItem(MG_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") {
      mgNote(`${MG_SAVE_UNREADABLE} — this night starts fresh.`);
      return null;
    }
    if (saved.game) window.MgCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    ["core", "resumable"].forEach((key) => {
      if (saved[key] !== null && saved[key] !== undefined && !mgUsableCore(saved[key])) {
        console.warn(`Ignoring a saved ${key} with a damaged state object.`);
        mgNote(`${MG_SAVE_UNREADABLE} — the prompts and the line-up are still here.`);
        saved[key] = null;
      }
    });
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    mgNote(`${MG_SAVE_UNREADABLE} — this night starts fresh.`);
    return null;
  }
}

function mgError(message) {
  const node = $("mg-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let mgPendingNote = "";

function mgNote(text) {
  mgPendingNote = text;
  if ($("mg-error")) mgError(text);
}

async function mgFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const game = await res.json();
  mgUseGame(game, label, kind, url);
}

/**
 * An explicit `?game=` URL wins over a saved file unless the save already came
 * from that URL (the cross-cutting rule from the Phase 1 triage).
 */
async function mgLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    if (mgApp.sourceKind === "url" && mgApp.sourceUrl === url && mgApp.game) return;
    try {
      await mgFetchGame(url, `Prompts from ${url}`, "url");
      return;
    } catch (err) {
      const kept = mgApp.game && mgApp.sourceKind !== "default";
      mgNote(`Couldn’t load ${url}: ${String(err.message).replace(/[.\s]+$/, "")}. `
        + (kept ? "Keeping the prompts you had." : "Using the shipped prompts instead."));
    }
  }
  if (mgApp.game && mgApp.sourceKind !== "default") return;
  try {
    await mgFetchGame("prompts.json", "The shipped prompts", "default");
  } catch (err) {
    const offline = globalThis.MG_DEFAULT_GAME;
    if (!offline) {
      mgError("No prompts could be loaded. Open the editor and paste some in.");
      return;
    }
    console.warn("Using the offline prompts:", err);
    mgUseGame(offline, "The shipped prompts (offline copy)", "default", null);
  }
}

function mgSettingsFromGame(game, setup) {
  if (setup.settingsTouched) return setup.settings;
  const s = window.MgCore.settingsOf(game);
  return {
    panelSize: s.panelSize, rounds: s.rounds, pointsPerMatch: s.pointsPerMatch,
    audienceValues: s.audienceValues.slice(), multipliers: s.multipliers.slice(),
    secondRoundRule: s.secondRoundRule,
  };
}

function mgUseGame(game, source, kind, url) {
  window.MgCore.validateGame(game);
  const settings = mgSettingsFromGame(game, mgApp.setup);
  const setup = Object.assign({}, mgApp.setup, { settings });
  mgSet({
    game, source, sourceKind: kind || "custom", sourceUrl: url || null,
    setup: mgFitPanel(setup, settings.panelSize),
  });
  mgError(mgPendingNote);
}

function mgOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      mgUseGame(JSON.parse(String(reader.result)), `Prompts from ${file.name}`, "file", null);
      mgError("");
    } catch (err) {
      mgError(`That file can’t be used: ${err.message}`);
    }
  };
  reader.onerror = () => mgError("That file couldn’t be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ The setup screen ============ */

/** Grow or shrink the panel to `size`, keeping the seats already filled in. */
function mgFitPanel(setup, size) {
  const panel = setup.panel.slice(0, size);
  while (panel.length < size) panel.push({ name: "", pid: "" });
  return Object.assign({}, setup, { panel });
}

function mgSetSetup(patch) {
  mgSet({ setup: Object.assign({}, mgApp.setup, patch) });
}

function mgSetSettings(patch) {
  const settings = Object.assign({}, mgApp.setup.settings, patch);
  const setup = mgFitPanel(Object.assign({}, mgApp.setup, { settingsTouched: true, settings }),
    settings.panelSize);
  mgSet({ setup });
}

/** Nobody may hold two seats: taking a phone frees it everywhere else. */
function mgClaimPid(setup, pid, where) {
  if (!pid) return setup;
  const contestants = setup.contestants.map((c, i) => (
    c.pid === pid && !(where.kind === "contestant" && where.index === i) ? Object.assign({}, c, { pid: "" }) : c));
  const panel = setup.panel.map((p, i) => (
    p.pid === pid && !(where.kind === "panel" && where.index === i) ? Object.assign({}, p, { pid: "" }) : p));
  return Object.assign({}, setup, { contestants, panel });
}

function mgNameOf(pid) {
  const found = mgApp.setup.players.find((p) => p.pid === pid);
  return found ? found.name : "";
}

function mgSetPanelPid(slot, pid) {
  const setup = mgClaimPid(mgApp.setup, pid, { kind: "panel", index: slot });
  const panel = setup.panel.map((p, i) => (i === slot
    ? { name: p.name || mgNameOf(pid), pid } : p));
  mgSetSetup(Object.assign({}, setup, { panel }));
}

function mgSetPanelName(slot, name) {
  const panel = mgApp.setup.panel.map((p, i) => (i === slot ? Object.assign({}, p, { name }) : p));
  mgSetSetup({ panel });
}

function mgSetContestantPid(index, pid) {
  const setup = mgClaimPid(mgApp.setup, pid, { kind: "contestant", index });
  const contestants = setup.contestants.map((c, i) => (i === index
    ? { name: c.name || mgNameOf(pid), pid } : c));
  mgSetSetup(Object.assign({}, setup, { contestants }));
}

function mgSetContestantName(index, name) {
  const contestants = mgApp.setup.contestants.map((c, i) => (
    i === index ? Object.assign({}, c, { name }) : c));
  mgSetSetup({ contestants });
}

/** A phone that joins takes the first free seat: contestants, then the panel. */
function mgAddPlayer(name, pid, manual) {
  const clean = window.MgCore.cleanText(name, window.MgCore.NAME_MAX);
  if (!clean || !pid) return;
  const players = mgApp.setup.players;
  if (players.some((p) => p.pid === pid)) return;
  const setup = Object.assign({}, mgApp.setup, {
    players: players.concat([{ pid, name: clean, manual: manual === true }]),
  });
  mgSet({ setup: mgAutoSeat(setup, pid, clean) });
}

function mgAutoSeat(setup, pid, name) {
  const free = setup.contestants.findIndex((c) => !c.pid);
  if (free >= 0) {
    return Object.assign({}, setup, {
      contestants: setup.contestants.map((c, i) => (i === free ? { name: c.name || name, pid } : c)),
    });
  }
  const seat = setup.panel.findIndex((p) => !p.pid);
  if (seat < 0) return setup;
  return Object.assign({}, setup, {
    panel: setup.panel.map((p, i) => (i === seat ? { name: p.name || name, pid } : p)),
  });
}

function mgRemovePlayer(pid) {
  const setup = Object.assign({}, mgApp.setup, {
    players: mgApp.setup.players.filter((p) => p.pid !== pid),
    contestants: mgApp.setup.contestants.map((c) => (c.pid === pid ? Object.assign({}, c, { pid: "" }) : c)),
    panel: mgApp.setup.panel.map((p) => (p.pid === pid ? Object.assign({}, p, { pid: "" }) : p)),
  });
  mgSet({ setup });
}

/* ============ Starting ============ */

/** The content the game actually plays with: the file plus the host's rules. */
function mgEffectiveGame() {
  const game = JSON.parse(JSON.stringify(mgApp.game));
  game.settings = Object.assign({}, window.MgCore.settingsOf(mgApp.game), mgApp.setup.settings);
  return game;
}

function mgLineUp() {
  const contestants = mgApp.setup.contestants.map((c, i) => ({
    pid: c.pid, name: c.name.trim() || `Contestant ${i + 1}`,
  }));
  const panel = mgApp.setup.panel.map((p, i) => ({
    pid: p.pid, name: p.name.trim() || `Panelist ${i + 1}`,
  }));
  return { contestants, panel };
}

function mgStart() {
  mgError("");
  if (!mgApp.game) { mgError("Load some prompts before you start."); return; }
  try {
    const lineUp = mgLineUp();
    const state = window.MgCore.createState(mgEffectiveGame(), {
      contestants: lineUp.contestants, panel: lineUp.panel,
      shuffle: mgApp.setup.shuffle, rng: Math.random,
    });
    mgSet({ core: window.MgCore.reduce(state, { type: "start" }), resumable: null });
    window.MgSound.play("deal");
  } catch (err) {
    mgError(err.message);
  }
}

/* ============ Host actions ============ */

function mgLockGuess() {
  const field = $("mg-guess-text");
  if (!field.value.trim()) { mgError("Type what the contestant said first."); return; }
  mgError("");
  mgDispatch({ type: "contestantAnswer", text: field.value });
  field.value = "";
}

function mgTypePanelAnswer(slot, text) {
  mgDispatch({ type: "panelAnswer", slot, text });
}

function mgHostAudienceAnswer(text) {
  if (!text.trim()) return;
  const pid = `h${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  mgDispatch({ type: "audienceAnswer", pid, text });
}

function mgAudiencePick(idx) {
  const field = $("mg-pick-text");
  mgDispatch({ type: "audiencePick", idx, text: field ? field.value : "" });
  if (field) field.value = "";
}

function mgLockHth() {
  const field = $("mg-hth-text");
  if (!field.value.trim()) { mgError("Type the contestant’s answer first."); return; }
  mgError("");
  mgDispatch({ type: "hthAnswer", text: field.value, who: "contestant" });
  field.value = "";
}

/** A panelist with no phone: the host types their Head-to-Head card (MG-D1). */
function mgLockHthPanel() {
  const field = $("mg-hth-panel-text");
  if (!field.value.trim()) { mgError("Type the panelist’s answer first."); return; }
  mgError("");
  mgDispatch({ type: "hthAnswer", text: field.value, who: "panel" });
  field.value = "";
}

/** The wheel: the roll goes into the event so undo and a reload replay it. */
function mgSpin() {
  if (mgApp.spinning) return;
  const before = mgApp.core;
  mgDispatch({ type: "spin", roll: Math.random() });
  if (mgApp.core === before) return;          // already spun: the show spins once
  window.MgSound.play("spin");
  if (mgReducedMotion()) return;
  mgSet({ spinning: true });
  if (mgSpinTimer) clearTimeout(mgSpinTimer);
  mgSpinTimer = setTimeout(() => { mgSpinTimer = null; mgSet({ spinning: false }); }, MG_SPIN_MS);
}

function mgReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/* ============ The game lobby control (docs/19 §1) ============ */

function mgOpenLobby() {
  if (!mgApp.core && !mgApp.resumable) return;
  mgSet({ lobbyOpen: true });
}

function mgLobbyKeep() {
  mgSet({ lobbyOpen: false, resumable: mgApp.core || mgApp.resumable, core: null, editorOpen: false });
}

function mgLobbyRestart() {
  mgSet({ lobbyOpen: false, resumable: null, core: null, editorOpen: false });
}

function mgResume() {
  if (!mgApp.resumable) return;
  mgSet({ core: mgApp.resumable, resumable: null });
}

/* ============ The splash (design-system §3) ============ */

const MG_SPLASH_MS = 600;   // docs/21 §2.8: a plain 600 ms title card

function mgShowSplash(title) {
  const node = $("gsc-splash");
  if (!node || mgReducedMotion()) return;
  setText("gsc-splash-title", title);
  setText("gsc-splash-sub", "");
  show(node, true);
  setTimeout(() => show(node, false), MG_SPLASH_MS);
}

/* ============ Wiring ============ */

const MG_CLICKS = [
  ["btn-start", mgStart],
  ["btn-resume", mgResume],
  ["btn-reveal", () => mgDispatch({ type: "revealNext" })],
  ["btn-match", () => mgDispatch({ type: "judge", match: true })],
  ["btn-no-match", () => mgDispatch({ type: "judge", match: false })],
  ["btn-next-prompt", () => mgDispatch({ type: "nextPrompt" })],
  ["btn-next-contestant", () => mgDispatch({ type: "nextContestant" })],
  ["btn-undo", () => mgDispatch({ type: "undo" })],
  ["btn-finish", () => mgDispatch({ type: "finish" })],
  ["btn-next-round", () => mgDispatch({ type: "nextContestant" })],
  ["btn-tiebreak", () => mgDispatch({ type: "tiebreak" })],
  ["btn-scores-undo", () => mgDispatch({ type: "undo" })],
  ["btn-scores-finish", () => mgDispatch({ type: "finish" })],
  ["btn-audience-open", () => mgDispatch({ type: "audienceOpen" })],
  ["btn-skip-audience", () => mgDispatch({ type: "toHeadToHead" })],
  ["btn-super-finish", () => mgDispatch({ type: "finish" })],
  ["btn-aud-close", () => mgDispatch({ type: "audienceClose" })],
  ["btn-aud-undo", () => mgDispatch({ type: "undo" })],
  ["btn-board-undo", () => mgDispatch({ type: "undo" })],
  ["btn-board-skip", () => mgDispatch({ type: "toHeadToHead" })],
  ["btn-pick-undo", () => mgDispatch({ type: "undo" })],
  ["btn-spin", mgSpin],
  ["btn-hth-reveal", () => mgDispatch({ type: "revealNext" })],
  ["btn-hth-match", () => mgDispatch({ type: "hthJudge", match: true })],
  ["btn-hth-no", () => mgDispatch({ type: "hthJudge", match: false })],
  ["btn-hth-undo", () => mgDispatch({ type: "undo" })],
  ["btn-super-standings", () => mgDispatch({ type: "finish" })],
  ["btn-result-undo", () => mgDispatch({ type: "undo" })],
  ["btn-standings-undo", () => mgDispatch({ type: "undo" })],
  ["btn-new-game", mgLobbyRestart],
  // Tester fix (MG-D6): "Play another game" had no handler. Embedded → the hub lobby.
  ["btn-next-game", () => { const r = window.MgRoom && window.MgRoom.room;
    if (r && r.exit && document.body.classList.contains("gsc-embedded")) r.exit(); else mgLobbyRestart(); }],
  ["btn-game-lobby", mgOpenLobby],
  ["btn-lobby-keep", mgLobbyKeep],
  ["btn-lobby-restart", mgLobbyRestart],
  ["btn-lobby-cancel", () => mgSet({ lobbyOpen: false })],
  ["btn-load-json", () => $("mg-file").click()],
  ["btn-shuffle", () => mgSetSetup({ shuffle: !mgApp.setup.shuffle })],
  ["btn-sound", () => { window.MgSound.toggle(); mgRender(); }],
];

const MG_NUMBERS = [
  ["mg-set-panel", "panelSize", 2, 6],
  ["mg-set-rounds", "rounds", 1, 6],
  ["mg-set-points", "pointsPerMatch", 1, 100],
];

function mgWireSettings() {
  MG_NUMBERS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) {
        e.target.value = String(mgApp.setup.settings[key]);
        mgError(`That has to be a whole number between ${lo} and ${hi}.`);
        return;
      }
      mgError("");
      mgSetSettings({ [key]: value });
    });
  });
  ["mg-set-v1", "mg-set-v2", "mg-set-v3"].forEach((id, i) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < 1) {
        e.target.value = String(mgApp.setup.settings.audienceValues[i]);
        mgError("An Audience Match value has to be a whole number of at least 1.");
        return;
      }
      const audienceValues = mgApp.setup.settings.audienceValues.slice();
      audienceValues[i] = value;
      mgError("");
      mgSetSettings({ audienceValues });
    });
  });
  $("mg-set-mult").addEventListener("change", (e) => {
    const list = mgParseNumbers(e.target.value);
    if (!list.length) {
      e.target.value = mgApp.setup.settings.multipliers.join(", ");
      mgError("The multipliers are a comma-separated list of whole numbers, like 10, 20, 30.");
      return;
    }
    mgError("");
    mgSetSettings({ multipliers: list });
  });
  $("mg-set-rule").addEventListener("change", (e) => {
    mgSetSettings({ secondRoundRule: e.target.checked });
  });
}

function mgParseNumbers(text) {
  return String(text).split(",").map((n) => Math.round(Number(n.trim())))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 1000).slice(0, 6);
}

function mgWireSetup() {
  [0, 1].forEach((i) => {
    $(`mg-c${i + 1}-name`).addEventListener("input", (e) => mgSetContestantName(i, e.target.value));
    $(`mg-c${i + 1}-pid`).addEventListener("change", (e) => mgSetContestantPid(i, e.target.value));
  });
  $("mg-file").addEventListener("change", mgOnFile);
  mgWireSettings();
}

function mgWireForms() {
  $("mg-guess-form").addEventListener("submit", (e) => { e.preventDefault(); mgLockGuess(); });
  $("mg-hth-form").addEventListener("submit", (e) => { e.preventDefault(); mgLockHth(); });
  $("mg-hth-panel-form").addEventListener("submit", (e) => { e.preventDefault(); mgLockHthPanel(); });
  $("mg-aud-host-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const field = $("mg-aud-host-text");
    mgHostAudienceAnswer(field.value);
    field.value = "";
    field.focus();
  });
  $("mg-pick-form").addEventListener("submit", (e) => e.preventDefault());
  $("mg-hide-typing").addEventListener("change", (e) => mgSet({ hideTyping: e.target.checked }));
}

const MG_KEYS = {
  r: () => mgDispatch({ type: "revealNext" }),
  " ": () => mgDispatch({ type: "judge", match: true }),
  x: () => mgDispatch({ type: "judge", match: false }),
  u: () => mgDispatch({ type: "undo" }),
  n: () => mgDispatch({ type: "nextContestant" }),
};

function mgWireKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!mgApp.core || mgApp.core.phase !== "prompt" || mgApp.editorOpen || mgApp.lobbyOpen) return;
    const key = e.key === " " ? " " : String(e.key).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(MG_KEYS, key)) return;
    e.preventDefault();
    MG_KEYS[key]();
  });
}

/** The set library from docs/19 §2 — hidden with a message when it cannot load. */
function mgMountLibrary() {
  const box = $("mg-library");
  if (!box || !window.GSCLibrary) return;
  window.GSCLibrary.mountPicker(box, {
    gameDir: "",
    label: "Saved sets",
    validate: (json) => window.MgCore.validateGame(json),
    onPick: (json, meta) => {
      try {
        mgUseGame(json, `set: ${meta.name}`, "set", null);
        mgError("");
      } catch (err) {
        mgError(`That set can’t be used: ${err.message}`);
      }
    },
  });
}

/* ============ Room scope (MG-D2) ============ */

/** Does this saved game seat anyone by a phone id? */
function mgSeatsPhones(state) {
  return !!state && (state.panel.some((p) => p.pid) || state.contestants.some((c) => c.pid));
}

/**
 * A saved game belongs to the room it was played in. Phone ids (p1, p2, …)
 * are issued per room, so in a NEW room the old seats would be inherited by
 * whoever is issued that id next. A different room code drops every phone
 * seat, and any game that seats a phone; host-typed seats keep their names.
 * The Pyramid pattern (games/pyramid/js/pyr-app.js pyrBindRoom).
 */
function mgBindRoom(code) {
  if (typeof code !== "string" || !code || mgApp.roomCode === code) return;
  const unseat = (row) => (row.pid ? Object.assign({}, row, { pid: "" }) : row);
  const setup = Object.assign({}, mgApp.setup, {
    players: mgApp.setup.players.filter((p) => p.manual),
    contestants: mgApp.setup.contestants.map(unseat),
    panel: mgApp.setup.panel.map(unseat),
  });
  const core = mgSeatsPhones(mgApp.core) ? null : mgApp.core;
  const resumable = mgSeatsPhones(mgApp.resumable) ? null : mgApp.resumable;
  const cleared = core !== mgApp.core || resumable !== mgApp.resumable;
  mgSet({ roomCode: code, setup, core, resumable });
  if (cleared) {
    mgNote("This is a new room, so the game in progress was cleared — its phone seats belonged to the old room.");
  }
}

/* ============ Boot ============ */

function mgBoot() {
  const saved = mgLoadSaved();
  if (saved) {
    mgApp = Object.assign({}, mgApp, saved, {
      setup: Object.assign({}, mgFreshApp().setup, saved.setup || {}),
      editorOpen: false, lobbyOpen: false, spinning: false,
    });
    mgApp.setup = mgFitPanel(mgApp.setup, mgApp.setup.settings.panelSize);
  }
  MG_CLICKS.forEach(([id, fn]) => {
    const node = $(id);
    if (node) node.addEventListener("click", fn);
  });
  // docs/21 rules 5 and 9: an icon beside each toolbar label (shared/icons.js).
  [["btn-editor", "edit"], ["btn-game-lobby", "lobby"], ["btn-undo", "undo"]].forEach(([id, icon]) => {
    if (window.GSCIcons && $(id)) window.GSCIcons.prepend($(id), icon);
  });
  mgWireSetup();
  mgWireForms();
  mgWireKeys();
  mgRender();
  mgMountLibrary();
  mgLoadContent().catch((err) => {
    console.warn("Content load failed:", err);
    mgError(`Prompts could not be loaded: ${err.message}`);
  });
  if (mgPendingNote) mgError(mgPendingNote);
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mgBoot);
  else mgBoot();
}

window.MgApp = {
  state: () => mgApp,
  core: () => mgApp.core,
  set: mgSet,
  error: mgError,
  dispatch: mgDispatch,
  subscribe: (fn) => { mgListeners.push(fn); },
  useGame: mgUseGame,
  addPlayer: mgAddPlayer,
  removePlayer: mgRemovePlayer,
  setPhoneCount: (n) => { if (n !== mgApp.phoneCount) mgSet({ phoneCount: n }); },
  bindRoom: mgBindRoom,
  setPanelName: mgSetPanelName,
  setPanelPid: mgSetPanelPid,
  setContestantName: mgSetContestantName,
  setContestantPid: mgSetContestantPid,
  typePanelAnswer: mgTypePanelAnswer,
  audiencePick: mgAudiencePick,
  merge: (from, into) => mgDispatch({ type: "mergeAnswers", from, into }),
  pickPanelist: (slot) => mgDispatch({ type: "pickPanelist", slot }),
  start: mgStart,
  resume: mgResume,
  showSplash: mgShowSplash,
  storeSuffix: mgStoreSuffix,
  STORAGE_KEY: MG_STORAGE_KEY,
};

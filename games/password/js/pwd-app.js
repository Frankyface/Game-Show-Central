/* ============================================================
   Password — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the Lightning
   Round clock and the sound cues. All game rules live in
   pwd-core.js; this file only dispatches events into the reducer
   and asks pwd-view.js to paint the result. Every string reaches
   the page through textContent, and no Peer/DOM/timer handle is
   ever stored in the state.
   ============================================================ */

"use strict";

/**
 * `?store=NAME` moves this page's localStorage into its own namespace. The
 * loopback harness uses `?store=harness` so a test run cannot leave harness
 * words (or a half-played game) in the real host's save on the same origin —
 * the pattern Price Is Right settled on in Phase 3 (defect PW-D5).
 * Anything but letters, digits and hyphens is stripped.
 */
function pwdStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const PWD_STORAGE_KEY = `gsc-pwd-state-v1${pwdStoreSuffix()}`;
const PWD_STUDY_MS = 5000;   // spec 13 §3: study mode shows the password for 5 s

/* ============ App state ============ */

let pwdApp = pwdFreshApp();
const pwdListeners = [];
let pwdClock = null;
let pwdStudyTimer = null;

function pwdFreshApp() {
  return {
    core: null,
    game: null,
    setup: {
      players: [],
      teamNames: ["Team A", "Team B"],
      seats: [["", ""], ["", ""]],
      mode: "phone",
      shuffle: false,
      settingsTouched: false,
      settings: {
        targetScore: 25, lightningSeconds: 60, lightningWords: 5,
        lightningValue: 100, allFiveBonus: true, swapRoles: true, firstTeam: 0,
      },
    },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phoneCount: 0,
    editorOpen: false,
    reveal: false,           // "Show password to me" — never persisted
    lightningReveal: false,
    studyUntil: null,
  };
}

/** Replace part of the app state, persist, repaint. */
function pwdSet(patch) {
  pwdApp = Object.assign({}, pwdApp, patch);
  pwdSave();
  pwdRender();
}

function pwdRender() {
  window.PwdView.render(pwdApp);
  if (pwdClock) pwdClock.refresh();
  pwdListeners.forEach((fn) => {
    try { fn(pwdApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** Send an event to the pure core, with the matching sound cue. */
function pwdDispatch(event) {
  const state = pwdApp.core;
  if (!state) return;
  const next = window.PwdCore.reduce(state, event, Date.now());
  if (next === state) return;
  pwdCue(event, state, next);
  pwdSet(Object.assign({ core: next }, pwdResetReveal(event, state, next)));
}

/** A new password, or a new Lightning Round, starts hidden again. */
function pwdResetReveal(event, before, after) {
  if (event.type === "nextWord" && after.phase === "word" && after.round !== before.round) {
    return { reveal: false, studyUntil: null };
  }
  if (event.type === "toLightning") return { lightningReveal: false };
  return {};
}

const PWD_CUES = { clueGiven: "clue", illegal: "illegal", lightningStart: "start", nextWord: "deal" };

function pwdCue(event, before, after) {
  if (event.type === "guess") {
    if (event.result !== "correct") { window.PwdSound.play("wrong"); return; }
    window.PwdSound.play(after.phase === "gameOver" ? "game" : "correct");
    return;
  }
  if (event.type === "lightningMark") {
    if (after.lightning && after.lightning.finished) {
      window.PwdSound.play(after.outcome && after.outcome.allFive ? "grand" : "close");
    } else window.PwdSound.play(event.result === "got" ? "got" : "pass");
    return;
  }
  if (event.type === "lightningExpired") { window.PwdSound.play("buzzer"); return; }
  if (event.type === "nextWord" && after.phase !== "word") return;
  if (Object.prototype.hasOwnProperty.call(PWD_CUES, event.type)) {
    window.PwdSound.play(PWD_CUES[event.type]);
  }
  void before;
}

/* ============ Persistence ============ */

function pwdSerialise() {
  return {
    core: pwdApp.core, game: pwdApp.game, setup: pwdApp.setup,
    source: pwdApp.source, sourceKind: pwdApp.sourceKind, sourceUrl: pwdApp.sourceUrl,
    roomCode: pwdApp.roomCode,
  };
}

function pwdSave() {
  try {
    localStorage.setItem(PWD_STORAGE_KEY, JSON.stringify(pwdSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    pwdError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
function pwdUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.PwdCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object" || !state.game.settings) return false;
  if (!Array.isArray(state.order) || !Array.isArray(state.teams) || !Array.isArray(state.history)) return false;
  if (!Array.isArray(state.scores) || state.scores.length !== 2) return false;
  if (state.teams.length !== 2 || state.teams.some((t) => !Array.isArray(t.members) || t.members.length !== 2)) {
    return false;
  }
  if (state.phase === "word" && (!state.round || !Array.isArray(state.round.log))) return false;
  if (state.phase === "lightning" && (!state.lightning || !Array.isArray(state.lightning.words))) return false;
  return true;
}

/**
 * A running clock is a deadline in the PAST once the tab has been away, so a
 * restored Lightning Round is always paused: the host presses Resume when the
 * room is ready again (success state PW-I5).
 */
function pwdPauseRestored(state) {
  if (!state || !state.lightning || !state.lightning.clock) return state;
  const clock = state.lightning.clock;
  const left = clock.running && clock.deadline
    ? Math.max(0, clock.deadline - Date.now()) : clock.remainingMs;
  return Object.assign({}, state, {
    lightning: Object.assign({}, state.lightning, {
      clock: { running: false, deadline: null, remainingMs: left },
    }),
  });
}

/**
 * A save we cannot use is always dropped — but never silently: the host is told
 * on the setup screen what happened, the way a failed `?game=` is (defect
 * PW-D6, and the house rule that every failure path surfaces a message).
 */
const PWD_SAVE_UNREADABLE = "Your saved game couldn’t be read, so it was cleared";

function pwdLoadSaved() {
  try {
    const raw = localStorage.getItem(PWD_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") {
      pwdNote(`${PWD_SAVE_UNREADABLE} — this night starts fresh.`);
      return null;
    }
    if (saved.game) window.PwdCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (saved.core !== null && saved.core !== undefined && !pwdUsableCore(saved.core)) {
      console.warn("Ignoring a saved game with a damaged state object.");
      pwdNote(`${PWD_SAVE_UNREADABLE} — the words and the line-up are still here.`);
      return Object.assign({}, saved, { core: null });
    }
    return Object.assign({}, saved, { core: pwdPauseRestored(saved.core) });
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    pwdNote(`${PWD_SAVE_UNREADABLE} — this night starts fresh.`);
    return null;
  }
}

function pwdError(message) {
  const node = $("pwd-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let pwdLoadMessage = "";   // survives the pwdSet() in pwdBoot, which clears the banner

/** Add one sentence to the banner pwdBoot shows. Notes never overwrite. */
function pwdNote(text) {
  if (!text) return;
  pwdLoadMessage = pwdLoadMessage ? `${pwdLoadMessage} ${text}` : text;
}
// The first half of the ?game= failure banner. The second half depends on what
// pwdChooseContent actually settles on, so it is written there.
let pwdUrlFailure = "";

async function pwdFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.PwdCore.validateGame(game);
  return { game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function pwdLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await pwdFetchGame(url, `Custom words from ${url}`, "fetch");
    } catch (err) {
      pwdUrlFailure = `Could not load words from ${url}: ${err.message}.`;
    }
  }
  try {
    return await pwdFetchGame("words.json", "Built-in words (words.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = globalThis.PWD_DEFAULT_GAME;
    if (!offline) {
      pwdLoadMessage = "No words could be loaded at all — open the editor and build a list.";
      return { game: null, source: "No words loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in words (offline copy)", kind: "default", url: null };
  }
}

/**
 * A loaded file brings its own rules. They land in the setup screen so the host
 * can see and change them — unless the host has already touched a rule field,
 * in which case their choice wins.
 */
function pwdSettingsFromGame(game, setup) {
  if (!game || setup.settingsTouched) return setup.settings;
  const s = window.PwdCore.settingsOf(game);
  return Object.assign({}, setup.settings, {
    targetScore: s.targetScore, lightningSeconds: s.lightningSeconds,
    lightningWords: s.lightningWords, lightningValue: s.lightningValue,
    allFiveBonus: s.allFiveBonus, swapRoles: s.swapRoles,
  });
}

/** Adopt a validated game — from the editor, a file, or a URL. */
function pwdUseGame(game, source, kind) {
  window.PwdCore.validateGame(game);
  pwdSet({
    game, source: source || "Custom words", sourceKind: kind || "upload",
    sourceUrl: null, core: null,
    setup: Object.assign({}, pwdApp.setup, { settings: pwdSettingsFromGame(game, pwdApp.setup) }),
  });
  pwdError("");
}

function pwdOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      pwdUseGame(JSON.parse(String(reader.result)), `Custom words from ${file.name}`, "upload");
    } catch (err) {
      pwdError(`That file is not a usable Password game: ${err.message}`);
    }
  };
  reader.onerror = () => pwdError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function pwdAddPlayer(name, pid, manual) {
  const clean = window.PwdCore.cleanText(name, window.PwdCore.NAME_MAX);
  if (!clean) { pwdError("Give the player a name first."); return false; }
  const players = pwdApp.setup.players;
  if (players.length >= 16) { pwdError("That is the maximum of 16 players."); return false; }
  const twin = players.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (twin) {
    // A phone that shares a name with somebody the host typed in IS that person,
    // arriving with a phone. Take over the typed row and its seat — the way the
    // hub relinks a returning player — instead of refusing them a seat at all.
    if (manual === false && pid && twin.manual) return pwdAdoptSeat(twin, pid);
    pwdError(`${clean} is already on the list — pick another name.`);
    return false;
  }
  const id = pid || `w${Date.now().toString(36)}${players.length}`;
  const next = players.concat([{ pid: id, name: clean, manual: manual !== false }]);
  pwdSet({ setup: Object.assign({}, pwdApp.setup, { players: next, seats: pwdAutoSeats(next) }) });
  pwdError("");
  return true;
}

/**
 * Hand a typed player's row — and whatever seat it holds — to the phone that
 * just joined under the same name. The name is kept as the host typed it.
 * @param {{pid:string, name:string}} row @param {string} pid the phone's pid
 */
function pwdAdoptSeat(row, pid) {
  const players = pwdApp.setup.players.map((p) => (
    p.pid === row.pid ? { pid, name: p.name, manual: false } : p));
  const seats = pwdApp.setup.seats.map((pair) => pair.map((s) => (s === row.pid ? pid : s)));
  pwdSet({ setup: Object.assign({}, pwdApp.setup, { players, seats }) });
  pwdError("");
  return true;
}

function pwdRemovePlayer(pid) {
  const players = pwdApp.setup.players.filter((p) => p.pid !== pid);
  const seats = pwdApp.setup.seats.map((pair) => pair.map((seat) => (seat === pid ? "" : seat)));
  pwdSet({ setup: Object.assign({}, pwdApp.setup, { players, seats }) });
}

/** Fill empty seats in roster order; never move somebody the host placed. */
function pwdAutoSeats(players) {
  const seats = pwdApp.setup.seats.map((pair) => pair.slice());
  const taken = new Set(seats.flat().filter(Boolean));
  const free = players.filter((p) => !taken.has(p.pid)).map((p) => p.pid);
  seats.forEach((pair, t) => pair.forEach((seat, s) => {
    if (!seat && free.length) seats[t][s] = free.shift();
  }));
  return seats;
}

function pwdSetSeat(team, seat, pid) {
  const seats = pwdApp.setup.seats.map((pair) => pair.slice());
  // One person cannot hold two seats: clear whichever other seat they were in.
  if (pid) seats.forEach((pair, t) => pair.forEach((held, s) => { if (held === pid) seats[t][s] = ""; }));
  seats[team][seat] = pid;
  pwdSet({ setup: Object.assign({}, pwdApp.setup, { seats }) });
}

/** The game the reducer actually plays: the file with the host's rules on top. */
function pwdEffectiveGame() {
  const game = JSON.parse(JSON.stringify(pwdApp.game));
  const s = pwdApp.setup.settings;
  game.settings = Object.assign({}, game.settings, {
    targetScore: s.targetScore, lightningSeconds: s.lightningSeconds,
    lightningWords: s.lightningWords, lightningValue: s.lightningValue,
    allFiveBonus: s.allFiveBonus, swapRoles: s.swapRoles,
  });
  return game;
}

function pwdTeamsForCore() {
  return pwdApp.setup.seats.map((pair, i) => ({
    name: pwdApp.setup.teamNames[i],
    members: pair.map((pid) => {
      const found = pwdApp.setup.players.find((p) => p.pid === pid);
      return found ? { pid: found.pid, name: found.name } : null;
    }).filter(Boolean),
  }));
}

function pwdStart() {
  try {
    if (!pwdApp.game) throw new Error("Words are still loading — try again in a second.");
    const teams = pwdTeamsForCore();
    if (teams.some((t) => t.members.length !== 2)) {
      throw new Error("Fill all four seats: two players on each team.");
    }
    const state = window.PwdCore.createState(pwdEffectiveGame(), teams, {
      shuffle: !!pwdApp.setup.shuffle,
      firstTeam: pwdApp.setup.settings.firstTeam,
    });
    const started = window.PwdCore.reduce(state, { type: "start" }, Date.now());
    pwdSet({ core: started, reveal: false, lightningReveal: false, studyUntil: null });
    pwdError("");
  } catch (err) {
    pwdError(err.message);
  }
}

/* ============ Host actions ============ */

/** The Lightning Round clock's start/pause button. */
function pwdToggleClock() {
  const state = pwdApp.core;
  if (!state || !state.lightning) return;
  pwdDispatch({ type: state.lightning.clock.running ? "lightningPause" : "lightningStart" });
}

function pwdToggleReveal() {
  pwdSet({ reveal: !pwdApp.reveal, studyUntil: null });
}

/** Show the password for five seconds so the host can read it to the givers. */
function pwdStudy() {
  pwdSet({ reveal: false, studyUntil: Date.now() + PWD_STUDY_MS });
  if (pwdStudyTimer) clearInterval(pwdStudyTimer);
  pwdStudyTimer = setInterval(() => {
    if (!Number.isFinite(pwdApp.studyUntil) || Date.now() >= pwdApp.studyUntil) {
      clearInterval(pwdStudyTimer);
      pwdStudyTimer = null;
      pwdSet({ studyUntil: null });
      return;
    }
    pwdRender();
  }, 250);
}

function pwdToLightning() {
  const select = $("pwd-lightning-giver");
  const giver = select && (select.value === "0" || select.value === "1") ? Number(select.value) : undefined;
  pwdDispatch({ type: "toLightning", giver });
}

/**
 * An intent from a phone. The host is still the judge: the core decides whether
 * this pid may act at all — it must be the current giver, and for a Lightning
 * mark the clock must be running (or at the buzzer, judging the word in
 * flight). Judging a guess and calling a clue illegal stay host-only.
 * @param {string} pid @param {"clue"|"got"|"pass"} intent
 */
function pwdPhoneIntent(pid, intent) {
  const state = pwdApp.core;
  if (!state) return;
  const Core = window.PwdCore;
  if (intent === "clue") {
    if (!Core.phoneCanClue(state, pid)) return;
    pwdDispatch({ type: "clueGiven", team: state.round.turn });
    return;
  }
  if (intent !== "got" && intent !== "pass") return;
  if (!Core.phoneCanMark(state, pid)) return;
  pwdDispatch({ type: "lightningMark", result: intent });
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone players would
 * otherwise be inherited by whoever is issued that pid next. A different room
 * code drops every phone seat; players the host typed in keep their own ids.
 */
function pwdBindRoom(code) {
  if (typeof code !== "string" || !code || pwdApp.roomCode === code) return;
  const manual = new Set(pwdApp.setup.players.filter((p) => p.manual).map((p) => p.pid));
  const players = pwdApp.setup.players.filter((p) => p.manual);
  const seats = pwdApp.setup.seats.map((pair) => pair.map((pid) => (manual.has(pid) ? pid : "")));
  let core = pwdApp.core;
  let message = "";
  if (core && core.teams.some((t) => t.members.some((m) => !manual.has(m.pid)))) {
    core = null;
    message = "This is a new room, so the game in progress was cleared — the phone seats belonged to the old one.";
  }
  pwdSet({ roomCode: code, core, setup: Object.assign({}, pwdApp.setup, { players, seats }) });
  if (message) pwdError(message);
}

/* ============ Hotkeys ============ */

function pwdIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

const PWD_WORD_KEYS = { c: { type: "clueGiven" }, w: { type: "guess", result: "wrong" },
  x: { type: "illegal" }, n: { type: "nextWord" }, u: { type: "undo" } };
const PWD_LIGHTNING_KEYS = { p: { type: "lightningMark", result: "pass" },
  n: { type: "nextWord" }, u: { type: "undo" } };

function pwdOnKey(event) {
  if (pwdIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (pwdApp.editorOpen) return;
  const state = pwdApp.core;
  if (!state) return;
  if (state.phase === "word") { pwdWordKey(event); return; }
  if (state.phase === "lightning") pwdLightningKey(event);
}

function pwdWordKey(event) {
  const key = String(event.key).toLowerCase();
  if (pwdIsSpace(event)) {
    event.preventDefault();
    pwdDispatch({ type: "guess", result: "correct" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(PWD_WORD_KEYS, key)) {
    event.preventDefault();
    pwdDispatch(PWD_WORD_KEYS[key]);
  }
}

function pwdLightningKey(event) {
  const key = String(event.key).toLowerCase();
  if (pwdIsSpace(event)) {
    event.preventDefault();
    pwdDispatch({ type: "lightningMark", result: "got" });
    return;
  }
  if (event.key === "Enter") { event.preventDefault(); pwdToggleClock(); return; }
  if (Object.prototype.hasOwnProperty.call(PWD_LIGHTNING_KEYS, key)) {
    event.preventDefault();
    pwdDispatch(PWD_LIGHTNING_KEYS[key]);
  }
}

function pwdIsSpace(event) {
  return event.key === " " || event.key === "Spacebar" || event.code === "Space";
}

/* ============ The clock ============ */

function pwdWireClock() {
  pwdClock = window.PwdClock.create({
    el: $("pwd-clock"),
    getClock: () => (pwdApp.core && pwdApp.core.lightning ? pwdApp.core.lightning.clock : null),
    onExpire: () => pwdDispatch({ type: "lightningExpired" }),
    onTick: () => window.PwdSound.play("tick"),
  });
  pwdClock.start();
}

/* ============ Wiring ============ */

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function pwdWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function pwdWireSetup() {
  $("pwd-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (pwdAddPlayer($("pwd-player-name").value)) $("pwd-player-name").value = "";
  });
  $("btn-load-json").addEventListener("click", () => $("pwd-file").click());
  $("pwd-file").addEventListener("change", pwdOnFile);
  $("btn-start").addEventListener("click", pwdStart);
  pwdWireButton("btn-shuffle", () => {
    pwdSet({ setup: Object.assign({}, pwdApp.setup, { shuffle: !pwdApp.setup.shuffle }) });
  });
  [["pwd-team-a", 0], ["pwd-team-b", 1]].forEach(([id, i]) => {
    $(id).addEventListener("input", (e) => {
      const names = pwdApp.setup.teamNames.slice();
      names[i] = e.target.value.slice(0, window.PwdCore.NAME_MAX);
      pwdSet({ setup: Object.assign({}, pwdApp.setup, { teamNames: names }) });
    });
  });
  [["pwd-a1", 0, 0], ["pwd-a2", 0, 1], ["pwd-b1", 1, 0], ["pwd-b2", 1, 1]].forEach(([id, t, s]) => {
    $(id).addEventListener("change", (e) => pwdSetSeat(t, s, e.target.value));
  });
  ["pwd-mode-phone", "pwd-mode-host"].forEach((id) => {
    $(id).addEventListener("change", (e) => {
      if (e.target.checked) pwdSet({ setup: Object.assign({}, pwdApp.setup, { mode: e.target.value }) });
    });
  });
  pwdWireRuleFields();
}

const PWD_RULE_FIELDS = [
  ["pwd-set-target", "targetScore", 5, 100],
  ["pwd-set-lsecs", "lightningSeconds", 15, 180],
  ["pwd-set-lwords", "lightningWords", 1, 10],
  ["pwd-set-lvalue", "lightningValue", 1, 1000000],
];

function pwdTouchSettings(fields) {
  pwdSet({ setup: Object.assign({}, pwdApp.setup, {
    settingsTouched: true,
    settings: Object.assign({}, pwdApp.setup.settings, fields),
  }) });
}

function pwdWireRuleFields() {
  PWD_RULE_FIELDS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) {
        e.target.value = String(pwdApp.setup.settings[key]);
        pwdError(`That has to be a whole number between ${lo} and ${hi}.`);
        return;
      }
      pwdError("");
      pwdTouchSettings({ [key]: value });
    });
  });
  $("pwd-set-first").addEventListener("change", (e) => {
    pwdTouchSettings({ firstTeam: e.target.value === "1" ? 1 : 0 });
  });
  $("pwd-set-bonus").addEventListener("change", (e) => pwdTouchSettings({ allFiveBonus: e.target.checked }));
  $("pwd-set-swap").addEventListener("change", (e) => pwdTouchSettings({ swapRoles: e.target.checked }));
}

function pwdWireWord() {
  pwdWireButton("btn-clue", () => pwdDispatch({ type: "clueGiven" }));
  pwdWireButton("btn-correct", () => pwdDispatch({ type: "guess", result: "correct" }));
  pwdWireButton("btn-wrong", () => pwdDispatch({ type: "guess", result: "wrong" }));
  pwdWireButton("btn-illegal", () => pwdDispatch({ type: "illegal" }));
  pwdWireButton("btn-reveal", pwdToggleReveal);
  pwdWireButton("btn-study", pwdStudy);
  pwdWireButton("btn-skip", () => pwdDispatch({ type: "skipWord" }));
  pwdWireButton("btn-first", () => {
    const state = pwdApp.core;
    if (state && state.round) pwdDispatch({ type: "setFirst", team: 1 - state.round.turn });
  });
  pwdWireButton("btn-undo", () => pwdDispatch({ type: "undo" }));
  pwdWireButton("btn-finish", () => pwdDispatch({ type: "finish" }));
  pwdWireButton("btn-next-word", () => pwdDispatch({ type: "nextWord" }));
}

function pwdWireOver() {
  pwdWireButton("btn-to-lightning", pwdToLightning);
  pwdWireButton("btn-over-next-game", () => pwdDispatch({ type: "nextGame" }));
  pwdWireButton("btn-over-undo", () => pwdDispatch({ type: "undo" }));
  pwdWireButton("btn-over-finish", () => pwdDispatch({ type: "finish" }));
}

function pwdWireLightning() {
  pwdWireButton("btn-l-start", pwdToggleClock);
  pwdWireButton("btn-l-got", () => pwdDispatch({ type: "lightningMark", result: "got" }));
  pwdWireButton("btn-l-pass", () => pwdDispatch({ type: "lightningMark", result: "pass" }));
  pwdWireButton("btn-l-reveal", () => pwdSet({ lightningReveal: !pwdApp.lightningReveal }));
  pwdWireButton("btn-l-undo", () => pwdDispatch({ type: "undo" }));
  pwdWireButton("btn-l-finish", () => pwdDispatch({ type: "finish" }));
  pwdWireButton("btn-l-next", () => pwdDispatch({ type: "nextWord" }));
}

function pwdWireResult() {
  pwdWireButton("btn-result-next", () => pwdDispatch({ type: "nextWord" }));
  pwdWireButton("btn-result-undo", () => pwdDispatch({ type: "undo" }));
  pwdWireButton("btn-next-game", () => pwdDispatch({ type: "nextGame" }));
  pwdWireButton("btn-new-teams", () => pwdSet({ core: null, reveal: false, lightningReveal: false }));
}

function pwdWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.PwdSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.PwdSound.enabled));
  };
  sound.addEventListener("click", () => { window.PwdSound.toggle(); paint(); });
  paint();
  document.addEventListener("keydown", pwdOnKey);
  window.addEventListener("beforeunload", pwdSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pwdSave(); });
}

/* ============ Boot ============ */

/**
 * Saved roster first, then any phone the shell added while we were loading.
 * De-duplicated by pid AND by name: a phone that arrived under the same name as
 * a typed row takes that row over (pid and seat), so the seat dropdowns never
 * offer two identical names with nothing to tell them apart.
 */
function pwdMergeSetup(savedSetup, current) {
  const base = Object.assign({}, pwdApp.setup, savedSetup);
  const players = (savedSetup.players || []).slice();
  const swaps = [];
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  current.forEach((p) => {
    if (players.some((x) => x.pid === p.pid)) return;
    const i = players.findIndex((x) => x.manual && same(x.name, p.name));
    if (i < 0) { players.push(p); return; }
    swaps.push([players[i].pid, p.pid]);
    players[i] = { pid: p.pid, name: players[i].name, manual: false };
  });
  base.players = players;
  const seats = Array.isArray(savedSetup.seats) && savedSetup.seats.length === 2
    ? savedSetup.seats.map((pair) => (Array.isArray(pair) ? pair.slice(0, 2) : ["", ""]))
    : pwdApp.setup.seats;
  base.seats = seats.map((pair) => pair.map((seat) => {
    const swap = swaps.find(([was]) => was === seat);
    return swap ? swap[1] : seat;
  }));
  base.settings = Object.assign({}, pwdApp.setup.settings, savedSetup.settings || {});
  return base;
}

/**
 * An explicit ?game=URL always wins over the saved game unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old words when they follow a shared link.
 */
function pwdChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.game && (!urlWon || saved.sourceUrl === wantUrl);
  const patch = {
    game: (useSaved && saved.game) || loaded.game,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (saved && saved.setup) patch.setup = pwdMergeSetup(saved.setup, pwdApp.setup.players);
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved && saved.core) patch.core = saved.core;
  if (pwdUrlFailure) {
    pwdNote(`${pwdUrlFailure} ${useSaved
      ? "Keeping the words you already had."
      : "Using the built-in list instead."}`);
  } else if (!useSaved && saved && saved.core) {
    pwdNote("Loaded the words from the link, so the game in progress was cleared.");
  }
  const setup = patch.setup || pwdApp.setup;
  patch.setup = Object.assign({}, setup, { settings: pwdSettingsFromGame(patch.game, setup) });
  return patch;
}

async function pwdBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  window.PwdView.showSplash();
  if (mode.endsWith("-player")) return;   // pwd-phone.js owns the phone page

  // Read the saved game BEFORE the first await: pwd-room.js seeds the roster as
  // soon as the shell sends `init`, and that write would clobber the restore.
  const saved = pwdLoadSaved();

  pwdWireSetup();
  pwdWireWord();
  pwdWireOver();
  pwdWireLightning();
  pwdWireResult();
  pwdWireChrome();
  pwdWireClock();

  const loaded = await pwdLoadContent();
  pwdSet(pwdChooseContent(saved, loaded));
  if (pwdLoadMessage) pwdError(pwdLoadMessage);
}

/** The public surface pwd-editor.js / pwd-room.js / the harness build on. */
window.PwdApp = {
  state: () => pwdApp,
  core: () => pwdApp.core,
  dispatch: pwdDispatch,
  set: pwdSet,
  render: pwdRender,
  useGame: pwdUseGame,
  addPlayer: pwdAddPlayer,
  removePlayer: pwdRemovePlayer,
  setSeat: pwdSetSeat,
  error: pwdError,
  subscribe: (fn) => { if (typeof fn === "function") pwdListeners.push(fn); },
  start: pwdStart,
  study: pwdStudy,
  toggleReveal: pwdToggleReveal,
  phoneIntent: pwdPhoneIntent,
  bindRoom: pwdBindRoom,
  showSplash: () => window.PwdView.showSplash(),
  storeSuffix: pwdStoreSuffix,
  setPhoneCount: (n) => { if (n !== pwdApp.phoneCount) pwdSet({ phoneCount: Number(n) || 0 }); },
  STORAGE_KEY: PWD_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { pwdBoot().catch((err) => pwdError(err.message)); });
} else {
  pwdBoot().catch((err) => pwdError(err.message));
}

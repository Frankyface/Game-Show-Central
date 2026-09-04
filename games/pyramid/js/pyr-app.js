/* ============================================================
   Pyramid — host glue
   Owns the app state (one serialisable object), persistence, the
   setup screen, the host's buttons and hotkeys, the two clocks
   and the sound cues. All game rules live in pyr-core.js; this
   file only dispatches events into the reducer and asks
   pyr-view.js to paint the result. Every string reaches the page
   through textContent, and no Peer/DOM/timer handle is ever
   stored in the state.
   ============================================================ */

"use strict";

const PYR_STORAGE_KEY = "gsc-pyr-state-v1";
const PYR_STUDY_MS = 10000;

/* ============ App state ============ */

let pyrApp = pyrFreshApp();
const pyrListeners = [];
let pyrRoundClock = null;
let pyrCircleClock = null;
let pyrStudyTimer = null;

function pyrFreshApp() {
  return {
    core: null,
    game: null,
    setup: {
      players: [],
      teamNames: ["Team A", "Team B"],
      seats: [["", ""], ["", ""]],
      mode: "phone",
      settingsTouched: false,
      settings: { categorySeconds: 30, circleSeconds: 60, categoriesPerTeam: 3, swapRoles: true },
    },
    usedIds: [],
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    roomCode: null,
    phoneCount: 0,
    editorOpen: false,
    reveal: false,        // "Show words to me" — never persisted
    circleReveal: false,
    studyUntil: null,
  };
}

/** Replace part of the app state, persist, repaint. */
function pyrSet(patch) {
  pyrApp = Object.assign({}, pyrApp, patch);
  pyrSave();
  pyrRender();
}

function pyrRender() {
  window.PyrView.render(pyrApp);
  if (pyrRoundClock) pyrRoundClock.refresh();
  if (pyrCircleClock) pyrCircleClock.refresh();
  pyrListeners.forEach((fn) => {
    try { fn(pyrApp.core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/** Send an event to the pure core, with the matching sound cue. */
function pyrDispatch(event) {
  const state = pyrApp.core;
  if (!state) return;
  const next = window.PyrCore.reduce(state, event, Date.now());
  if (next === state) return;
  pyrCue(event, state, next);
  pyrSet(Object.assign({ core: next }, pyrResetReveal(event)));
}

/** A new round or a new circle starts hidden again, whatever was on screen. */
function pyrResetReveal(event) {
  if (event.type === "pickCategory" || event.type === "tiebreak") return { reveal: false, studyUntil: null };
  if (event.type === "toCircle") return { circleReveal: false };
  return {};
}

const PYR_CUES = { clockStart: "start", circleStart: "start", pickCategory: "pick" };

function pyrCue(event, before, after) {
  void before;
  if (event.type === "mark") {
    window.PyrSound.play(event.result === "correct" ? "correct" : (event.result === "pass" ? "pass" : "illegal"));
    return;
  }
  if (event.type === "circleMark") {
    if (after.circle && after.circle.finished) {
      window.PyrSound.play(after.outcome && after.outcome.cleared ? "grand" : "close");
    } else window.PyrSound.play(event.result === "correct" ? "box" : (event.result === "pass" ? "pass" : "illegal"));
    return;
  }
  if (event.type === "clockExpired" || event.type === "circleExpired") {
    window.PyrSound.play("buzzer");
    return;
  }
  const cue = PYR_CUES[event.type];
  if (cue) window.PyrSound.play(cue);
}

/* ============ Persistence ============ */

function pyrSerialise() {
  return {
    core: pyrApp.core, game: pyrApp.game, setup: pyrApp.setup, usedIds: pyrApp.usedIds,
    source: pyrApp.source, sourceKind: pyrApp.sourceKind, sourceUrl: pyrApp.sourceUrl,
    roomCode: pyrApp.roomCode,
  };
}

function pyrSave() {
  try {
    localStorage.setItem(PYR_STORAGE_KEY, JSON.stringify(pyrSerialise()));
  } catch (err) {
    console.warn("Could not save the game:", err);
    pyrError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

/** Every field the reducer and the renderers dereference without a guard. */
function pyrUsableCore(state) {
  if (!state || typeof state !== "object") return false;
  if (typeof state.phase !== "string" || window.PyrCore.PHASES.indexOf(state.phase) < 0) return false;
  if (!state.game || typeof state.game !== "object" || !state.game.settings) return false;
  if (!Array.isArray(state.board) || !Array.isArray(state.teams) || !Array.isArray(state.history)) return false;
  if (state.teams.length !== 2 || state.teams.some((t) => !Array.isArray(t.members) || t.members.length !== 2)) {
    return false;
  }
  if (state.board.some((slot) => !slot || !Array.isArray(slot.words))) return false;
  if (state.phase === "play" && (!state.round || !Array.isArray(state.round.words))) return false;
  if (state.phase === "circle" && (!state.circle || !Array.isArray(state.circle.boxes))) return false;
  return true;
}

/**
 * A running clock is a deadline in the PAST once the tab has been away, so a
 * restored game is always paused: the host presses Resume when the room is
 * ready again (success state Y-I5).
 */
function pyrPauseRestored(state) {
  if (!state) return state;
  const stop = (clock) => Object.assign({}, clock, {
    running: false, deadline: null,
    remainingMs: clock.running && clock.deadline ? Math.max(0, clock.deadline - Date.now()) : clock.remainingMs,
  });
  const out = Object.assign({}, state);
  if (out.round && out.round.clock) out.round = Object.assign({}, out.round, { clock: stop(out.round.clock) });
  if (out.circle && out.circle.clock) out.circle = Object.assign({}, out.circle, { clock: stop(out.circle.clock) });
  return out;
}

function pyrLoadSaved() {
  try {
    const raw = localStorage.getItem(PYR_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.game) window.PyrCore.validateGame(saved.game);
    if (typeof saved.roomCode !== "string") saved.roomCode = null;
    if (saved.core !== null && saved.core !== undefined && !pyrUsableCore(saved.core)) {
      console.warn("Ignoring a saved game with a damaged state object.");
      return Object.assign({}, saved, { core: null });
    }
    return Object.assign({}, saved, { core: pyrPauseRestored(saved.core) });
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

function pyrError(message) {
  const node = $("pyr-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

let pyrLoadMessage = "";   // survives the pyrSet() in pyrBoot, which clears the banner

async function pyrFetchGame(url, label, kind) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const game = await res.json();
  window.PyrCore.validateGame(game);
  return { game, source: label, kind, url: kind === "fetch" ? url : null };
}

async function pyrLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      return await pyrFetchGame(url, `Custom categories from ${url}`, "fetch");
    } catch (err) {
      pyrLoadMessage = `Could not load categories from ${url}: ${err.message}. Using the built-in set instead.`;
    }
  }
  try {
    return await pyrFetchGame("categories.json", "Built-in categories (categories.json)", "default");
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    const offline = window.PYR_DEFAULT_GAME;
    if (!offline) {
      pyrLoadMessage = "No categories could be loaded at all — open the editor and build a set.";
      return { game: null, source: "No categories loaded", kind: "none", url: null };
    }
    return { game: offline, source: "Built-in categories (offline copy)", kind: "default", url: null };
  }
}

/**
 * A loaded file brings its own clock lengths and board size. They land in the
 * setup screen so the host can see and change them — unless the host has
 * already touched a rule field, in which case their choice wins.
 */
function pyrSettingsFromGame(game, setup) {
  if (!game || setup.settingsTouched) return setup.settings;
  const s = window.PyrCore.settingsOf(game);
  return {
    categorySeconds: s.categorySeconds, circleSeconds: s.circleSeconds,
    categoriesPerTeam: s.categoriesPerTeam, swapRoles: s.swapRoles,
  };
}

/** Adopt a validated game — from the editor, a file, or a URL. */
function pyrUseGame(game, source, kind) {
  window.PyrCore.validateGame(game);
  pyrSet({
    game, source: source || "Custom categories", sourceKind: kind || "upload",
    sourceUrl: null, core: null, usedIds: [],
    setup: Object.assign({}, pyrApp.setup, { settings: pyrSettingsFromGame(game, pyrApp.setup) }),
  });
  pyrError("");
}

function pyrOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      pyrUseGame(JSON.parse(String(reader.result)), `Custom categories from ${file.name}`, "upload");
    } catch (err) {
      pyrError(`That file is not a usable Pyramid game: ${err.message}`);
    }
  };
  reader.onerror = () => pyrError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function pyrAddPlayer(name, pid, manual) {
  const clean = window.PyrCore.cleanText(name, window.PyrCore.NAME_MAX);
  if (!clean) { pyrError("Give the player a name first."); return false; }
  const players = pyrApp.setup.players;
  if (players.length >= 16) { pyrError("That is the maximum of 16 players."); return false; }
  if (players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    pyrError(`${clean} is already on the list — pick another name.`);
    return false;
  }
  const id = pid || `y${Date.now().toString(36)}${players.length}`;
  const next = players.concat([{ pid: id, name: clean, manual: manual !== false }]);
  pyrSet({ setup: Object.assign({}, pyrApp.setup, { players: next, seats: pyrAutoSeats(next) }) });
  pyrError("");
  return true;
}

function pyrRemovePlayer(pid) {
  const players = pyrApp.setup.players.filter((p) => p.pid !== pid);
  const seats = pyrApp.setup.seats.map((pair) => pair.map((seat) => (seat === pid ? "" : seat)));
  pyrSet({ setup: Object.assign({}, pyrApp.setup, { players, seats }) });
}

/** Fill empty seats in roster order; never move somebody the host placed. */
function pyrAutoSeats(players) {
  const seats = pyrApp.setup.seats.map((pair) => pair.slice());
  const taken = new Set(seats.flat().filter(Boolean));
  const free = players.filter((p) => !taken.has(p.pid)).map((p) => p.pid);
  seats.forEach((pair, t) => pair.forEach((seat, s) => {
    if (!seat && free.length) seats[t][s] = free.shift();
  }));
  return seats;
}

function pyrSetSeat(team, seat, pid) {
  const seats = pyrApp.setup.seats.map((pair) => pair.slice());
  // One person cannot hold two seats: clear whichever other seat they were in.
  if (pid) seats.forEach((pair, t) => pair.forEach((held, s) => { if (held === pid) seats[t][s] = ""; }));
  seats[team][seat] = pid;
  pyrSet({ setup: Object.assign({}, pyrApp.setup, { seats }) });
}

/** The game the reducer actually plays: the file with the host's rules on top. */
function pyrEffectiveGame() {
  const game = JSON.parse(JSON.stringify(pyrApp.game));
  game.settings = Object.assign({}, game.settings, {
    categorySeconds: pyrApp.setup.settings.categorySeconds,
    circleSeconds: pyrApp.setup.settings.circleSeconds,
    categoriesPerTeam: pyrApp.setup.settings.categoriesPerTeam,
    swapRoles: pyrApp.setup.settings.swapRoles,
  });
  return game;
}

function pyrTeamsForCore() {
  return pyrApp.setup.seats.map((pair, i) => ({
    name: pyrApp.setup.teamNames[i],
    members: pair.map((pid) => {
      const found = pyrApp.setup.players.find((p) => p.pid === pid);
      return found ? { pid: found.pid, name: found.name } : null;
    }).filter(Boolean),
  }));
}

function pyrStart() {
  try {
    if (!pyrApp.game) throw new Error("Categories are still loading — try again in a second.");
    const teams = pyrTeamsForCore();
    if (teams.some((t) => t.members.length !== 2)) {
      throw new Error("Fill all four seats: two players on each team.");
    }
    const state = window.PyrCore.createState(pyrEffectiveGame(), teams, { usedIds: pyrApp.usedIds });
    const started = window.PyrCore.reduce(state, { type: "start" }, Date.now());
    const used = pyrApp.usedIds
      .concat(started.board.map((slot) => slot.catId))
      .concat(started.tiebreakCat ? [started.tiebreakCat.catId] : [])
      .concat(started.circleSet ? [started.circleSet.setId] : []);
    pyrSet({ core: started, usedIds: used.slice(-60), reveal: false, circleReveal: false, studyUntil: null });
    pyrError("");
  } catch (err) {
    pyrError(err.message);
  }
}

/* ============ Host actions ============ */

function pyrPick(index) { pyrDispatch({ type: "pickCategory", index }); }

/** The category clock's start/pause button. */
function pyrToggleClock(which) {
  const state = pyrApp.core;
  if (!state) return;
  if (which === "circle") {
    const running = state.circle && state.circle.clock.running;
    pyrDispatch({ type: running ? "circlePause" : "circleStart" });
    return;
  }
  const running = state.round && state.round.clock.running;
  pyrDispatch({ type: running ? "clockPause" : "clockStart" });
}

function pyrToggleReveal() {
  pyrSet({ reveal: !pyrApp.reveal, studyUntil: null });
}

/** Show the list for ten seconds so the host can read it to the giver. */
function pyrStudy() {
  pyrSet({ reveal: false, studyUntil: Date.now() + PYR_STUDY_MS });
  if (pyrStudyTimer) clearInterval(pyrStudyTimer);
  pyrStudyTimer = setInterval(() => {
    if (!Number.isFinite(pyrApp.studyUntil) || Date.now() >= pyrApp.studyUntil) {
      clearInterval(pyrStudyTimer);
      pyrStudyTimer = null;
      pyrSet({ studyUntil: null });
      return;
    }
    pyrRender();
  }, 250);
}

/** A tap from the giver's phone. The host is still the judge: this is checked
    against the state before it becomes an event, and illegal is host-only. */
function pyrPhoneMark(pid, result) {
  const state = pyrApp.core;
  if (!state || (result !== "correct" && result !== "pass")) return;
  if (state.phase === "play" && state.round && state.round.giverPid === pid) {
    pyrDispatch({ type: "mark", result });
    return;
  }
  if (state.phase === "circle" && state.circle && state.circle.giverPid === pid) {
    pyrDispatch({ type: "circleMark", result });
  }
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's phone players would
 * otherwise be inherited by whoever is issued that pid next. A different room
 * code drops every phone seat; players the host typed in keep their own ids.
 */
function pyrBindRoom(code) {
  if (typeof code !== "string" || !code || pyrApp.roomCode === code) return;
  const manual = new Set(pyrApp.setup.players.filter((p) => p.manual).map((p) => p.pid));
  const players = pyrApp.setup.players.filter((p) => p.manual);
  const seats = pyrApp.setup.seats.map((pair) => pair.map((pid) => (manual.has(pid) ? pid : "")));
  let core = pyrApp.core;
  let message = "";
  if (core && core.teams.some((t) => t.members.some((m) => !manual.has(m.pid)))) {
    core = null;
    message = "This is a new room, so the game in progress was cleared — the phone seats belonged to the old one.";
  }
  pyrSet({ roomCode: code, core, setup: Object.assign({}, pyrApp.setup, { players, seats }) });
  if (message) pyrError(message);
}

/* ============ Hotkeys ============ */

function pyrIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

const PYR_MARK_KEYS = { p: "pass", x: "illegal" };

function pyrOnKey(event) {
  if (pyrIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target && event.target.tagName === "BUTTON") return;
  if (pyrApp.editorOpen) return;
  const state = pyrApp.core;
  if (!state) return;
  const circle = state.phase === "circle";
  if (!circle && state.phase !== "play") return;
  const markEvent = circle ? "circleMark" : "mark";
  const key = String(event.key).toLowerCase();
  const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
  if (isSpace) { event.preventDefault(); pyrDispatch({ type: markEvent, result: "correct" }); return; }
  if (PYR_MARK_KEYS[key]) { event.preventDefault(); pyrDispatch({ type: markEvent, result: PYR_MARK_KEYS[key] }); return; }
  if (key === "u") { event.preventDefault(); pyrDispatch({ type: "undo" }); return; }
  if (event.key === "Enter") { event.preventDefault(); pyrToggleClock(circle ? "circle" : "round"); return; }
  if (key === "n") { event.preventDefault(); pyrDispatch({ type: "nextTurn" }); }
}

/* ============ Clocks ============ */

function pyrWireClocks() {
  pyrRoundClock = window.PyrClock.create({
    el: $("pyr-clock"),
    getClock: () => (pyrApp.core && pyrApp.core.round ? pyrApp.core.round.clock : null),
    onExpire: () => pyrDispatch({ type: "clockExpired" }),
    onTick: () => window.PyrSound.play("tick"),
  });
  pyrCircleClock = window.PyrClock.create({
    el: $("pyr-circle-clock"),
    getClock: () => (pyrApp.core && pyrApp.core.circle ? pyrApp.core.circle.clock : null),
    onExpire: () => pyrDispatch({ type: "circleExpired" }),
    onTick: () => window.PyrSound.play("tick"),
  });
  pyrRoundClock.start();
  pyrCircleClock.start();
}

/* ============ Wiring ============ */

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function pyrWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function pyrWireSetup() {
  $("pyr-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (pyrAddPlayer($("pyr-player-name").value)) $("pyr-player-name").value = "";
  });
  $("btn-load-json").addEventListener("click", () => $("pyr-file").click());
  $("pyr-file").addEventListener("change", pyrOnFile);
  $("btn-start").addEventListener("click", pyrStart);
  [["pyr-team-a", 0], ["pyr-team-b", 1]].forEach(([id, i]) => {
    $(id).addEventListener("input", (e) => {
      const names = pyrApp.setup.teamNames.slice();
      names[i] = e.target.value.slice(0, window.PyrCore.NAME_MAX);
      pyrSet({ setup: Object.assign({}, pyrApp.setup, { teamNames: names }) });
    });
  });
  [["pyr-a1", 0, 0], ["pyr-a2", 0, 1], ["pyr-b1", 1, 0], ["pyr-b2", 1, 1]].forEach(([id, t, s]) => {
    $(id).addEventListener("change", (e) => pyrSetSeat(t, s, e.target.value));
  });
  ["pyr-mode-phone", "pyr-mode-host"].forEach((id) => {
    $(id).addEventListener("change", (e) => {
      if (e.target.checked) pyrSet({ setup: Object.assign({}, pyrApp.setup, { mode: e.target.value }) });
    });
  });
  pyrWireRuleFields();
}

const PYR_RULE_FIELDS = [
  ["pyr-set-catsecs", "categorySeconds", 5, 300],
  ["pyr-set-circlesecs", "circleSeconds", 5, 300],
  ["pyr-set-perteam", "categoriesPerTeam", 1, 6],
];

function pyrWireRuleFields() {
  PYR_RULE_FIELDS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) { e.target.value = String(pyrApp.setup.settings[key]); return; }
      pyrSet({ setup: Object.assign({}, pyrApp.setup, {
        settingsTouched: true,
        settings: Object.assign({}, pyrApp.setup.settings, { [key]: value }),
      }) });
    });
  });
  $("pyr-set-swap").addEventListener("change", (e) => {
    pyrSet({ setup: Object.assign({}, pyrApp.setup, {
      settingsTouched: true,
      settings: Object.assign({}, pyrApp.setup.settings, { swapRoles: e.target.checked }),
    }) });
  });
}

function pyrWirePlay() {
  pyrWireButton("btn-clock-start", () => pyrToggleClock("round"));
  pyrWireButton("btn-correct", () => pyrDispatch({ type: "mark", result: "correct" }));
  pyrWireButton("btn-pass", () => pyrDispatch({ type: "mark", result: "pass" }));
  pyrWireButton("btn-illegal", () => pyrDispatch({ type: "mark", result: "illegal" }));
  pyrWireButton("btn-reveal-words", pyrToggleReveal);
  pyrWireButton("btn-study", pyrStudy);
  pyrWireButton("btn-undo", () => pyrDispatch({ type: "undo" }));
  pyrWireButton("btn-next", () => pyrDispatch({ type: "nextTurn" }));
}

function pyrWireBoard() {
  pyrWireButton("btn-board-undo", () => pyrDispatch({ type: "undo" }));
  pyrWireButton("btn-board-finish", () => pyrDispatch({ type: "finish" }));
  pyrWireButton("btn-tiebreak", () => pyrDispatch({ type: "tiebreak" }));
  pyrWireButton("btn-to-circle-a", () => pyrDispatch({ type: "toCircle", team: 0 }));
  pyrWireButton("btn-to-circle-b", () => pyrDispatch({ type: "toCircle", team: 1 }));
}

function pyrWireCircle() {
  pyrWireButton("btn-circle-start", () => pyrToggleClock("circle"));
  pyrWireButton("btn-circle-correct", () => pyrDispatch({ type: "circleMark", result: "correct" }));
  pyrWireButton("btn-circle-pass", () => pyrDispatch({ type: "circleMark", result: "pass" }));
  pyrWireButton("btn-circle-illegal", () => pyrDispatch({ type: "circleMark", result: "illegal" }));
  pyrWireButton("btn-circle-reveal", () => pyrSet({ circleReveal: !pyrApp.circleReveal }));
  pyrWireButton("btn-circle-undo", () => pyrDispatch({ type: "undo" }));
  pyrWireButton("btn-circle-next", () => pyrDispatch({ type: "nextTurn" }));
}

function pyrWireResult() {
  pyrWireButton("btn-result-next", () => pyrDispatch({ type: "nextTurn" }));
  pyrWireButton("btn-result-undo", () => pyrDispatch({ type: "undo" }));
  pyrWireButton("btn-play-again", () => pyrSet({ core: null, reveal: false, circleReveal: false }));
}

function pyrWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.PyrSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.PyrSound.enabled));
  };
  sound.addEventListener("click", () => { window.PyrSound.toggle(); paint(); });
  paint();
  document.addEventListener("keydown", pyrOnKey);
  window.addEventListener("beforeunload", pyrSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pyrSave(); });
}

/* ============ Splash ============ */

const PYR_SPLASH_MS = 1200;
let pyrSplashTimer = null;

/**
 * The 1.2 s title card the hub shows on a game switch, mirrored here so a
 * standalone page carries it too. Decorative only: `.gsc-splash` is
 * `pointer-events: none`, and the whole card is skipped under reduced motion.
 */
function pyrShowSplash() {
  const node = $("gsc-splash");
  if (!node) return;
  if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.body.classList.contains("gsc-embedded")) return;  // the hub shows its own
  setText("gsc-splash-title", "Pyramid");
  setText("gsc-splash-sub", "Seven words. Thirty seconds. Don’t say the word.");
  node.dataset.gscGame = "pyramid";
  node.classList.remove("hidden");
  if (pyrSplashTimer) clearTimeout(pyrSplashTimer);
  pyrSplashTimer = setTimeout(() => {
    pyrSplashTimer = null;
    node.classList.add("hidden");
  }, PYR_SPLASH_MS);
}

/* ============ Boot ============ */

/** Saved roster first, then any phone the shell added while we were loading. */
function pyrMergeSetup(savedSetup, current) {
  const base = Object.assign({}, pyrApp.setup, savedSetup);
  const players = (savedSetup.players || []).slice();
  current.forEach((p) => { if (!players.some((x) => x.pid === p.pid)) players.push(p); });
  base.players = players;
  base.seats = Array.isArray(savedSetup.seats) && savedSetup.seats.length === 2
    ? savedSetup.seats.map((pair) => (Array.isArray(pair) ? pair.slice(0, 2) : ["", ""]))
    : pyrApp.setup.seats;
  base.settings = Object.assign({}, pyrApp.setup.settings, savedSetup.settings || {});
  return base;
}

/**
 * An explicit ?game=URL always wins over the saved game unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old categories when they follow a shared link.
 */
function pyrChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.game && (!urlWon || saved.sourceUrl === wantUrl);
  const patch = {
    game: (useSaved && saved.game) || loaded.game,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (saved && saved.setup) patch.setup = pyrMergeSetup(saved.setup, pyrApp.setup.players);
  if (saved && Array.isArray(saved.usedIds)) patch.usedIds = saved.usedIds;
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved && saved.core) patch.core = saved.core;
  if (!useSaved && saved && saved.core && !pyrLoadMessage) {
    pyrLoadMessage = "Loaded the categories from the link, so the game in progress was cleared.";
  }
  const setup = patch.setup || pyrApp.setup;
  patch.setup = Object.assign({}, setup, { settings: pyrSettingsFromGame(patch.game, setup) });
  return patch;
}

async function pyrBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  pyrShowSplash();
  if (mode.endsWith("-player")) return;   // pyr-phone.js owns the phone page

  // Read the saved game BEFORE the first await: pyr-room.js seeds the roster as
  // soon as the shell sends `init`, and that write would clobber the restore.
  const saved = pyrLoadSaved();

  pyrWireSetup();
  pyrWireBoard();
  pyrWirePlay();
  pyrWireCircle();
  pyrWireResult();
  pyrWireChrome();
  pyrWireClocks();

  const loaded = await pyrLoadContent();
  pyrSet(pyrChooseContent(saved, loaded));
  if (pyrLoadMessage) pyrError(pyrLoadMessage);
}

/** The public surface pyr-editor.js / pyr-room.js / the harness build on. */
window.PyrApp = {
  state: () => pyrApp,
  core: () => pyrApp.core,
  dispatch: pyrDispatch,
  set: pyrSet,
  render: pyrRender,
  useGame: pyrUseGame,
  addPlayer: pyrAddPlayer,
  removePlayer: pyrRemovePlayer,
  setSeat: pyrSetSeat,
  error: pyrError,
  subscribe: (fn) => { if (typeof fn === "function") pyrListeners.push(fn); },
  pick: pyrPick,
  start: pyrStart,
  study: pyrStudy,
  toggleReveal: pyrToggleReveal,
  phoneMark: pyrPhoneMark,
  bindRoom: pyrBindRoom,
  showSplash: pyrShowSplash,
  setPhoneCount: (n) => { if (n !== pyrApp.phoneCount) pyrSet({ phoneCount: Number(n) || 0 }); },
  STORAGE_KEY: PYR_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { pyrBoot().catch((err) => pyrError(err.message)); });
} else {
  pyrBoot().catch((err) => pyrError(err.message));
}

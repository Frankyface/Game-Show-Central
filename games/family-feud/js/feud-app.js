/* ============================================================
   Family Feud — host glue (spec 03 §3)
   Owns the single serialisable state object, its localStorage
   persistence, content loading and every host screen except Fast
   Money (js/feud-fm.js) and the editor (js/feud-editor.js).
   All game rules live in the pure FeudCore reducer; this file only
   dispatches events and paints the result. Every user-supplied
   string is inserted with textContent (never a markup sink), so a
   hand-written questions.json can't inject anything.
   ============================================================ */

"use strict";

const STORAGE_KEY = "gsc-family-feud-state-v1";
const MAX_PLAYERS = 16;
/* App-only slices that must survive a reducer `undo`: the roster and the
   content provenance are host bookkeeping, not game rules. */
const APP_FIELDS = ["roster", "source", "sourceKind", "sourceUrl", "roomCode"];

/** @type {object|null} the one state object (FeudCore state + APP_FIELDS) */
let state = null;
let manualIdCounter = 0;
let strikeFlashTimer = 0;

/* ============ DOM helpers ============ */

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick, options) {
  const node = el("button", className, text);
  node.type = "button";
  if (options && options.label) node.setAttribute("aria-label", options.label);
  if (options && options.disabled) node.disabled = true;
  node.addEventListener("click", onClick);
  return node;
}

function show(node, visible) {
  if (node) node.classList.toggle("hidden", !visible);
}

/* ============ State + persistence ============ */

function setState(patch) {
  state = { ...state, ...patch };
  saveState();
  render();
}

/**
 * Run one reducer event. App-only slices are re-applied on top of the result
 * so an `undo` rewinds the GAME without rewinding the roster.
 * @returns {boolean} true when the event changed anything.
 */
function dispatch(event) {
  if (!state) return false;
  const before = state;
  const next = window.FeudCore.reduce(state, event);
  if (next === before) return false;
  const overlay = {};
  APP_FIELDS.forEach((key) => { overlay[key] = before[key]; });
  state = { ...next, ...overlay };
  playCue(before, state, event);
  saveState();
  render();
  return true;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setSaveWarning("");
  } catch (err) {
    console.warn("Could not save the game:", err);
    setSaveWarning(
      "⚠ This browser can’t save the game — its storage is full. The game still " +
      "works, but do NOT refresh this tab: it would revert to an earlier state."
    );
  }
}

function setSaveWarning(msg) {
  const node = $("save-warning");
  if (!node) return;
  node.textContent = msg || "";
  show(node, !!msg);
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !saved.phase || !saved.game) return null;
    window.FeudCore.validateGame(saved.game); // throws on a corrupt/edited save
    const fresh = window.FeudCore.createState(saved.game, {});
    const restored = { ...fresh, ...saved, game: fresh.game };
    if (!Array.isArray(restored.roster)) restored.roster = [];
    if (!Array.isArray(restored.history)) restored.history = [];
    // Saves written before rooms were stamped count as "unknown room", so the
    // first room to open scrubs their phone seats (see bindRoom).
    if (typeof restored.roomCode !== "string") restored.roomCode = null;
    return restored;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("Could not clear the saved game:", err);
  }
}

/* ============ Content loading ============ */

async function fetchGameData() {
  const params = new URLSearchParams(window.location.search);
  const customUrl = params.get("game");
  const url = customUrl || "questions.json";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    window.FeudCore.validateGame(data);
    return {
      game: data,
      source: customUrl ? `custom URL (${customUrl})` : "questions.json",
      sourceKind: "fetch",
      sourceUrl: customUrl,
    };
  } catch (err) {
    console.warn(`Could not load ${url}; using the built-in sample survey.`, err);
    return {
      game: typeof DEFAULT_FEUD_GAME !== "undefined" ? DEFAULT_FEUD_GAME : null,
      source: `built-in sample (${url} could not be loaded)`,
      sourceKind: "default",
      sourceUrl: null,
    };
  }
}

/** Build a brand-new setup state around `game`, keeping team names + roster. */
function stateForGame(game, meta, keep) {
  const base = window.FeudCore.createState(game, {
    teamNames: keep ? keep.teamNames : undefined,
  });
  return {
    ...base,
    roster: keep && keep.roster ? keep.roster : [],
    roomCode: keep && typeof keep.roomCode === "string" ? keep.roomCode : null,
    source: meta.source,
    sourceKind: meta.sourceKind,
    sourceUrl: meta.sourceUrl,
  };
}

function keepFromState() {
  if (!state) return null;
  return {
    teamNames: state.teams.map((t) => t.name),
    roster: state.roster,
    roomCode: state.roomCode,
  };
}

function handleCustomFile(file) {
  const reader = new FileReader();
  reader.onerror = () => setSetupError("Could not read that file.");
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      window.FeudCore.validateGame(data);
      setSetupError("");
      state = stateForGame(data, {
        source: `uploaded file (${file.name})`, sourceKind: "upload", sourceUrl: null,
      }, keepFromState());
      saveState();
      render();
    } catch (err) {
      setSetupError(`Invalid questions file: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

/* ============ Sound + strike cues ============ */

function playCue(before, after, event) {
  const sound = window.FeudSound;
  if (event.type === "strike") {
    flashStrike(after.strikes);
    sound?.play("strike");
    return;
  }
  if (event.type === "reveal" || (event.type === "steal" && after.steal.result === "success")) {
    sound?.play("ding");
  } else if (event.type === "notOnBoard" || (event.type === "steal" && after.steal.result === "fail")) {
    sound?.play("strike");
  } else if (event.type === "buzz") {
    sound?.play("buzzIn");
  }
  if (after.phase === "roundover" && before.phase !== "roundover") sound?.play("roundEnd");
}

/** Flash the big red X overlay. Cue only — nothing about the game changes. */
function flashStrike(count) {
  const overlay = $("strike-overlay");
  const marks = $("strike-overlay-marks");
  if (!overlay || !marks) return;
  marks.textContent = "✕".repeat(Math.max(1, count));
  show(overlay, true);
  window.clearTimeout(strikeFlashTimer);
  strikeFlashTimer = window.setTimeout(() => show(overlay, false), 950);
}

/* ============ Render dispatch ============ */

function render() {
  if (!state) return;
  const phase = state.phase;
  const onBoard = ["faceoff", "playpass", "play", "steal", "roundover"].indexOf(phase) !== -1;
  show($("screen-setup"), phase === "setup");
  show($("screen-board"), onBoard);
  show($("screen-fm"), phase === "fastmoney");
  show($("screen-final"), phase === "final");
  show($("btn-new-game"), phase !== "setup");
  show($("btn-undo"), phase !== "setup" && state.history.length > 0);
  $("game-title").textContent = state.game?.title || "Family Feud";

  if (phase === "setup") renderSetup();
  if (onBoard) renderBoard();
  if (phase === "fastmoney") window.FeudFM?.render();
  if (phase === "final") renderFinal();
  window.FeudRoom?.onRender?.();
}

/* ============ Setup screen ============ */

function renderSetup() {
  $("setup-title").textContent = state.game?.title || "Family Feud";
  $("source-note").textContent = `Questions: ${state.source}`;
  reflectInput("team-a-name", state.teams[0].name);
  reflectInput("team-b-name", state.teams[1].name);
  const rounds = $("rounds-to-play");
  rounds.max = String(state.game.rounds.length);
  reflectInput("rounds-to-play", String(state.roundsToPlay));

  const fmPossible = state.game.settings.fastMoney.enabled &&
    state.game.fastMoney.length >= window.FeudCore.FM_QUESTIONS;
  const fmBox = $("fast-money-on");
  fmBox.checked = state.fastMoneyEnabled;
  fmBox.disabled = !fmPossible;
  $("fast-money-note").textContent = fmPossible
    ? `${state.game.fastMoney.length} Fast Money questions loaded; the game plays the first 5. Target ${state.game.settings.fastMoney.target}.`
    : "This question file has no Fast Money round (it needs at least 5 Fast Money questions).";

  renderRoster();
}

function reflectInput(id, value) {
  const input = $(id);
  if (input && document.activeElement !== input) input.value = value;
}

function renderRoster() {
  const list = $("roster-list");
  list.replaceChildren();
  if (!state.roster.length) {
    list.appendChild(el("li", "roster-empty",
      "No players yet. Add names for on-screen team lists, or open a room so phones can join — either way you can host the whole game yourself."));
    return;
  }
  state.roster.forEach((player) => list.appendChild(rosterRow(player)));
}

function rosterRow(player) {
  const row = el("li", "roster-row");
  row.appendChild(el("span", "roster-name", player.name));
  row.appendChild(el("span", "roster-tag",
    player.manual ? "no phone" : (player.connected === false ? "offline" : "phone")));

  const toggle = el("div", "roster-toggle");
  const team = window.FeudCore.teamOfPid(state, player.pid);
  [["A", 0, "pick-a"], ["B", 1, "pick-b"], ["–", null, "pick-none"]].forEach(([label, value, cls]) => {
    const pick = button(cls, label, () => dispatch({ type: "setTeam", pid: player.pid, team: value }),
      { label: `Put ${player.name} on ${value === null ? "no team" : `team ${label}`}` });
    pick.setAttribute("aria-pressed", String(team === value));
    toggle.appendChild(pick);
  });
  row.appendChild(toggle);

  if (player.manual) {
    row.appendChild(button("remove-btn", "✕", () => removeManualPlayer(player.pid),
      { label: `Remove ${player.name}` }));
  }
  return row;
}

function addManualPlayer(name) {
  const clean = window.FeudCore.sanitizeText(name, 24);
  if (!clean) return;
  if (state.roster.length >= MAX_PLAYERS) {
    setSetupError(`That's the maximum of ${MAX_PLAYERS} players.`);
    return;
  }
  setSetupError("");
  manualIdCounter += 1;
  const pid = `m${Date.now().toString(36)}${manualIdCounter}`;
  setState({ roster: state.roster.concat([{ pid, name: clean, manual: true, connected: true }]) });
}

function removeManualPlayer(pid) {
  const roster = state.roster.filter((p) => p.pid !== pid);
  const teams = state.teams.map((t) => ({ ...t, players: t.players.filter((p) => p !== pid) }));
  setState({ roster, teams });
}

/** Merge the shell/room roster into ours, keeping manual players. */
function syncRoster(players) {
  if (!state || !Array.isArray(players)) return;
  const manual = state.roster.filter((p) => p.manual);
  const phones = players.map((p) => ({
    pid: p.pid, name: p.name, manual: !!p.manual, connected: p.connected !== false,
  }));
  const seen = new Set(phones.map((p) => p.pid));
  setState({ roster: phones.concat(manual.filter((p) => !seen.has(p.pid))) });
}

/* ============ Room identity ============ */

/** Strip every phone pid out of one state slice (or one history snapshot). */
function withoutPhoneSeats(slice, manual) {
  const seat = (pid) => (pid && manual.has(pid) ? pid : null);
  return {
    teams: slice.teams.map((t) => ({ ...t, players: t.players.filter((pid) => manual.has(pid)) })),
    faceoff: { ...slice.faceoff, podium: slice.faceoff.podium.map(seat) },
    fastMoney: { ...slice.fastMoney, players: slice.fastMoney.players.map(seat) },
  };
}

/**
 * Bind the saved game to the room it is being played in. Shell pids (p1, p2, …)
 * restart at p1 in every new room, so a resumed game's pid-keyed team seats,
 * podium and Fast Money seats would otherwise be inherited by whoever is issued
 * that pid next — and a Fast Money seat carries the previous player's typed
 * answers. Whenever the room code differs from the one this game was saved
 * with, every phone pid is dropped from the line-ups, in the history stack too
 * so an undo cannot resurrect them. Players the host typed in by hand keep
 * their own ids and stay. Same code (a plain refresh) changes nothing.
 */
function bindRoom(code) {
  if (!state || typeof code !== "string" || !code) return;
  if (state.roomCode === code) return;
  const manual = new Set(state.roster.filter((p) => p.manual).map((p) => p.pid));
  const scrubbed = withoutPhoneSeats(state, manual);
  const history = state.history.map((entry) => ({ ...entry, ...withoutPhoneSeats(entry, manual) }));
  setState({ ...scrubbed, history, roomCode: code });
}

function setSetupError(msg) {
  $("setup-error").textContent = msg || "";
}

function startGame() {
  if (!state.game) {
    setSetupError("Questions are still loading — try again in a second.");
    return;
  }
  setSetupError("");
  dispatch({ type: "start" });
}

/* ============ Board screen ============ */

function renderBoard() {
  const core = window.FeudCore;
  $("phase-banner").textContent = bannerText();
  $("round-question").textContent =
    `Round ${state.roundIndex + 1} of ${state.roundsToPlay} — ${core.currentRound(state).question}`;
  renderTiles();
  $("bank-value").textContent = String(state.bank);
  const mult = core.multiplierFor(state);
  const badge = $("bank-mult");
  badge.textContent = `×${mult}`;
  show(badge, mult !== 1);
  renderStrikes();
  renderTeamPanel(0);
  renderTeamPanel(1);
  $("board-hint").textContent = hintText();
  renderControls();
}

function bannerText() {
  const teams = state.teams;
  switch (state.phase) {
    case "faceoff": return "Face-off";
    case "playpass": return `${teams[state.control].name} — play or pass?`;
    case "play": return `${teams[state.control].name} is playing`;
    case "steal": return `Steal — ${teams[state.steal.team].name}`;
    case "roundover": return state.awarded
      ? `Round over — ${teams[state.awarded.team].name} takes ${state.awarded.points}`
      : "Round over";
    default: return "";
  }
}

function hintText() {
  if (state.phase === "faceoff") {
    if (state.faceoff.buzzed !== null) {
      return `${state.teams[state.faceoff.buzzed].name} answers — click the matching tile, or “Not on the board”.`;
    }
    if (state.faceoff.attempts.length >= 2) return "Nobody hit the board. Face off again, or hand control to a team.";
    return "Read the question, then arm the buzzers (or click who buzzed first).";
  }
  if (state.phase === "play") return "Click a tile to reveal it, or press Strike for a miss.";
  if (state.phase === "steal") return "Click the tile they said to steal the bank, or press No steal.";
  if (state.phase === "roundover") return state.message;
  return "";
}

function renderTiles() {
  const board = $("board");
  const tiles = window.FeudCore.boardView(state);
  board.classList.toggle("two-col", tiles.length > 5);
  board.replaceChildren();
  tiles.forEach((tile) => board.appendChild(buildTile(tile)));
}

function buildTile(tile) {
  const node = el("button", `tile${tile.revealed ? " revealed" : ""}`);
  node.type = "button";
  node.setAttribute("role", "listitem");
  node.disabled = !canRevealTile(tile);
  node.setAttribute("aria-label", tile.revealed
    ? `Answer ${tile.number}: ${tile.text}, ${tile.count}`
    : `Reveal answer ${tile.number}`);
  const inner = el("div", "tile-inner");
  const back = el("div", "tile-back");
  back.appendChild(el("span", "tile-number", String(tile.number)));
  const face = el("div", "tile-face");
  face.appendChild(el("span", "tile-text", tile.text));
  face.appendChild(el("span", "tile-count", String(tile.count)));
  inner.appendChild(back);
  inner.appendChild(face);
  node.appendChild(inner);
  node.addEventListener("click", () => onTileClick(tile.index));
  return node;
}

function canRevealTile(tile) {
  if (tile.revealed) return false;
  if (state.phase === "play") return true;
  if (state.phase === "steal") return true;
  return state.phase === "faceoff" && state.faceoff.buzzed !== null;
}

function onTileClick(index) {
  if (state.phase === "steal") dispatch({ type: "steal", index });
  else dispatch({ type: "reveal", index });
}

function renderStrikes() {
  const row = $("strike-row");
  row.replaceChildren();
  const limit = state.game.settings.strikes;
  for (let i = 0; i < limit; i += 1) {
    const slot = el("div", `strike-slot${i < state.strikes ? " on" : ""}`, "✕");
    slot.setAttribute("aria-label", i < state.strikes ? `Strike ${i + 1}` : `Strike ${i + 1} unused`);
    row.appendChild(slot);
  }
}

function renderTeamPanel(team) {
  const panel = $(team === 0 ? "team-panel-a" : "team-panel-b");
  const info = state.teams[team];
  panel.className = `team-panel ${team === 0 ? "team-a" : "team-b"}` +
    (state.control === team ? " control" : "");
  panel.replaceChildren();
  panel.appendChild(el("h3", "team-name", info.name));

  const score = button("team-score", String(info.score), () => editScore(team),
    { label: `${info.name} score ${info.score}. Click to edit.` });
  panel.appendChild(score);

  let badge = "";
  if (state.phase === "steal" && state.steal.team === team) badge = "Stealing";
  else if (state.control === team) badge = "Control";
  else if (state.phase === "faceoff" && state.faceoff.buzzed === team) badge = "Buzzed in";
  panel.appendChild(el("span", "team-badge", badge));

  panel.appendChild(teamRoster(team));
}

function teamRoster(team) {
  const list = el("ul", "team-roster");
  const podium = state.phase === "faceoff" ? window.FeudCore.podiumFor(state) : [null, null];
  state.teams[team].players.forEach((pid) => {
    const player = state.roster.find((p) => p.pid === pid);
    const item = el("li", podium[team] === pid ? "podium" : null,
      (podium[team] === pid ? "🎙 " : "") + (player ? player.name : pid));
    list.appendChild(item);
  });
  return list;
}

function editScore(team) {
  const current = state.teams[team].score;
  const raw = window.prompt(`Set the score for ${state.teams[team].name}`, String(current));
  if (raw === null) return;
  // Whole numbers only. parseInt would read "12abc" as 12 and quietly set it.
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    $("board-hint").textContent = "That score wasn’t a whole number — nothing changed.";
    return;
  }
  dispatch({ type: "setScore", team, score: Number.parseInt(trimmed, 10) });
}

/* ============ Host controls ============ */

function group(label) {
  const box = el("div", "control-group");
  if (label) box.appendChild(el("span", "control-label", label));
  return box;
}

function renderControls() {
  const host = $("controls");
  host.replaceChildren();
  const builders = {
    faceoff: faceoffControls,
    playpass: playPassControls,
    play: playControls,
    steal: stealControls,
    roundover: roundOverControls,
  };
  (builders[state.phase] || (() => []))().forEach((node) => host.appendChild(node));
}

function faceoffControls() {
  const out = [];
  if (state.faceoff.buzzed === null && state.faceoff.attempts.length === 0) {
    const buzz = group("Face-off");
    buzz.appendChild(button("btn btn-gold", state.faceoff.armed ? "Disarm buzzers" : "Arm buzzers",
      () => dispatch({ type: "arm", on: !state.faceoff.armed })));
    state.teams.forEach((team, i) => {
      buzz.appendChild(button("btn btn-ghost", `${team.name} buzzed`,
        () => dispatch({ type: "buzz", team: i, host: true })));
    });
    out.push(buzz);
  } else if (state.faceoff.buzzed !== null) {
    const answer = group(`${state.teams[state.faceoff.buzzed].name} answers`);
    answer.appendChild(button("btn btn-danger", "Not on the board",
      () => dispatch({ type: "notOnBoard" })));
    out.push(answer);
  }
  const override = group("Host override");
  state.teams.forEach((team, i) => {
    override.appendChild(button("btn btn-ghost btn-small", `Give control to ${team.name}`,
      () => dispatch({ type: "giveControl", team: i })));
  });
  override.appendChild(button("btn btn-ghost btn-small", "Face-off again",
    () => dispatch({ type: "faceoffAgain" })));
  out.push(override);
  return out;
}

function playPassControls() {
  const box = group(`${state.teams[state.control].name} decides`);
  box.appendChild(button("btn btn-gold btn-big", "Play the board", () => dispatch({ type: "play" })));
  box.appendChild(button("btn btn-ghost btn-big", "Pass to the other team", () => dispatch({ type: "pass" })));
  return [box];
}

function playControls() {
  const box = group("Board in play");
  box.appendChild(button("btn btn-danger btn-big", "Strike ✕", () => dispatch({ type: "strike" })));
  return [box];
}

function stealControls() {
  const box = group(`${state.teams[state.steal.team].name} steals`);
  box.appendChild(button("btn btn-danger btn-big", "No steal — they missed",
    () => dispatch({ type: "steal", index: null })));
  return [box];
}

function roundOverControls() {
  const out = [];
  if (!state.revealed.every(Boolean)) {
    const rest = group("Board");
    rest.appendChild(button("btn btn-ghost", "Let’s see the rest", () => dispatch({ type: "revealRest" })));
    out.push(rest);
  }
  const next = group("Next");
  const more = state.roundIndex + 1 < state.roundsToPlay;
  if (more) {
    next.appendChild(button("btn btn-gold btn-big", "Next round", () => dispatch({ type: "nextRound" })));
  }
  if (state.fastMoneyEnabled) {
    next.appendChild(button(`btn ${more ? "btn-ghost" : "btn-gold"} btn-big`, "Fast Money",
      () => window.FeudFM?.begin()));
  }
  next.appendChild(button("btn btn-ghost", "Finish the game", () => dispatch({ type: "finish" })));
  out.push(next);
  const picker = window.FeudFM?.teamPicker?.();
  if (picker) out.push(picker);
  return out;
}

/* ============ Final standings ============ */

function renderFinal() {
  const host = $("final-standings");
  host.replaceChildren();
  const best = Math.max(state.teams[0].score, state.teams[1].score);
  const tied = state.teams[0].score === state.teams[1].score;
  state.teams.forEach((team, i) => {
    const card = el("div", `final-team ${i === 0 ? "team-a" : "team-b"}` +
      (!tied && team.score === best ? " winner" : ""));
    card.appendChild(el("h3", "team-name", team.name));
    card.appendChild(el("p", "team-score", String(team.score)));
    card.appendChild(el("span", "team-badge", !tied && team.score === best ? "Winner" : ""));
    host.appendChild(card);
  });
  const fm = state.fastMoney;
  $("final-note").textContent = fm.started
    ? `Fast Money: ${window.FeudCore.fmTotal(state)} of ${state.game.settings.fastMoney.target}` +
      (fm.winner === null ? "" : fm.winner ? " — winners!" : " — so close.")
    : "";
}

/** Fresh setup state around the loaded content, keeping team names + line-ups. */
function resetToSetup() {
  const lineups = state.teams.map((t) => t.players.slice());
  const fresh = stateForGame(state.game, {
    source: state.source, sourceKind: state.sourceKind, sourceUrl: state.sourceUrl,
  }, keepFromState());
  fresh.teams = fresh.teams.map((team, i) => ({ ...team, players: lineups[i] }));
  fresh.roundsToPlay = state.roundsToPlay;
  fresh.fastMoneyEnabled = state.fastMoneyEnabled;
  state = fresh;
}

/** Same teams, scores back to zero, straight into round 1. */
function playAgain() {
  resetToSetup();
  saveState();
  render();
  dispatch({ type: "start" });
}

function backToSetup() {
  resetToSetup();
  saveState();
  render();
}

function newGame() {
  if (!window.confirm("Start a new game? Scores and the board will be cleared.")) return;
  clearSavedState();
  backToSetup();
}

/* ============ Wiring ============ */

function wireSoundToggle() {
  const btn = $("btn-sound");
  const paint = () => {
    const on = window.FeudSound ? window.FeudSound.isOn() : false;
    btn.textContent = on ? "🔊 Sound" : "🔇 Muted";
    btn.setAttribute("aria-pressed", String(on));
  };
  btn.addEventListener("click", () => {
    if (window.FeudSound) window.FeudSound.setOn(!window.FeudSound.isOn());
    paint();
  });
  paint();
}

function wireHostEvents() {
  $("btn-start").addEventListener("click", startGame);
  $("btn-undo").addEventListener("click", () => dispatch({ type: "undo" }));
  $("btn-new-game").addEventListener("click", newGame);
  $("btn-play-again").addEventListener("click", playAgain);
  $("btn-back-setup").addEventListener("click", backToSetup);
  $("btn-load-json").addEventListener("click", () => $("json-file-input").click());
  $("json-file-input").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) handleCustomFile(file);
    event.target.value = "";
  });
  $("add-player-form").addEventListener("submit", (event) => {
    event.preventDefault();
    addManualPlayer($("player-name-input").value);
    $("player-name-input").value = "";
  });
  [["team-a-name", 0], ["team-b-name", 1]].forEach(([id, team]) => {
    $(id).addEventListener("input", () => dispatch({ type: "setTeamName", team, name: $(id).value }));
  });
  $("rounds-to-play").addEventListener("change", () => {
    const value = Number.parseInt($("rounds-to-play").value, 10);
    if (!dispatch({ type: "setRoundsToPlay", count: value })) render();
  });
  $("fast-money-on").addEventListener("change", () => {
    dispatch({ type: "setFastMoney", on: $("fast-money-on").checked });
  });
  wireSoundToggle();
  wireSpaceToArm();
}

/** Space arms/disarms the face-off buzzers, the Jeopardy host habit. */
function wireSpaceToArm() {
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    if (!state || state.phase !== "faceoff") return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
    event.preventDefault();
    dispatch({ type: "arm", on: !state.faceoff.armed });
  });
}

/* ============ Boot ============ */

/** Load content (saved game first) and paint the first screen. */
async function bootHost() {
  wireHostEvents();
  const saved = loadSavedState();
  // D1: an explicit ?game=URL always wins over the saved game unless the save
  // already came from that same URL (Jeopardy behaviour, gate V8).
  const wantUrl = new URLSearchParams(window.location.search).get("game");
  if (saved && (!wantUrl || saved.sourceUrl === wantUrl)) {
    state = saved;
    render();
    return;
  }
  const meta = await fetchGameData();
  if (!meta.game) {
    setSetupError("No questions could be loaded. Open the editor and build a game, or upload a JSON file.");
    return;
  }
  state = stateForGame(meta.game, meta, null);
  saveState();
  render();
}

window.FeudApp = {
  bootHost,
  dispatch,
  setState,
  render,
  syncRoster,
  bindRoom,
  getState: () => state,
  stateForGame,
  clearSavedState,
  setSetupError,
  helpers: { $, el, button, show, group },
};

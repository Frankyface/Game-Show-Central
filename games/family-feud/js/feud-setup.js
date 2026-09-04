/* ============================================================
   Family Feud — setup screen, question-set library and the
   game-lobby park/resume flow (spec 19 §1 and §2)
   Split out of feud-app.js to keep both files under the 800-line
   house limit. These are plain classic scripts sharing one global
   scope, so `state`, `setState`, `render`, `$`, `el`, `button`
   and `show` are the same bindings feud-app.js declares; this file
   only ever runs after it. Nothing here is called before boot.
   ============================================================ */

"use strict";

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
  renderResumeCard();
}

function renderResumeCard() {
  const card = $("resume-card");
  if (!card) return;
  const parked = !!state.resumable;
  show(card, parked);
  // Start means the same thing either way, but next to a Resume button it has
  // to say so — and it must go back to plain wording once nothing is parked.
  $("btn-start").textContent = parked ? "Start a fresh game" : "Start the Feud";
  if (parked) $("resume-note").textContent = resumeSummary(state.resumable);
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

/* ============ Question-set library (19 §2) ============ */

/** Make `data` the current content, exactly as an upload would. */
function useContent(data, sourceLabel) {
  window.FeudCore.validateGame(data); // the caller catches; the picker shows it
  setSetupError("");
  state = stateForGame(data, {
    source: sourceLabel, sourceKind: "library", sourceUrl: null,
  }, keepFromState());
  saveState();
  render();
}

/**
 * Mount the shared picker under the Questions section. It is entirely
 * optional: with no shared/library.js, no sets/ folder or a page opened from
 * disk, the picker says so in plain English and the rest of setup is unchanged.
 */
function mountLibrary() {
  const host = $("questions-library");
  if (!host || !window.GSCLibrary) return;
  window.GSCLibrary.mountPicker(host, {
    gameDir: "",
    label: "Question sets in this repo",
    validate: (json) => window.FeudCore.validateGame(json),
    onPick: (json, meta) => {
      try {
        useContent(json, `set: ${meta.name}`);
      } catch (err) {
        setSetupError(`That set didn't load: ${err.message}`);
      }
    },
  });
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
  // Starting fresh retires whatever was parked — it is no longer reachable.
  if (state.resumable) setState({ resumable: null });
  dispatch({ type: "start" });
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
  fresh.resumable = null; // callers that want to park a game set it themselves
  state = fresh;
}

/* ============ Game lobby (19 §1) ============ */

/**
 * The parked game: everything except the content (which cannot change while a
 * snapshot exists — loading a set retires it) and any nested snapshot.
 */
function resumableSnapshot() {
  const snap = { ...state };
  delete snap.resumable;
  delete snap.game;
  return snap;
}

/** A one-line description of what Resume would bring back. */
function resumeSummary(snap) {
  if (!snap) return "";
  const scores = snap.teams.map((t) => `${t.name} ${t.score}`).join(" · ");
  if (snap.phase === "fastmoney") return `Fast Money · ${scores}`;
  if (snap.phase === "final") return `Final standings · ${scores}`;
  return `Round ${snap.roundIndex + 1} of ${snap.roundsToPlay} · ${scores}`;
}

function openGameLobby() {
  if (!state || state.phase === "setup") return;
  $("game-lobby-sub").textContent =
    `${resumeSummary(state)}. Keep it and you can pick it up from the setup screen; ` +
    "start over and the teams, players and questions stay as they are.";
  show($("game-lobby-modal"), true);
  $("btn-lobby-keep").focus();
}

function closeGameLobby() {
  show($("game-lobby-modal"), false);
  const back = $("btn-game-lobby");
  if (back && !back.classList.contains("hidden")) back.focus();
}

/** Keep this game: park it, then show setup. */
function gameLobbyKeep() {
  const parked = resumableSnapshot();
  resetToSetup();
  state.resumable = parked;
  saveState();
  render();
  closeGameLobby();
}

/** Start over: clear the game; roster, content and settings stay. */
function gameLobbyRestart() {
  resetToSetup();
  state.resumable = null;
  saveState();
  render();
  closeGameLobby();
}

/** Put the parked game back exactly as it was. */
function resumeGame() {
  const parked = state.resumable;
  if (!parked) return;
  // The roster and the room are live host bookkeeping, not part of the parked
  // game, so they carry over; bindRoom then scrubs if the room has changed.
  const roster = state.roster;
  const roomCode = state.roomCode;
  state = { ...parked, game: state.game, roster, resumable: null };
  saveState();
  render();
  bindRoom(roomCode);
}

function discardResume() {
  if (!state.resumable) return;
  if (!window.confirm("Discard the game in progress? The teams and questions stay.")) return;
  setState({ resumable: null });
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

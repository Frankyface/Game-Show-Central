/* ============================================================
   The Chase — wiring and boot
   The other half of the host glue: every addEventListener, the
   hotkey map, the clock loop and the boot sequence that decides
   which content wins (an explicit ?game= URL, the saved game, or
   the shipped questions). Split out of chase-app.js so both
   files stay well under the 800-line house limit; the two share
   one script scope, so `chaseApp`, `chaseSet` and friends are
   the same bindings in both.
   ============================================================ */

"use strict";

/* ============ Wiring ============ */

/** Secondary controls hand focus back to the page so the hotkeys keep working. */
function chaseWireButton(id, handler) {
  const node = $(id);
  if (node) node.addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function chaseWireSetup() {
  $("chase-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (chaseAddPlayer($("chase-player-name").value)) $("chase-player-name").value = "";
  });
  $("btn-load-json").addEventListener("click", () => $("chase-file").click());
  $("chase-file").addEventListener("change", chaseOnFile);
  $("btn-start").addEventListener("click", chaseStart);
  chaseWireButton("btn-resume", chaseResume);
  chaseWireButton("btn-shuffle", () => {
    chaseSet({ setup: Object.assign({}, chaseApp.setup, { shuffle: !chaseApp.setup.shuffle }) });
  });
  ["chase-mode-host", "chase-mode-player"].forEach((id) => {
    $(id).addEventListener("change", (e) => {
      if (e.target.checked) {
        chaseSet({ setup: Object.assign({}, chaseApp.setup, { chaserMode: e.target.value }) });
      }
    });
  });
  $("chase-chaser-pid").addEventListener("change", (e) => {
    chaseSet({ setup: Object.assign({}, chaseApp.setup, { chaserPid: e.target.value }) });
  });
  $("chase-chaser-name").addEventListener("input", (e) => {
    chaseSet({ setup: Object.assign({}, chaseApp.setup, {
      chaserName: e.target.value.slice(0, window.ChaseCore.NAME_MAX),
    }) });
  });
  chaseWireRuleFields();
}

const CHASE_RULE_FIELDS = [
  ["chase-set-steps", "steps", 3, 12],
  ["chase-set-start", "startStep", 2, 10],
  ["chase-set-cbsecs", "cashBuilderSeconds", 15, 300],
  ["chase-set-cbvalue", "cashBuilderValue", 1, 1000000],
  ["chase-set-higher", "higherMultiplier", 2, 100],
  ["chase-set-lower", "lowerDivisor", 2, 10],
  ["chase-set-final", "finalSeconds", 30, 600],
  ["chase-set-headstart", "headStartPerMember", 0, 3],
];

function chaseTouchSettings(fields) {
  chaseSet({ setup: Object.assign({}, chaseApp.setup, {
    settingsTouched: true,
    settings: Object.assign({}, chaseApp.setup.settings, fields),
  }) });
}

function chaseWireRuleFields() {
  CHASE_RULE_FIELDS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) {
        e.target.value = String(chaseApp.setup.settings[key]);
        chaseError(`That has to be a whole number between ${lo} and ${hi}.`);
        return;
      }
      const next = Object.assign({}, chaseApp.setup.settings, { [key]: value });
      if (next.startStep < 2 || next.startStep > next.steps - 2) {
        e.target.value = String(chaseApp.setup.settings[key]);
        chaseError(`On a ${next.steps}-step board the contestant must start between step 2 and `
          + `step ${next.steps - 2}, so both offers have somewhere to go.`);
        return;
      }
      chaseError("");
      chaseTouchSettings({ [key]: value });
    });
  });
}

function chaseWireCash() {
  chaseWireButton("btn-cash-clock", chaseToggleClock);
  chaseWireButton("btn-cash-right", () => chaseMark("correct"));
  chaseWireButton("btn-cash-wrong", () => chaseMark("wrong"));
  chaseWireButton("btn-cash-pass", () => chaseMark("pass"));
  chaseWireButton("btn-cash-undo", () => chaseDispatch({ type: "undo" }));
  chaseWireButton("btn-cash-finish", () => chaseDispatch({ type: "finish" }));
  chaseWireButton("btn-cash-next", () => chaseDispatch({ type: "nextQuestion" }));
}

function chaseWireOffer() {
  ["higher", "middle", "lower"].forEach((choice) => {
    chaseWireButton(`btn-offer-${choice}`, () => chaseDispatch({ type: "offer", choice }));
  });
  chaseWireButton("btn-offer-undo", () => chaseDispatch({ type: "undo" }));
  chaseWireButton("btn-offer-finish", () => chaseDispatch({ type: "finish" }));
}

function chaseWireBoard() {
  chaseWireButton("btn-reveal-contestant", () => chaseDispatch({ type: "revealContestant" }));
  chaseWireButton("btn-reveal-chaser", () => chaseDispatch({ type: "revealChaser" }));
  chaseWireButton("btn-board-next", () => chaseDispatch({ type: "nextQuestion" }));
  chaseWireButton("btn-next-contestant", () => chaseDispatch({ type: "nextContestant" }));
  chaseWireButton("btn-board-undo", () => chaseDispatch({ type: "undo" }));
  chaseWireButton("btn-board-finish", () => chaseDispatch({ type: "finish" }));
}

function chaseWireFinal() {
  chaseWireButton("btn-final-clock", chaseToggleClock);
  chaseWireButton("btn-final-right", () => chaseMark("correct"));
  chaseWireButton("btn-final-wrong", () => chaseMark("wrong"));
  chaseWireButton("btn-final-pass", () => chaseMark("pass"));
  chaseWireButton("btn-final-next", () => chaseDispatch({ type: "nextQuestion" }));
  chaseWireButton("btn-final-undo", () => chaseDispatch({ type: "undo" }));
  chaseWireButton("btn-final-finish", () => chaseDispatch({ type: "finish" }));
  chaseWireButton("btn-pushback-yes", () => chaseDispatch({ type: "pushback", correct: true }));
  chaseWireButton("btn-pushback-no", () => chaseDispatch({ type: "pushback", correct: false }));
}

function chaseWireResult() {
  chaseWireButton("btn-result-next", () => chaseDispatch({ type: "nextQuestion" }));
  chaseWireButton("btn-result-undo", () => chaseDispatch({ type: "undo" }));
  chaseWireButton("btn-new-team", () => chaseSet({ core: null, resumable: null }));
}

function chaseWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.ChaseSound.enabled ? "Sound" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.ChaseSound.enabled));
    // v3 toolbar (docs/21 rule 9): icon + text label; textContent above drops it.
    if (window.GSCIcons) window.GSCIcons.prepend(sound, window.ChaseSound.enabled ? "sound" : "sound-off");
  };
  if (window.GSCIcons) {
    window.GSCIcons.prepend($("btn-editor"), "edit");
    window.GSCIcons.prepend($("btn-game-lobby"), "lobby");
  }
  sound.addEventListener("click", () => { window.ChaseSound.toggle(); paint(); });
  paint();
  chaseWireButton("btn-game-lobby", chaseOpenLobby);
  chaseWireButton("btn-lobby-keep", chaseLobbyKeep);
  chaseWireButton("btn-lobby-over", chaseLobbyStartOver);
  chaseWireButton("btn-lobby-cancel", () => chaseSet({ lobbyOpen: false }));
  document.addEventListener("keydown", chaseOnKey);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chaseApp.lobbyOpen) chaseSet({ lobbyOpen: false });
  });
  window.addEventListener("beforeunload", chaseSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) chaseSave(); });
}

/* ============ Boot ============ */

/**
 * Saved roster first, then any phone the shell added while we were loading.
 * De-duplicated by pid AND by name: a phone that arrived under the same name as
 * a typed row takes that row over, so the hot-seat order never offers two
 * identical names with nothing to tell them apart.
 */
function chaseMergeSetup(savedSetup, current) {
  const base = Object.assign({}, chaseApp.setup, savedSetup);
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
  const swap = swaps.find(([was]) => was === base.chaserPid);
  if (swap) base.chaserPid = swap[1];
  base.settings = Object.assign({}, chaseApp.setup.settings, savedSetup.settings || {});
  return base;
}

/**
 * An explicit ?game=URL always wins over the saved game unless the save already
 * came from that same URL — otherwise a host who has played once silently gets
 * their old questions when they follow a shared link.
 */
function chaseChooseContent(saved, loaded) {
  const wantUrl = new URLSearchParams(location.search).get("game");
  const urlWon = !!wantUrl && loaded.kind === "fetch" && loaded.url === wantUrl;
  const useSaved = !!saved && !!saved.game && (!urlWon || saved.sourceUrl === wantUrl);
  const patch = {
    game: (useSaved && saved.game) || loaded.game,
    source: (useSaved && saved.source) || loaded.source,
    sourceKind: (useSaved && saved.sourceKind) || loaded.kind,
    sourceUrl: useSaved ? saved.sourceUrl : loaded.url,
  };
  if (saved && saved.setup) patch.setup = chaseMergeSetup(saved.setup, chaseApp.setup.players);
  if (saved && typeof saved.roomCode === "string") patch.roomCode = saved.roomCode;
  if (useSaved) {
    if (saved.core) patch.core = saved.core;
    if (saved.resumable) patch.resumable = saved.resumable;
  }
  if (chaseUrlFailure) {
    chaseNote(`${chaseUrlFailure} ${useSaved
      ? "Keeping the questions you already had."
      : "Using the built-in set instead."}`);
  } else if (!useSaved && saved && (saved.core || saved.resumable)) {
    chaseNote("Loaded the questions from the link, so the game in progress was cleared.");
  }
  const setup = patch.setup || chaseApp.setup;
  patch.setup = Object.assign({}, setup, { settings: chaseSettingsFromGame(patch.game, setup) });
  return patch;
}

async function chaseBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  window.ChaseView.showSplash();
  if (mode.endsWith("-player")) return;   // chase-phone.js owns the phone page

  // Read the saved game BEFORE the first await: chase-room.js seeds the roster
  // as soon as the shell sends `init`, and that write would clobber the restore.
  const saved = chaseLoadSaved();

  chaseWireSetup();
  chaseWireCash();
  chaseWireOffer();
  chaseWireBoard();
  chaseWireFinal();
  chaseWireResult();
  chaseWireChrome();
  chaseWireClock();
  chaseMountLibrary();

  const loaded = await chaseLoadContent();
  chaseSet(chaseChooseContent(saved, loaded));
  if (chaseLoadMessage) chaseError(chaseLoadMessage);
  chaseMarkContentReady();
}

/* ============ Go ============ */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    chaseBoot().catch((err) => chaseError(err.message));
  });
} else {
  chaseBoot().catch((err) => chaseError(err.message));
}

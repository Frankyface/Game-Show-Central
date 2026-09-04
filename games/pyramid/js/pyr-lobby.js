/* ============================================================
   Pyramid — the game lobby and the set library
   Two ways in and out of a game, split out of pyr-app.js so both
   files stay well under the 800-line house limit.

   THE GAME LOBBY (docs/19 §1). "⟲ Game lobby" in the host toolbar
   opens a confirm with two answers. "Keep this game" parks the
   running game — clocks stopped — and shows the setup screen with
   a Resume button that puts it back exactly as it was. "Start
   over" drops it and keeps the players, the categories and the
   rules. Neither touches the undo history: the parked snapshot IS
   the state.

   THE SET LIBRARY (docs/19 §2). The shared picker from
   shared/library.js, mounted under the categories section. A set
   goes through this game's own validateGame before it becomes the
   content, and a page opened from disk simply gets the picker's
   own plain-English note.

   Everything here reads and writes the app state through
   pyr-app.js (pyrSet / pyrApp); no rules live in this file.
   ============================================================ */

"use strict";

let pyrLibrary = null;   // the mounted picker: a DOM handle, never state

/* ============ The game lobby (docs/19 §1) ============ */

/** Plain English for what is running or parked; the confirm and Resume use it. */
function pyrGameLabel(state) {
  if (!state) return "";
  if (state.phase === "play" && state.round) {
    const count = window.PyrCore.wordCount(state);
    const what = state.round.tiebreak ? "the tiebreak" : state.round.title;
    return what + ", " + count.done + " of " + count.total + " taken";
  }
  if (state.phase === "circle") return "the Winner\u2019s Circle";
  if (state.phase === "board") {
    return "the board, " + state.board.filter((s) => s.team === null).length + " categories left";
  }
  if (state.phase === "mainResult") return "the end of the main game";
  return "the standings";
}

function pyrOpenLobby() {
  const state = pyrApp.core || pyrApp.resumable;
  setText("pyr-lobby-body", state
    ? "You are on " + pyrGameLabel(state) + ". Keep this game and Resume picks it up exactly there, with the "
      + "clock paused. Start over clears it \u2014 your players, categories and rules stay as they are."
    : "There is no game in progress. Your players, categories and rules stay as they are either way.");
  show($("pyr-lobby-modal"), true);
  const first = $("btn-lobby-keep");
  if (first) first.focus();
}

function pyrCloseLobby() {
  show($("pyr-lobby-modal"), false);
  const back = $("btn-game-lobby");
  if (back) back.focus();
}

/**
 * "Keep this game" parks the running game with both clocks stopped and shows
 * setup; "Start over" drops it. Neither touches the undo history — the parked
 * snapshot IS the state, so Resume is exact.
 * @param {boolean} keep false = Start over
 */
function pyrToLobby(keep) {
  const parked = keep ? pyrPauseRestored(pyrApp.core || pyrApp.resumable) : null;
  pyrCloseLobby();
  pyrSet({ core: null, resumable: parked, reveal: false, circleReveal: false, studyUntil: null });
  pyrError("");
}

function pyrResume() {
  const parked = pyrApp.resumable;
  if (!parked) return;
  pyrSet({ core: parked, resumable: null, reveal: false, circleReveal: false, studyUntil: null });
  pyrError("");
}

/* ============ The set library (docs/19 §2) ============ */

/**
 * Mount the shared picker under the categories section. Never throws: a page
 * opened from disk, or a build with no sets/ folder, gets the picker's own
 * plain-English note and nothing else on the setup screen changes.
 */
function pyrMountLibrary() {
  const box = $("pyr-library");
  if (!box || !window.GSCLibrary || typeof window.GSCLibrary.mountPicker !== "function") return null;
  return window.GSCLibrary.mountPicker(box, {
    gameDir: "",
    label: "Saved category sets",
    validate: (json) => window.PyrCore.validateGame(json),
    onPick: (json, meta) => {
      try {
        pyrUseGame(json, "set: " + meta.name, "library");
      } catch (err) {
        pyrError("That set could not be used: " + err.message);
      }
    },
  });
}

function pyrWireLobby() {
  pyrWireButton("btn-game-lobby", pyrOpenLobby);
  pyrWireButton("btn-lobby-keep", () => pyrToLobby(true));
  pyrWireButton("btn-lobby-over", () => pyrToLobby(false));
  pyrWireButton("btn-lobby-cancel", pyrCloseLobby);
  pyrWireButton("btn-resume", pyrResume);
  // Escape closes the confirm: it is a question, not a decision.
  $("pyr-lobby-modal").addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); pyrCloseLobby(); }
  });
}

function pyrLobbyBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  if (mode.endsWith("-player")) return;      // pyr-phone.js owns the phone page
  pyrWireLobby();
  pyrLibrary = pyrMountLibrary();
  // The calls the harness and pyr-view.js reach for live on PyrApp, the
  // way every other part of this game does. They are attached here rather than
  // declared in pyr-app.js's literal because this script is evaluated second.
  Object.assign(window.PyrApp, {
    openLobby: pyrOpenLobby,
    closeLobby: pyrCloseLobby,
    toLobby: pyrToLobby,
    resume: pyrResume,
    gameLabel: pyrGameLabel,
    library: () => pyrLibrary,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", pyrLobbyBoot);
} else {
  pyrLobbyBoot();
}

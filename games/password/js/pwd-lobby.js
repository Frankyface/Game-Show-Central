/* ============================================================
   Password — the Game lobby control (docs/19 §1)
   A game auto-resumes its saved state, and once you are past
   setup there is no way back to THIS game's start screen — only
   the hub's. "⟲ Game lobby" is that way back, and it asks first:

     Keep this game — park the game exactly as it stands (the
       Lightning clock is stopped so it cannot run down while
       nobody is watching) and show setup with a Resume button.
     Start over  — drop the game in progress. The roster, the
       words and the rules all stay, so the host can just press
       Start again.

   Neither touches the undo history: the whole core object is
   moved from `core` to `resumable` and back, never rewound. The
   parked game is part of the save, so it survives a reload.

   DOM only: every state change goes through window.PwdApp.
   ============================================================ */

"use strict";

(function () {
  const app = () => window.PwdApp.state();
  const core = () => window.PwdCore;

  let lastFocus = null;

  /* ============ What the host is about to leave ============ */

  /** One plain-English line describing a parked or in-progress game. */
  function describe(state) {
    if (!state) return "";
    const names = state.teams.map((t) => t.name);
    const points = core().scores(state);
    const line = `${names[0]} ${points[0]} · ${names[1]} ${points[1]}`;
    if (state.phase === "word") return `Password ${state.wordsPlayed + 1} of game ${state.gameNo} — ${line}`;
    if (state.phase === "gameOver") {
      const won = state.teams[state.winner === null ? 0 : state.winner].name;
      return `Game ${state.gameNo} won by ${won} — ${line}`;
    }
    if (state.phase === "lightning") {
      return `${state.teams[state.lightning.team].name} in the Lightning Round — `
        + `${core().formatMoney(state, core().lightningTotal(state))} so far`;
    }
    return `The standings — ${line}`;
  }

  /* ============ The confirm ============ */

  function open() {
    const state = app().core;
    if (!state) return;
    lastFocus = document.activeElement;
    setText("pwd-lobby-body", `You are in the middle of ${describe(state)}. `
      + "Keep it and you can pick it up again from the setup screen; start over and the players, "
      + "the words and the rules all stay as they are.");
    show($("pwd-lobby-backdrop"), true);
    window.PwdApp.set({ lobbyOpen: true });
    const keep = $("btn-lobby-keep");
    if (keep) keep.focus();
  }

  function close() {
    show($("pwd-lobby-backdrop"), false);
    window.PwdApp.set({ lobbyOpen: false });
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    lastFocus = null;
  }

  /**
   * Park the game. The Lightning clock is stopped first — a deadline left
   * running would burn through while the host is on the setup screen, so
   * Resume hands back exactly the time that was left (docs/19 §1).
   */
  function keep() {
    const parked = window.PwdApp.pauseRestored(app().core);
    close();
    window.PwdApp.set({ core: null, resumable: parked, reveal: false, lightningReveal: false, studyUntil: null });
  }

  function startOver() {
    close();
    window.PwdApp.set({ core: null, resumable: null, reveal: false, lightningReveal: false, studyUntil: null });
    window.PwdApp.error("");
  }

  function resume() {
    const parked = app().resumable;
    if (!parked) return;
    window.PwdApp.set({ core: parked, resumable: null, reveal: false, lightningReveal: false, studyUntil: null });
  }

  /* ============ Painting ============ */

  /** Runs after every render: the toolbar control and the Resume button. */
  function paint() {
    const state = app();
    const lobby = $("btn-game-lobby");
    if (lobby) lobby.disabled = !state.core;
    const parked = state.resumable;
    const resumeBtn = $("btn-resume");
    if (resumeBtn) show(resumeBtn, !!parked && !state.core);
    const note = $("pwd-resume-note");
    if (!note) return;
    show(note, !!parked && !state.core);
    note.textContent = parked ? `Parked: ${describe(parked)}. Start the game instead and it is gone.` : "";
  }

  /* ============ Wiring ============ */

  function wire() {
    const lobby = $("btn-game-lobby");
    if (!lobby) return;
    lobby.addEventListener("click", () => { open(); lobby.blur(); });
    $("btn-lobby-cancel").addEventListener("click", close);
    $("btn-lobby-keep").addEventListener("click", keep);
    $("btn-lobby-over").addEventListener("click", startOver);
    const resumeBtn = $("btn-resume");
    if (resumeBtn) resumeBtn.addEventListener("click", () => { resume(); resumeBtn.blur(); });
    // The backdrop is a click-away; Escape is the keyboard equivalent.
    $("pwd-lobby-backdrop").addEventListener("click", (event) => {
      if (event.target === $("pwd-lobby-backdrop")) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && app().lobbyOpen) { event.preventDefault(); close(); }
    });
    window.PwdApp.subscribe(paint);
    paint();
  }

  if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wire);
    } else {
      wire();
    }
  }

  window.PwdLobby = { open, close, keep, startOver, resume, describe, paint };
})();

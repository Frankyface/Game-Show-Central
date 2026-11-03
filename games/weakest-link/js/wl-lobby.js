/* ============================================================
   Weakest Link — the "Game lobby" control (docs/19 §1)

   Every game gets one toolbar button that returns the host to the
   game's OWN setup screen from any phase, with two choices:

     Keep this game — setup, with the in-progress game parked in
                      `resumable` and a Resume button offered.
     Start over     — the in-progress game is dropped; roster,
                      content and settings stay exactly as they are.

   Nothing here touches the reducer's history, so undo is unaffected:
   the parked snapshot is the whole core object, and Resume puts the
   identical object back. A running clock is parked PAUSED with the
   time that was left, the same rule wl-app.js uses when it saves.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);

  /** The core as it should be parked: never mid-tick. */
  function paused(core) {
    if (!core || !core.clock || !core.clock.running || core.clock.deadline === null) return core;
    const remainingMs = Math.max(0, core.clock.deadline - Date.now());
    return Object.assign({}, core, { clock: { running: false, deadline: null, remainingMs } });
  }

  /* ============ the three actions ============ */

  /** Park the game and show setup. No-op when there is nothing to park. */
  function keep() {
    const core = window.WlApp.core();
    if (!core) return false;
    window.WlApp.set({ core: null, resumable: paused(core) });
    close();
    return true;
  }

  /** Drop the game. Roster, content and settings are untouched. */
  function startOver() {
    window.WlApp.set({ core: null, resumable: null });
    close();
    return true;
  }

  /** Put the parked game back exactly as it was. */
  function resume() {
    const parked = window.WlApp.state().resumable;
    if (!parked) return false;
    window.WlApp.set({ core: parked, resumable: null });
    return true;
  }

  /* ============ the confirm ============ */

  function open() {
    const box = $id("wl-lobby-confirm");
    // On setup there is no game to leave: the button is disabled there (all-games
    // toolbar rule), so this only ever opens over a game in progress.
    if (!box || !window.WlApp.core()) return;
    $id("wl-lobby-text").textContent =
      "Leave the game on the table and go back to the setup screen, or throw it away and start again.";
    box.setAttribute("aria-modal", "true");
    box.classList.remove("hidden");
    $id("btn-lobby-cancel").focus();
  }

  function close() {
    const box = $id("wl-lobby-confirm");
    if (box) box.classList.add("hidden");
    const btn = $id("btn-game-lobby");
    if (btn) btn.focus();
  }

  function isOpen() {
    const box = $id("wl-lobby-confirm");
    return !!box && !box.classList.contains("hidden");
  }

  /* ============ wiring ============ */

  /** Toolbar rule: Game lobby is present on every screen but disabled on setup.
      The Resume button lives on setup and only exists when a game is parked. */
  function paint() {
    const lobbyBtn = $id("btn-game-lobby");
    if (lobbyBtn) {
      const onSetup = !window.WlApp.core();
      lobbyBtn.disabled = onSetup;
      lobbyBtn.title = onSetup ? "You are on the setup screen already" : "";
      if (onSetup && isOpen()) close();
    }
    const btn = $id("btn-resume");
    if (!btn) return;
    const parked = window.WlApp.state().resumable;
    btn.classList.toggle("hidden", !parked);
    if (!parked) return;
    const round = Number(parked.roundIndex) + 1;
    btn.textContent = parked.phase === "result"
      ? "Resume (finished game)"
      : `Resume round ${Number.isFinite(round) ? round : 1}`;
  }

  function wire() {
    const openBtn = $id("btn-game-lobby");
    if (!openBtn) return;
    openBtn.addEventListener("click", open);
    $id("btn-lobby-keep").addEventListener("click", keep);
    $id("btn-lobby-start-over").addEventListener("click", startOver);
    $id("btn-lobby-cancel").addEventListener("click", close);
    $id("btn-resume").addEventListener("click", resume);
    // Escape closes the confirm; it never leaves the host trapped.
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) { event.preventDefault(); close(); }
    });
    window.WlApp.subscribe(paint);
    paint();
  }

  window.WlLobby = { keep, startOver, resume, open, close, isOpen, paint };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

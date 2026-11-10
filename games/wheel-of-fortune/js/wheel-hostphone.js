/* ============================================================
   Wheel of Fortune — host phone, laptop side (docs/22 §5)
   Kept out of wheel-app.js (800-line limit). Three jobs:

   1. Room glue: every state change hands the hub the host's
      private view — room.setHostView({t:"host", item, seq,
      ...WheelSelect.hostView(state)}). No cache, no resend; the
      SDK and the hub de-duplicate and re-deliver.
   2. Answers-private mode (room.answersPrivate()): the shared
      screen never carries a solution before the room sees it.
      The board already hides letters; what this module adds is
      the status line ("Answer is on your host phone" / "Host
      phone disconnected" + Show answer on this screen, current
      puzzle only, cleared on the next puzzle), and it empties the
      editor's puzzle list and disables the Editor button while a
      game runs, because the editor DOM holds every solution.
      "Reveal all" stays an ordinary host action.
   3. Seat reconciliation on boot (docs/22 §5.6, review F11).

   With no host phone assigned nothing here renders or changes:
   setHostView is a no-op for the hub and the status line stays
   hidden, so behaviour is identical to before.
   ============================================================ */

"use strict";

const WheelHostPhone = (function () {
  const $ = (id) => document.getElementById(id);
  const show = (node, on) => { if (node) node.classList.toggle("hidden", !on); };
  const app = () => window.WheelApp;

  let room = null;
  let seq = 0;
  let lastJson = null;
  let shownItem = null; // the puzzle whose answer the host chose to show here

  const answersPrivate = () => !!(room && room.answersPrivate && room.answersPrivate());
  const connectedPhones = () => (room && room.hostPhones ? room.hostPhones() : [])
    .filter((p) => p.connected !== false);

  /** The puzzle in play, or null when nothing is secret. */
  function secretItem(state) {
    if (!state || !state.round || state.roundDone) return null;
    if (!["round", "tossup", "bonus"].includes(state.phase)) return null;
    return `${state.roundIndex}:${state.round.puzzle}`;
  }

  /* ============ 1. Room glue ============ */

  function pushHostView(state) {
    if (!room || !room.setHostView || !state || !window.WheelSelect) return;
    const view = window.WheelSelect.hostView(state);
    const json = JSON.stringify(view);
    if (json !== lastJson) { lastJson = json; seq += 1; }
    room.setHostView({ t: "host", seq, ...view });
  }

  /* ============ 2. Answers-private mode ============ */

  function renderStatus(state) {
    const box = $("hp-status");
    if (!box) return;
    const item = secretItem(state);
    if (shownItem && shownItem !== item) shownItem = null; // next puzzle: clear
    const on = answersPrivate() && !!item;
    show(box, on);
    const answer = $("hp-answer");
    if (!on) { answer.textContent = ""; show(answer, false); return; }
    const away = connectedPhones().length === 0;
    $("hp-status-text").textContent = away ? "Host phone disconnected" : "Answer is on your host phone";
    show($("btn-hp-show"), away && shownItem !== item);
    // The answer text exists in the DOM only after the host asked for it.
    answer.textContent = shownItem === item ? `Answer: ${state.round.puzzle}` : "";
    show(answer, shownItem === item);
  }

  /** While a game runs in answers-private mode the editor holds no puzzles. */
  function guardEditor(state) {
    const running = !!state && state.phase !== "idle";
    const lock = answersPrivate() && running;
    const btn = $("btn-editor");
    if (btn) {
      btn.disabled = lock;
      if (lock) btn.title = "Answers are private while a game runs — open the editor from the setup screen";
      else btn.removeAttribute("title");
    }
    if (lock) {
      const list = $("ed-rounds");
      if (list && list.children.length) list.replaceChildren();
      const editor = $("screen-editor");
      if (editor && !editor.classList.contains("hidden") && window.WheelEditor) window.WheelEditor.close();
    }
  }

  function render() {
    const state = app() ? app().getState() : null;
    renderStatus(state);
    guardEditor(state);
  }

  function onShowAnswer() {
    const item = secretItem(app().getState());
    if (!item) return;
    shownItem = item;
    render();
  }

  /* ============ 3. Seat reconciliation (docs/22 §5.6) ============ */

  /**
   * Phone seats from the save whose pid the room no longer offers as a
   * contestant: dropped from a setup list; kept (scores stand, phone-less)
   * in a running or parked game, with one notice. `savedPhones` is the
   * phone-pid set restored from the save, read before the roster resyncs.
   */
  function reconcileSeats(savedPhones) {
    if (!room || !app()) return [];
    const present = new Set(room.players().map((p) => p.pid));
    const hosts = new Set((room.hostPhones ? room.hostPhones() : []).map((p) => p.pid));
    const stale = [...(savedPhones || [])].filter((pid) => !present.has(pid));
    if (!stale.length) return [];
    const state = app().getState();
    const seated = state ? state.players.filter((p) => stale.includes(p.pid)) : [];
    const parked = app().resumableSeats ? app().resumableSeats() : [];
    if (state && state.phase === "idle" && seated.length) {
      app().setState({ ...state, players: state.players.filter((p) => !stale.includes(p.pid)) });
    }
    const kept = state && state.phase !== "idle" ? seated
      : parked.filter((p) => stale.includes(p.pid));
    if (kept.length) notice(kept.map((p) => (hosts.has(p.pid)
      ? `${p.name} is now the host phone`
      : `${p.name}'s phone has left the room`)).join("; ")
      + " — play their turns from this screen, or start a new game.");
    return stale;
  }

  function notice(text) {
    $("hp-notice-text").textContent = text;
    show($("hp-notice"), true);
  }

  /* ============ Wiring ============ */

  function attach(theRoom) {
    room = theRoom;
    const btn = $("btn-hp-show");
    if (btn) btn.addEventListener("click", onShowAnswer);
    const ok = $("btn-hp-notice");
    if (ok) ok.addEventListener("click", () => show($("hp-notice"), false));
    app().subscribe((state) => { pushHostView(state); render(); });
    pushHostView(app().getState());
    render();
  }

  return { attach, render, reconcileSeats, pushHostView, secretItem };
})();

window.WheelHostPhone = WheelHostPhone;

/* ============================================================
   Family Feud — answers-private mode on the shared screen (docs/22 §5.4)
   While a host phone is assigned (connected or not) the laptop never
   draws an answer before the game reveals it to the room. The board
   already shows blank numbered tiles; the leak this closes is Fast
   Money's "which board answer?" picker (review F10), which now lists
   "Answer 1…N". A status line bottom-right says where the answers are:
   "Answers are on your host phone" while one is connected; "Host
   phone disconnected" plus one button, Show answer on this screen,
   while none is. That button reveals the CURRENT item only (this
   round, or this Fast Money player) and clears on the next item.
   The fallback is display state, not game state: it is never saved,
   so a reload re-hides the answers.
   With no host phone assigned nothing here renders and nothing changes.
   ============================================================ */

"use strict";

const FeudPrivate = (function () {
  const { $, el, show } = window.FeudApp.helpers;

  let assigned = false; // room.answersPrivate(): a host-phone entry exists
  let connected = false; // at least one host phone is connected
  let fallbackItem = null; // the item the host chose to show on this screen

  const itemOf = (state) => window.FeudSelect.itemOf(state);

  /** Called by the room glue on boot and on every host-phones change. */
  function setRoom(isPrivate, anyConnected) {
    assigned = !!isPrivate;
    connected = !!anyConnected;
  }

  /** True when the shared screen must not show this item's answers. */
  function hidden(state) {
    if (!assigned || !state) return false;
    const item = itemOf(state);
    return !(item && fallbackItem === item);
  }

  function showHere() {
    const state = window.FeudApp.getState();
    if (!state) return;
    fallbackItem = itemOf(state);
    window.FeudApp.render();
  }

  /** The bottom-right status line (+ the fallback list for a board round). */
  function render(state) {
    const panel = $("private-panel");
    if (!panel) return;
    const item = state ? itemOf(state) : "";
    if (fallbackItem && fallbackItem !== item) fallbackItem = null; // next item: clear
    const relevant = assigned && !!item;
    show(panel, relevant);
    if (!relevant) return;
    const shownHere = fallbackItem === item;
    $("private-text").textContent = connected
      ? "Answers are on your host phone."
      : shownHere
        ? `Host phone disconnected — showing ${item} on this screen.`
        : "Host phone disconnected.";
    show($("btn-show-answer"), !connected && !shownHere);
    renderFallbackList(state, shownHere);
  }

  function renderFallbackList(state, shownHere) {
    const list = $("private-answers");
    list.replaceChildren();
    const onBoard = window.FeudSelect.BOARD_PHASES.indexOf(state.phase) !== -1;
    show(list, shownHere && onBoard);
    if (!shownHere || !onBoard) return; // Fast Money: the pickers carry the text
    window.FeudCore.boardView(state).forEach((tile) => {
      const li = el("li", tile.revealed ? "is-revealed" : null);
      li.appendChild(el("span", "private-n", String(tile.number)));
      li.appendChild(el("span", "private-text", tile.text));
      li.appendChild(el("span", "private-count", String(tile.count)));
      list.appendChild(li);
    });
  }

  function wire() {
    const btn = $("btn-show-answer");
    if (btn) btn.addEventListener("click", showHere);
  }

  return { setRoom, hidden, render, wire, isAssigned: () => assigned, isConnected: () => connected };
})();

window.FeudPrivate = FeudPrivate;

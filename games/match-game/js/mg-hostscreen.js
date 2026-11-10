/* ============================================================
   Match Game — the shared screen when a host phone is assigned
   docs/22 §5.4 and §5.6. While `room.answersPrivate()` is true
   (a host phone is assigned, connected or not), the laptop never
   draws private text before the show reveals it:

   - the prompt's hint is not rendered;
   - the Audience Match top three show their rank, count and money
     but not their wording until a guess hits that row, and the
     merge buttons name the rows by rank ("→ #1");
   - every host type-in (panel cards, the Head-to-Head cards) is
     masked, and the "hide as I type" choice is forced on.

   In place of the private text: "Answer is on your host phone"
   while one is connected; while none is, "Host phone disconnected"
   and ONE "Show answer on this screen" button, which reveals the
   current item only and is forgotten on the next item. With no
   host phone assigned, nothing here changes anything.

   Also seat reconciliation on boot (§5.6, review F11): phone
   seats whose pid is not in this room are dropped from setup; a
   running or kept game keeps the seat and plays it phone-less.
   Built with createElement/textContent only.
   ============================================================ */

"use strict";

const MgHostScreen = (function () {
  const app = () => window.MgApp.state();

  /* ============ Keys: one per item, so a fallback never outlives it ============ */

  function promptKey(state) {
    const cur = state.current;
    return cur ? `prompt:${state.round}:${state.tiebreak}:${cur.seat}:${cur.index}:${state.cursor}` : "";
  }

  function boardKey(state) {
    return state.audience ? `board:${state.audCursor}:${state.audience.index}` : "";
  }

  /** May the laptop show this item's private text right now? */
  function shows(a, key) {
    return !a.answersPrivate || (!!key && a.fallbackKey === key);
  }

  /* ============ The note / fallback in place of private text ============ */

  /**
   * Fill `node` with the private-mode stand-in: a note while the host phone is
   * connected, or the note plus the single per-item fallback button when not.
   */
  function renderStandIn(node, a, key) {
    node.replaceChildren();
    if (a.hostPhoneLive) {
      node.appendChild(el("span", "hp-note", "Answer is on your host phone"));
      return;
    }
    node.appendChild(el("span", "hp-note is-away", "Host phone disconnected"));
    const btn = el("button", "btn btn-ghost btn-small hp-fallback", "Show answer on this screen");
    btn.type = "button";
    btn.addEventListener("click", () => window.MgApp.set({ fallbackKey: key }));
    node.appendChild(btn);
  }

  /** The prompt's hint line: the hint itself, or the stand-in. */
  function renderHint(node, a, state) {
    const hint = state.current && state.current.hint;
    if (!hint) { node.replaceChildren(); return; }
    const key = promptKey(state);
    if (shows(a, key)) {
      node.replaceChildren();
      node.textContent = `Hint: ${hint}`;
      return;
    }
    renderStandIn(node, a, key);
  }

  /** One line above the Audience Match board while its wording is private. */
  function renderBoardNote(node, a, state, board) {
    const key = boardKey(state);
    const hidden = board.some((row) => !rowShown(a, state, row));
    show(node, hidden);
    if (hidden) renderStandIn(node, a, key);
    else node.replaceChildren();
  }

  /** A board row's wording is public once a guess has hit it. */
  function rowShown(a, state, row) {
    if (shows(a, boardKey(state))) return true;
    return state.audience.guesses.some((g) => g.hit === row.rank);
  }

  /** "→ gloves" in the open; "→ #1" while the row's wording is private. */
  function targetLabel(a, state, target, board) {
    const onBoard = board.find((row) => row.key === target.key);
    if (onBoard && !rowShown(a, state, onBoard)) return `#${onBoard.rank + 1}`;
    return null;
  }

  /* ============ Host phones and seats ============ */

  function setHostPhones(list, isPrivate) {
    const live = (Array.isArray(list) ? list : []).some((p) => p && p.connected !== false);
    const a = app();
    if (a.answersPrivate === !!isPrivate && a.hostPhoneLive === live) return;
    window.MgApp.set({ answersPrivate: !!isPrivate, hostPhoneLive: live });
  }

  /** Pids a game seats by phone. */
  function seatedPids(st) {
    if (!st) return [];
    return st.panel.map((p) => p.pid).concat(st.contestants.map((c) => c.pid)).filter(Boolean);
  }

  function nameOf(st, pid) {
    const row = st.panel.find((p) => p.pid === pid) || st.contestants.find((c) => c.pid === pid);
    return row ? row.name : pid;
  }

  /**
   * Seat reconciliation on boot (embedded only — standalone has no roster yet).
   * @param {string[]} present the contestant pids in this room
   */
  function reconcileSeats(present) {
    const here = new Set(present);
    const a = app();
    // A seat whose phone is gone loses the phone AND the name that came with it
    // (verification M1): a former contestant who is now the host phone must not
    // stay named on a seat that the next phone to join will take.
    const keep = (row) => (!row.pid || here.has(row.pid) ? row : window.MgApp.unseat(row, a.setup.players));
    const setup = Object.assign({}, a.setup, {
      players: a.setup.players.filter((p) => p.manual || here.has(p.pid)),
      contestants: a.setup.contestants.map(keep),
      panel: a.setup.panel.map(keep),
    });
    const phoneless = [...new Set(seatedPids(a.core).concat(seatedPids(a.resumable)))]
      .filter((pid) => !here.has(pid));
    window.MgApp.set({ setup, phoneless });
    if (!phoneless.length) return;
    const st = a.core || a.resumable;
    const names = phoneless.map((pid) => nameOf(st, pid)).join(", ");
    window.MgApp.error(`${names} ${phoneless.length === 1 ? "has" : "have"} no phone in this room — `
      + "type their answers on this screen, or start a new game.");
  }

  /** Is this seat played without a phone (none assigned, or reconciled away)? */
  function phoneless(a, pid) {
    return !pid || (a.phoneless || []).indexOf(pid) >= 0;
  }

  return {
    promptKey, boardKey, shows, renderStandIn, renderHint, renderBoardNote, rowShown,
    targetLabel, setHostPhones, reconcileSeats, phoneless,
  };
})();

window.MgHostScreen = MgHostScreen;

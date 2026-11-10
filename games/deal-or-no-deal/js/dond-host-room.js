/* ============================================================
   Deal or No Deal — host-phone room glue (docs/22 §5.2, §5.6)
   Two jobs, both on top of the room dond-room.js already holds:

   1. On every state change, hand the hub the host's private view:
      room.setHostView({ t:"host", item, seq, ...hostView(state) }).
      `seq` bumps only when the content actually changes. No cache,
      no resend, never room.send — the SDK and the hub de-duplicate
      and re-deliver to a host phone that (re)connects.
   2. Seat reconciliation on boot (embedded only, review F11): phone
      seats in the saved setup whose pid is not in this room are
      dropped; a running or parked game that seats such a pid keeps
      the seat — it plays from the laptop like any phone-less
      contestant — and the host is told once.

   Nothing here is secret-bearing on the shared screen: the view
   goes only to the hub. With no host phone assigned the hub simply
   holds it, so behaviour is identical to before.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let seq = 0;
  let lastJson = "";

  function pushHostView(state) {
    if (!room || typeof room.setHostView !== "function" || !window.DondHostView) return;
    const view = window.DondHostView.hostView(state);
    const json = JSON.stringify(view);
    if (json !== lastJson) { lastJson = json; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item: view.item || "", seq }, view));
  }

  /** Every pid a game still seats: the contestant at the cases and everyone yet to play. */
  function seatedPids(state) {
    if (!state || !Array.isArray(state.contestants)) return [];
    return state.contestants.filter((c) => !c.out || c.pid === state.current).map((c) => c.pid);
  }

  /**
   * Drop setup seats whose phone is not in this room; keep game seats and say so.
   * @param {string[]} present the room's contestant pids
   */
  function reconcileSeats(present) {
    const app = window.DondApp.state();
    const here = new Set(present);
    const manual = new Set(app.setup.players.filter((p) => p.manual).map((p) => p.pid));
    const players = app.setup.players.filter((p) => p.manual || here.has(p.pid));
    const phoneless = [...new Set(seatedPids(app.core).concat(seatedPids(app.resumable)))]
      .filter((pid) => !here.has(pid) && !manual.has(pid));
    if (players.length !== app.setup.players.length) {
      window.DondApp.set({ setup: Object.assign({}, app.setup, { players }) });
    }
    if (!phoneless.length) return phoneless;
    const st = app.core || app.resumable;
    const names = phoneless.map((pid) => window.DondCore.nameOf(st, pid)).filter(Boolean).join(", ");
    window.DondApp.error(`${names} ${phoneless.length === 1 ? "has" : "have"} no phone in this room. `
      + "They keep their seat — play their cases from this screen, or start a new game.");
    return phoneless;
  }

  window.DondHostRoom = {
    /** Called by dond-room.js once GSC.host() has resolved. */
    attach(theRoom, embedded) {
      room = theRoom;
      window.DondApp.subscribe(pushHostView);
      const settle = window.DondApp.whenReady ? window.DondApp.whenReady() : Promise.resolve();
      settle.then(() => {
        if (embedded) reconcileSeats((room.players ? room.players() : []).map((p) => p.pid));
        pushHostView(window.DondApp.core());
      }).catch((err) => console.warn("Host-phone setup failed:", err));
    },
    onHostPhones() {
      // Nothing on the shared screen depends on a host phone (docs/22 §6: "No
      // change"), so there is nothing to re-render; the hub re-delivers the view.
    },
    pushHostView,
    reconcileSeats,
    seq: () => seq,
  };
})();

/* ============================================================
   Password — host-phone room glue (docs/22 §5.2, §5.4, §5.6)
   Three jobs, all on the host page, none on a phone:

   1. Every state change hands the hub the host's private view:
      room.setHostView({t:"host", item, seq, …hostView(state)}).
      `seq` bumps only when the content changes. No cache, no
      resend: the SDK and the hub de-duplicate and re-deliver.
   2. It keeps three render flags on the app (never persisted):
      answersPrivate (a host phone is assigned, connected or not),
      hostPhoneLive (one is connected right now) and livePhones
      (contestant pids with a connected phone — so the giver panel
      can stay for a giver who has none; review F6).
   3. Seat reconciliation on boot, embedded only (review F11).

   With no host phone assigned every flag is false/empty and the
   game behaves exactly as it did before this file existed.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let seq = 0;
  let lastJson = "";

  const app = () => window.PwdApp.state();

  /* ============ 1. The view ============ */

  function pushHostView(state) {
    if (!room || typeof room.setHostView !== "function" || !window.PwdHostView) return;
    const view = window.PwdHostView.hostView(state);
    const text = JSON.stringify(view);
    if (text !== lastJson) { lastJson = text; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item: view.item || "", seq }, view));
  }

  /* ============ 2. The flags ============ */

  function sameList(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  }

  /** Re-read the roster. Only writes (and so re-renders) when something changed. */
  function refresh() {
    if (!room) return;
    const hosts = typeof room.hostPhones === "function" ? room.hostPhones() : [];
    const isPrivate = typeof room.answersPrivate === "function" ? !!room.answersPrivate() : false;
    const live = hosts.some((h) => h && h.connected !== false);
    const phones = (room.players ? room.players() : [])
      .filter((p) => !p.manual && p.connected !== false).map((p) => p.pid).sort();
    const a = app();
    if (!!a.answersPrivate === isPrivate && !!a.hostPhoneLive === live && sameList(a.livePhones || [], phones)) return;
    const patch = { answersPrivate: isPrivate, hostPhoneLive: live, livePhones: phones };
    if (!isPrivate) patch.fallbackKey = null;
    window.PwdApp.set(patch);
  }

  /* ============ 3. Seat reconciliation (embedded only) ============ */

  /** The saved setup lands asynchronously (content load); wait for it, briefly. */
  function whenContentSettled() {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        if (app().source !== "loading…" || Date.now() - start > 10000) { resolve(); return; }
        setTimeout(poll, 40);
      })();
    });
  }

  function seatedIn(st) {
    return st && Array.isArray(st.teams) ? st.teams.flatMap((t) => t.members || []) : [];
  }

  /**
   * Phone seats in the saved setup whose pid is not in this room are removed.
   * A running or parked game that seats such a pid keeps the seat (scores
   * stand); it simply has no phone now, so its giver panel stays available on
   * this screen. One notice says so.
   */
  function reconcile() {
    const present = new Set((room.players ? room.players() : []).map((p) => p.pid));
    const hostNames = new Map((room.hostPhones ? room.hostPhones() : []).map((h) => [h.pid, h.name]));
    const setup = app().setup;
    const gone = setup.players.filter((p) => !p.manual && !present.has(p.pid));
    if (!gone.length) return;
    const goneIds = new Set(gone.map((p) => p.pid));
    window.PwdApp.set({ setup: Object.assign({}, setup, {
      players: setup.players.filter((p) => !goneIds.has(p.pid)),
      seats: setup.seats.map((pair) => pair.map((pid) => (goneIds.has(pid) ? "" : pid))),
    }) });
    const inGame = seatedIn(app().core).concat(seatedIn(app().resumable)).filter((m) => goneIds.has(m.pid));
    const names = [...new Map(inGame.map((m) => [m.pid, m.name])).entries()];
    if (!names.length) return;
    const [pid, name] = names[0];
    window.PwdApp.error(hostNames.has(pid)
      ? `${name} is now the host phone — play their turns from this screen, or start a new game.`
      : `${name}'s phone is not in this room — play their turns from this screen, or start a new game.`);
  }

  /* ============ Wiring ============ */

  async function attach(theRoom, embedded) {
    room = theRoom;
    window.PwdApp.subscribe(pushHostView);
    refresh();   // private mode applies from the first frame, before content settles
    if (embedded) {
      await whenContentSettled();
      reconcile();
    }
    refresh();
    pushHostView(window.PwdApp.core());
  }

  window.PwdHostPhone = {
    attach,
    onHostPhones: () => refresh(),
    roster: () => refresh(),
    push: () => pushHostView(window.PwdApp.core()),
    seq: () => seq,
  };
})();

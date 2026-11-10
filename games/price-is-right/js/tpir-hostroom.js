/* ============================================================
   The Price Is Right — host phone, laptop side (docs/22 §5.2,
   §5.4, §5.6)

   - Room glue: on every state change, room.setHostView({t:"host",
     item, seq, ...hostView(state)}); `seq` bumps only when the
     content changes. No cache or resend here — the SDK and the hub
     do that.
   - Answers-private notice: while a host phone is assigned, the
     play bar says "Answer is on your host phone"; while it is away,
     "Host phone disconnected" and one "Show answer on this screen"
     button that reveals the CURRENT item only and clears on the
     next one. Nothing in TPIR draws a price before its public
     reveal, so this is the only place one can appear early.
   - Seat reconciliation on boot (embedded only).

   With no host phone assigned nothing here renders anything, so
   the game behaves exactly as before. createElement/textContent only.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let isPrivate = false;    // a host phone is assigned (connected or not)
  let live = false;         // …and is connected right now
  let seq = 0;
  let lastJson = "";
  let shownKey = "";        // the fallback key the host revealed, if any

  const HV = () => window.TpirHostView;

  /* ============ docs/22 §5.2 — the view for the host phone ============ */

  function pushHostView(state) {
    if (!room || typeof room.setHostView !== "function" || !HV()) return;
    const view = HV().hostView(state);
    const json = JSON.stringify(view);
    if (json !== lastJson) { lastJson = json; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item: view.item || "", seq }, view));
  }

  /* ============ docs/22 §5.4 — the shared screen ============ */

  function paint(state) {
    const note = $("tpir-hp-note");
    if (!note) return;
    const fb = isPrivate && HV() ? HV().fallbackFor(state) : null;
    const answer = $("tpir-hp-answer");
    const btn = $("btn-hp-fallback");
    if (!fb) {
      // Nothing secret (or no host phone): nothing to say, and no stale text left behind.
      show(note, false);
      answer.textContent = "";
      shownKey = "";
      return;
    }
    if (shownKey && shownKey !== fb.key) shownKey = "";     // a new item: the reveal clears
    const revealed = !live && shownKey === fb.key;
    setText("tpir-hp-msg", live ? "Answer is on your host phone" : "Host phone disconnected");
    show(btn, !live && !revealed);
    answer.textContent = revealed ? fb.text : "";
    show(answer, revealed);
    show(note, true);
  }

  function onFallback() {
    const fb = HV() ? HV().fallbackFor(window.TpirApp.core()) : null;
    if (!fb) return;
    shownKey = fb.key;
    paint(window.TpirApp.core());
  }

  function onHostPhones(list) {
    live = (Array.isArray(list) ? list : []).some((p) => p && p.connected !== false);
    isPrivate = room && typeof room.answersPrivate === "function" ? room.answersPrivate() : live;
    paint(window.TpirApp.core());
  }

  /* ============ docs/22 §5.6 — seat reconciliation (embedded only) ============ */

  /** Resolve once the saved show and the content have landed (boot is async). */
  function contentReady() {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        if (window.TpirApp.state().content || Date.now() - start > 10000) { resolve(); return; }
        setTimeout(poll, 40);
      })();
    });
  }

  /**
   * Phone seats in the saved line-up whose pid is not in this room are
   * removed (a former contestant who is now a host phone, a phone that never
   * came back). A running or parked show that seats such a pid keeps the seat
   * — scores stand — and plays it phone-less: with no connected phone the
   * host's own field is live for that player. One notice says so.
   */
  async function reconcileSeats() {
    await contentReady();
    const app = window.TpirApp.state();
    const here = new Set((room.players ? room.players() : []).map((p) => p.pid));
    const manual = new Set(app.setup.players.filter((p) => p.manual).map((p) => p.pid));
    const players = app.setup.players.filter((p) => p.manual || here.has(p.pid));
    const seated = [].concat(app.core ? app.core.roster : [], app.resumable ? app.resumable.roster : []);
    const lost = [];
    seated.forEach((r) => {
      if (!here.has(r.pid) && !manual.has(r.pid) && !lost.some((x) => x.pid === r.pid)) lost.push(r);
    });
    if (players.length !== app.setup.players.length) {
      window.TpirApp.set({ setup: Object.assign({}, app.setup, { players }) });
    }
    if (!lost.length) return;
    const names = lost.map((r) => r.name).join(", ");
    window.TpirApp.error(`${names} ${lost.length === 1 ? "has" : "have"} no phone in this room. `
      + "They keep their seat and you enter their bids on this screen.");
  }

  /* ============ Wiring ============ */

  function attach(r, embedded) {
    room = r;
    isPrivate = typeof r.answersPrivate === "function" ? r.answersPrivate() : false;
    live = (typeof r.hostPhones === "function" ? r.hostPhones() : []).some((p) => p.connected !== false);
    const btn = $("btn-hp-fallback");
    if (btn) btn.addEventListener("click", onFallback);
    window.TpirApp.subscribe((state) => { pushHostView(state); paint(state); });
    pushHostView(window.TpirApp.core());
    paint(window.TpirApp.core());
    if (embedded) reconcileSeats().catch((err) => console.warn("Seat reconciliation failed:", err));
  }

  window.TpirHostRoom = {
    attach, onHostPhones,
    state: () => ({ isPrivate, live, seq, shownKey }),
  };
})();

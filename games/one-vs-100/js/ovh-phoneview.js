/* ============================================================
   1 vs 100 — phone payloads and phone views (PURE)
   What a phone may send (validatePhoneMsg) and the ONE view each
   phone is allowed to see (phoneView): a Mob member never gets
   another member's pick or the correct answer before the reveal
   (O-U10, spec 16 §4). Split out of ovh-core.js to keep both
   files under the 800-line house limit; ovh-core.js builds this
   with its own selectors and re-exports both functions, so
   callers only ever touch OvhCore.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OvhPhoneView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * @param {object} S the selectors and helpers ovh-core.js hands over
   * @returns {{validatePhoneMsg:Function, phoneView:Function, memberOf:Function}}
   */
  function make(S) {
    const {
      isPlainObject, isIntIn, OPTION_COUNT, members, nameOf, bank, formatMoney,
      mobAlive, mobSize, contestantName, publicQuestion, split, perMember,
    } = S;

    /**
     * Validate a phone->host payload: a narrow copy, or null for junk — callers
     * ignore null and never throw on a hostile frame. @param {unknown} obj
     */
    function validatePhoneMsg(obj) {
      if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
      if (obj.t === "mob") return isIntIn(obj.idx, 0, OPTION_COUNT - 1) ? { t: "mob", idx: obj.idx } : null;
      if (obj.t === "lock") return isIntIn(obj.idx, 0, OPTION_COUNT - 1) ? { t: "lock", idx: obj.idx } : null;
      return null;
    }

    function memberOf(state, pid) {
      return members(state).find((m) => m.pid === pid) || null;
    }

    /**
     * What phone `pid` should render. A Mob member's view NEVER contains another
     * member's answer and never contains the correct answer before the reveal
     * (O-U10, spec 16 §4).
     */
    function phoneView(state, pid, now) {
      const base = {
        screen: "wait",
        name: nameOf(state, pid),
        bank: formatMoney(state, bank(state)),
        qNumber: state.qNumber,
        alive: mobAlive(state),
        mobSize: mobSize(state),
        sub: "",
      };
      if (state.phase === "result" || state.phase === "standings") return resultPhoneView(state, pid, base);
      if (state.phase === "setup") return Object.assign(base, { sub: "The host is still setting up." });
      if (pid === state.contestant) return Object.assign(base, contestantPhoneView(state));
      return Object.assign(base, mobPhoneView(state, pid, now));
    }

    function resultPhoneView(state, pid, base) {
      const out = state.outcome;
      const me = memberOf(state, pid);
      const mine = out && pid === state.contestant
        ? formatMoney(state, out.won)
        : (me && me.alive && out && out.reason === "lose" ? formatMoney(state, out.each) : null);
      return Object.assign(base, {
        screen: "result",
        reason: out ? out.reason : "over",
        mine,
        contestant: contestantName(state),
        won: out ? formatMoney(state, out.won) : formatMoney(state, 0),
        sub: mine ? "Nicely played." : "Watch the host screen for the standings.",
      });
    }

    function contestantPhoneView(state) {
      const q = state.q || {};
      const pub = publicQuestion(state);
      if (!pub) return { sub: "Waiting for the next question." };
      if (!q.closed) {
        return { screen: "wait", sub: "The Mob is answering. You are up next.", q: pub.q };
      }
      if (q.revealed || state.phase === "decision") {
        return { screen: "wait", sub: "Locked in — watch the host screen.", q: pub.q, locked: q.locked };
      }
      return {
        screen: "contestant",
        q: pub.q,
        category: pub.category,
        options: pub.options,
        locked: q.locked,
        helps: Object.assign({}, state.helps),
        poll: q.poll ? split(state).counts : null,
        playingFor: formatMoney(state, perMember(state, state.qNumber)),
        sub: q.locked === null ? "Lock in your answer." : "Locked in — the host reveals.",
      };
    }

    function mobPhoneView(state, pid, now) {
      const me = memberOf(state, pid);
      if (!me) return { screen: "wait", sub: "You are watching this one — the Mob is already set." };
      if (!me.alive) {
        return { screen: "mob-eliminated", seat: me.seat, out: me.out, sub: "You're out — watch the host screen." };
      }
      const q = state.q || {};
      const pub = publicQuestion(state);
      const mine = Object.prototype.hasOwnProperty.call(q.answers || {}, pid) ? q.answers[pid] : null;
      if (!pub || !q.open) {
        return {
          screen: "wait",
          seat: me.seat,
          mine,
          sub: q.closed ? "Answer locked — watch the host screen." : "Stand by — the next question is coming.",
        };
      }
      return {
        screen: "mob-answer",
        seat: me.seat,
        q: pub.q,
        category: pub.category,
        options: pub.options,
        mine,
        // D12: time LEFT, not the host's wall clock, so a phone whose clock is
        // off still counts down correctly. Without `now`, the stored remainder.
        msLeft: Number.isFinite(q.deadline) && Number.isFinite(now)
          ? Math.max(0, q.deadline - now)
          : (Number.isFinite(q.remainingMs) ? q.remainingMs : (q.seconds || 0) * 1000),
        seconds: q.seconds,
        sub: mine === null ? "Tap your answer before the window closes." : "Answer in — good luck.",
      };
    }

    return { validatePhoneMsg, phoneView, memberOf };
  }

  return { make };
});

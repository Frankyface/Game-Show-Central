/* ============================================================
   The Chase — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances, and
   never learns anything the host did not address to it — the
   host only ever sends this phone its OWN view
   (ChaseCore.phoneView).

   Which is the whole trick of the head-to-head: the contestant's
   phone and the Chaser's phone each carry their own locked
   letter and nothing else. The other side is a lamp — "locked" —
   until the host reveals it on the big screen. Rapid-fire
   questions are read aloud by the host and never reach a phone
   at all, so no answer can be sitting in a pocket.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;
  let ticker = null;      // the clock repaint interval; ephemeral, never sent

  const TICK_MS = 250;
  const LETTERS = ["A", "B", "C"];

  /* ============ Small builders ============ */

  function actionButton(label, className, onClick, disabled) {
    const btn = el("button", `btn ${className}`, label);
    btn.type = "button";
    btn.disabled = !!disabled;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function stat(box, key, value, className) {
    const cell = el("div", `phone-stat ${className || ""}`.trim());
    cell.appendChild(el("p", "k", key));
    cell.appendChild(el("p", "v", value));
    box.appendChild(cell);
    return cell;
  }

  /* ============ The clock (a read-out, never a rule) ============ */

  function stopClock() {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = null;
  }

  /** mm:ss from the deadline the host sent. Hitting zero changes nothing here:
      the host's screen owns the expiry and the host judges what is in flight. */
  function paintClock(cell) {
    const left = window.ChaseCore ? window.ChaseCore.secondsLeft(view.clock, Date.now()) : 0;
    const label = cell.querySelector(".v");
    if (label) label.textContent = window.ChaseClock ? window.ChaseClock.format(left * 1000) : String(left);
    cell.classList.toggle("is-urgent", left > 0 && left <= 10);
    cell.classList.toggle("is-done", left <= 0 && !!(view.clock && view.clock.remainingMs === 0));
  }

  function buildClock(box) {
    if (!view.clock) return;
    const cell = stat(box, "Time", "", "is-clock");
    paintClock(cell);
    ticker = setInterval(() => paintClock(cell), TICK_MS);
  }

  /* ============ The three options ============ */

  /**
   * A, B and C as thumb-sized rows. The button this phone locked is marked;
   * the other side's choice is not in the payload at all until the reveal, and
   * after it the view carries `answer` so both phones can light the right one.
   */
  function buildOptions(box, v, kind) {
    const list = el("div", `phone-options is-${kind}`);
    (v.options || []).forEach((text, i) => {
      const chosen = v.myLock === i;
      const shown = typeof v.answer === "number";
      const classes = ["btn", "btn-option", "btn-tap"];
      if (chosen) classes.push("is-mine");
      if (shown && i === v.answer) classes.push("is-right");
      if (shown && chosen && i !== v.answer) classes.push("is-wrong");
      const btn = actionButton("", classes.join(" "), () => send(i), !v.canLock);
      btn.appendChild(el("span", "opt-letter", LETTERS[i]));
      btn.appendChild(el("span", "opt-text", text));
      if (chosen) btn.appendChild(el("span", "opt-tag", shown ? "you" : "locked"));
      btn.setAttribute("aria-pressed", String(chosen));
      list.appendChild(btn);
    });
    box.appendChild(list);
    return list;
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v, meta) {
      if (v.clock) buildClock(meta);
      if (v.totalText) stat(meta, "Built", v.totalText, "is-value");
      if (v.amounts) {
        stat(meta, "Higher", v.amounts.higher);
        stat(meta, "Middle", v.amounts.middle);
        stat(meta, "Lower", v.amounts.lower);
      }
      if (!v.clock && !v.totalText && !v.amounts) stat(meta, "Bank", v.bankText || "", "is-value");
      return {
        kicker: v.isChaser ? `You are ${v.chaserName}` : (v.name || "Stand by"),
        headline: v.sub || "Waiting for the host…",
        sub: v.hotSeatName ? `In the hot seat: ${v.hotSeatName}` : "",
        cardClass: "is-wait",
      };
    },

    answer(v, meta, actions, card) {
      stat(meta, "Playing for", v.amountText || "", "is-value");
      stat(meta, "To home", String(v.board ? v.board.contestant : ""), "is-steps");
      stat(meta, "Chaser", String(v.board ? v.board.chaser : ""), "is-steps");
      card.appendChild(el("p", "phone-question", v.q || ""));
      buildOptions(card, v, "contestant");
      void actions;
      return {
        kicker: "Head to head",
        headline: v.myLock === null || v.myLock === undefined ? "Lock an answer" : "Locked in",
        sub: v.sub || "",
        cardClass: "is-answer",
        status: v.chaserLocked ? `${v.chaserName} has locked in.` : `${v.chaserName} is thinking…`,
      };
    },

    chaser(v, meta, actions, card) {
      stat(meta, "They play for", v.amountText || "", "is-value");
      stat(meta, "To home", String(v.board ? v.board.contestant : ""), "is-steps");
      stat(meta, "You", String(v.board ? v.board.chaser : ""), "is-steps");
      card.appendChild(el("p", "phone-question", v.q || ""));
      buildOptions(card, v, "chaser");
      void actions;
      return {
        kicker: `${v.chaserName} — you`,
        headline: v.myLock === null || v.myLock === undefined ? "Lock an answer" : "Locked in",
        sub: v.sub || "",
        cardClass: "is-chaser",
        status: v.contestantLocked ? `${v.hotSeatName} has locked in.` : `${v.hotSeatName} is thinking…`,
      };
    },

    final(v, meta) {
      buildClock(meta);
      stat(meta, "Team", String(v.teamSteps), "is-steps");
      stat(meta, v.chaserName || "Chaser", String(v.chaserSteps), "is-steps");
      return {
        kicker: v.half === "team" ? "Final Chase — your two minutes" : `Final Chase — ${v.chaserName}`,
        headline: v.pushbackPending ? "Pushback!" : (v.half === "team" ? "Answer out loud" : "Watch the board"),
        sub: v.sub || "",
        cardClass: v.pushbackPending ? "is-pushback" : "is-final",
      };
    },

    result(v, meta, actions, card) {
      const list = el("ul", "phone-standings");
      (v.standings || []).forEach((row) => {
        const li = el("li");
        li.appendChild(el("span", null, `${row.name} — ${row.outcome}`));
        li.appendChild(el("span", null, row.winnings));
        list.appendChild(li);
      });
      card.appendChild(list);
      void meta; void actions;
      return {
        kicker: v.won ? "You held on" : "Standings",
        headline: v.mine || "That’s a wrap",
        sub: v.sub || "",
        cardClass: "is-result",
      };
    },
  };

  function send(idx) {
    if (!me) return;
    me.send({ t: "lock", idx });
    setText("chase-phone-status", `Sent — ${LETTERS[idx]} locked. Nobody else can see it.`);
  }

  /* ============ Rendering ============ */

  function render() {
    const card = $("chase-phone-card");
    if (!card) return;
    const meta = $("chase-phone-meta");
    const actions = $("chase-phone-actions");
    meta.replaceChildren();
    actions.replaceChildren();
    // Anything a previous screen appended straight to the card goes with it:
    // only the fixed children survive a repaint.
    [...card.querySelectorAll(".phone-standings, .phone-options, .phone-question")]
      .forEach((node) => node.remove());
    stopClock();
    const build = Object.prototype.hasOwnProperty.call(SCREENS, view.screen)
      ? SCREENS[view.screen] : SCREENS.wait;
    const spec = build(view, meta, actions, card) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("chase-phone-kicker", spec.kicker || "");
    setText("chase-phone-headline", spec.headline || "");
    setText("chase-phone-sub", spec.sub || "");
    setText("chase-phone-status", connected ? (spec.status || "") : "Reconnecting…");
  }

  /* ============ Transport ============ */

  function onMessage(raw) {
    if (!raw || typeof raw !== "object" || raw.t !== "view") return;
    view = raw;
    render();
  }

  function onStatus(up) {
    connected = !!up;
    if (me && me.role === "host") { window.ChaseHostPhone.status(connected); return; }
    render();
  }

  /** docs/22: only a host phone ever receives one; it is rendered, never answered. */
  function onHostView(v) {
    if (window.ChaseHostPhone) window.ChaseHostPhone.show(v);
  }

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || !GSC.mode.endsWith("-player")) return;
    document.body.classList.add("player-mode");
    show($("screen-phone"), true);
    try {
      me = await GSC.player({ onMessage, onStatus, onHostView });
    } catch (err) {
      setText("chase-phone-headline", "Could not join");
      setText("chase-phone-sub", err.message);
      return;
    }
    if (me.role === "host") {
      // The host's private second screen: it renders and sends nothing (docs/22 section 5.7).
      window.ChaseHostPhone.start();
      window.ChasePhone = { me, role: "host", view: () => view };
      return;
    }
    me.send({ t: "ready" });
    setText("chase-phone-status", "Connected. Waiting for the host…");
    render();
    window.ChasePhone = {
      me, onMessage,
      view: () => view,
      headline: () => ($("chase-phone-headline") ? $("chase-phone-headline").textContent : ""),
      questionText: () => {
        const node = document.querySelector("#chase-phone-card .phone-question");
        return node ? node.textContent : "";
      },
      clockText: () => {
        const cell = document.querySelector(".phone-stat.is-clock .v");
        return cell ? cell.textContent : "";
      },
      option: (letter) => [...document.querySelectorAll("#chase-phone-card .btn-option")]
        .find((b) => b.textContent.indexOf(letter) === 0) || null,
      options: () => [...document.querySelectorAll("#chase-phone-card .btn-option")],
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

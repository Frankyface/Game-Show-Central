/* ============================================================
   Pyramid — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances, and
   never learns anything the host did not address to it — the
   host only ever sends this phone its OWN view (PyrCore.phoneView).

   Which is the whole trick of this game: the giver's phone is the
   only surface in the room that carries the word. The guesser's
   phone deliberately shows nothing but the clock and the count,
   so it can be held up, put on the table, or glanced at by the
   whole team without giving anything away.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;
  let ticker = null;      // the clock repaint interval; ephemeral, never sent

  const TICK_MS = 250;

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

  function countText(v) {
    const c = v.count || { done: 0, total: 0 };
    return `${c.done} / ${c.total}`;
  }

  /* ============ The clock (a read-out, never a rule) ============ */

  function stopClock() {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = null;
  }

  /** mm:ss from the deadline the host sent. Hitting zero changes nothing here:
      the host's screen owns the expiry and the host judges the word in flight. */
  function paintClock(cell) {
    const clock = view.clock;
    const left = window.PyrCore ? window.PyrCore.secondsLeft(clock, Date.now()) : 0;
    const label = cell.querySelector(".v");
    if (label) label.textContent = window.PyrClock ? window.PyrClock.format(left * 1000) : String(left);
    cell.classList.toggle("is-urgent", left > 0 && left <= 10);
    cell.classList.toggle("is-done", left <= 0 && !!clock && clock.running === false && !!view.started);
  }

  function buildClock(box) {
    if (!view.clock) return;
    const cell = stat(box, "Time", "", "is-clock");
    paintClock(cell);
    ticker = setInterval(() => paintClock(cell), TICK_MS);
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v, meta) {
      if (v.clock) buildClock(meta);
      if (v.count) stat(meta, "Words", countText(v));
      return {
        kicker: v.teamName || "Stand by",
        word: v.sub || "Waiting for the host…",
        sub: v.teamNames ? `${v.teamNames[0]} ${v.points[0]} · ${v.teamNames[1]} ${v.points[1]}` : "",
        cardClass: "is-wait",
      };
    },

    giver(v, meta, actions) {
      buildClock(meta);
      stat(meta, "Got", countText(v));
      actions.appendChild(actionButton("Got it", "btn-green btn-tap",
        () => send("correct"), !v.started));
      actions.appendChild(actionButton("Pass", "btn-blue btn-tap",
        () => send("pass"), !v.started));
      return {
        kicker: `You give · ${v.category || ""}`,
        word: v.word || "",
        sub: v.sub || "",
        cardClass: "is-giver",
        status: v.hint ? `Theme: ${v.hint}` : "",
      };
    },

    guesser(v, meta) {
      buildClock(meta);
      stat(meta, "Got", countText(v));
      return {
        kicker: "You guess",
        word: v.category || "",
        sub: v.sub || "",
        cardClass: "is-guesser",
        status: "Shout your answers out loud — the host marks them.",
      };
    },

    "circle-giver": function circleGiver(v, meta, actions) {
      buildClock(meta);
      stat(meta, "Boxes", countText(v));
      actions.appendChild(actionButton("Got it", "btn-green btn-tap", () => send("correct"), !v.started));
      actions.appendChild(actionButton("Pass", "btn-blue btn-tap", () => send("pass"), !v.started));
      return {
        kicker: "Winner’s Circle · you give examples",
        word: v.circleCategory || "",
        sub: v.sub || "",
        cardClass: "is-giver",
        status: "Examples only. Describing the subject is an illegal clue.",
      };
    },

    "circle-guesser": function circleGuesser(v, meta) {
      buildClock(meta);
      stat(meta, "Boxes", countText(v));
      return {
        kicker: "Winner’s Circle · you name it",
        word: "Name the subject",
        sub: v.sub || "",
        cardClass: "is-guesser",
        status: "Six subjects, one minute.",
      };
    },

    result(v, meta, actions, card) {
      const list = el("ul", "phone-standings");
      (v.standings || []).forEach((row) => {
        const li = el("li");
        li.appendChild(el("span", null, `${row.name} — ${row.points} pts`));
        li.appendChild(el("span", null, row.winnings));
        list.appendChild(li);
      });
      card.appendChild(list);
      return {
        kicker: v.mine ? "Your night" : "Standings",
        word: v.mine || "That’s a wrap",
        sub: v.sub || "",
        cardClass: "is-result",
      };
    },
  };

  function send(result) {
    if (!me) return;
    me.send({ t: "mark", result });
    setText("pyr-phone-status", result === "correct" ? "Sent — got it." : "Sent — pass.");
  }

  /* ============ Rendering ============ */

  function render() {
    const card = $("pyr-phone-card");
    if (!card) return;
    const meta = $("pyr-phone-meta");
    const actions = $("pyr-phone-actions");
    meta.replaceChildren();
    actions.replaceChildren();
    // Anything the previous screen appended straight to the card (the standings
    // list) goes with it: only the fixed children survive a repaint.
    [...card.querySelectorAll(".phone-standings")].forEach((node) => node.remove());
    stopClock();
    const build = SCREENS[view.screen] || SCREENS.wait;
    const spec = build(view, meta, actions, card) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("pyr-phone-kicker", spec.kicker || "");
    setText("pyr-phone-word", spec.word || "");
    setText("pyr-phone-sub", spec.sub || "");
    setText("pyr-phone-status", connected ? (spec.status || "") : "Reconnecting…");
  }

  /* ============ Transport ============ */

  function onMessage(raw) {
    if (!raw || typeof raw !== "object" || raw.t !== "view") return;
    view = raw;
    render();
  }

  function onStatus(up) {
    connected = !!up;
    render();
  }

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || !GSC.mode.endsWith("-player")) return;
    document.body.classList.add("player-mode");
    show($("screen-phone"), true);
    try {
      me = await GSC.player({ onMessage, onStatus });
    } catch (err) {
      setText("pyr-phone-word", "Could not join");
      setText("pyr-phone-sub", err.message);
      return;
    }
    me.send({ t: "ready" });
    setText("pyr-phone-status", "Connected. Waiting for the host…");
    render();
    window.PyrPhone = {
      me, onMessage,
      view: () => view,
      wordText: () => ($("pyr-phone-word") ? $("pyr-phone-word").textContent : ""),
      clockText: () => {
        const cell = document.querySelector(".phone-stat.is-clock .v");
        return cell ? cell.textContent : "";
      },
      action: (label) => [...document.querySelectorAll("#pyr-phone-actions .btn")]
        .find((b) => b.textContent === label) || null,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

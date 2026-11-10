/* ============================================================
   1 vs 100 — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances and
   never learns the right answer — the host only ever sends this
   phone its OWN view (OvhCore.phoneView).

   Every phone that is not the contestant is a Mob member. While
   the answer window is open they see the question and three
   buttons; once they are out they see the "You're out" card and
   nothing else.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;
  let localDeadline = null;   // this phone's own clock + the host's msLeft

  /** The answer-window countdown's repaint interval; ephemeral, never sent. */
  let clockTicker = null;

  const LETTERS = ["A", "B", "C"];
  const CLOCK_TICK_MS = 250;
  const TIMER_BLOCKS = 10;

  /* ============ Small builders ============ */

  function choiceButton(label, letter, options) {
    const btn = el("button", "phone-choice");
    btn.type = "button";
    btn.appendChild(el("span", "phone-letter", letter));
    btn.appendChild(el("span", "phone-choice-text", label));
    if (options.pressed !== undefined) btn.setAttribute("aria-pressed", String(!!options.pressed));
    if (options.disabled) btn.disabled = true;
    if (options.onPick) btn.addEventListener("click", options.onPick);
    return btn;
  }

  function statLine(box, rows) {
    const wrap = el("div", "phone-stats");
    rows.forEach(([k, v]) => {
      const cell = el("div");
      cell.appendChild(el("p", "k", k));
      cell.appendChild(el("p", "v", v));
      wrap.appendChild(cell);
    });
    box.appendChild(wrap);
  }

  /* ============ The answer-window countdown (a cue, nothing more) ============ */

  function stopClock() {
    if (!clockTicker) return;
    clearInterval(clockTicker);
    clockTicker = null;
  }

  /**
   * Repaint the strip and the seconds from the time left the host sent (D12:
   * turned into a deadline on THIS phone's clock when the view arrived). Hitting
   * zero changes nothing at all on the phone: the host closes the window.
   */
  function paintClock(box) {
    const total = Number.isFinite(view.seconds) ? view.seconds : 0;
    const left = Number.isFinite(localDeadline)
      ? Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000)) : total;
    const label = box.querySelector(".phone-clock-label");
    if (label) {
      label.textContent = left > 0
        ? `${left}s left to answer`
        : "Time is up — the host closes the window.";
    }
    const blocks = box.querySelectorAll(".gsc-timer-block");
    const lit = total > 0 ? Math.ceil((left / total) * TIMER_BLOCKS) : 0;
    blocks.forEach((block, i) => block.classList.toggle("is-lit", i < lit));
    const urgent = left > 0 && left <= 5;
    box.classList.toggle("is-urgent", urgent);
    const strip = box.querySelector(".gsc-timer");
    if (strip) strip.classList.toggle("is-urgent", urgent);
  }

  /** A .gsc-timer strip plus a plain seconds line, under the three options. */
  function buildClock(actions) {
    if (!Number.isFinite(localDeadline) || !(view.seconds > 0)) return;
    const box = el("div", "phone-clock");
    const strip = el("div", "gsc-timer");
    strip.setAttribute("aria-hidden", "true");
    for (let i = 0; i < TIMER_BLOCKS; i += 1) strip.appendChild(el("span", "gsc-timer-block"));
    box.appendChild(strip);
    box.appendChild(el("p", "phone-clock-label"));
    actions.appendChild(box);
    paintClock(box);
    clockTicker = setInterval(() => paintClock(box), CLOCK_TICK_MS);
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v, box) {
      statLine(box, [["Bank", v.bank || "—"], ["Mob left", `${v.alive || 0}/${v.mobSize || 0}`]]);
      return {
        kicker: v.seat ? `Mob member ${v.seat}` : "Stand by",
        headline: v.q || "Waiting for the host…",
        sub: v.sub || "Watch the host screen.",
      };
    },

    "mob-answer": function mobAnswer(v, box, actions) {
      (v.options || []).forEach((text, idx) => {
        box.appendChild(choiceButton(text, LETTERS[idx], {
          pressed: v.mine === idx,
          disabled: v.mine !== null && v.mine !== undefined,
          onPick: () => me.send({ t: "mob", idx }),
        }));
      });
      buildClock(actions);
      return {
        kicker: `You are Mob member ${v.seat}`,
        headline: v.q || "",
        sub: v.sub || "",
        status: v.mine === null ? "One answer each. Get it wrong and you're out." : "",
      };
    },

    "mob-eliminated": function eliminated(v, box) {
      statLine(box, [["You went out on", `Q${v.out || 0}`], ["Mob left", `${v.alive || 0}/${v.mobSize || 0}`]]);
      return {
        kicker: `Mob member ${v.seat}`,
        headline: "You're out",
        sub: "Watch the host screen — the bank is still growing.",
        cardClass: "out-card",
      };
    },

    contestant(v, box, actions) {
      (v.options || []).forEach((text, idx) => {
        box.appendChild(choiceButton(text, LETTERS[idx], {
          pressed: v.locked === idx,
          disabled: v.locked !== null && v.locked !== undefined,
          onPick: () => me.send({ t: "lock", idx }),
        }));
      });
      if (Array.isArray(v.poll)) {
        const poll = el("div", "phone-poll");
        poll.appendChild(el("p", "phone-poll-title", "The Mob said"));
        v.poll.forEach((n, idx) => {
          const row = el("p", "phone-poll-row");
          row.appendChild(el("span", "phone-poll-k", LETTERS[idx]));
          row.appendChild(el("span", "phone-poll-v", `${n}`));
          poll.appendChild(row);
        });
        actions.appendChild(poll);
      }
      return {
        kicker: `Playing for ${v.playingFor || ""} a head`,
        headline: v.q || "",
        sub: v.sub || "",
        status: "The host reveals when you have locked in.",
        cardClass: "contestant-card",
      };
    },

    result(v, box) {
      statLine(box, [["Contestant", v.contestant || "—"], ["They leave with", v.won || "—"]]);
      return {
        kicker: v.mine ? "Your game" : "How it ended",
        headline: v.mine ? `You take ${v.mine}` : "Nothing this time",
        sub: v.sub || "",
        cardClass: v.mine ? "winner-card" : "",
      };
    },
  };

  /* ============ Rendering ============ */

  function render() {
    // A host phone shows the host screen; the contestant renderer must never
    // redraw over it (docs/22 §5.3).
    if (window.OvhHostScreen && window.OvhHostScreen.isActive()) return;
    const card = $("ovh-phone-card");
    if (!card) return;
    const box = $("ovh-phone-choices");
    const actions = $("ovh-phone-actions");
    box.replaceChildren();
    actions.replaceChildren();
    stopClock();                           // the answer screen starts a fresh one
    const build = Object.prototype.hasOwnProperty.call(SCREENS, view.screen)
      ? SCREENS[view.screen] : SCREENS.wait;
    const spec = build(view, box, actions) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("ovh-phone-kicker", spec.kicker || "");
    setText("ovh-phone-headline", spec.headline || "");
    setText("ovh-phone-sub", spec.sub || "");
    setText("ovh-phone-status", connected ? (spec.status || "") : "Reconnecting…");
  }

  /* ============ Transport ============ */

  function onMessage(raw) {
    if (!raw || typeof raw !== "object" || raw.t !== "view") return;
    view = raw;
    localDeadline = Number.isFinite(raw.msLeft) ? Date.now() + raw.msLeft : null;
    render();
  }

  function onStatus(up) {
    connected = !!up;
    if (window.OvhHostScreen) window.OvhHostScreen.onStatus(up);
    render();
  }

  function onHostView(v) {
    if (window.OvhHostScreen) window.OvhHostScreen.onHostView(v);
  }

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || !GSC.mode.endsWith("-player")) return;
    document.body.classList.add("player-mode");
    show($("screen-phone"), true);
    try {
      me = await GSC.player({ onMessage, onStatus, onHostView });
      // The role comes from init, never from the URL (that is a layout hint).
      if (window.OvhHostScreen) {
        if (me.role === "host") window.OvhHostScreen.start();
        else window.OvhHostScreen.stop();
      }
    } catch (err) {
      setText("ovh-phone-headline", "Could not join");
      setText("ovh-phone-sub", err.message);
      return;
    }
    if (!(window.OvhHostScreen && window.OvhHostScreen.isActive())) {
      setText("ovh-phone-status", "Connected. Waiting for the host…");
    }
    render();
    window.OvhPhone = {
      me, onMessage, view: () => view,
      clockText: () => {
        const label = document.querySelector(".phone-clock-label");
        return label ? label.textContent : "";
      },
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

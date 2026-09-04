/* ============================================================
   Millionaire — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances and
   never learns the right answer — the host only ever sends this
   phone its OWN view (WwmCore.phoneView).

   Fastest Finger is the one screen with local state: the taps
   build an order on the phone and only the finished order is
   sent, so the host sees one arrival per player.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;

  /** Tap-to-order state for Fastest Finger; reset when the question changes. */
  let fffOrder = [];
  let fffKey = "";

  /** The Ask-the-Audience countdown's repaint interval; ephemeral, never sent. */
  let voteTicker = null;

  const LETTERS = ["A", "B", "C", "D"];

  /* ============ Small builders ============ */

  function choiceButton(label, letter, options) {
    const btn = el("button", "phone-choice");
    btn.type = "button";
    const badge = el("span", options.badgeClass || "phone-letter", letter);
    btn.appendChild(badge);
    btn.appendChild(el("span", "phone-choice-text", label));
    if (options.pressed !== undefined) btn.setAttribute("aria-pressed", String(!!options.pressed));
    if (options.disabled) btn.disabled = true;
    if (options.onPick) btn.addEventListener("click", options.onPick);
    return btn;
  }

  function actionButton(label, className, onClick, disabled) {
    const btn = el("button", `btn ${className}`, label);
    btn.type = "button";
    btn.disabled = !!disabled;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function moneyBlock(box, v) {
    const wrap = el("div", "phone-money");
    const cell = el("div");
    cell.appendChild(el("p", "k", "In the hot seat"));
    cell.appendChild(el("p", "v", v.hotName || "—"));
    wrap.appendChild(cell);
    const cash = el("div");
    cash.appendChild(el("p", "k", "Banked"));
    cash.appendChild(el("p", "v", v.hotMoney || ""));
    wrap.appendChild(cash);
    box.appendChild(wrap);
  }

  /* ============ Ask-the-Audience countdown (a cue, nothing more) ============ */

  const CLOCK_TICK_MS = 250;

  function stopVoteClock() {
    if (!voteTicker) return;
    clearInterval(voteTicker);
    voteTicker = null;
  }

  /**
   * Repaint the strip and the seconds from the deadline the host sent. Hitting
   * zero changes nothing at all: the host still closes the vote, exactly as the
   * host screen behaves (spec 08 §1).
   */
  function paintVoteClock(box) {
    const core = window.WwmCore;
    const total = Number.isFinite(view.seconds) ? view.seconds : 0;
    const left = core ? core.secondsLeft(view.deadline, Date.now()) : 0;
    const label = box.querySelector(".phone-clock-label");
    if (label) label.textContent = left > 0 ? `${left}s left to vote` : "Time is up — the host closes the vote.";
    const blocks = box.querySelectorAll(".gsc-timer-block");
    const tc = window.TimerCore;
    const lit = tc && total > 0 ? tc.litBlocks((total - left) * 1000, total * 1000) : 0;
    const first = (blocks.length - lit) / 2;
    blocks.forEach((block, i) => block.classList.toggle("is-lit", i >= first && i < first + lit));
    const urgent = left > 0 && left <= 5;
    box.classList.toggle("is-urgent", urgent);
    const strip = box.querySelector(".gsc-timer");
    if (strip) strip.classList.toggle("is-urgent", urgent);   // the shared brighter lit style
  }

  /** A .gsc-timer strip plus a plain seconds line, under the ballot. */
  function buildVoteClock(actions) {
    if (!Number.isFinite(view.deadline)) return;
    const box = el("div", "phone-clock");
    const strip = el("div", "gsc-timer");
    strip.setAttribute("aria-hidden", "true");
    const count = (window.TimerCore && window.TimerCore.BLOCKS) || 9;
    for (let i = 0; i < count; i += 1) strip.appendChild(el("span", "gsc-timer-block"));
    box.appendChild(strip);
    box.appendChild(el("p", "phone-clock-label"));
    actions.appendChild(box);
    paintVoteClock(box);
    voteTicker = setInterval(() => paintVoteClock(box), CLOCK_TICK_MS);
  }

  /* ============ Fastest Finger ordering ============ */

  function resetFffIfNew(v) {
    const key = `${v.q || ""}|${(v.options || []).join("|")}`;
    if (key === fffKey) return;
    fffKey = key;
    fffOrder = [];
  }

  function toggleFff(idx) {
    const at = fffOrder.indexOf(idx);
    if (at >= 0) fffOrder.splice(at, 1);
    else if (fffOrder.length < 4) fffOrder.push(idx);
    render();
  }

  function submitFff() {
    if (fffOrder.length !== 4 || !me) return;
    me.send({ t: "fff", order: fffOrder.slice() });
    setText("wwm-phone-status", "Order sent.");
  }

  function buildFff(v, box, actions) {
    resetFffIfNew(v);
    (v.options || []).forEach((text, idx) => {
      const place = fffOrder.indexOf(idx);
      const badge = place >= 0 ? String(place + 1) : "·";
      box.appendChild(choiceButton(text, badge, {
        pressed: place >= 0,
        badgeClass: place >= 0 ? "phone-rank" : "phone-rank phone-rank-empty",
        onPick: () => toggleFff(idx),
      }));
    });
    actions.appendChild(actionButton("Submit my order", "btn-gold btn-tap", submitFff, fffOrder.length !== 4));
    actions.appendChild(actionButton("Start again", "btn-ghost btn-tap", () => { fffOrder = []; render(); }));
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v, box) {
      moneyBlock(box, v);
      return {
        kicker: v.spectator ? "You're watching" : "Stand by",
        headline: v.hotName ? `${v.hotName} is in the hot seat` : "Waiting for the host…",
        sub: v.sub || "Watch the host screen.",
      };
    },

    fff(v, box, actions) {
      buildFff(v, box, actions);
      return {
        kicker: "Fastest Finger First",
        headline: v.q || "",
        sub: "Tap the four in order, then submit. Fastest correct answer takes the hot seat.",
      };
    },

    hotseat(v, box, actions) {
      (v.options || []).forEach((text, idx) => {
        const gone = (v.removed || []).indexOf(idx) >= 0;
        box.appendChild(choiceButton(gone ? "" : text, LETTERS[idx], {
          pressed: v.selected === idx,
          disabled: gone,
          onPick: () => me.send({ t: "answer", idx }),
        }));
      });
      buildLifelineActions(v, actions);
      return {
        kicker: `You are playing for ${v.playingFor || ""}`,
        headline: v.q || "",
        sub: v.request
          ? "Asked the host — wait for them to confirm."
          : "Tap your answer. The host locks it in when you say “final answer”.",
      };
    },

    locked(v) {
      return {
        kicker: "Final answer",
        headline: "Locked in",
        sub: "Look at the host screen.",
        cardClass: "locked-card",
      };
    },

    vote(v, box, actions) {
      (v.options || []).forEach((text, idx) => {
        const gone = (v.removed || []).indexOf(idx) >= 0;
        box.appendChild(choiceButton(gone ? "" : text, LETTERS[idx], {
          pressed: v.myVote === idx,
          disabled: gone || v.myVote !== null,
          onPick: () => me.send({ t: "vote", idx }),
        }));
      });
      buildVoteClock(actions);
      return {
        kicker: "Ask the Audience",
        headline: v.q || "",
        sub: v.myVote === null ? "Tap the answer you think is right." : "Vote counted — thank you.",
        status: v.myVote === null ? "One vote each." : "",
      };
    },

    result(v, box) {
      const list = el("ul", "phone-standings");
      (v.standings || []).forEach((row) => {
        const li = el("li");
        li.appendChild(el("span", null, row.name));
        li.appendChild(el("span", null, row.out ? row.won : "still to play"));
        list.appendChild(li);
      });
      box.appendChild(list);
      return {
        kicker: v.mine ? "Your game" : "Standings",
        headline: v.mine ? `You leave with ${v.mine}` : "How the night is going",
        sub: "",
        cardClass: "winner-card",
      };
    },
  };

  function buildLifelineActions(v, actions) {
    const labels = { fifty: "50:50", phone: "Phone a Friend", audience: "Ask the Audience", switch: "Switch question" };
    Object.keys(labels).forEach((key) => {
      if (!v.lifelines || !v.lifelines[key]) return;
      actions.appendChild(actionButton(`Ask for ${labels[key]}`, "btn-ghost btn-tap",
        () => me.send({ t: "lifeline", which: key }), v.request === key));
    });
    actions.appendChild(actionButton("Ask to walk away", "btn-ghost btn-tap",
      () => me.send({ t: "walk" }), v.request === "walk"));
  }

  /* ============ Rendering ============ */

  function render() {
    const card = $("wwm-phone-card");
    if (!card) return;
    const box = $("wwm-phone-choices");
    const actions = $("wwm-phone-actions");
    box.replaceChildren();
    actions.replaceChildren();
    stopVoteClock();                       // the vote screen starts a fresh one
    const build = SCREENS[view.screen] || SCREENS.wait;
    const spec = build(view, box, actions) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("wwm-phone-kicker", spec.kicker || "");
    setText("wwm-phone-headline", spec.headline || "");
    setText("wwm-phone-sub", spec.sub || "");
    setText("wwm-phone-status", connected ? (spec.status || "") : "Reconnecting…");
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
      setText("wwm-phone-headline", "Could not join");
      setText("wwm-phone-sub", err.message);
      return;
    }
    setText("wwm-phone-status", "Connected. Waiting for the host…");
    render();
    window.WwmPhone = {
      me, onMessage, view: () => view, order: () => fffOrder.slice(),
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

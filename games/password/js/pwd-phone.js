/* ============================================================
   Password — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances, and
   never learns anything the host did not address to it — the
   host only ever sends this phone its OWN view (PwdCore.phoneView).

   Which is the whole trick of this game: the two givers' phones
   are the only surfaces in the room that carry the password. The
   receiver's phone deliberately shows nothing but what the word
   is worth and whose clue it is, so it can be held up, put on the
   table, or glanced at by the whole team without giving anything
   away.
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

  function scoreLine(v) {
    if (!v.teamNames || !v.points) return "";
    return `${v.teamNames[0]} ${v.points[0]} · ${v.teamNames[1]} ${v.points[1]}`;
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
    const left = window.PwdCore ? window.PwdCore.secondsLeft(clock, Date.now()) : 0;
    const label = cell.querySelector(".v");
    if (label) label.textContent = window.PwdClock ? window.PwdClock.format(left * 1000) : String(left);
    cell.classList.toggle("is-urgent", left > 0 && left <= 10);
    cell.classList.toggle("is-done", left <= 0 && !!view.started);
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
      if (v.count) stat(meta, "Got", countText(v));
      else if (v.value !== undefined) stat(meta, "Worth", String(v.value), "is-value");
      return {
        kicker: v.teamName || "Stand by",
        word: v.sub || "Waiting for the host…",
        sub: scoreLine(v),
        cardClass: "is-wait",
      };
    },

    giver(v, meta, actions) {
      stat(meta, "Worth", String(v.value), `is-value${v.yourTurn ? " is-yours" : ""}`);
      stat(meta, "Clues", String(v.clues));
      // Greyed out unless it really is this giver's turn and no clue is out:
      // the reducer refuses the tap anyway, so the button tells the truth.
      actions.appendChild(actionButton("Clue given", "btn-gold btn-tap",
        () => send("clue"), !v.canClue));
      return {
        kicker: `You give · ${v.turnName || ""} to clue`,
        word: v.word || "",
        sub: v.sub || "",
        cardClass: "is-giver",
        status: scoreLine(v),
      };
    },

    receiver(v, meta) {
      stat(meta, "Worth", String(v.value), `is-value${v.yourTurn ? " is-yours" : ""}`);
      stat(meta, "Clues", String(v.clues));
      return {
        kicker: v.yourTurn ? "Your guess" : "Their clue",
        word: v.yourTurn ? "Listen…" : (v.turnName || ""),
        sub: v.sub || "",
        cardClass: "is-receiver",
        status: `${v.yourTurn ? "Say your guess out loud — the host judges it. " : ""}${scoreLine(v)}`,
      };
    },

    "lightning-giver": function lightningGiver(v, meta, actions) {
      buildClock(meta);
      stat(meta, "Got", countText(v));
      stat(meta, "Won", v.moneyText || "");
      actions.appendChild(actionButton("Got it", "btn-green btn-tap btn-half",
        () => send("got"), !v.canMark));
      actions.appendChild(actionButton("Pass", "btn-blue btn-tap btn-half",
        () => send("pass"), !v.canMark));
      return {
        kicker: "Lightning Round · you give",
        word: v.word || "",
        sub: v.sub || "",
        cardClass: "is-giver",
      };
    },

    "lightning-receiver": function lightningReceiver(v, meta) {
      buildClock(meta);
      stat(meta, "Got", countText(v));
      stat(meta, "Won", v.moneyText || "");
      return {
        kicker: "Lightning Round · you guess",
        word: "Say the password",
        sub: v.sub || "",
        cardClass: "is-receiver",
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
        kicker: v.won ? "Your night" : "Standings",
        word: v.mine || "That’s a wrap",
        sub: v.sub || "",
        cardClass: "is-result",
      };
    },
  };

  function send(intent) {
    if (!me) return;
    me.send({ t: intent });
    const said = { clue: "Sent — clue given.", got: "Sent — got it.", pass: "Sent — pass." };
    setText("pwd-phone-status", Object.prototype.hasOwnProperty.call(said, intent) ? said[intent] : "Sent.");
  }

  /* ============ Rendering ============ */

  function render() {
    const card = $("pwd-phone-card");
    if (!card) return;
    const meta = $("pwd-phone-meta");
    const actions = $("pwd-phone-actions");
    meta.replaceChildren();
    actions.replaceChildren();
    // Anything the previous screen appended straight to the card (the standings
    // list) goes with it: only the fixed children survive a repaint.
    [...card.querySelectorAll(".phone-standings")].forEach((node) => node.remove());
    stopClock();
    const build = Object.prototype.hasOwnProperty.call(SCREENS, view.screen)
      ? SCREENS[view.screen] : SCREENS.wait;
    const spec = build(view, meta, actions, card) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("pwd-phone-kicker", spec.kicker || "");
    setText("pwd-phone-word", spec.word || "");
    setText("pwd-phone-sub", spec.sub || "");
    setText("pwd-phone-status", connected ? (spec.status || "") : "Reconnecting…");
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
      setText("pwd-phone-word", "Could not join");
      setText("pwd-phone-sub", err.message);
      return;
    }
    me.send({ t: "ready" });
    setText("pwd-phone-status", "Connected. Waiting for the host…");
    render();
    window.PwdPhone = {
      me, onMessage,
      view: () => view,
      wordText: () => ($("pwd-phone-word") ? $("pwd-phone-word").textContent : ""),
      clockText: () => {
        const cell = document.querySelector(".phone-stat.is-clock .v");
        return cell ? cell.textContent : "";
      },
      action: (label) => [...document.querySelectorAll("#pwd-phone-actions .btn")]
        .find((b) => b.textContent === label) || null,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

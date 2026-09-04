/* ============================================================
   The Price Is Right — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances and
   never learns a price — the host only ever sends this phone its
   OWN view (TpirCore.phoneView).

   The one piece of local state is the number being typed on the
   pad; it is cleared whenever the host sends a different screen.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;

  /** Digits typed on the pad, and the screen they belong to. */
  let typed = "";
  let typedKey = "";

  const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "send"];

  /* ============ Small builders ============ */

  function tapButton(label, className, onClick, disabled) {
    const btn = el("button", `btn ${className}`, label);
    btn.type = "button";
    btn.disabled = !!disabled;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function resetTypedIfNew(key) {
    if (key === typedKey) return;
    typedKey = key;
    typed = "";
  }

  function pressPad(key, max) {
    if (key === "clear") typed = "";
    else if (typed.length < 7) typed = String(Number(`${typed}${key}`));
    if (Number.isFinite(max) && Number(typed) > max) typed = String(max);
    render();
  }

  /** The shared numeric pad: a big read-out, nine digits, clear and send. */
  function numberPad(body, actions, options) {
    const readout = el("p", "phone-amount", options.prefix ? `${options.prefix}${typed || "0"}` : (typed || "0"));
    readout.id = "tpir-phone-amount";
    body.appendChild(readout);
    const pad = el("div", "phone-pad");
    PAD_KEYS.forEach((key) => {
      if (key === "clear") { pad.appendChild(tapButton("Clear", "btn-ghost", () => pressPad("clear"))); return; }
      if (key === "send") {
        pad.appendChild(tapButton(options.action, "btn-gold",
          () => options.onSend(Number(typed)), !typed || Number(typed) < (options.min || 0)));
        return;
      }
      pad.appendChild(tapButton(key, "btn-ghost", () => pressPad(key, options.max)));
    });
    body.appendChild(pad);
    void actions;
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v, body) {
      if (Array.isArray(v.standings)) body.appendChild(standingsList(v));
      return { kicker: v.spectator ? "You're watching" : "Stand by", status: "" };
    },

    bid(v, body, actions) {
      resetTypedIfNew(`bid|${v.headline}`);
      if (v.myBid !== null && v.myBid !== undefined && !typed) typed = String(v.myBid);
      numberPad(body, actions, {
        prefix: v.currency, min: 1, max: 999999, action: "Bid",
        onSend: (amount) => { me.send({ t: "bid", amount }); setText("tpir-phone-status", "Bid sent."); },
      });
      const list = el("ul", "phone-list");
      (v.placed || []).forEach((p) => {
        const li = el("li", p.placed ? "is-placed" : null);
        li.appendChild(el("span", null, p.name));
        li.appendChild(el("span", null, p.placed ? "in" : "thinking"));
        list.appendChild(li);
      });
      body.appendChild(list);
      return { kicker: "Your bid", status: "Nobody sees your bid until the host reveals them." };
    },

    guess(v, body, actions) {
      resetTypedIfNew(`guess|${v.headline}`);
      if (v.kind === "luckyseven") {
        const pad = el("div", "phone-slots");
        for (let d = 0; d <= 9; d += 1) {
          pad.appendChild(tapButton(String(d), "btn-gold", () => sendGuess(d)));
        }
        body.appendChild(pad);
        return { kicker: "Lucky Seven", status: "One digit at a time." };
      }
      numberPad(body, actions, {
        prefix: v.currency, min: v.min || 1, max: v.max || 99, action: "Lock it in",
        onSend: (value) => sendGuess(value),
      });
      return { kicker: "Cliff Hangers", status: v.prompt || "" };
    },

    plinko(v, body, actions) {
      if (v.stage === "answer") {
        const labels = { higher: "Higher", lower: "Lower", correct: "That's right" };
        ["higher", "lower", "correct"].forEach((answer) => {
          actions.appendChild(tapButton(labels[answer], "btn-gold btn-tap",
            () => me.send({ t: "plinko", answer })));
        });
        return { kicker: "Plinko", status: `You have ${v.chips} chip${v.chips === 1 ? "" : "s"}.` };
      }
      const slots = el("div", "phone-slots");
      for (let i = 0; i < (v.slots || 9); i += 1) {
        slots.appendChild(tapButton(String(i + 1), "btn-blue",
          () => me.send({ t: "plinko", slot: i })));
      }
      body.appendChild(slots);
      return { kicker: "Plinko", status: "The board decides where it lands." };
    },

    spin(v, body, actions) {
      actions.appendChild(tapButton("SPIN", "btn-gold phone-spin", () => {
        me.send({ t: "spin" });
        setText("tpir-phone-status", "Spin sent — watch the wheel.");
      }));
      return { kicker: "The big wheel", status: v.total ? `You are on ${v.total}.` : "" };
    },

    "showcase-bid": function showcaseBid(v, body, actions) {
      resetTypedIfNew(`sc|${v.headline}`);
      if (v.myBid !== null && v.myBid !== undefined && !typed) typed = String(v.myBid);
      const prizes = el("ul", "phone-prizes");
      (v.prizes || []).forEach((p) => {
        const li = el("li");
        li.appendChild(el("b", null, p.name));
        if (p.note) li.appendChild(el("small", null, p.note));
        prizes.appendChild(li);
      });
      body.appendChild(prizes);
      numberPad(body, actions, {
        prefix: v.currency, min: 1, max: 999999, action: "Bid",
        onSend: (amount) => { me.send({ t: "bid", amount }); setText("tpir-phone-status", "Bid sent."); },
      });
      return { kicker: "Your showcase", status: "Closest without going over." };
    },

    result(v, body) {
      body.appendChild(standingsList(v));
      return { kicker: "That is the show", status: "" };
    },
  };

  function standingsList(v) {
    const list = el("ul", "phone-list");
    (v.standings || []).forEach((row) => {
      const li = el("li");
      li.appendChild(el("span", null, row.name));
      li.appendChild(el("span", null, row.won));
      list.appendChild(li);
    });
    return list;
  }

  function sendGuess(value) {
    me.send({ t: "guess", value });
    setText("tpir-phone-status", "Sent — watch the host screen.");
  }

  /* ============ Rendering ============ */

  function render() {
    const card = $("tpir-phone-card");
    if (!card) return;
    const body = $("tpir-phone-body");
    const actions = $("tpir-phone-actions");
    body.replaceChildren();
    actions.replaceChildren();
    const build = SCREENS[view.screen] || SCREENS.wait;
    const spec = build(view, body, actions) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("tpir-phone-kicker", spec.kicker || "");
    setText("tpir-phone-headline", view.headline || "Waiting for the host…");
    setText("tpir-phone-sub", view.taken ? "The host has taken the controls for this one." : (view.sub || ""));
    setText("tpir-phone-status", connected ? (spec.status || "") : "Reconnecting…");
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
      setText("tpir-phone-headline", "Could not join");
      setText("tpir-phone-sub", err.message);
      return;
    }
    setText("tpir-phone-status", "Connected. Waiting for the host…");
    render();
    window.TpirPhone = {
      me, onMessage, view: () => view, typed: () => typed,
      press: (key) => pressPad(key, 999999),
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

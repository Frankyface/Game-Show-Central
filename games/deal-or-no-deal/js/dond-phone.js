/* ============================================================
   Deal or No Deal — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances and
   never learns what is inside a sealed case — the host only ever
   sends this phone its OWN view (DondCore.phoneView), and every
   money value in it arrives as text.

   Three things a phone can do: the contestant picks a case, the
   contestant says Deal or No Deal (the host confirms), and
   everybody else votes advice while the vote is open.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;

  /* ============ Small builders ============ */

  /** `onPick` is null when the round's counter has run out: the reducer would
      refuse the tap anyway, so the button reads as dead rather than live. */
  function caseButton(c, onPick) {
    const btn = el("button", "phone-case");
    btn.type = "button";
    const state = c.own ? "own" : (c.opened ? "opened" : "sealed");
    btn.dataset.state = state;
    btn.dataset.n = String(c.n);
    btn.appendChild(el("span", "phone-case-number", c.opened ? c.label : c.n));
    if (c.own) btn.appendChild(el("span", "phone-case-note", "yours"));
    if (c.opened) btn.appendChild(el("span", "phone-case-note", `case ${c.n}`));
    btn.disabled = c.opened || c.own || !onPick;
    btn.setAttribute("aria-label", caseLabel(c));
    if (!btn.disabled) btn.addEventListener("click", () => onPick(c.n));
    return btn;
  }

  function caseLabel(c) {
    if (c.own) return `Case ${c.n}, the one you are keeping`;
    if (c.opened) return `Case ${c.n}, opened, ${c.label}`;
    return `Case ${c.n}, still sealed`;
  }

  function choiceButton(label, kind, options) {
    const btn = el("button", `phone-choice choice-${kind}`, label);
    btn.type = "button";
    btn.dataset.choice = kind === "deal" ? "deal" : "no";
    if (options.pressed !== undefined) btn.setAttribute("aria-pressed", String(!!options.pressed));
    btn.disabled = !!options.disabled;
    if (options.onPick) btn.addEventListener("click", options.onPick);
    return btn;
  }

  /** The offer, big, above whatever the screen is asking for. */
  function offerBlock(box, v) {
    box.appendChild(el("p", "phone-offer-label", "The banker offers"));
    box.appendChild(el("p", "phone-offer", v.offer || ""));
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v) {
      return {
        kicker: v.spectator ? "You're watching" : "Stand by",
        headline: v.hotName ? `${v.hotName} is at the cases` : "Waiting for the host…",
        sub: v.sub || "Watch the host screen.",
      };
    },

    pick(v, box) {
      const live = v.mode === "own" || v.toOpen > 0;
      const onPick = live ? (n) => me.send({ t: "pick", n }) : null;
      const grid = el("div", "phone-cases");
      (v.cases || []).forEach((c) => grid.appendChild(caseButton(c, onPick)));
      box.appendChild(grid);
      return {
        kicker: v.mode === "own" ? "Your case" : `Round ${v.round} of ${v.rounds}`,
        headline: v.mode === "own" ? "Pick the case you keep" : "Open a case",
        sub: v.sub || "",
      };
    },

    decision(v, box, actions) {
      offerBlock(box, v);
      actions.appendChild(choiceButton("Deal", "deal", {
        pressed: v.asked === "deal",
        disabled: v.asked === "deal",
        onPick: () => me.send({ t: "decision", choice: "deal" }),
      }));
      actions.appendChild(choiceButton("No deal", "no", {
        pressed: v.asked === "no",
        disabled: v.asked === "no",
        onPick: () => me.send({ t: "decision", choice: "no" }),
      }));
      return {
        kicker: "The banker is on the phone",
        headline: "Deal or no deal?",
        sub: v.sub || "",
        cardClass: "decision-card",
      };
    },

    advice(v, box, actions) {
      offerBlock(box, v);
      actions.appendChild(choiceButton("Take the deal", "deal", {
        pressed: v.myVote === "deal",
        disabled: v.myVote !== null,
        onPick: () => me.send({ t: "advice", choice: "deal" }),
      }));
      actions.appendChild(choiceButton("No deal!", "no", {
        pressed: v.myVote === "no",
        disabled: v.myVote !== null,
        onPick: () => me.send({ t: "advice", choice: "no" }),
      }));
      return {
        kicker: "What should they do?",
        headline: v.hotName ? `${v.hotName} has an offer` : "There is an offer",
        sub: v.sub || "",
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
        kicker: v.yours ? "Your game" : "Standings",
        headline: v.yours ? `You leave with ${v.yours}` : "How the night is going",
        sub: "",
        cardClass: "winner-card",
      };
    },
  };

  /* ============ Rendering ============ */

  function render() {
    const card = $("dond-phone-card");
    if (!card) return;
    const box = $("dond-phone-choices");
    const actions = $("dond-phone-actions");
    box.replaceChildren();
    actions.replaceChildren();
    const build = SCREENS[view.screen] || SCREENS.wait;
    const spec = build(view, box, actions) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("dond-phone-kicker", spec.kicker || "");
    setText("dond-phone-headline", spec.headline || "");
    setText("dond-phone-sub", spec.sub || "");
    setText("dond-phone-status", connected ? (spec.status || "") : "Reconnecting…");
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
      setText("dond-phone-headline", "Could not join");
      setText("dond-phone-sub", err.message);
      return;
    }
    setText("dond-phone-status", "Connected. Waiting for the host…");
    render();
    window.DondPhone = {
      me, onMessage, view: () => view,
      cases: () => [...document.querySelectorAll("#dond-phone-choices .phone-case")],
      choices: () => [...document.querySelectorAll("#dond-phone-actions .phone-choice")],
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

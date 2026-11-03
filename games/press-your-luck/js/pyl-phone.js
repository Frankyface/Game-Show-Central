/* ============================================================
   Press Your Luck — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances and
   never learns the landing square — the host only ever sends
   this phone its OWN view (PylCore.phoneView), which carries no
   board, no square and no question answer at all.

   Four intents leave this page: buzz, pick, STOP (only for the
   player in control) and pass. Every one of them is validated
   again by the host before it reaches the reducer.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;
  let armedAt = 0;          // when this phone last saw the buzzers open

  /* ============ Small builders ============ */

  function actionButton(label, className, onClick, disabled) {
    const btn = el("button", `btn ${className}`, label);
    btn.type = "button";
    btn.disabled = !!disabled;
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** Name, money and Whammy count — this phone's own standing. */
  function buildMine(actions, v) {
    if (v.seat === null || v.seat === undefined) return;
    const box = el("div", "phone-mine");
    box.appendChild(el("p", "k", v.name || "You"));
    box.appendChild(el("p", "v", v.total || ""));
    box.appendChild(el("p", "w",
      `${v.whammies} ${v.whammies === 1 ? "Whammy" : "Whammies"} · ${v.spins} spin${v.spins === 1 ? "" : "s"}`));
    actions.appendChild(box);
  }

  function buildStandings(actions, v) {
    if (!Array.isArray(v.standings) || !v.standings.length) return;
    const list = el("ul", "phone-standings");
    v.standings.forEach((row) => {
      const li = el("li");
      if (row.winner) li.classList.add("is-winner");
      li.appendChild(el("span", null, row.winner ? `◆ ${row.name}` : row.name));
      li.appendChild(el("span", null, row.out ? "out" : row.money));
      list.appendChild(li);
    });
    actions.appendChild(list);
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v, actions) {
      buildStandings(actions, v);
      buildMine(actions, v);
      return {
        kicker: v.name || "Watching",
        headline: v.q || "Watch the big screen",
        sub: v.sub || "",
      };
    },

    buzz(v, actions) {
      const btn = actionButton("BUZZ", "btn-buzz gsc-btn", () => {
        me.send({ t: "buzz" });
        setText("pyl-phone-status", "In! Answer out loud.");
      }, !v.armed);
      actions.appendChild(btn);
      buildMine(actions, v);
      return {
        kicker: v.name || "You",
        headline: v.q || "",
        sub: v.sub || "",
        cardClass: v.armed ? "is-armed" : "",
      };
    },

    pick(v, actions) {
      const group = el("div", "phone-picks");
      (v.options || []).forEach((text, idx) => {
        const label = `${(v.letters || ["A", "B", "C"])[idx]}  ${text}`;
        const btn = actionButton(label, "btn-pick gsc-btn", () => {
          me.send({ t: "pick", idx });
          setText("pyl-phone-status", "Locked in.");
        });
        if (v.myPick === idx) btn.classList.add("is-on");
        btn.setAttribute("aria-pressed", String(v.myPick === idx));
        group.appendChild(btn);
      });
      actions.appendChild(group);
      buildMine(actions, v);
      return {
        kicker: v.name || "You",
        headline: v.q || "",
        sub: v.sub || "",
        cardClass: "is-mine",
      };
    },

    board(v, actions) {
      if (v.canStop) {
        actions.appendChild(actionButton("STOP", "btn-stop-phone gsc-btn", () => {
          me.send({ t: "stop" });
          setText("pyl-phone-status", "Stopped!");
        }));
      }
      if (v.canPass && Array.isArray(v.passTargets)) {
        const row = el("div", "phone-pass");
        row.appendChild(el("p", "phone-sub", "…or pass your spins to"));
        v.passTargets.forEach((target) => {
          row.appendChild(actionButton(target.name, "btn-ghost gsc-btn gsc-btn-ghost btn-wide",
            () => me.send({ t: "pass", to: target.to })));
        });
        actions.appendChild(row);
      }
      if (v.last) actions.appendChild(el("p", "phone-last", v.last));
      buildMine(actions, v);
      return {
        kicker: v.mine ? `${v.spins} spin${v.spins === 1 ? "" : "s"} left` : (v.name || "Watching"),
        headline: v.mine ? (v.canStop ? "Your turn on the board" : "Your turn is over") : `${v.control} is on the board`,
        sub: v.sub || "",
        cardClass: v.mine ? "is-mine is-board" : "is-board",
      };
    },

    result(v, actions) {
      buildStandings(actions, v);
      return {
        kicker: "That's the game",
        headline: winnerLine(v),
        sub: "",
        cardClass: "is-mine",
      };
    },
  };

  function winnerLine(v) {
    const winners = (v.standings || []).filter((row) => row.winner);
    if (!winners.length) return "Everybody got Whammied";
    if (winners.some((row) => row.name === v.name)) return "You win!";
    return `${winners.map((row) => row.name).join(" and ")} win`;
  }

  /* ============ Rendering ============ */

  function render() {
    const card = $("pyl-phone-card");
    if (!card) return;
    const actions = $("pyl-phone-actions");
    actions.replaceChildren();
    const build = Object.prototype.hasOwnProperty.call(SCREENS, view.screen) ? SCREENS[view.screen] : SCREENS.wait;
    const spec = build(view, actions) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("pyl-phone-kicker", spec.kicker || "");
    setText("pyl-phone-headline", spec.headline || "");
    setText("pyl-phone-sub", spec.sub || "");
    if (!connected) setText("pyl-phone-status", "Reconnecting…");
  }

  /* ============ Transport ============ */

  function onMessage(raw) {
    if (!raw || typeof raw !== "object" || raw.t !== "view") return;
    const wasArmed = view.screen === "buzz" && view.armed;
    view = raw;
    // A fresh arming clears whatever this phone was last told.
    if (view.screen === "buzz" && view.armed && !wasArmed) {
      armedAt = Date.now();
      setText("pyl-phone-status", "");
    }
    if (view.screen === "pick" || view.screen === "wait") setText("pyl-phone-status", "");
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
      setText("pyl-phone-headline", "Could not join");
      setText("pyl-phone-sub", err.message);
      return;
    }
    setText("pyl-phone-status", "Connected. Waiting for the host…");
    render();
    window.PylPhone = {
      me, onMessage,
      view: () => view,
      armedAt: () => armedAt,
      buttons: () => Array.prototype.slice.call(document.querySelectorAll("#pyl-phone-actions .btn")),
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

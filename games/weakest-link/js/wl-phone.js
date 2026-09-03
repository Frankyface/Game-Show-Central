/* ============================================================
   Weakest Link — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent (a vote, or a tie-break choice). It never
   scores, never advances, and never learns anybody else's vote —
   the host only ever sends this phone its OWN view.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;

  /* ============ Rendering ============ */

  function card() { return document.getElementById("wl-phone-card"); }

  function paintMoney(box, v) {
    if (v.bank === undefined && v.total === undefined) return;
    const wrap = el("div", "phone-money");
    [["Round bank", v.bank], ["Team total", v.total]].forEach(([label, amount]) => {
      const cell = el("div");
      cell.appendChild(el("p", "k", label));
      cell.appendChild(el("p", "v", `${v.currency || "$"}${Number(amount || 0).toLocaleString("en-US")}`));
      wrap.appendChild(cell);
    });
    box.appendChild(wrap);
  }

  function choiceButton(choice, pressed, onPick) {
    const btn = el("button", "phone-choice", choice.name);
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(!!pressed));
    btn.addEventListener("click", () => onPick(choice.pid));
    return btn;
  }

  const SCREENS = {
    wait(v) {
      return {
        kicker: `Round ${v.round || 1}`,
        headline: v.myTurn ? "Your question" : (v.turnName ? `${v.turnName}'s turn` : "Waiting…"),
        sub: v.waitingFor ? `${v.waitingFor} is deciding.` : "Listen to the host.",
        money: true,
      };
    },
    vote(v) {
      return {
        kicker: "Secret ballot",
        headline: "Who is the weakest link?",
        sub: v.myVote
          ? "Vote locked — you can change it until the reveal."
          : "Tap a name. Nobody else sees your vote.",
        choices: v.choices || [],
        pressed: v.myVote,
        status: `${v.castCount || 0} of ${v.voterCount || 0} votes are in.`,
        send: (pid) => me.send({ t: "vote", target: pid }),
      };
    },
    tiebreak(v) {
      return {
        kicker: "You were the strongest link",
        headline: "Break the tie",
        sub: "Choose who leaves.",
        choices: v.choices || [],
        send: (pid) => me.send({ t: "tiebreak", target: pid }),
      };
    },
    goodbye() {
      return {
        kicker: "",
        headline: "You are the weakest link",
        sub: "Goodbye.",
        cardClass: "goodbye-card",
      };
    },
    out(v) {
      // `spectator` = this phone joined after the game started, so it never had
      // a seat. It must never be offered a ballot (WlCore.phoneView enforces
      // that); say plainly why the screen is quiet.
      if (v.spectator) {
        return {
          kicker: "You're watching",
          headline: "You joined mid-game",
          sub: "Watch the host screen — you can play from the next game.",
          standings: v.standings || [],
        };
      }
      return { kicker: "You are out", headline: "Watch the rest", standings: v.standings || [] };
    },
    final(v) {
      const line = (v.tally || []).map((r) => `${r.name} ${r.correct}`).join("  ·  ");
      return {
        kicker: "Head to head",
        headline: v.myTurn ? "Your question" : `${v.turnName}'s question`,
        sub: line,
        money: true,
      };
    },
    result(v) {
      return {
        kicker: v.won ? "You win" : "Tonight's winner",
        headline: v.winner || "Game over",
        sub: v.won ? "You are the strongest link." : "",
        cardClass: "winner-card",
        money: true,
      };
    },
  };

  function render() {
    const box = card();
    if (!box) return;
    const build = SCREENS[view.screen] || SCREENS.wait;
    const spec = build(view);
    box.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("wl-phone-kicker", spec.kicker || "");
    setText("wl-phone-headline", spec.headline || "");
    setText("wl-phone-sub", spec.sub || "");

    const choices = document.getElementById("wl-phone-choices");
    choices.replaceChildren();
    (spec.choices || []).forEach((choice) => {
      choices.appendChild(choiceButton(choice, spec.pressed === choice.pid, spec.send));
    });
    if (spec.standings) {
      const list = el("ul", "phone-standings");
      spec.standings.forEach((row) => list.appendChild(el("li", row.out ? "" : "in", row.out ? `${row.name} — out` : row.name)));
      choices.appendChild(list);
    }
    if (spec.money) paintMoney(choices, view);
    setText("wl-phone-status", connected ? (spec.status || "") : "Reconnecting…");
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
    show(document.getElementById("screen-phone"), true);
    try {
      me = await GSC.player({ onMessage, onStatus });
    } catch (err) {
      setText("wl-phone-headline", "Could not join");
      setText("wl-phone-sub", err.message);
      return;
    }
    setText("wl-phone-status", "Connected. Waiting for the host…");
    render();
    window.WlPhone = { me, onMessage, view: () => view };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

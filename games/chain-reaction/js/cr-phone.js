/* ============================================================
   Chain Reaction — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one intent. It never scores, never advances and
   never learns a hidden letter — the host only ever sends this
   phone its OWN masked view (CrCore.phoneView), so an unrevealed
   letter is not in the payload at all.

   Two intents leave this page: which end to build from, and the
   text of a guess. The guess is mirrored to the host screen as it
   is typed and is NEVER judged here.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;

  /** The typed guess, kept locally so a re-render never wipes what is half typed. */
  let guessText = "";
  let guessKey = "";
  let guessTimer = null;

  /** The Speed Chain countdown's repaint interval; ephemeral, never sent. */
  let clockTicker = null;

  const SEND_DELAY_MS = 280;      // one message per pause, not per keystroke
  const CLOCK_TICK_MS = 200;

  /* ============ Small builders ============ */

  /** The view can be the bare `{screen:"wait"}` the page starts with, so every
      read of a team name goes through here rather than indexing blind. */
  function teamName(v, index) {
    const names = Array.isArray(v.teams) ? v.teams : [];
    return index === 0 || index === 1 ? (names[index] || `Team ${index + 1}`) : "";
  }

  function myName(v) {
    return v.team === 0 || v.team === 1 ? teamName(v, v.team) : "You're watching";
  }

  function actionButton(label, className, onClick, disabled) {
    const btn = el("button", `btn ${className}`, label);
    btn.type = "button";
    btn.disabled = !!disabled;
    btn.addEventListener("click", onClick);
    return btn;
  }

  /**
   * The masked column, exactly as the host sent it: one row per word, each row
   * a grid of `row.len` letter tiles. The longest word in the chain sets one
   * tile size for the whole column (`--cr-cols`), so the rows stack like the
   * show's board instead of each stretching to the full width (docs/19 §3).
   */
  function buildColumn(box, rows) {
    box.replaceChildren();
    const list = rows || [];
    const widest = list.reduce((max, row) => Math.max(max, row.len || 0), 0);
    box.style.setProperty("--cr-cols", String(Math.max(2, widest)));
    list.forEach((row) => {
      const li = el("li", "row");
      const tiles = el("div", "row-tiles");
      tiles.style.setProperty("--len", String(row.len));
      row.cells.forEach((cell) => {
        const tile = el("span", "tile", cell.ch === null ? "" : cell.ch);
        if (cell.ch !== null) tile.classList.add("is-lit");
        if (!cell.letter) tile.classList.add("is-punct");
        tiles.appendChild(tile);
      });
      li.appendChild(tiles);
      if (row.solved) li.classList.add("is-solved");
      if (row.owner === 0 || row.owner === 1) li.classList.add(`owner-${row.owner}`);
      if (row.eligible) li.classList.add("is-eligible");
      if (row.target) li.classList.add("is-target");
      if (row.current) li.classList.add("is-current");
      li.setAttribute("aria-label", row.solved
        ? "solved"
        : `${row.shown} of ${row.cells.filter((c) => c.letter).length} letters showing`);
      box.appendChild(li);
    });
  }

  function buildScores(actions, v) {
    if (!Array.isArray(v.teams) || !v.teams.length) return;
    const wrap = el("div", "phone-scores");
    v.teams.forEach((name, i) => {
      const cell = el("div", `team-${i}${v.control === i ? " is-control" : ""}`);
      cell.appendChild(el("p", "k", v.control === i ? `${name} ▶` : name));
      cell.appendChild(el("p", "v", `${v.currency || "$"}${Number((v.scores || [])[i] || 0).toLocaleString("en-US")}`));
      wrap.appendChild(cell);
    });
    actions.appendChild(wrap);
  }

  /* ============ The guess field ============ */

  function sendGuess(now) {
    if (!me) return;
    if (guessTimer) { clearTimeout(guessTimer); guessTimer = null; }
    const fire = () => {
      guessTimer = null;
      me.send({ t: "guess", text: guessText });
      setText("cr-phone-status", guessText ? "The host can see your guess." : "");
    };
    if (now) fire();
    else guessTimer = setTimeout(fire, SEND_DELAY_MS);
  }

  /** A new word to guess clears whatever was typed for the last one. */
  function resetGuessIfNew(v) {
    const key = `${v.chainNo}|${(v.column || []).map((r) => r.shown).join("")}|${v.screen}`;
    if (v.canPick) { guessKey = key; guessText = ""; return; }
    if (key === guessKey) return;
    guessKey = key;
    if (!v.guess) guessText = "";
  }

  function buildGuessForm(actions) {
    const form = el("form", "phone-guess");
    const label = el("label", "phone-sub", "Your guess");
    label.setAttribute("for", "cr-phone-guess");
    const field = el("input");
    field.type = "text";
    field.id = "cr-phone-guess";
    field.maxLength = 24;
    field.autocomplete = "off";
    field.spellcheck = false;
    field.placeholder = "Say it out loud too";
    field.value = guessText;
    field.addEventListener("input", (e) => { guessText = e.target.value; sendGuess(false); });
    const send = el("button", "btn btn-gold gsc-btn gsc-btn-primary btn-wide", "Send it to the host");
    send.type = "submit";
    form.addEventListener("submit", (e) => { e.preventDefault(); sendGuess(true); });
    form.appendChild(label);
    form.appendChild(field);
    form.appendChild(send);
    actions.appendChild(form);
  }

  /* ============ The Speed Chain clock ============ */

  function stopClock() {
    if (!clockTicker) return;
    clearInterval(clockTicker);
    clockTicker = null;
  }

  /**
   * Repaint from the deadline the host sent. Hitting zero changes nothing at
   * all here: the host's own clock ends the round (spec 14 §1).
   */
  function paintClock(node) {
    const core = window.CrCore;
    // Not running: 0 once the round is over ("Time!" must not show the round
    // length again), otherwise whatever the host says is left.
    const fallback = view.over ? 0 : (Number.isFinite(view.remaining) ? view.remaining : view.seconds);
    const left = Number.isFinite(view.deadline) && core ? core.secondsLeft(view.deadline, Date.now()) : fallback;
    node.textContent = String(left);
    node.classList.toggle("danger", Number.isFinite(view.deadline) && left > 0 && left <= 10);
    node.classList.toggle("done", Number.isFinite(view.deadline) && left <= 0);
  }

  function buildClock(box) {
    const node = el("p", "phone-clock");
    node.setAttribute("role", "timer");
    box.appendChild(node);
    paintClock(node);
    // A disconnected phone cannot know whether the host still has the clock
    // running, so it freezes on the last number it was told rather than
    // counting down against a deadline that may already have been paused.
    if (Number.isFinite(view.deadline) && connected) {
      clockTicker = setInterval(() => paintClock(node), CLOCK_TICK_MS);
    }
  }

  /* ============ Screens ============ */

  const SCREENS = {
    wait(v, box, actions) {
      buildColumn(box, v.column);
      buildScores(actions, v);
      return {
        kicker: myName(v),
        headline: "Watch the big screen",
        sub: v.sub || "",
      };
    },

    watch(v, box, actions) {
      buildColumn(box, v.column);
      if (v.sudden) actions.appendChild(el("p", "phone-neighbour", `${v.sudden.before} … ${v.sudden.after}`));
      buildScores(actions, v);
      return {
        kicker: myName(v),
        headline: `${teamName(v, v.control)} have control`,
        sub: v.sub || "",
      };
    },

    control(v, box, actions) {
      buildColumn(box, v.column);
      if (v.sudden) actions.appendChild(el("p", "phone-neighbour", `${v.sudden.before} … ${v.sudden.after}`));
      if (v.canPick) {
        actions.appendChild(actionButton("Build from the top", "btn-blue gsc-btn gsc-btn-primary",
          () => me.send({ t: "direction", dir: "top" }), !v.dirs.top));
        actions.appendChild(actionButton("Build from the bottom", "btn-blue gsc-btn gsc-btn-primary",
          () => me.send({ t: "direction", dir: "bottom" }), !v.dirs.bottom));
      } else {
        buildGuessForm(actions);
      }
      buildScores(actions, v);
      return {
        kicker: `You're up — ${v.value || ""} a word`,
        headline: v.canPick ? "Which end?" : "What's the word?",
        sub: v.sub || "",
        cardClass: "is-mine",
      };
    },

    speed(v, box, actions) {
      buildColumn(box, v.column);
      buildClock(actions);
      if (v.canPass) {
        actions.appendChild(actionButton("Pass — come back to it", "btn-ghost gsc-btn gsc-btn-ghost btn-wide",
          () => me.send({ t: "speed", result: "pass" })));
      }
      buildScores(actions, v);
      return {
        kicker: v.mine ? "Your Speed Chain" : "Speed Chain",
        headline: v.over ? `Banked ${v.award}` : (v.mine ? "Call them out in order" : "Watch the big screen"),
        sub: v.sub || "",
        cardClass: v.mine ? "is-speed is-mine" : "is-speed",
      };
    },

    result(v, box, actions) {
      const list = el("ul", "phone-standings");
      (v.standings || []).forEach((row) => {
        const li = el("li");
        li.appendChild(el("span", null, row.winner ? `◆ ${row.name}` : row.name));
        li.appendChild(el("span", null, row.money));
        list.appendChild(li);
      });
      actions.appendChild(list);
      return {
        kicker: "That's the game",
        headline: winnerLine(v),
        sub: "",
        cardClass: "is-mine",
      };
    },
  };

  function winnerLine(v) {
    const winner = (v.standings || []).find((row) => row.winner);
    if (!winner) return "It ends level";
    return teamName(v, v.team) === winner.name ? "You win!" : `${winner.name} win`;
  }

  /* ============ Rendering ============ */

  function render() {
    const card = $("cr-phone-card");
    if (!card) return;
    const box = $("cr-phone-column");
    const actions = $("cr-phone-actions");
    box.replaceChildren();
    actions.replaceChildren();
    stopClock();                       // the speed screen starts a fresh one
    const build = Object.prototype.hasOwnProperty.call(SCREENS, view.screen) ? SCREENS[view.screen] : SCREENS.wait;
    const spec = build(view, box, actions) || {};
    card.className = `phone-card ${spec.cardClass || ""}`.trim();
    setText("cr-phone-kicker", spec.kicker || "");
    setText("cr-phone-headline", spec.headline || "");
    setText("cr-phone-sub", spec.sub || "");
    if (!connected) setText("cr-phone-status", "Reconnecting…");
  }

  /* ============ Transport ============ */

  function onMessage(raw) {
    if (!raw || typeof raw !== "object" || raw.t !== "view") return;
    view = raw;
    resetGuessIfNew(view);
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
      setText("cr-phone-headline", "Could not join");
      setText("cr-phone-sub", err.message);
      return;
    }
    setText("cr-phone-status", "Connected. Waiting for the host…");
    render();
    window.CrPhone = {
      me, onMessage,
      view: () => view,
      guess: () => guessText,
      clockText: () => {
        const node = document.querySelector(".phone-clock");
        return node ? node.textContent : "";
      },
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

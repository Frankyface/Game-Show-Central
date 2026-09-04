/* ============================================================
   The Price Is Right — the three pricing-game stages
   Cliff Hangers (a climber that steps one rung per dollar of
   error), Plinko (a nine-slot board with a chip that follows the
   bounce path the core already rolled) and Lucky Seven (five
   digit tiles and a wallet of one-dollar bills).

   DOM only. Nothing here decides anything: the landing slot, the
   climb and the wallet all come out of TpirCore; this file draws
   what already happened and animates the journey.
   Exported as window.TpirGames.
   ============================================================ */

"use strict";

const TpirGames = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const core = () => window.TpirCore;

  /* Plinko board geometry (viewBox units). */
  const BW = 460;
  const BH = 336;
  const PAD = 6;
  const COL = (BW - PAD * 2) / 9;
  const ROWS = 12;
  const Y_TOP = 30;
  const Y_MOUTH = 292;
  const DROP_MS = 1800;

  const built = { stage: "", controls: "" };
  let dropping = false;

  const svgEl = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  };

  const colX = (pos) => PAD + (pos + 0.5) * COL;
  const rowY = (k) => Y_TOP + (k * (Y_MOUTH - Y_TOP)) / ROWS;

  /* ============ Entry points ============ */

  function render(app) {
    const state = app.core;
    const g = state.game;
    const stage = $("tpir-game-stage");
    const controls = $("tpir-game-controls");
    if (!g.kind || g.pending) {
      built.stage = "";
      built.controls = "";
      stage.replaceChildren();
      controls.replaceChildren();
      return;
    }
    const stageSig = `${g.kind}|${g.setIndex}|${g.stage || ""}`;
    if (built.stage !== stageSig) {
      built.stage = stageSig;
      stage.replaceChildren();
      STAGES[g.kind].build(state, stage);
    }
    STAGES[g.kind].paint(state, stage);
    renderControls(app, controls);
  }

  function renderControls(app, controls) {
    const state = app.core;
    const g = state.game;
    const phone = window.TpirApp.hasPhone(g.pid) && !window.TpirApp.isTakenOver(g.pid);
    const sig = [g.kind, g.setIndex, g.index, g.stage, g.dropped, g.done, phone].join("|");
    if (built.controls === sig) return;
    built.controls = sig;
    controls.replaceChildren();
    if (g.done) return;
    STAGES[g.kind].controls(state, controls, phone);
    if (phone) {
      controls.appendChild(TpirView.button("Take over", "btn btn-ghost",
        () => window.TpirApp.takeOver(g.pid)));
    }
  }

  /** A number field plus its button, for a host typing what a player calls out. */
  function entry(label, options, onSubmit) {
    const wrap = el("label", "guess-field");
    wrap.appendChild(el("span", "bid-name", label));
    const input = el("input", "bid-input");
    input.type = "number";
    input.id = options.id || "tpir-guess-input";
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = "1";
    input.inputMode = "numeric";
    input.disabled = !!options.disabled;
    wrap.appendChild(input);
    const send = TpirView.button(options.action || "Lock it in", "btn btn-gold", () => onSubmit(input));
    send.disabled = !!options.disabled;
    send.id = options.buttonId || "btn-guess";
    wrap.appendChild(send);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(input); } });
    return wrap;
  }

  /* ============ Cliff Hangers ============ */

  const cliff = {
    build(state, stage) {
      const wrap = el("div", "cliff");
      const mountain = el("div", "cliff-mountain");
      mountain.appendChild(el("div", "cliff-slope"));
      const rungs = el("div", "cliff-rungs");
      for (let i = 0; i <= core().CLIFF_STEPS; i += 1) {
        const rung = el("i", "cliff-rung");
        rung.style.setProperty("--p", String(i / core().CLIFF_STEPS));
        if (i === core().CLIFF_STEPS) rung.classList.add("is-edge");
        rungs.appendChild(rung);
      }
      mountain.appendChild(rungs);
      const climber = el("div", "cliff-climber");
      climber.id = "tpir-climber";
      climber.appendChild(el("span", "cliff-climber-icon", "🧗"));
      climber.appendChild(el("span", "cliff-climber-steps", "0"));
      mountain.appendChild(climber);
      mountain.appendChild(el("p", "cliff-edge-label", "The edge — 25 steps"));
      wrap.appendChild(mountain);
      const items = el("ol", "cliff-items");
      items.id = "tpir-cliff-items";
      wrap.appendChild(items);
      const prize = el("p", "cliff-prize");
      prize.id = "tpir-cliff-prize";
      wrap.appendChild(prize);
      stage.appendChild(wrap);
    },

    paint(state, stage) {
      const g = state.game;
      const climber = stage.querySelector("#tpir-climber");
      climber.style.setProperty("--p", String(Math.min(1, g.steps / core().CLIFF_STEPS)));
      climber.classList.toggle("is-fallen", !!g.done && !g.won);
      climber.classList.toggle("is-safe", !!g.won);
      climber.querySelector(".cliff-climber-steps").textContent = `${g.steps}`;
      const list = stage.querySelector("#tpir-cliff-items");
      list.replaceChildren();
      g.items.forEach((item, i) => list.appendChild(cliffItem(state, g, item, i)));
      setText("tpir-cliff-prize", `Playing for ${g.prize.name} — ${core().formatMoney(state, g.prize.price)}`);
    },

    controls(state, controls, phone) {
      const g = state.game;
      const item = g.items[g.index];
      // The app reads the field itself so an empty or out-of-range box gets a
      // plain-English message instead of a silently ignored `chGuess` (D6).
      controls.appendChild(entry(item ? `${item.name} — your price` : "Your price",
        { min: 1, max: 99, disabled: phone, action: "Lock the price" },
        () => window.TpirApp.submitGuess("#tpir-guess-input", { min: 1, max: 99 })));
    },
  };

  function cliffItem(state, g, item, i) {
    const guessed = i < g.guesses.length;
    const li = el("li", `cliff-item${guessed ? " is-done" : ""}${i === g.index && !g.done ? " is-current" : ""}`);
    li.dataset.index = String(i);
    li.appendChild(el("span", "cliff-item-name", item.name));
    if (!guessed) {
      li.appendChild(el("span", "cliff-item-value", "?"));
      li.appendChild(el("span", "cliff-item-note", ""));
      return li;
    }
    const err = core().cliffError(g.guesses[i], item.price);
    li.appendChild(el("span", "cliff-item-value", core().formatMoney(state, item.price)));
    li.appendChild(el("span", "cliff-item-note",
      `guessed ${core().formatMoney(state, g.guesses[i])} · ${err} step${err === 1 ? "" : "s"}`));
    return li;
  }

  /* ============ Plinko ============ */

  const plinko = {
    build(state, stage) {
      const wrap = el("div", "plinko");
      const head = el("div", "plinko-head");
      head.id = "tpir-plinko-head";
      wrap.appendChild(head);
      const svg = svgEl("svg", { viewBox: `0 0 ${BW} ${BH}`, class: "plinko-board", role: "img" });
      svg.id = "tpir-plinko-board";
      svg.setAttribute("aria-label", "The Plinko board: nine slots");
      buildBoard(state, svg);
      const board = el("div", "plinko-board-wrap");
      board.appendChild(svg);
      board.appendChild(buildValues(state));
      wrap.appendChild(board);
      stage.appendChild(wrap);
    },

    paint(state, stage) {
      const g = state.game;
      const head = stage.querySelector("#tpir-plinko-head");
      head.replaceChildren();
      head.appendChild(chipCounter(g));
      if (g.stage === "answers") head.appendChild(smallPriceCard(state, g));
      else head.appendChild(dropSummary(state, g));
      paintResting(state, stage.querySelector("#tpir-plinko-board"));
    },

    controls(state, controls, phone) {
      const g = state.game;
      if (g.stage === "answers") {
        const labels = { higher: "Higher", lower: "Lower", correct: "That's right" };
        core().PLINKO_ANSWERS.forEach((answer) => {
          const b = TpirView.button(labels[answer], "btn btn-gold btn-big plinko-answer",
            () => window.TpirApp.dispatch({ type: "plinkoAnswer", i: g.index, answer }));
          b.dataset.answer = answer;
          b.disabled = phone;
          controls.appendChild(b);
        });
        return;
      }
      const box = el("div", "plinko-slots");
      for (let i = 0; i < core().PLINKO_SLOTS; i += 1) {
        const b = TpirView.button(String(i + 1), "btn btn-blue btn-big plinko-slot",
          () => window.TpirApp.dropChip(i));
        b.dataset.slot = String(i);
        b.disabled = phone;
        box.appendChild(b);
      }
      controls.appendChild(el("p", "gsc-eyebrow", "Drop the chip from…"));
      controls.appendChild(box);
    },
  };

  function buildBoard(state, svg) {
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: BW, height: BH, rx: 16, fill: "#12070f" }));
    const pegs = svgEl("g", { class: "plinko-pegs" });
    for (let r = 0; r < ROWS; r += 1) {
      const offset = r % 2 === 0 ? 0 : 0.5;
      for (let c = 0; c <= 9; c += 1) {
        const pos = c + offset;
        if (pos < 0 || pos > 8.5) continue;
        pegs.appendChild(svgEl("circle", { cx: colX(pos).toFixed(1), cy: rowY(r + 0.5).toFixed(1), r: 3.4, fill: "#ffd9a0" }));
      }
    }
    svg.appendChild(pegs);
    svg.appendChild(buildSlots(state));
    const chip = svgEl("circle", { cx: colX(4).toFixed(1), cy: Y_TOP, r: 12, class: "plinko-chip", opacity: 0 });
    chip.id = "tpir-plinko-chip";
    svg.appendChild(chip);
    svg.appendChild(svgEl("g", { class: "plinko-resting", id: "tpir-plinko-resting" }));
  }

  /** The nine mouths at the foot of the board. The values are HTML chips under
      the board (buildValues) so CSS can size them; SVG text cannot wrap. */
  function buildSlots(state) {
    const slots = state.content.settings.plinko.slots;
    const g = svgEl("g", { class: "plinko-slot-row" });
    slots.forEach((value, i) => {
      const x = PAD + i * COL;
      g.appendChild(svgEl("rect", {
        x: (x + 2).toFixed(1), y: Y_MOUTH, width: (COL - 4).toFixed(1), height: BH - Y_MOUTH - 4, rx: 6,
        fill: slotFill(value), stroke: "#ffd23f", "stroke-width": 2,
      }));
    });
    return g;
  }

  const slotFill = (value) => (value >= 10000 ? "#e63946" : (value === 0 ? "#241426" : "#1d6fdc"));

  /** One readable chip per slot, in a nine-column grid under the board. */
  function buildValues(state) {
    const box = el("div", "plinko-values");
    state.content.settings.plinko.slots.forEach((value, i) => {
      const chip = el("span", `plinko-value${value === 0 ? " is-zero" : ""}${value >= 10000 ? " is-top" : ""}`);
      chip.dataset.slot = String(i);
      chip.appendChild(el("b", null, core().money(state.content.settings.currency, value)));
      chip.appendChild(el("small", null, String(i + 1)));
      box.appendChild(chip);
    });
    return box;
  }

  function chipCounter(g) {
    const box = el("div", "chip-counter");
    box.appendChild(el("span", "gsc-eyebrow", "Chips"));
    const row = el("div", "chip-row");
    for (let i = 0; i < g.chips; i += 1) {
      row.appendChild(el("i", `chip-dot${i < g.dropped ? " is-spent" : ""}`));
    }
    box.appendChild(row);
    box.appendChild(el("span", "chip-count", `${g.chips - g.dropped} of ${g.chips} left`));
    return box;
  }

  function smallPriceCard(state, g) {
    const price = g.prices[g.index];
    const card = el("div", "small-price");
    card.appendChild(el("p", "gsc-eyebrow", `Small price ${g.index + 1} of ${core().PLINKO_PRICES}`));
    card.appendChild(el("p", "small-price-name", price ? price.name : ""));
    card.appendChild(el("p", "small-price-value", price ? core().money(state.content.settings.currency, price.shown) : ""));
    card.appendChild(el("p", "small-price-ask", "Is that the right price?"));
    return card;
  }

  function dropSummary(state, g) {
    const box = el("div", "small-price");
    box.appendChild(el("p", "gsc-eyebrow", "Plinko"));
    box.appendChild(el("p", "small-price-name", `Banked ${core().formatMoney(state, g.total)}`));
    box.appendChild(el("p", "small-price-ask", g.done
      ? "That is every chip."
      : `Chip ${g.dropped + 1} of ${g.chips} — pick a slot.`));
    return box;
  }

  /** The chips that have already landed, stacked in their slots. The chip that
      is still falling is left out until its animation puts it there. */
  function paintResting(state, svg) {
    const box = svg.querySelector("#tpir-plinko-resting");
    box.replaceChildren();
    const counts = {};
    const drops = dropping ? state.game.drops.slice(0, -1) : state.game.drops;
    drops.forEach((drop) => {
      const n = counts[drop.landing] || 0;
      counts[drop.landing] = n + 1;
      box.appendChild(svgEl("circle", {
        cx: colX(drop.landing).toFixed(1), cy: (BH - 14 - n * 8).toFixed(1), r: 6.5,
        fill: "#ffd23f", stroke: "#1a0d05", "stroke-width": 2,
      }));
    });
  }

  /** Rest the chip in its slot and take it off the board. */
  function landChip(chip, drop) {
    chip.setAttribute("cx", colX(drop.landing).toFixed(1));
    chip.setAttribute("cy", String(BH - 16));
    chip.setAttribute("opacity", "0");
  }

  /**
   * Walk the chip down the path the CORE rolled, then into the slot.
   * `after.game.lastDrop.path` is authoritative — this only replays it.
   */
  function animateDrop(after, done) {
    const drop = after.game.lastDrop;
    const chip = document.getElementById("tpir-plinko-chip");
    if (!drop || !chip) { dropping = false; done(); return; }
    const steps = drop.path.length;
    if (window.TpirWheel.prefersReducedMotion()) {
      landChip(chip, drop);
      dropping = false;
      done();
      return;
    }
    chip.setAttribute("opacity", "1");
    const start = performance.now();
    let lastRow = -1;
    let frame = 0;
    let guard = 0;
    let finished = false;

    /** Land the chip and hand the host back. Idempotent: both the last frame
        and the wall-clock guard below can call it. */
    function finish() {
      if (finished) return;
      finished = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(guard);
      landChip(chip, drop);
      window.TpirSound.play(drop.value > 0 ? "land" : "dud");
      dropping = false;
      done();
    }

    const tick = (now) => {
      if (finished) return;
      const t = Math.min((now - start) / DROP_MS, 1);
      if (t >= 1) { finish(); return; }
      const at = t * (steps - 1);
      const k = Math.min(Math.floor(at), steps - 2);
      const frac = at - k;
      const pos = drop.path[k] + (drop.path[k + 1] - drop.path[k]) * frac;
      chip.setAttribute("cx", colX(pos).toFixed(1));
      chip.setAttribute("cy", (rowY(k + frac)).toFixed(1));
      if (k !== lastRow) { lastRow = k; window.TpirSound.play("tick"); }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    // A hidden or backgrounded tab stops firing rAF. Without this the chip
    // would never land and the host would be locked out of their own show.
    guard = window.setTimeout(finish, DROP_MS + 900);
  }

  /* ============ Lucky Seven ============ */

  const luckySeven = {
    build(state, stage) {
      const wrap = el("div", "l7");
      const car = el("p", "l7-car");
      car.id = "tpir-l7-car";
      wrap.appendChild(car);
      const tiles = el("div", "l7-tiles");
      tiles.id = "tpir-l7-tiles";
      wrap.appendChild(tiles);
      const wallet = el("div", "l7-wallet");
      wallet.id = "tpir-l7-wallet";
      wallet.setAttribute("aria-label", "Dollars left");
      wrap.appendChild(wallet);
      const note = el("p", "l7-note");
      note.id = "tpir-l7-note";
      wrap.appendChild(note);
      stage.appendChild(wrap);
    },

    paint(state, stage) {
      const g = state.game;
      setText("tpir-l7-car", `${g.car}${g.note ? ` — ${g.note}` : ""}`);
      const tiles = stage.querySelector("#tpir-l7-tiles");
      tiles.replaceChildren();
      for (let i = 0; i < core().L7_DIGITS; i += 1) tiles.appendChild(l7Tile(g, i));
      const wallet = stage.querySelector("#tpir-l7-wallet");
      wallet.replaceChildren();
      for (let i = 0; i < core().L7_START; i += 1) {
        wallet.appendChild(el("i", `l7-bill${i < g.wallet ? "" : " is-spent"}`, "$1"));
      }
      setText("tpir-l7-note", g.done
        ? (g.won ? "Enough left over — the car is theirs." : "Out of dollars.")
        : `${g.wallet} dollar${g.wallet === 1 ? "" : "s"} left — the last digit must leave at least one.`);
    },

    controls(state, controls, phone) {
      const box = el("div", "l7-pad");
      for (let d = 0; d <= 9; d += 1) {
        const b = TpirView.button(String(d), "btn btn-gold btn-big l7-key",
          () => window.TpirApp.dispatch({ type: "l7Guess", digit: d }));
        b.dataset.digit = String(d);
        b.disabled = phone;
        box.appendChild(b);
      }
      controls.appendChild(el("p", "gsc-eyebrow", `Digit ${state.game.index + 1}`));
      controls.appendChild(box);
    },
  };

  function l7Tile(g, i) {
    const known = i < g.revealedDigits.length;
    const tile = el("div", `l7-tile${known ? " is-known" : ""}${i === g.index && !g.done ? " is-current" : ""}`);
    tile.dataset.index = String(i);
    tile.appendChild(el("span", "l7-digit", known ? String(g.revealedDigits[i]) : "?"));
    const cost = i > 0 && i - 1 < g.guesses.length
      ? Math.abs(g.guesses[i - 1] - g.revealedDigits[i]) : null;
    tile.appendChild(el("span", "l7-cost", i === 0 ? "given" : (cost === null ? "" : `cost $${cost}`)));
    return tile;
  }

  const STAGES = { cliffhangers: cliff, plinko: plinko, luckyseven: luckySeven };

  /** The one animation the host must wait for. Everything else paints at once. */
  function animate(event, before, after, done) {
    if (event.type === "plinkoDrop" && after.game && after.game.lastDrop) {
      animateDrop(after, done);
      return true;
    }
    return false;
  }

  /** Claim the falling chip BEFORE the state lands, so it is not drawn twice. */
  function beginDrop() { dropping = true; }

  return {
    render, animate, beginDrop,
    reset: () => { built.stage = ""; built.controls = ""; dropping = false; },
  };
})();

window.TpirGames = TpirGames;

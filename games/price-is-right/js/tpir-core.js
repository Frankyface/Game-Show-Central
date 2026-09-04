/* ============================================================
   The Price Is Right — pure game core
   The immutable reducer for a whole episode: Contestants' Row,
   the three pricing games, the Showcase Showdown and the
   Showcase. No DOM, no network, no timers; every random choice
   takes an injected `rng`, so the wheel, the Plinko bounce and
   the content draw are all reproducible in Node.

   Content rules live in tpir-content.js and every selector in
   tpir-select.js; both are re-exported here so callers only ever
   need TpirCore. Reducers never mutate their inputs.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./tpir-content.js") : root.TpirContent;
  const select = node ? require("./tpir-select.js") : root.TpirSelect;
  const api = factory(content, select);
  if (node) module.exports = api;
  root.TpirCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content, Select) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, fail, pickIndex, money,
    validateGame, normalizeGame, normalizeSettings, warningsFor, drawFrom,
    GAME_KINDS, GAME_LABELS, DEFAULT_SETTINGS, MAX_BID, MAX_PRICE,
    CLIFF_STEPS, CLIFF_ITEMS, PLINKO_SLOTS, PLINKO_PRICES, L7_DIGITS, L7_START,
    ROW_SEATS, MAX_PLAYERS, PLAYER_NAME_MAX, PID_MAX,
  } = Content;

  const {
    plan, rowWinner, cliffError, cliffClimb, plinkoTruth, plinkoPath,
    l7Digits, l7Cost, showdownWinner, showcaseResult, PLINKO_ANSWERS, WHEEL_TARGET,
    formatMoney, wheelLabel, nameOf, isPlayer, winningsOf, standings,
    currentSegment, activePid, rowSeats, validatePhoneMsg, phoneView, settingsOf,
  } = Select;

  const PHASES = Object.freeze(["setup", "row", "game", "showdown", "showcase", "standings"]);
  const MAX_HISTORY = 60;

  /* ============ State construction ============ */

  function normalizePlayers(players) {
    if (!Array.isArray(players)) fail("The player list is missing.");
    const seen = new Set();
    const out = [];
    players.forEach((p) => {
      if (!isPlainObject(p)) return;
      const pid = cleanText(p.pid, PID_MAX);
      const name = cleanText(p.name, PLAYER_NAME_MAX);
      if (!pid || !name || seen.has(pid)) return;
      seen.add(pid);
      out.push({ pid, name });
    });
    if (!out.length) fail("The Price Is Right needs at least one player.");
    if (out.length > MAX_PLAYERS) fail(`The Price Is Right takes at most ${MAX_PLAYERS} players.`);
    return out;
  }

  const blankRow = () => ({
    itemIndex: -1, item: null, seats: [], queue: [], bids: {}, order: [],
    revealed: false, result: null, allOver: false, rebids: 0,
  });

  const blankGame = () => ({ kind: null, pid: null, pending: true, done: false, won: false, award: 0 });

  const blankShowdown = () => ({
    spinners: [], current: 0, spins: {}, totals: {}, awaiting: "spin",
    round: 1, spinoff: false, winner: null, tie: [], lastSpin: null,
  });

  const blankShowcase = () => ({
    finalists: [], chooser: null, pair: [], assignments: {}, chosen: false,
    passed: false, bids: {}, order: [], revealed: false, result: null,
  });

  /**
   * Build the opening state from a prize file and a roster.
   * @param {object} rawContent @param {{pid:string,name:string}[]} players
   */
  function createState(rawContent, players, options) {
    const content = normalizeGame(rawContent);
    const roster = normalizePlayers(players);
    void (isPlainObject(options) ? options : {});
    return {
      phase: "setup",
      content,
      roster,
      plan: plan(roster, content.settings, { oneBid: content.oneBid.length }),
      segmentIndex: 0,
      row: blankRow(),
      game: blankGame(),
      showdown: blankShowdown(),
      showcase: blankShowcase(),
      winnings: {},
      comeOnDown: [],
      showdownWinners: [],
      used: { oneBid: [], cliffhangers: [], plinko: [], luckyseven: [], showcases: [] },
      rotation: 0,
      notice: "",
      history: [],
    };
  }

  /* ============ Reducer plumbing ============ */

  /** A history entry drops the one constant (`content`) and its own history. */
  function snapshot(state) {
    const copy = Object.assign({}, state);
    delete copy.content;
    copy.history = [];
    return copy;
  }

  function withHistory(state, next) {
    const history = state.history.concat([snapshot(state)]);
    return Object.assign({}, next, { history: history.slice(-MAX_HISTORY) });
  }

  /** Add to a player's total without mutating the old map. */
  function award(state, pid, amount) {
    if (!pid || !Number.isFinite(amount) || amount === 0) return state.winnings;
    const next = Object.assign({}, state.winnings);
    next[pid] = (Number.isFinite(next[pid]) ? next[pid] : 0) + amount;
    return next;
  }

  /* ============ Entering a segment ============ */

  function initialSeats(state) {
    const pids = state.roster.map((p) => p.pid);
    const n = Math.max(1, Math.min(ROW_SEATS, pids.length));
    return { seats: pids.slice(0, n), queue: pids.slice(n) };
  }

  /**
   * The row for the next One Bid: the previous winner walks off to their
   * pricing game and the front of the queue takes the empty seat. With four
   * players or fewer the winner is the only one waiting, so they sit back down.
   */
  function nextRowSeats(state) {
    const prev = state.row;
    if (!prev.seats || !prev.seats.length) return initialSeats(state);
    const seats = prev.seats.slice();
    const queue = prev.queue.slice();
    const leaving = prev.result && prev.result.pid ? prev.result.pid : null;
    const at = leaving ? seats.indexOf(leaving) : -1;
    if (at >= 0) {
      queue.push(leaving);
      seats[at] = queue.shift();
    }
    return { seats, queue };
  }

  function enterRow(state, rng) {
    const draw = drawFrom(state.content.oneBid, state.used.oneBid, rng);
    const { seats, queue } = nextRowSeats(state);
    const used = Object.assign({}, state.used, { oneBid: state.used.oneBid.concat([draw.index]) });
    return Object.assign({}, state, {
      phase: "row", used,
      row: Object.assign(blankRow(), {
        itemIndex: draw.index, item: state.content.oneBid[draw.index] || null, seats, queue,
      }),
      notice: draw.wrapped ? "The One Bid items have wrapped — this one has been seen before." : "",
    });
  }

  function enterGame(state) {
    const pid = state.row.result ? state.row.result.pid : null;
    return Object.assign({}, state, {
      phase: "game",
      game: Object.assign(blankGame(), { pid }),
      notice: "",
    });
  }

  /** Spinners are the players who came on down since the last showdown,
      lowest winnings first, exactly as the wheel is ordered on television. */
  function enterShowdown(state) {
    const seen = [];
    state.comeOnDown.forEach((pid) => { if (seen.indexOf(pid) < 0) seen.push(pid); });
    const spinners = seen.slice().sort((a, b) => winningsOf(state, a) - winningsOf(state, b));
    const totals = {};
    const spins = {};
    spinners.forEach((pid) => { totals[pid] = 0; spins[pid] = []; });
    return Object.assign({}, state, {
      phase: "showdown", comeOnDown: [],
      showdown: Object.assign(blankShowdown(), {
        spinners, totals, spins, awaiting: spinners.length ? "spin" : "done",
      }),
      notice: spinners.length ? "" : "Nobody came on down — the showdown is skipped.",
    });
  }

  /**
   * Two finalists. The showdown winners come first, but the SAME player can win
   * both showdowns (they only have to keep winning One Bid), so the list is
   * de-duplicated and the biggest winner who is not already in it fills the
   * empty chair. With one player there is only ever one finalist.
   */
  function showcaseFinalists(state) {
    const out = [];
    state.showdownWinners.forEach((pid) => {
      if (out.length < 2 && isPlayer(state, pid) && out.indexOf(pid) < 0) out.push(pid);
    });
    standings(state).forEach((row) => {
      if (out.length < 2 && out.indexOf(row.pid) < 0) out.push(row.pid);
    });
    return out;
  }

  function enterShowcase(state, rng) {
    const finalists = showcaseFinalists(state);
    const first = drawFrom(state.content.showcases, state.used.showcases, rng);
    const usedNow = state.used.showcases.concat([first.index]);
    const second = drawFrom(state.content.showcases, usedNow, rng);
    const pair = [first.index, second.index];
    const chooser = finalists.slice().sort((a, b) => winningsOf(state, b) - winningsOf(state, a))[0] || null;
    return Object.assign({}, state, {
      phase: "showcase",
      used: Object.assign({}, state.used, { showcases: usedNow.concat([second.index]) }),
      showcase: Object.assign(blankShowcase(), { finalists, chooser, pair }),
      notice: "",
    });
  }

  const ENTER = { row: enterRow, game: enterGame, showdown: enterShowdown, showcase: enterShowcase };

  function enterSegment(state, index, rng) {
    const segment = state.plan.segments[index];
    if (!segment) return Object.assign({}, state, { phase: "standings", segmentIndex: index, notice: "" });
    const moved = Object.assign({}, state, { segmentIndex: index });
    const build = ENTER[segment.t];
    return build ? build(moved, rng) : Object.assign(moved, { phase: "standings" });
  }

  /* ============ Reducer ============ */

  const HANDLERS = {
    start: evStart,
    bid: evBid,
    revealBids: evRevealBids,
    rebid: evRebid,
    pickGame: evPickGame,
    chGuess: evChGuess,
    plinkoAnswer: evPlinkoAnswer,
    plinkoDrop: evPlinkoDrop,
    l7Guess: evL7Guess,
    spin: evSpin,
    spinAgain: evSpinAgain,
    stay: evStay,
    showcasePass: evShowcasePass,
    showcaseBid: evShowcaseBid,
    revealShowcase: evRevealShowcase,
    nextSegment: evNextSegment,
    finish: evFinish,
    undo: evUndo,
  };

  const NO_HISTORY = new Set(["undo"]);

  /**
   * Apply `event` to `state`; illegal or unknown events return `state`
   * unchanged. `rng` is injected — the core never calls Math.random itself.
   */
  function reduce(state, event, rng) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    // hasOwnProperty, not a bare lookup: "toString"/"valueOf"/"constructor" are
    // on Object.prototype and would otherwise be called as if they were handlers.
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, event.type)
      ? HANDLERS[event.type] : null;
    if (!handler) return state;
    const next = handler(state, event, typeof rng === "function" ? rng : Math.random);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return withHistory(state, next);
  }

  /**
   * Representative payloads so legalActions can probe payload-carrying events.
   * They are built from the state because "can somebody bid?" only means
   * anything for a pid that is actually in a seat.
   */
  function sampleEvents(state) {
    const seat = (state.row.seats || [])[0] || "?";
    const finalist = (state.showcase.finalists || [])[0] || "?";
    const fresh = (bids, pid) => (bids && bids[pid] === 1 ? 2 : 1);
    return {
      bid: { pid: seat, amount: fresh(state.row.bids, seat) },
      pickGame: { kind: null },
      chGuess: { amount: 1 },
      plinkoAnswer: { answer: "correct" },
      plinkoDrop: { slot: 4 },
      l7Guess: { digit: 0 },
      spin: { pid: null },
      showcasePass: { pass: true },
      showcaseBid: { pid: finalist, amount: fresh(state.showcase.bids, finalist) },
    };
  }

  /** Which events would do something right now (host buttons read this). */
  function legalActions(state) {
    if (!state) return [];
    const samples = sampleEvents(state);
    return Object.keys(HANDLERS).filter((type) => {
      if (type === "undo") return state.history.length > 0;
      const next = HANDLERS[type](state, Object.assign({ type }, samples[type] || {}), () => 0);
      return !!next && next !== state;
    });
  }

  /* ============ Setup and Contestants' Row ============ */

  function evStart(state, ev, rng) {
    if (state.phase !== "setup") return state;
    return enterSegment(state, 0, rng);
  }

  function evBid(state, ev) {
    const row = state.row;
    if (state.phase !== "row" || row.revealed) return state;
    const pid = cleanText(ev.pid, PID_MAX);
    if (!pid || row.seats.indexOf(pid) < 0) return state;
    if (!isIntIn(ev.amount, 1, MAX_BID)) return state;
    if (row.bids[pid] === ev.amount) return state;
    const bids = Object.assign({}, row.bids);
    bids[pid] = ev.amount;
    // A correction keeps its original place in the queue, so the tie rule
    // ("the earliest bid wins") still means the earliest contestant to bid.
    const order = row.order.indexOf(pid) >= 0 ? row.order : row.order.concat([pid]);
    return Object.assign({}, state, { row: Object.assign({}, row, { bids, order }), notice: "" });
  }

  function evRevealBids(state) {
    const row = state.row;
    if (state.phase !== "row" || row.revealed || !row.item) return state;
    if (!row.order.length) return state;
    const s = state.content.settings;
    const result = rowWinner(row.bids, row.item.price, s.exactBidBonus, row.order);
    if (result.allOver) {
      return Object.assign({}, state, {
        row: Object.assign({}, row, { revealed: true, result: null, allOver: true }),
        notice: "Everybody went over — all bids again.",
      });
    }
    const prize = row.item.price + result.bonus;
    return Object.assign({}, state, {
      row: Object.assign({}, row, { revealed: true, result, allOver: false }),
      winnings: award(state, result.pid, prize),
      comeOnDown: state.comeOnDown.concat([result.pid]),
      notice: result.exact
        ? `Exactly right — a ${money(s.currency, s.exactBidBonus)} bonus.`
        : "",
    });
  }

  function evRebid(state) {
    const row = state.row;
    if (state.phase !== "row" || !row.revealed || !row.allOver) return state;
    return Object.assign({}, state, {
      row: Object.assign({}, row, {
        bids: {}, order: [], revealed: false, result: null, allOver: false, rebids: row.rebids + 1,
      }),
      notice: "Bids cleared — everybody bids again.",
    });
  }

  /* ============ Choosing and setting up a pricing game ============ */

  function cliffSlate(state, rng) {
    const draw = drawFrom(state.content.cliffhangers, state.used.cliffhangers, rng);
    const set = state.content.cliffhangers[draw.index];
    if (!set) return null;
    return {
      slate: {
        setIndex: draw.index, items: set.items.slice(), prize: set.prize,
        guesses: [], index: 0, steps: 0, left: CLIFF_STEPS, lastError: null,
      },
      kind: "cliffhangers", index: draw.index,
    };
  }

  function plinkoSlate(state, rng) {
    const draw = drawFrom(state.content.plinko, state.used.plinko, rng);
    const set = state.content.plinko[draw.index];
    if (!set) return null;
    return {
      slate: {
        setIndex: draw.index, prices: set.smallPrices.slice(), answers: [], index: 0,
        stage: "answers", chips: 1, dropped: 0, drops: [], lastDrop: null, total: 0,
      },
      kind: "plinko", index: draw.index,
    };
  }

  function l7Slate(state, rng) {
    const draw = drawFrom(state.content.luckyseven, state.used.luckyseven, rng);
    const car = state.content.luckyseven[draw.index];
    if (!car) return null;
    const digits = l7Digits(car.price);
    return {
      slate: {
        setIndex: draw.index, car: car.car, note: car.note, price: car.price, digits,
        revealedDigits: [digits[0]], guesses: [], index: 1, wallet: L7_START, lastCost: null,
      },
      kind: "luckyseven", index: draw.index,
    };
  }

  const SLATES = { cliffhangers: cliffSlate, plinko: plinkoSlate, luckyseven: l7Slate };

  function evPickGame(state, ev, rng) {
    if (state.phase !== "game" || !state.game.pending) return state;
    const enabled = state.content.settings.pricingGames;
    const kind = typeof ev.kind === "string" && enabled.indexOf(ev.kind) >= 0
      ? ev.kind : enabled[state.rotation % enabled.length];
    const built = SLATES[kind] ? SLATES[kind](state, rng) : null;
    if (!built) return Object.assign({}, state, { notice: `There is no ${GAME_LABELS[kind] || kind} set in this file.` });
    const used = Object.assign({}, state.used);
    used[kind] = used[kind].concat([built.index]);
    return Object.assign({}, state, {
      used,
      rotation: (enabled.indexOf(kind) + 1) % enabled.length,
      game: Object.assign(blankGame(), built.slate, { kind, pid: state.game.pid, pending: false }),
      notice: "",
    });
  }

  /* ============ Cliff Hangers ============ */

  function evChGuess(state, ev) {
    const g = state.game;
    if (state.phase !== "game" || g.kind !== "cliffhangers" || g.done) return state;
    if (!isIntIn(ev.amount, 1, 99)) return state;
    const item = g.items[g.index];
    if (!item) return state;
    const guesses = g.guesses.concat([ev.amount]);
    const climb = cliffClimb(guesses, g.items);
    const finished = climb.fell || guesses.length >= CLIFF_ITEMS;
    const won = !climb.fell && guesses.length >= CLIFF_ITEMS;
    const next = Object.assign({}, g, {
      guesses, index: Math.min(g.index + 1, CLIFF_ITEMS - 1),
      steps: climb.steps, left: climb.left, lastError: cliffError(ev.amount, item.price),
      done: finished, won, award: won ? g.prize.price : 0,
    });
    return Object.assign({}, state, {
      game: next,
      winnings: won ? award(state, g.pid, g.prize.price) : state.winnings,
      notice: cliffNotice(climb, won, item, ev.amount),
    });
  }

  function cliffNotice(climb, won, item, guess) {
    if (climb.fell) return "Over the edge — the climber falls.";
    if (won) return "Safe at the top!";
    const err = cliffError(guess, item.price);
    return err === 0 ? "Exactly right — no steps." : `${err} step${err === 1 ? "" : "s"} up the mountain.`;
  }

  /* ============ Plinko ============ */

  function evPlinkoAnswer(state, ev) {
    const g = state.game;
    if (state.phase !== "game" || g.kind !== "plinko" || g.done || g.stage !== "answers") return state;
    if (PLINKO_ANSWERS.indexOf(ev.answer) < 0) return state;
    if (ev.i !== undefined && ev.i !== g.index) return state;
    const price = g.prices[g.index];
    if (!price) return state;
    const right = plinkoTruth(price) === ev.answer;
    const max = state.content.settings.plinko.maxChips;
    const chips = right ? Math.min(max, g.chips + 1) : g.chips;
    const index = g.index + 1;
    return Object.assign({}, state, {
      game: Object.assign({}, g, {
        answers: g.answers.concat([{ answer: ev.answer, right }]),
        index, chips, stage: index >= PLINKO_PRICES ? "drops" : "answers",
      }),
      notice: right
        ? `Right — that is ${chips} chip${chips === 1 ? "" : "s"}.`
        : `No: it is ${money(state.content.settings.currency, price.actual)}.`,
    });
  }

  function evPlinkoDrop(state, ev, rng) {
    const g = state.game;
    if (state.phase !== "game" || g.kind !== "plinko" || g.done || g.stage !== "drops") return state;
    if (!isIntIn(ev.slot, 0, PLINKO_SLOTS - 1)) return state;
    if (g.dropped >= g.chips) return state;
    const slots = state.content.settings.plinko.slots;
    const bounce = plinkoPath(ev.slot, rng, slots.length);
    const value = slots[bounce.landing] || 0;
    const drop = { slot: ev.slot, landing: bounce.landing, value, path: bounce.path };
    const dropped = g.dropped + 1;
    const total = g.total + value;
    const done = dropped >= g.chips;
    return Object.assign({}, state, {
      game: Object.assign({}, g, {
        drops: g.drops.concat([drop]), lastDrop: drop, dropped, total,
        done, won: done && total > 0, award: done ? total : 0,
      }),
      winnings: award(state, g.pid, value),
      notice: `${money(state.content.settings.currency, value)} in slot ${bounce.landing + 1}.`,
    });
  }

  /* ============ Lucky Seven ============ */

  function evL7Guess(state, ev) {
    const g = state.game;
    if (state.phase !== "game" || g.kind !== "luckyseven" || g.done) return state;
    if (!isIntIn(ev.digit, 0, 9)) return state;
    if (g.index >= L7_DIGITS) return state;
    const actual = g.digits[g.index];
    const cost = l7Cost(ev.digit, actual);
    const wallet = Math.max(0, g.wallet - cost);
    const index = g.index + 1;
    const finished = index >= L7_DIGITS;
    const broke = wallet < 1;
    const won = finished && !broke;
    const done = finished || broke;
    return Object.assign({}, state, {
      game: Object.assign({}, g, {
        guesses: g.guesses.concat([ev.digit]),
        revealedDigits: g.revealedDigits.concat([actual]),
        index, wallet, lastCost: cost, done, won, award: won ? g.price : 0,
      }),
      winnings: won ? award(state, g.pid, g.price) : state.winnings,
      notice: l7Notice(cost, wallet, done, won),
    });
  }

  function l7Notice(cost, wallet, done, won) {
    if (won) return "Enough left over — the car is theirs!";
    if (done) return "Out of dollars — no car this time.";
    if (cost === 0) return `Spot on — still ${wallet} dollars.`;
    return `That costs ${cost} dollar${cost === 1 ? "" : "s"} — ${wallet} left.`;
  }

  /* ============ Showcase Showdown ============ */

  function evSpin(state, ev, rng) {
    const sd = state.showdown;
    if (state.phase !== "showdown" || sd.awaiting !== "spin") return state;
    const pid = sd.spinners[sd.current];
    if (!pid) return state;
    if (ev.pid !== undefined && ev.pid !== null && cleanText(ev.pid, PID_MAX) !== pid) return state;
    const wheel = state.content.settings.wheel;
    const index = pickIndex(rng, wheel.length);
    const value = wheel[index];
    const total = (sd.totals[pid] || 0) + value;
    const spins = Object.assign({}, sd.spins, { [pid]: (sd.spins[pid] || []).concat([{ index, value }]) });
    const totals = Object.assign({}, sd.totals, { [pid]: total });
    const bonus = total === WHEEL_TARGET ? state.content.settings.wheelDollarBonus : 0;
    const spun = Object.assign({}, state, {
      showdown: Object.assign({}, sd, {
        spins, totals, lastSpin: { pid, index, value, total },
        awaiting: spinAwaiting(sd, spins[pid], total),
      }),
      winnings: bonus ? award(state, pid, bonus) : state.winnings,
      notice: spinNotice(state, total, bonus),
    });
    return spun.showdown.awaiting === "advance" ? advanceSpinner(spun) : spun;
  }

  /** After a spin: bust and exact dollars end the turn; a first spin offers a second. */
  function spinAwaiting(sd, mySpins, total) {
    if (total > WHEEL_TARGET || total === WHEEL_TARGET) return "advance";
    if (sd.spinoff) return "advance";
    return mySpins.length >= 2 ? "advance" : "decide";
  }

  function spinNotice(state, total, bonus) {
    if (bonus) return `A dollar! ${formatMoney(state, bonus)} bonus.`;
    if (total > WHEEL_TARGET) return `${wheelLabel(total)} — over a dollar, and out.`;
    return `${wheelLabel(total)} on the board.`;
  }

  function evSpinAgain(state) {
    const sd = state.showdown;
    if (state.phase !== "showdown" || sd.awaiting !== "decide") return state;
    return Object.assign({}, state, {
      showdown: Object.assign({}, sd, { awaiting: "spin" }), notice: "",
    });
  }

  function evStay(state) {
    const sd = state.showdown;
    if (state.phase !== "showdown" || sd.awaiting !== "decide") return state;
    return advanceSpinner(Object.assign({}, state, {
      showdown: Object.assign({}, sd, { awaiting: "advance" }),
    }));
  }

  /** Next spinner, or close the showdown (with a spin-off when it is a draw). */
  function advanceSpinner(state) {
    const sd = state.showdown;
    const next = sd.current + 1;
    if (next < sd.spinners.length) {
      return Object.assign({}, state, {
        showdown: Object.assign({}, sd, { current: next, awaiting: "spin" }),
      });
    }
    const result = showdownWinner(sd.totals, sd.spinners);
    const draw = result.tie.length > 1 ? result.tie : (result.allBust ? sd.spinners.slice() : []);
    if (draw.length > 1) return startSpinoff(state, draw);
    const winner = result.pid || sd.spinners[0] || null;
    return Object.assign({}, state, {
      showdown: Object.assign({}, sd, { awaiting: "done", winner, tie: [] }),
      showdownWinners: winner ? state.showdownWinners.concat([winner]) : state.showdownWinners,
      notice: winner ? `${nameOf(state, winner)} takes the showdown.` : "No winner in the showdown.",
    });
  }

  function startSpinoff(state, tied) {
    const sd = state.showdown;
    const totals = {};
    const spins = {};
    tied.forEach((pid) => { totals[pid] = 0; spins[pid] = []; });
    return Object.assign({}, state, {
      showdown: Object.assign({}, sd, {
        spinners: tied.slice(), totals, spins, current: 0, awaiting: "spin",
        round: sd.round + 1, spinoff: true, tie: tied.slice(), lastSpin: null,
      }),
      notice: "A tie — one spin each to settle it.",
    });
  }

  /* ============ Showcase ============ */

  function evShowcasePass(state, ev) {
    const sc = state.showcase;
    if (state.phase !== "showcase" || sc.chosen || !sc.chooser) return state;
    const other = sc.finalists.find((pid) => pid !== sc.chooser) || null;
    const passed = ev.pass !== false;
    const assignments = {};
    assignments[sc.chooser] = passed ? sc.pair[1] : sc.pair[0];
    if (other) assignments[other] = passed ? sc.pair[0] : sc.pair[1];
    return Object.assign({}, state, {
      showcase: Object.assign({}, sc, { chosen: true, passed, assignments }),
      notice: passed
        ? `${nameOf(state, sc.chooser)} passes the first showcase.`
        : `${nameOf(state, sc.chooser)} takes the first showcase.`,
    });
  }

  function evShowcaseBid(state, ev) {
    const sc = state.showcase;
    if (state.phase !== "showcase" || !sc.chosen || sc.revealed) return state;
    const pid = cleanText(ev.pid, PID_MAX);
    if (!pid || sc.finalists.indexOf(pid) < 0) return state;
    if (!isIntIn(ev.amount, 1, MAX_PRICE)) return state;
    if (sc.bids[pid] === ev.amount) return state;
    const bids = Object.assign({}, sc.bids, { [pid]: ev.amount });
    const order = sc.order.indexOf(pid) >= 0 ? sc.order : sc.order.concat([pid]);
    return Object.assign({}, state, { showcase: Object.assign({}, sc, { bids, order }), notice: "" });
  }

  function evRevealShowcase(state) {
    const sc = state.showcase;
    if (state.phase !== "showcase" || !sc.chosen || sc.revealed) return state;
    if (!Object.keys(sc.bids).length) return state;
    const actuals = {};
    sc.finalists.forEach((pid) => {
      const showcase = state.content.showcases[sc.assignments[pid]];
      actuals[pid] = showcase ? showcase.total : 0;
    });
    const margin = state.content.settings.showcaseMargin;
    const result = showcaseResult(sc.bids, actuals, margin, sc.finalists);
    return Object.assign({}, state, {
      showcase: Object.assign({}, sc, { revealed: true, result }),
      winnings: showcasePayout(state, sc, result, actuals),
      notice: showcaseNotice(state, result),
    });
  }

  function showcasePayout(state, sc, result, actuals) {
    if (!result.winner) return state.winnings;
    const other = sc.finalists.find((pid) => pid !== result.winner);
    const own = actuals[result.winner] || 0;
    const extra = result.both && other ? (actuals[other] || 0) : 0;
    return award(state, result.winner, own + extra);
  }

  function showcaseNotice(state, result) {
    if (result.doubleOver) return "Both showcases overbid — nobody wins.";
    const who = nameOf(state, result.winner);
    if (result.both) return `${who} is within the margin and wins BOTH showcases!`;
    return `${who} wins their showcase by ${formatMoney(state, result.diff)}.`;
  }

  /* ============ Moving on ============ */

  /** Is the current segment finished? */
  function segmentDone(state) {
    if (state.phase === "row") return !!(state.row.revealed && state.row.result);
    if (state.phase === "game") return !!state.game.done;
    if (state.phase === "showdown") return state.showdown.awaiting === "done";
    if (state.phase === "showcase") return !!state.showcase.revealed;
    return false;
  }

  function evNextSegment(state, ev, rng) {
    if (state.phase === "setup" || state.phase === "standings") return state;
    if (!segmentDone(state)) return state;
    return enterSegment(state, state.segmentIndex + 1, rng);
  }

  function evFinish(state) {
    if (state.phase === "setup" || state.phase === "standings") return state;
    return Object.assign({}, state, { phase: "standings", notice: "That is the night." });
  }

  function evUndo(state) {
    if (!Array.isArray(state.history) || !state.history.length) return state;
    const prev = state.history[state.history.length - 1];
    return Object.assign({}, prev, {
      content: state.content,
      history: state.history.slice(0, -1),
    });
  }

  /* ============ Export ============ */

  return {
    // constants
    PHASES, GAME_KINDS, GAME_LABELS, DEFAULT_SETTINGS, MAX_PLAYERS, ROW_SEATS,
    CLIFF_STEPS, CLIFF_ITEMS, PLINKO_SLOTS, PLINKO_PRICES, PLINKO_ANSWERS,
    L7_DIGITS, L7_START, WHEEL_TARGET, MAX_BID, MAX_PRICE, PLAYER_NAME_MAX,
    // content
    validateGame, normalizeGame, normalizeSettings, warningsFor, drawFrom, cleanText, money,
    // state
    createState, reduce, legalActions, segmentDone, currentSegment, activePid,
    // rules maths
    plan, rowWinner, cliffError, cliffClimb, plinkoTruth, plinkoPath,
    l7Digits, l7Cost, showdownWinner, showcaseResult,
    // reading a state
    formatMoney, wheelLabel, nameOf, isPlayer, winningsOf, standings, rowSeats, settingsOf,
    // phones
    validatePhoneMsg, phoneView,
  };
});

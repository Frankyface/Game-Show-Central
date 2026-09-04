/* ============================================================
   The Price Is Right — selectors and rules maths (PURE)
   Everything that READS a state (or a slice of one) and every
   piece of arithmetic the format needs: the episode plan, the
   One Bid winner, the Cliff Hangers climb, the Plinko bounce
   path, the Lucky Seven wallet, the wheel totals, the showcase
   comparison, and the masked view a phone is allowed to see.

   The reducer in tpir-core.js uses these; tpir-core.js re-exports
   them, so callers only ever touch TpirCore. No DOM, no timers,
   no mutation, no Math.random (an rng is always injected).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./tpir-content.js") : root.TpirContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.TpirSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, money,
    normalizeSettings, GAME_KINDS, GAME_LABELS,
    PID_MAX, MAX_BID, MAX_PRICE, ROW_SEATS,
    CLIFF_STEPS, CLIFF_ITEMS, PLINKO_SLOTS, PLINKO_PRICES, L7_DIGITS, L7_START,
  } = Content;

  const PLINKO_ROWS = 12;        // peg rows; 12 half-steps keep the chip on integers
  const WHEEL_TARGET = 100;      // $1.00 in cents — the number to reach without going over
  const PLINKO_ANSWERS = ["higher", "lower", "correct"];

  /* ============ Tiny shared shapes ============ */

  /** `{pid: n}` or `[{pid, amount}]` → a stable ordered array of entries. */
  function toEntries(bids, order, key) {
    const field = key || "amount";
    if (Array.isArray(bids)) {
      return bids.filter((e) => isPlainObject(e) && typeof e.pid === "string")
        .map((e) => ({ pid: e.pid, [field]: Number(e[field] !== undefined ? e[field] : e.amount) }));
    }
    if (!isPlainObject(bids)) return [];
    const pids = Array.isArray(order) && order.length
      ? order.filter((pid) => Object.prototype.hasOwnProperty.call(bids, pid))
      : Object.keys(bids);
    return pids.map((pid) => ({ pid, [field]: Number(bids[pid]) }));
  }

  /* ============ The episode plan ============ */

  /**
   * How the night is shaped: one Contestants' Row per pricing game, a Showcase
   * Showdown after every `gamesPerShowdown` games, then the Showcase.
   * `limits.oneBid` caps the number of games at the number of items the file
   * actually carries (an extra, optional argument beyond spec 10 §4 so a thin
   * file yields a shorter but complete episode instead of running dry).
   * @param {{pid:string,name:string}[]} roster
   */
  function plan(roster, settings, limits) {
    const players = Array.isArray(roster) ? roster.length : 0;
    const s = normalizeSettings(settings);
    const per = s.gamesPerShowdown;
    const cap = limits && Number.isFinite(limits.oneBid) ? limits.oneBid : per * 2;
    const games = Math.max(1, Math.min(per * 2, Math.floor(cap)));
    const showdowns = Math.min(2, Math.ceil(games / per));
    const segments = [];
    let played = 0;
    let done = 0;
    while (played < games) {
      played += 1;
      segments.push({ t: "row", n: played });
      segments.push({ t: "game", n: played });
      if (played % per === 0 && done < showdowns) { done += 1; segments.push({ t: "showdown", n: done }); }
    }
    while (done < showdowns) { done += 1; segments.push({ t: "showdown", n: done }); }
    segments.push({ t: "showcase", n: 1 });
    return {
      players, seats: Math.max(1, Math.min(ROW_SEATS, players)),
      games, showdowns, gamesPerShowdown: per, segments,
      note: planNote(players, games, showdowns),
    };
  }

  function planNote(players, games, showdowns) {
    const p = `${players} player${players === 1 ? "" : "s"}`;
    const g = `${games} pricing game${games === 1 ? "" : "s"}`;
    const d = `${showdowns} showcase showdown${showdowns === 1 ? "" : "s"}`;
    return `${p}: ${games} Contestants' Row${games === 1 ? "" : "s"}, ${g}, ${d}, then the showcase.`;
  }

  /* ============ One Bid ============ */

  /**
   * Closest without going over. Ties go to the EARLIEST bid, which is why the
   * caller passes the arrival order.
   * @returns {{pid:?string, amount:?number, exact:boolean, bonus:number,
   *            allOver:boolean, diff:?number}}
   */
  function rowWinner(bids, price, bonus, order) {
    const entries = toEntries(bids, order);
    const blank = { pid: null, amount: null, exact: false, bonus: 0, allOver: false, diff: null };
    if (!entries.length) return blank;
    const under = entries.filter((e) => Number.isFinite(e.amount) && e.amount <= price);
    if (!under.length) return Object.assign({}, blank, { allOver: true });
    let best = under[0];
    // Strictly greater, so the first of two equal bids keeps the win.
    for (let i = 1; i < under.length; i += 1) if (under[i].amount > best.amount) best = under[i];
    const exact = best.amount === price;
    return {
      pid: best.pid, amount: best.amount, exact,
      bonus: exact ? (Number.isFinite(bonus) ? bonus : 0) : 0,
      allOver: false, diff: price - best.amount,
    };
  }

  /* ============ Cliff Hangers ============ */

  /** One dollar of error is one step of the climb. */
  function cliffError(guess, price) {
    if (!Number.isFinite(guess) || !Number.isFinite(price)) return 0;
    return Math.abs(Math.round(guess) - price);
  }

  /** Total steps climbed after `guesses`, and whether the climber is off. */
  function cliffClimb(guesses, items) {
    const list = Array.isArray(guesses) ? guesses : [];
    const prices = Array.isArray(items) ? items : [];
    let steps = 0;
    list.forEach((g, i) => { steps += cliffError(g, prices[i] ? prices[i].price : 0); });
    return { steps, fell: steps > CLIFF_STEPS, left: Math.max(0, CLIFF_STEPS - steps) };
  }

  /* ============ Plinko ============ */

  /** What the truth is about one small price. */
  function plinkoTruth(price) {
    if (!isPlainObject(price)) return "correct";
    if (price.actual === price.shown) return "correct";
    return price.actual > price.shown ? "higher" : "lower";
  }

  /**
   * Bounce a chip from `slot` down `PLINKO_ROWS` rows of pegs. The rng decides
   * every bounce, so the LANDING SLOT IS DECIDED HERE — tpir-games.js only
   * replays `path` (spec 10 §1: the same discipline as the wheel).
   * @returns {{path:number[], landing:number}}
   */
  function plinkoPath(slot, rng, slotCount) {
    const count = Number.isFinite(slotCount) && slotCount > 0 ? slotCount : PLINKO_SLOTS;
    const max = count - 1;
    const rand = typeof rng === "function" ? rng : Math.random;
    let pos = Math.min(Math.max(Math.round(Number(slot) || 0), 0), max);
    const path = [pos];
    for (let r = 0; r < PLINKO_ROWS; r += 1) {
      let step = Number(rand()) < 0.5 ? -0.5 : 0.5;
      if (pos + step < 0) step = 0.5;
      if (pos + step > max) step = -0.5;
      pos += step;
      path.push(pos);
    }
    return { path, landing: Math.min(Math.max(Math.round(pos), 0), max) };
  }

  /* ============ Lucky Seven ============ */

  /** The five digits of a price, most significant first. */
  function l7Digits(price) {
    return String(Math.abs(Math.round(Number(price) || 0)))
      .padStart(L7_DIGITS, "0").slice(-L7_DIGITS).split("").map((c) => Number(c));
  }

  /** What guessing `digit` costs against `actual`. */
  function l7Cost(digit, actual) {
    if (!Number.isFinite(digit) || !Number.isFinite(actual)) return 0;
    return Math.abs(Math.round(digit) - actual);
  }

  /* ============ Showcase Showdown (the big wheel) ============ */

  /** Closest to $1.00 without going over; `tie` is non-empty when it is a draw. */
  function showdownWinner(totals, order) {
    const entries = toEntries(totals, order, "total");
    if (!entries.length) return { pid: null, tie: [], best: 0, allBust: false };
    const live = entries.filter((e) => Number.isFinite(e.total) && e.total <= WHEEL_TARGET && e.total > 0);
    if (!live.length) return { pid: null, tie: [], best: 0, allBust: true };
    const best = live.reduce((m, e) => Math.max(m, e.total), 0);
    const tie = live.filter((e) => e.total === best).map((e) => e.pid);
    return { pid: tie.length === 1 ? tie[0] : null, tie: tie.length > 1 ? tie : [], best, allBust: false };
  }

  /* ============ Showcase ============ */

  /**
   * Closest without going over wins their own showcase; inside `margin` wins
   * both. Everybody over = nobody wins (the TV double-overbid).
   */
  function showcaseResult(bids, actuals, margin, order) {
    const pids = Array.isArray(order) && order.length ? order.slice() : Object.keys(actuals || {});
    const rows = pids.map((pid) => {
      const bid = bids && Number.isFinite(bids[pid]) ? bids[pid] : null;
      const actual = actuals && Number.isFinite(actuals[pid]) ? actuals[pid] : 0;
      const over = bid === null || bid > actual;
      return { pid, bid, actual, over, diff: over ? null : actual - bid };
    });
    const live = rows.filter((r) => !r.over);
    if (!live.length) return { winner: null, both: false, rows, doubleOver: true, diff: null };
    let best = live[0];
    for (let i = 1; i < live.length; i += 1) if (live[i].diff < best.diff) best = live[i];
    const limit = Number.isFinite(margin) ? margin : 0;
    return { winner: best.pid, both: best.diff <= limit, rows, doubleOver: false, diff: best.diff };
  }

  /* ============ Reading a live state ============ */

  const settingsOf = (state) => (state && state.content ? state.content.settings : normalizeSettings(null));
  const currencyOf = (state) => settingsOf(state).currency;

  function formatMoney(state, amount) {
    return money(currencyOf(state), amount);
  }

  /** `45` on the wheel is 45 cents. */
  function wheelLabel(value) {
    const v = Number(value) || 0;
    return v >= 100 ? "$1.00" : `${v}¢`;
  }

  function nameOf(state, pid) {
    if (!state || !pid) return "";
    const found = (state.roster || []).find((p) => p.pid === pid);
    return found ? found.name : "";
  }

  function isPlayer(state, pid) {
    return !!state && (state.roster || []).some((p) => p.pid === pid);
  }

  function winningsOf(state, pid) {
    const w = state && state.winnings ? state.winnings[pid] : 0;
    return Number.isFinite(w) ? w : 0;
  }

  /** Everyone, richest first; ties keep roster order. */
  function standings(state) {
    return (state && state.roster ? state.roster : []).map((p, i) => ({
      pid: p.pid, name: p.name, won: winningsOf(state, p.pid), seat: i,
    })).sort((a, b) => (b.won - a.won) || (a.seat - b.seat));
  }

  const currentSegment = (state) => {
    if (!state || !state.plan) return null;
    return state.plan.segments[state.segmentIndex] || null;
  };

  /** Who is "on stage" right now — the one player a phone screen belongs to. */
  function activePid(state) {
    if (!state) return null;
    if (state.phase === "game") return state.game ? state.game.pid : null;
    if (state.phase === "showdown") {
      const sd = state.showdown;
      return sd && sd.awaiting !== "done" ? sd.spinners[sd.current] || null : null;
    }
    return null;
  }

  /* ============ Host-side row view (bids masked until the reveal) ============ */

  function rowSeats(state) {
    const row = state.row || { seats: [], bids: {} };
    return (row.seats || []).map((pid, i) => ({
      seat: i, pid, name: nameOf(state, pid),
      placed: Object.prototype.hasOwnProperty.call(row.bids || {}, pid),
      bid: row.revealed && row.bids ? row.bids[pid] : null,
      masked: !row.revealed && Object.prototype.hasOwnProperty.call(row.bids || {}, pid),
      winner: !!(row.result && row.result.pid === pid),
      over: !!(row.revealed && row.bids && row.bids[pid] > (row.item ? row.item.price : 0)),
    }));
  }

  /* ============ Phone payloads ============ */

  /**
   * Validate a phone->host payload: a narrow copy, or null for junk — callers
   * ignore null and never throw on a hostile frame.
   */
  function validatePhoneMsg(obj) {
    if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
    if (obj.t === "bid") return isIntIn(obj.amount, 1, MAX_BID) ? { t: "bid", amount: obj.amount } : null;
    if (obj.t === "guess") return isIntIn(obj.value, 0, MAX_PRICE) ? { t: "guess", value: obj.value } : null;
    if (obj.t === "spin") return { t: "spin" };
    if (obj.t === "plinko") {
      if (typeof obj.answer === "string") {
        return PLINKO_ANSWERS.indexOf(obj.answer) >= 0 ? { t: "plinko", answer: obj.answer } : null;
      }
      return isIntIn(obj.slot, 0, PLINKO_SLOTS - 1) ? { t: "plinko", slot: obj.slot } : null;
    }
    return null;
  }

  /** Never leaks a price, another player's bid, or the Plinko landing slot. */
  function phoneView(state, pid) {
    const base = {
      screen: "wait", name: nameOf(state, pid), currency: currencyOf(state),
      won: formatMoney(state, winningsOf(state, pid)),
      spectator: !isPlayer(state, pid),
      headline: "Watch the host screen", sub: "",
    };
    if (!state || state.phase === "setup") {
      return Object.assign(base, { headline: "Waiting for the host…", sub: "The show is about to start." });
    }
    if (state.phase === "standings") return Object.assign(base, resultView(state, pid));
    const build = PHONE_SCREENS[state.phase];
    return Object.assign(base, build ? build(state, pid) : {});
  }

  const PHONE_SCREENS = {
    row: rowPhoneView,
    game: gamePhoneView,
    showdown: showdownPhoneView,
    showcase: showcasePhoneView,
  };

  function resultView(state, pid) {
    return {
      screen: "result",
      headline: `You won ${formatMoney(state, winningsOf(state, pid))}`,
      sub: "That is the night.",
      standings: standings(state).map((r) => ({ name: r.name, won: formatMoney(state, r.won) })),
    };
  }

  function rowPhoneView(state, pid) {
    const row = state.row;
    const seated = (row.seats || []).indexOf(pid) >= 0;
    const item = row.item || { name: "", note: "" };
    if (!seated) {
      return { headline: "Contestants' Row", sub: `${item.name} is up for bid.` };
    }
    if (row.revealed) {
      const mine = row.bids[pid];
      return {
        headline: row.result && row.result.pid === pid ? "Come on down!" : "Bids are in",
        sub: mine === undefined ? "You did not bid." : `You bid ${formatMoney(state, mine)}.`,
      };
    }
    return {
      screen: "bid",
      headline: item.name,
      sub: item.note || "Whole dollars. Closest without going over wins.",
      // The amount is echoed back so a reload restores it; nobody else's is here.
      myBid: Object.prototype.hasOwnProperty.call(row.bids, pid) ? row.bids[pid] : null,
      placed: (row.seats || []).map((seat) => ({
        name: nameOf(state, seat),
        placed: Object.prototype.hasOwnProperty.call(row.bids, seat),
      })),
    };
  }

  function gamePhoneView(state, pid) {
    const g = state.game;
    if (!g || !g.kind) return { headline: "Coming up", sub: "The host is choosing a pricing game." };
    const label = GAME_LABELS[g.kind] || "Pricing game";
    if (g.pid !== pid || g.done) {
      return { headline: label, sub: g.pid === pid ? "That's your game done." : `${nameOf(state, g.pid)} is playing.` };
    }
    if (g.kind === "cliffhangers") return cliffPhoneView(state, g, label);
    if (g.kind === "luckyseven") return l7PhoneView(state, g, label);
    return plinkoPhoneView(state, g, label);
  }

  function cliffPhoneView(state, g, label) {
    const item = g.items[g.index];
    if (!item) return { headline: label, sub: "Waiting for the host." };
    return {
      screen: "guess", kind: "cliffhangers", headline: item.name,
      sub: `Item ${g.index + 1} of ${CLIFF_ITEMS}. ${g.left} steps left before the fall.`,
      min: 1, max: 99, digits: 2, prompt: "Your price in whole dollars",
    };
  }

  function l7PhoneView(state, g, label) {
    return {
      screen: "guess", kind: "luckyseven",
      headline: `Digit ${g.index + 1} of ${L7_DIGITS}`,
      sub: `${label}: you have ${g.wallet} dollar${g.wallet === 1 ? "" : "s"} left.`,
      min: 0, max: 9, digits: 1, prompt: "Pick the next digit",
      known: g.revealedDigits.slice(),
    };
  }

  function plinkoPhoneView(state, g, label) {
    if (g.stage === "answers") {
      const p = g.prices[g.index];
      return {
        screen: "plinko", stage: "answer", headline: p ? p.name : label,
        sub: `Shown at ${formatMoney(state, p ? p.shown : 0)} — is that right?`,
        chips: g.chips,
      };
    }
    return {
      screen: "plinko", stage: "slot", headline: `Chip ${g.dropped + 1} of ${g.chips}`,
      sub: "Pick a slot to drop from.", chips: g.chips, slots: PLINKO_SLOTS,
    };
  }

  function showdownPhoneView(state, pid) {
    const sd = state.showdown;
    const mine = sd.spinners.indexOf(pid) >= 0;
    const total = Number.isFinite(sd.totals[pid]) ? sd.totals[pid] : 0;
    if (!mine) return { headline: "Showcase Showdown", sub: "The wheel is spinning." };
    if (activePid(state) !== pid) {
      return { headline: "Showcase Showdown", sub: total ? `Your total: ${wheelLabel(total)}` : "Stand by for the wheel." };
    }
    if (sd.awaiting === "decide") {
      return {
        headline: `You are on ${wheelLabel(total)}`,
        sub: "The host asks: spin again, or stay?",
      };
    }
    return {
      screen: "spin",
      headline: sd.spins[pid] && sd.spins[pid].length ? "Second spin" : "Your spin",
      sub: total ? `You are on ${wheelLabel(total)}.` : "Closest to $1.00 without going over.",
      total: wheelLabel(total),
    };
  }

  function showcasePhoneView(state, pid) {
    const sc = state.showcase;
    if (sc.finalists.indexOf(pid) < 0) return { headline: "The Showcase", sub: "The finalists are bidding." };
    const idx = sc.assignments[pid];
    const showcase = Number.isFinite(idx) ? state.content.showcases[idx] : null;
    if (!sc.chosen || !showcase) {
      return { headline: "The Showcase", sub: "Waiting for the first showcase to be claimed." };
    }
    if (sc.revealed) {
      const win = sc.result && sc.result.winner === pid;
      return { headline: win ? "You win the showcase!" : "Showcase decided", sub: `You bid ${formatMoney(state, sc.bids[pid])}.` };
    }
    return {
      screen: "showcase-bid", headline: "Your showcase",
      sub: "One bid. Closest without going over.",
      prizes: showcase.prizes.map((p) => ({ name: p.name, note: p.note })),
      myBid: Object.prototype.hasOwnProperty.call(sc.bids, pid) ? sc.bids[pid] : null,
    };
  }

  /* ============ Export ============ */

  return {
    PLINKO_ROWS, WHEEL_TARGET, PLINKO_ANSWERS,
    toEntries, plan, planNote,
    rowWinner, cliffError, cliffClimb,
    plinkoTruth, plinkoPath, l7Digits, l7Cost,
    showdownWinner, showcaseResult,
    settingsOf, currencyOf, formatMoney, wheelLabel,
    nameOf, isPlayer, winningsOf, standings, currentSegment, activePid, rowSeats,
    validatePhoneMsg, phoneView,
    // re-exported so tpir-core.js has one import
    PID_MAX, MAX_BID, MAX_PRICE, CLIFF_STEPS, CLIFF_ITEMS, PLINKO_SLOTS,
    PLINKO_PRICES, L7_DIGITS, L7_START, ROW_SEATS, GAME_KINDS, GAME_LABELS, cleanText,
  };
});

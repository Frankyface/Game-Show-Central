/* ============================================================
   Deal or No Deal — content rules and banker maths (PURE)
   The JSON contract from spec 12 §2: what a playable board file
   may contain, how a loaded file is normalised, the injected-rng
   shuffle that puts the amounts into the cases, and the offer
   arithmetic (nice-number rounding, bounded jitter). Split out of
   dond-core.js so both files stay well under the 800-line house
   limit; dond-core.js re-exports everything here, so callers only
   ever touch DondCore.
   No DOM, no timers, no Math.random, no mutation of the caller's
   objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DondContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  /** The 26-case US board (spec 12 §2). */
  const DEFAULT_AMOUNTS = Object.freeze([
    0.01, 1, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750,
    1000, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 300000,
    400000, 500000, 750000, 1000000,
  ]);
  /** 6 + 5 + 4 + 3 + 2 + 1 + 1 + 1 + 1 = 24 = 26 cases minus 2. */
  const DEFAULT_ROUNDS = Object.freeze([6, 5, 4, 3, 2, 1, 1, 1, 1]);
  const DEFAULT_FACTORS = Object.freeze([0.12, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 1.0]);
  const DEFAULT_JITTER = 0.05;

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    amounts: DEFAULT_AMOUNTS,
    rounds: DEFAULT_ROUNDS,
    offerFactors: DEFAULT_FACTORS,
    jitter: DEFAULT_JITTER,
    allowSwap: true,
    audienceAdvice: true,
  });

  const MIN_CASES = 10;
  const MAX_CASES = 30;
  const MAX_FACTOR = 1.5;
  const MAX_JITTER = 0.2;
  const MAX_AMOUNT = 1e12;
  const TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const NAME_MAX = 24;
  const PID_MAX = 24;
  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  // Curly quotes used in the plain-English validation messages, kept as
  // escapes so every source file in this game is printable ASCII.
  const LQ = "“";
  const RQ = "”";
  const q = (text) => LQ + text + RQ;

  /**
   * @typedef {{currency:string, amounts:number[], rounds:number[],
   *            offerFactors:number[], jitter:number, allowSwap:boolean,
   *            audienceAdvice:boolean}} Settings
   * @typedef {{title:string, settings:Settings}} Board
   */

  /* ============ Small helpers ============ */

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  /** Strip control chars, trim, cap. Returns "" when nothing survives. */
  function cleanText(raw, max) {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL_CHARS, "").trim().slice(0, max).trim();
  }

  function fail(message) {
    throw new Error(message);
  }

  function isPosInt(v) {
    return Number.isInteger(v) && v > 0;
  }

  /** A whole number in [lo, hi]. */
  function isIntIn(v, lo, hi) {
    return Number.isInteger(v) && v >= lo && v <= hi;
  }

  /** Deterministic index from an injected rng; never out of range. */
  function pickIndex(rng, length) {
    if (!length || length <= 0) return -1;
    const rand = typeof rng === "function" ? rng : Math.random;
    const raw = Number(rand());
    const scaled = Number.isFinite(raw) ? Math.floor(raw * length) : 0;
    return Math.min(Math.max(scaled, 0), length - 1);
  }

  /**
   * Whole percentages that always sum to 100 (largest remainder). An all-zero
   * input returns all zeroes rather than a fake split.
   * @param {number[]} counts @returns {number[]}
   */
  function largestRemainder(counts) {
    const list = (Array.isArray(counts) ? counts : []).map((n) => (Number.isFinite(n) && n > 0 ? n : 0));
    const total = list.reduce((a, b) => a + b, 0);
    if (!total) return list.map(() => 0);
    const exact = list.map((n) => (n * 100) / total);
    const floors = exact.map((v) => Math.floor(v));
    let left = 100 - floors.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ i, rem: v - Math.floor(v) }))
      .sort((a, b) => b.rem - a.rem || a.i - b.i);
    const out = floors.slice();
    for (let k = 0; k < order.length && left > 0; k += 1, left -= 1) out[order[k].i] += 1;
    return out;
  }

  /* ============ Validation (spec 12 §2) ============ */

  /**
   * Throw a plain-English Error when `board` is not a playable Deal or No Deal
   * file. Returns true so callers can use it as an assertion.
   * @param {unknown} board @returns {true}
   */
  function validateBoard(board) {
    if (!isPlainObject(board)) fail("This file is not a Deal or No Deal board: expected a JSON object.");
    if (board.title !== undefined && typeof board.title !== "string") fail(q("title") + " must be text.");
    validateSettings(board.settings);
    return true;
  }

  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail(q("settings") + " must be an object.");
    const s = raw;
    if (s.currency !== undefined && (typeof s.currency !== "string" || s.currency.length > CURRENCY_MAX)) {
      fail(q("settings.currency") + " must be text of at most 3 characters.");
    }
    const amounts = s.amounts === undefined ? DEFAULT_AMOUNTS.slice() : validateAmounts(s.amounts);
    // The DEFAULT schedule must be checked against THIS board's case count too:
    // a file with ten amounts and no `rounds` key would otherwise validate and
    // then deadlock mid-play with more cases to open than exist (tester fix).
    const rounds = validateRounds(s.rounds === undefined ? DEFAULT_ROUNDS : s.rounds, amounts.length);
    if (s.offerFactors !== undefined) validateFactors(s.offerFactors, rounds.length);
    if (s.jitter !== undefined && !(Number.isFinite(s.jitter) && s.jitter >= 0 && s.jitter <= MAX_JITTER)) {
      fail(q("settings.jitter") + ` must be a number between 0 and ${MAX_JITTER}.`);
    }
    ["allowSwap", "audienceAdvice"].forEach((key) => {
      if (s[key] !== undefined && typeof s[key] !== "boolean") {
        fail(q(`settings.${key}`) + " must be true or false.");
      }
    });
  }

  /** 10-30 distinct non-negative numbers. Returned sorted, low to high. */
  function validateAmounts(list) {
    if (!Array.isArray(list)) fail(q("settings.amounts") + " must be a list of numbers.");
    if (list.length < MIN_CASES || list.length > MAX_CASES) {
      fail(q("settings.amounts") + ` needs between ${MIN_CASES} and ${MAX_CASES} amounts (this file has ${list.length}).`);
    }
    const seen = new Set();
    list.forEach((n) => {
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        fail(q("settings.amounts") + ` must hold non-negative numbers — ${JSON.stringify(n)} is not one.`);
      }
      if (n > MAX_AMOUNT) fail(`${n} is too large to be a case amount.`);
      if (seen.has(n)) fail(`Every amount must be different — ${n} appears twice.`);
      seen.add(n);
    });
    return list.slice().sort((a, b) => a - b);
  }

  /** Positive whole numbers whose sum leaves at least two cases closed. */
  function validateRounds(list, cases) {
    if (!Array.isArray(list) || !list.length) {
      fail(q("settings.rounds") + " must be a non-empty list of whole numbers.");
    }
    list.forEach((n) => {
      if (!isPosInt(n)) {
        fail(q("settings.rounds") + ` must hold whole numbers above zero — ${JSON.stringify(n)} is not one.`);
      }
    });
    const sum = list.reduce((a, b) => a + b, 0);
    if (sum > cases - 2) {
      fail(`The rounds open ${sum} cases but only ${cases - 2} may be opened with ${cases} cases — two must stay closed.`);
    }
    return list.slice();
  }

  function validateFactors(list, rounds) {
    if (!Array.isArray(list)) fail(q("settings.offerFactors") + " must be a list of numbers.");
    if (list.length !== rounds) {
      fail(q("settings.offerFactors") + ` needs one factor per round — ${rounds} rounds, ${list.length} factors.`);
    }
    list.forEach((n) => {
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_FACTOR) {
        fail(`Every offer factor must be a number between 0 and ${MAX_FACTOR} — ${JSON.stringify(n)} is not.`);
      }
    });
  }

  /* ============ Normalising ============ */

  /**
   * A validated board with every default filled in and the amounts sorted.
   * Never mutates `board`.
   * @param {unknown} board @returns {Board}
   */
  function normalizeBoard(board) {
    validateBoard(board);
    const raw = isPlainObject(board) ? board : {};
    const s = isPlainObject(raw.settings) ? raw.settings : {};
    const amounts = s.amounts === undefined
      ? DEFAULT_AMOUNTS.slice()
      : s.amounts.slice().sort((a, b) => a - b);
    const rounds = s.rounds === undefined ? DEFAULT_ROUNDS.slice() : s.rounds.slice();
    return {
      title: cleanText(raw.title, TITLE_MAX) || "Deal or No Deal",
      settings: {
        currency: typeof s.currency === "string" ? s.currency : DEFAULT_SETTINGS.currency,
        amounts,
        rounds,
        offerFactors: Array.isArray(s.offerFactors) ? s.offerFactors.slice() : factorsFor(rounds.length),
        jitter: Number.isFinite(s.jitter) ? s.jitter : DEFAULT_JITTER,
        allowSwap: s.allowSwap === undefined ? true : !!s.allowSwap,
        audienceAdvice: s.audienceAdvice === undefined ? true : !!s.audienceAdvice,
      },
    };
  }

  /**
   * Offer factors for a round schedule the file did not give factors for: the
   * shipped curve when the length matches, otherwise a straight ramp from 0.12
   * to 1.0 so a custom schedule still plays sensibly.
   */
  function factorsFor(rounds) {
    if (rounds === DEFAULT_FACTORS.length) return DEFAULT_FACTORS.slice();
    if (rounds <= 1) return [1];
    const out = [];
    for (let i = 0; i < rounds; i += 1) {
      out.push(Math.round((0.12 + ((1 - 0.12) * i) / (rounds - 1)) * 100) / 100);
    }
    return out;
  }

  /** Things worth telling the host about but not worth refusing the file for. */
  function warningsFor(board) {
    const out = [];
    let g;
    try { g = normalizeBoard(board); } catch (err) { return [err.message]; }
    const cases = g.settings.amounts.length;
    const sum = g.settings.rounds.reduce((a, b) => a + b, 0);
    if (sum < cases - 2) {
      out.push(`The rounds only open ${sum} of the ${cases - 2} cases that may be opened, so ${cases - sum} cases stay closed at the end.`);
    }
    if (g.settings.offerFactors.some((f, i, list) => i > 0 && f < list[i - 1])) {
      out.push("The offer factors fall at some point — the banker usually gets more generous, not less.");
    }
    if (!g.settings.allowSwap) out.push("The final swap is switched off in this file.");
    return out;
  }

  /* ============ The shuffle ============ */

  /**
   * Fisher-Yates with an injected rng: the same rng always produces the same
   * board, and the result is always a permutation of the input (N-U2).
   * @param {number[]} list @param {function} rng @returns {number[]}
   */
  function shuffle(list, rng) {
    const out = (Array.isArray(list) ? list : []).slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = pickIndex(rng, i + 1);
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  /* ============ The banker's arithmetic (spec 12 §1) ============ */

  /**
   * The "nice" number the banker actually says out loud: nearest 100 under
   * 10k, nearest 1k under 100k, nearest 5k above. GUARD: when that rounding
   * would land on nothing at all (a board whose last amounts are pennies) the
   * offer is given to the cent instead — the banker never offers zero while
   * there is money on the board.
   * @param {number} raw @returns {number}
   */
  function niceOffer(raw) {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    let v;
    if (raw < 10000) v = Math.round(raw / 100) * 100;
    else if (raw < 100000) v = Math.round(raw / 1000) * 1000;
    else v = Math.round(raw / 5000) * 5000;
    if (v > 0) return v;
    return Math.round(raw * 100) / 100;
  }

  /**
   * The jitter multiplier for one call: rng 0 is the low end, 1 the high end,
   * 0.5 dead centre. Always inside plus/minus `jitter` (N-U4).
   * @param {number} jitter @param {function} rng @returns {number}
   */
  function jitterFactor(jitter, rng) {
    const span = Number.isFinite(jitter) ? Math.min(Math.max(jitter, 0), MAX_JITTER) : 0;
    const rand = typeof rng === "function" ? Number(rng()) : 0.5;
    const r = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 1) : 0.5;
    return 1 + (r * 2 - 1) * span;
  }

  /**
   * `offer = niceOffer(EV x factor x (1 + jitter))` — spec 12 §1.3.
   * @param {number} ev @param {number} factor @param {number} jitter
   * @param {function} rng @returns {number}
   */
  function offerFrom(ev, factor, jitter, rng) {
    const mean = Number.isFinite(ev) ? ev : 0;
    const f = Number.isFinite(factor) ? factor : 0;
    return niceOffer(mean * f * jitterFactor(jitter, rng));
  }

  /* ============ Export ============ */

  return {
    // constants
    DEFAULT_AMOUNTS, DEFAULT_ROUNDS, DEFAULT_FACTORS, DEFAULT_JITTER, DEFAULT_SETTINGS,
    MIN_CASES, MAX_CASES, MAX_FACTOR, MAX_JITTER, TITLE_MAX, NAME_MAX, PID_MAX,
    // helpers
    isPlainObject, isPosInt, isIntIn, cleanText, fail, pickIndex, largestRemainder,
    // content
    validateBoard, validateGame: validateBoard, normalizeBoard, warningsFor, factorsFor,
    // maths
    shuffle, niceOffer, jitterFactor, offerFrom,
  };
});

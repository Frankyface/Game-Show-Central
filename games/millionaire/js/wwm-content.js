/* ============================================================
   Who Wants to Be a Millionaire — content rules (PURE)
   The JSON contract from spec 08 §2: what a playable Millionaire
   file may contain, how a loaded file is normalised (levels
   assigned, questions sorted, ids stamped), how a question is
   drawn for a level without repeating one, and the small pieces
   of maths the reducer needs (50:50 pair, largest-remainder
   percentages). Split out of wwm-core.js so both files stay well
   under the 800-line house limit; wwm-core.js re-exports
   everything here, so callers only ever touch WwmCore.
   No DOM, no timers, no mutation of the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WwmContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const DEFAULT_MONEY_TREE = [
    100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000,
    32000, 64000, 125000, 250000, 500000, 1000000,
  ];
  const DEFAULT_SAFE_HAVENS = [5, 10];
  const LIFELINE_KEYS = ["fifty", "phone", "audience", "switch"];
  const DEFAULT_LIFELINES = Object.freeze({ fifty: true, phone: true, audience: true, switch: false });
  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    moneyTree: DEFAULT_MONEY_TREE,
    safeHavens: DEFAULT_SAFE_HAVENS,
    lifelines: DEFAULT_LIFELINES,
    phoneSeconds: 30,
    audienceSeconds: 20,
    fastestFinger: true,
  });

  const Q_MAX = 200;          // question text cap (spec 08 §2)
  const OPTION_MAX = 60;      // one option
  const CAT_MAX = 30;
  const TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const NAME_MAX = 24;        // friend name / player name
  const MIN_QUESTIONS = 15;
  const MIN_TREE = 5;
  const MAX_TREE = 20;
  const MAX_TIMER_SECONDS = 120;
  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{id:string, level:number, category:string, q:string,
   *            options:string[], answer:number}} Question
   * @typedef {{id:string, q:string, options:string[], order:number[]}} FffQuestion
   * @typedef {{currency:string, moneyTree:number[], safeHavens:number[],
   *            lifelines:Record<string,boolean>, phoneSeconds:number,
   *            audienceSeconds:number, fastestFinger:boolean}} Settings
   * @typedef {{title:string, settings:Settings, questions:Question[],
   *            fastestFinger:FffQuestion[]}} Game
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

  /* ============ Validation ============ */

  /**
   * Throw a plain-English Error when `game` is not a playable Millionaire
   * file. Returns true so callers can use it as an assertion.
   * @param {unknown} game
   * @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("This file is not a Millionaire game: expected a JSON object.");
    if (game.title !== undefined && typeof game.title !== "string") fail("“title” must be text.");
    validateSettings(game.settings);
    const tree = treeOf(game);
    validateQuestions(game.questions, tree.length);
    validateFastestFinger(game, wantsFastestFinger(game));
    return true;
  }

  /** The money tree a file will actually play with (its own, or the default). */
  function treeOf(game) {
    const s = isPlainObject(game) && isPlainObject(game.settings) ? game.settings : {};
    return Array.isArray(s.moneyTree) && s.moneyTree.length ? s.moneyTree : DEFAULT_MONEY_TREE;
  }

  function wantsFastestFinger(game) {
    const s = isPlainObject(game) && isPlainObject(game.settings) ? game.settings : {};
    return s.fastestFinger !== false;
  }

  /** @param {unknown} raw */
  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail("“settings” must be an object.");
    const s = raw;
    if (s.currency !== undefined && (typeof s.currency !== "string" || s.currency.length > CURRENCY_MAX)) {
      fail("“settings.currency” must be text of at most 3 characters.");
    }
    if (s.moneyTree !== undefined) validateTree(s.moneyTree);
    if (s.safeHavens !== undefined) validateHavens(s.safeHavens, treeOf({ settings: s }).length);
    if (s.lifelines !== undefined) validateLifelines(s.lifelines);
    validateTimer(s.phoneSeconds, "phoneSeconds");
    validateTimer(s.audienceSeconds, "audienceSeconds");
    if (s.fastestFinger !== undefined && typeof s.fastestFinger !== "boolean") {
      fail("“settings.fastestFinger” must be true or false.");
    }
  }

  function validateTimer(value, key) {
    if (value === undefined) return;
    if (!isIntIn(value, 0, MAX_TIMER_SECONDS)) {
      fail(`“settings.${key}” must be a whole number of seconds from 0 to ${MAX_TIMER_SECONDS}.`);
    }
  }

  /** @param {unknown} tree */
  function validateTree(tree) {
    if (!Array.isArray(tree) || tree.length < MIN_TREE || tree.length > MAX_TREE) {
      fail(`“settings.moneyTree” must be a list of ${MIN_TREE} to ${MAX_TREE} money values.`);
    }
    for (let i = 0; i < tree.length; i += 1) {
      if (!isPosInt(tree[i])) fail("Every value in the money tree must be a whole number above zero.");
      if (i > 0 && tree[i] <= tree[i - 1]) {
        fail("The money tree must increase at every rung — each question is worth more than the last.");
      }
    }
  }

  /** @param {unknown} havens @param {number} rungs */
  function validateHavens(havens, rungs) {
    if (!Array.isArray(havens)) fail("“settings.safeHavens” must be a list of rung numbers.");
    for (let i = 0; i < havens.length; i += 1) {
      if (!isIntIn(havens[i], 1, rungs)) {
        fail(`Every safe haven must be a rung number from 1 to ${rungs} — ${String(havens[i])} is outside the money tree.`);
      }
      if (i > 0 && havens[i] <= havens[i - 1]) fail("Safe havens must be listed in rising order, with no repeats.");
    }
  }

  /** @param {unknown} raw */
  function validateLifelines(raw) {
    if (!isPlainObject(raw)) fail("“settings.lifelines” must be an object.");
    Object.keys(raw).forEach((key) => {
      if (LIFELINE_KEYS.indexOf(key) < 0) {
        fail(`“${key}” is not a lifeline. Use ${LIFELINE_KEYS.join(", ")}.`);
      }
      if (typeof raw[key] !== "boolean") fail(`“settings.lifelines.${key}” must be true or false.`);
    });
  }

  /** Shared by the quiz questions and the Fastest Finger items. */
  function validateOptions(options, at) {
    if (!Array.isArray(options) || options.length !== 4) fail(`${at} must have exactly 4 options.`);
    const seen = new Set();
    options.forEach((opt, i) => {
      if (typeof opt !== "string" || !opt.trim()) fail(`${at} option ${"ABCD"[i]} is empty.`);
      if (opt.length > OPTION_MAX) fail(`${at} option ${"ABCD"[i]} is longer than ${OPTION_MAX} characters.`);
      const key = opt.trim().toLowerCase();
      if (seen.has(key)) fail(`${at} repeats the option “${opt.trim()}” — all four must differ.`);
      seen.add(key);
    });
  }

  /** @param {unknown} questions @param {number} rungs */
  function validateQuestions(questions, rungs) {
    if (!Array.isArray(questions)) fail("“questions” must be a list.");
    if (questions.length < MIN_QUESTIONS) {
      fail(`A Millionaire game needs at least ${MIN_QUESTIONS} questions — this file has ${questions.length}.`);
    }
    questions.forEach((row, i) => {
      const at = `Question ${i + 1}`;
      if (!isPlainObject(row)) fail(`${at} is not an object.`);
      if (typeof row.q !== "string" || !row.q.trim()) fail(`${at} has no question text.`);
      if (row.q.length > Q_MAX) fail(`${at} is longer than ${Q_MAX} characters.`);
      validateOptions(row.options, at);
      if (!isIntIn(row.answer, 0, 3)) fail(`${at} needs an “answer” of 0, 1, 2 or 3.`);
      if (row.level !== undefined && row.level !== null && !isIntIn(row.level, 1, rungs)) {
        fail(`${at} has level ${String(row.level)}; the money tree only has ${rungs} rungs.`);
      }
      if (row.category !== undefined && row.category !== null) {
        if (typeof row.category !== "string") fail(`${at}'s category must be text.`);
        if (row.category.length > CAT_MAX) fail(`${at}'s category is longer than ${CAT_MAX} characters.`);
      }
    });
  }

  /**
   * Fastest Finger items. Required only when the file explicitly switches the
   * round on: a file that leaves `settings.fastestFinger` unset simply plays
   * without it (normalizeGame turns the flag off), which keeps hand-written
   * question sets usable. Deviation noted in the README.
   */
  function validateFastestFinger(game, enabled) {
    const list = game.fastestFinger;
    const explicit = isPlainObject(game.settings) && game.settings.fastestFinger === true;
    if (list === undefined || list === null) {
      if (explicit) fail("Fastest Finger is switched on but the file has no “fastestFinger” questions.");
      return;
    }
    if (!Array.isArray(list)) fail("“fastestFinger” must be a list.");
    if (explicit && list.length < 1) fail("Fastest Finger is switched on but the list is empty.");
    void enabled;
    list.forEach((row, i) => {
      const at = `Fastest Finger question ${i + 1}`;
      if (!isPlainObject(row)) fail(`${at} is not an object.`);
      if (typeof row.q !== "string" || !row.q.trim()) fail(`${at} has no question text.`);
      if (row.q.length > Q_MAX) fail(`${at} is longer than ${Q_MAX} characters.`);
      validateOptions(row.options, at);
      if (!isPermutation(row.order)) {
        fail(`${at} needs an “order” listing 0, 1, 2 and 3 exactly once each.`);
      }
    });
  }

  /** Is `order` a permutation of 0..3? */
  function isPermutation(order) {
    if (!Array.isArray(order) || order.length !== 4) return false;
    const seen = [false, false, false, false];
    for (const v of order) {
      if (!isIntIn(v, 0, 3) || seen[v]) return false;
      seen[v] = true;
    }
    return true;
  }

  /**
   * Non-fatal advice about a (already valid) game, for the editor badge.
   * @param {Game|{questions?:unknown[]}} game
   * @returns {string[]}
   */
  function warningsFor(game) {
    const out = [];
    const norm = safeNormalize(game);
    if (!norm) return ["This game cannot be read yet."];
    const rungs = norm.settings.moneyTree.length;
    const thin = [];
    for (let level = 1; level <= rungs; level += 1) {
      const n = norm.questions.filter((q) => q.level === level).length;
      if (n < 2) thin.push(`${level} (${n})`);
    }
    if (thin.length) {
      out.push(`Levels with fewer than 2 questions: ${thin.join(", ")} — a second contestant may repeat questions.`);
    }
    if (norm.settings.fastestFinger && norm.fastestFinger.length < 2) {
      out.push("Only one Fastest Finger question — a second round will repeat it.");
    }
    return out;
  }

  function safeNormalize(game) {
    try {
      return normalizeGame(game);
    } catch (err) {
      void err;
      return null;
    }
  }

  /* ============ Normalisation ============ */

  /**
   * Validate then return a fully-defaulted copy with levels assigned, stable
   * ids stamped and the questions sorted by level. Never mutates the input.
   * @param {unknown} game
   * @returns {Game}
   */
  function normalizeGame(game) {
    validateGame(game);
    const raw = /** @type {Record<string, unknown>} */ (game);
    const settings = normalizeSettings(raw.settings, Array.isArray(raw.fastestFinger) ? raw.fastestFinger.length : 0);
    const rungs = settings.moneyTree.length;
    const questions = assignLevels(/** @type {any[]} */ (raw.questions), rungs)
      .map((row, i) => ({
        id: `q${i + 1}`,
        level: row.level,
        category: cleanText(row.source.category, CAT_MAX),
        q: cleanText(row.source.q, Q_MAX),
        options: row.source.options.map((o) => cleanText(o, OPTION_MAX)),
        answer: row.source.answer,
      }))
      .sort((a, b) => (a.level - b.level) || (Number(a.id.slice(1)) - Number(b.id.slice(1))));
    const fff = (Array.isArray(raw.fastestFinger) ? raw.fastestFinger : []).map((row, i) => ({
      id: `f${i + 1}`,
      q: cleanText(row.q, Q_MAX),
      options: row.options.map((o) => cleanText(o, OPTION_MAX)),
      order: row.order.slice(),
    }));
    return {
      title: cleanText(raw.title, TITLE_MAX) || "Millionaire",
      settings, questions, fastestFinger: fff,
    };
  }

  /** @param {unknown} raw @param {number} fffCount */
  function normalizeSettings(raw, fffCount) {
    const s = isPlainObject(raw) ? raw : {};
    const moneyTree = Array.isArray(s.moneyTree) && s.moneyTree.length
      ? s.moneyTree.slice() : DEFAULT_MONEY_TREE.slice();
    const havens = Array.isArray(s.safeHavens)
      ? s.safeHavens.slice()
      : (moneyTree.length === DEFAULT_MONEY_TREE.length ? DEFAULT_SAFE_HAVENS.slice() : []);
    const lifelines = {};
    LIFELINE_KEYS.forEach((key) => {
      const given = isPlainObject(s.lifelines) ? s.lifelines[key] : undefined;
      lifelines[key] = typeof given === "boolean" ? given : DEFAULT_LIFELINES[key];
    });
    return {
      currency: typeof s.currency === "string" && s.currency ? s.currency : DEFAULT_SETTINGS.currency,
      moneyTree,
      safeHavens: havens.filter((h) => isIntIn(h, 1, moneyTree.length)),
      lifelines,
      phoneSeconds: isIntIn(s.phoneSeconds, 0, MAX_TIMER_SECONDS) ? s.phoneSeconds : DEFAULT_SETTINGS.phoneSeconds,
      audienceSeconds: isIntIn(s.audienceSeconds, 0, MAX_TIMER_SECONDS)
        ? s.audienceSeconds : DEFAULT_SETTINGS.audienceSeconds,
      // No items means no round, whatever the flag says: the host screen would
      // otherwise offer a Fastest Finger it can never open.
      fastestFinger: s.fastestFinger !== false && fffCount > 0,
    };
  }

  /**
   * Give every question a level. Explicit levels are kept; the rest are spread
   * evenly over the tree by file order (spec 08 §2), so a plain list of 45
   * questions becomes 3 per rung of a 15-rung tree.
   */
  function assignLevels(questions, rungs) {
    const n = questions.length;
    return questions.map((source, i) => {
      const given = source.level;
      const level = isIntIn(given, 1, rungs) ? given : Math.min(rungs, Math.floor((i * rungs) / n) + 1);
      return { level, source };
    });
  }

  /* ============ Drawing questions ============ */

  /** Every question sitting on a rung; falls back to the nearest stocked rung. */
  function poolFor(game, level) {
    const exact = game.questions.filter((q) => q.level === level);
    if (exact.length) return exact;
    let bestLevel = null;
    let bestDistance = Infinity;
    game.questions.forEach((q) => {
      const d = Math.abs(q.level - level);
      if (d < bestDistance) { bestDistance = d; bestLevel = q.level; }
    });
    return bestLevel === null ? [] : game.questions.filter((q) => q.level === bestLevel);
  }

  /**
   * Draw a question for `level` that no contestant has seen. Once a rung is
   * exhausted the pool wraps and `wrapped` is true so the host can be told.
   * @returns {{question:Question|null, wrapped:boolean}}
   */
  function drawQuestion(game, level, used, rng) {
    const pool = poolFor(game, level);
    if (!pool.length) return { question: null, wrapped: false };
    const usedSet = new Set(Array.isArray(used) ? used : []);
    const fresh = pool.filter((q) => !usedSet.has(q.id));
    const from = fresh.length ? fresh : pool;
    return { question: from[pickIndex(rng, from.length)], wrapped: fresh.length === 0 };
  }

  /** The same draw for the Fastest Finger pool. */
  function drawFff(game, used, rng) {
    const pool = game.fastestFinger || [];
    if (!pool.length) return { question: null, wrapped: false };
    const usedSet = new Set(Array.isArray(used) ? used : []);
    const fresh = pool.filter((q) => !usedSet.has(q.id));
    const from = fresh.length ? fresh : pool;
    return { question: from[pickIndex(rng, from.length)], wrapped: fresh.length === 0 };
  }

  /**
   * The two wrong options 50:50 takes away, ascending. Deterministic under an
   * injected rng, so a test can assert the exact pair.
   * @returns {number[]}
   */
  function fiftyFiftyPair(question, rng) {
    const wrong = [0, 1, 2, 3].filter((i) => i !== question.answer);
    for (let i = wrong.length - 1; i > 0; i -= 1) {
      const j = pickIndex(rng, i + 1);
      const tmp = wrong[i];
      wrong[i] = wrong[j];
      wrong[j] = tmp;
    }
    return wrong.slice(0, 2).sort((a, b) => a - b);
  }

  /* ============ Percentages ============ */

  /**
   * Turn four weights into four whole percentages that sum to exactly 100,
   * using largest-remainder rounding (ties go to the earlier option).
   * All-zero weights stay all-zero: nobody has voted yet.
   * @param {number[]} weights
   * @returns {number[]}
   */
  function largestRemainder(weights) {
    const safe = (Array.isArray(weights) ? weights : []).map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
    while (safe.length < 4) safe.push(0);
    const total = safe.reduce((a, b) => a + b, 0);
    if (total <= 0) return [0, 0, 0, 0];
    const exact = safe.map((w) => (w * 100) / total);
    const out = exact.map((v) => Math.floor(v));
    let left = 100 - out.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
    for (let k = 0; left > 0 && k < order.length; k += 1) {
      out[order[k].i] += 1;
      left -= 1;
    }
    return out;
  }

  /* ============ Export ============ */

  return {
    DEFAULT_MONEY_TREE, DEFAULT_SAFE_HAVENS, DEFAULT_LIFELINES, DEFAULT_SETTINGS, LIFELINE_KEYS,
    Q_MAX, OPTION_MAX, CAT_MAX, TITLE_MAX, NAME_MAX, MIN_QUESTIONS, MIN_TREE, MAX_TREE,
    MAX_TIMER_SECONDS,
    isPlainObject, isPosInt, isIntIn, cleanText, fail, pickIndex, isPermutation,
    validateGame, normalizeGame, warningsFor,
    poolFor, drawQuestion, drawFff, fiftyFiftyPair, largestRemainder,
  };
});

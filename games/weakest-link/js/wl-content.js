/* ============================================================
   Weakest Link — content rules (PURE)
   The JSON contract from spec 05 §2: what a playable Weakest Link
   file may contain, how a loaded file is normalised, and how the
   question order is built. Split out of wl-core.js so both files
   stay well under the 800-line house limit; wl-core.js re-exports
   everything here, so callers only ever touch WlCore.
   No DOM, no timers, no mutation of the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WlContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const DEFAULT_CHAIN = [1000, 2500, 5000, 10000, 25000, 50000, 75000, 125000];
  const DEFAULT_ROUND_SECONDS = [150, 140, 130, 120, 110, 100, 90, 90, 90, 90];
  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    chain: DEFAULT_CHAIN,
    roundSeconds: DEFAULT_ROUND_SECONDS,
    finalPlayers: 2,
    finalQuestionsEach: 5,
    finalMultiplier: 3,
    topOfChainEndsRound: true,
  });

  const Q_MAX = 200;          // question text cap (spec §2)
  const A_MAX = 80;           // answer text cap
  const CAT_MAX = 30;         // category label cap
  const TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const MIN_QUESTIONS = 40;   // validator floor
  const WARN_QUESTIONS = 120; // editor warning threshold
  const MIN_CHAIN = 3;
  const MAX_CHAIN = 12;
  const MAX_ROUND_SECONDS = 600;
  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{q:string, a:string, category:string}} Question
   * @typedef {{currency:string, chain:number[], roundSeconds:number[],
   *            finalPlayers:number, finalQuestionsEach:number,
   *            finalMultiplier:number, topOfChainEndsRound:boolean}} Settings
   * @typedef {{title:string, settings:Settings, questions:Question[]}} Game
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

  /** Positive integer test used by every numeric setting. */
  function isPosInt(v) {
    return Number.isInteger(v) && v > 0;
  }

  /* ============ Validation ============ */

  /**
   * Throw a plain-English Error when `game` is not a playable Weakest Link
   * file. Returns true so callers can use it as an assertion.
   * @param {unknown} game
   * @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("This file is not a Weakest Link game: expected a JSON object.");
    if (game.title !== undefined && typeof game.title !== "string") {
      fail("“title” must be text.");
    }
    validateSettings(game.settings);
    validateQuestions(game.questions);
    return true;
  }

  /** @param {unknown} raw */
  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail("“settings” must be an object.");
    const s = raw;
    if (s.currency !== undefined) {
      if (typeof s.currency !== "string" || s.currency.length > CURRENCY_MAX) {
        fail("“settings.currency” must be text of at most 3 characters.");
      }
    }
    if (s.chain !== undefined) validateChain(s.chain);
    if (s.roundSeconds !== undefined) validateRoundSeconds(s.roundSeconds);
    if (s.finalPlayers !== undefined && s.finalPlayers !== 2) {
      fail("“settings.finalPlayers” must be 2 — only a two-player head-to-head is supported.");
    }
    if (s.finalQuestionsEach !== undefined
        && (!Number.isInteger(s.finalQuestionsEach) || s.finalQuestionsEach < 1 || s.finalQuestionsEach > 10)) {
      fail("“settings.finalQuestionsEach” must be a whole number from 1 to 10.");
    }
    if (s.finalMultiplier !== undefined
        && (!Number.isInteger(s.finalMultiplier) || s.finalMultiplier < 1 || s.finalMultiplier > 5)) {
      fail("“settings.finalMultiplier” must be a whole number from 1 to 5.");
    }
    if (s.topOfChainEndsRound !== undefined && typeof s.topOfChainEndsRound !== "boolean") {
      fail("“settings.topOfChainEndsRound” must be true or false.");
    }
  }

  /** @param {unknown} chain */
  function validateChain(chain) {
    if (!Array.isArray(chain) || chain.length < MIN_CHAIN || chain.length > MAX_CHAIN) {
      fail("“settings.chain” must be a list of 3 to 12 money values.");
    }
    for (let i = 0; i < chain.length; i += 1) {
      if (!isPosInt(chain[i])) fail("Every value in “settings.chain” must be a whole number above zero.");
      if (i > 0 && chain[i] <= chain[i - 1]) {
        fail("“settings.chain” must increase at every step (each link is worth more than the last).");
      }
    }
  }

  /** @param {unknown} secs */
  function validateRoundSeconds(secs) {
    if (!Array.isArray(secs) || secs.length === 0) {
      fail("“settings.roundSeconds” must be a list of round lengths in seconds.");
    }
    for (const value of secs) {
      if (!isPosInt(value) || value > MAX_ROUND_SECONDS) {
        fail("Every round length must be a whole number of seconds from 1 to 600.");
      }
    }
  }

  /** @param {unknown} questions */
  function validateQuestions(questions) {
    if (!Array.isArray(questions)) fail("“questions” must be a list.");
    if (questions.length < MIN_QUESTIONS) {
      fail(`This game needs at least ${MIN_QUESTIONS} questions — it has ${questions.length}.`);
    }
    questions.forEach((row, i) => {
      const at = `Question ${i + 1}`;
      if (!isPlainObject(row)) fail(`${at} is not an object.`);
      if (typeof row.q !== "string" || !row.q.trim()) fail(`${at} has no question text.`);
      if (row.q.length > Q_MAX) fail(`${at} is longer than ${Q_MAX} characters.`);
      if (typeof row.a !== "string" || !row.a.trim()) fail(`${at} has no answer.`);
      if (row.a.length > A_MAX) fail(`${at}'s answer is longer than ${A_MAX} characters.`);
      if (row.category !== undefined && row.category !== null) {
        if (typeof row.category !== "string") fail(`${at}'s category must be text.`);
        if (row.category.length > CAT_MAX) fail(`${at}'s category is longer than ${CAT_MAX} characters.`);
      }
    });
  }

  /**
   * Non-fatal advice about a (already valid) game, for the editor badge.
   * @param {Game|{questions?:unknown[]}} game
   * @returns {string[]}
   */
  function warningsFor(game) {
    const out = [];
    const list = game && Array.isArray(game.questions) ? game.questions : [];
    if (list.length < WARN_QUESTIONS) {
      out.push(`Only ${list.length} questions — a 6-player game uses ~150. Add more or expect repeats.`);
    }
    const cats = new Set();
    list.forEach((row) => { if (row && row.category) cats.add(String(row.category)); });
    if (list.length >= WARN_QUESTIONS && cats.size < 4) {
      out.push("Fewer than 4 categories — the round will feel repetitive.");
    }
    return out;
  }

  /**
   * Validate then return a frozen, fully-defaulted copy. Never mutates input.
   * @param {unknown} game
   * @returns {Game}
   */
  function normalizeGame(game) {
    validateGame(game);
    const raw = /** @type {Record<string, unknown>} */ (game);
    const s = isPlainObject(raw.settings) ? raw.settings : {};
    /** @type {Settings} */
    const settings = {
      currency: typeof s.currency === "string" && s.currency ? s.currency : DEFAULT_SETTINGS.currency,
      chain: Array.isArray(s.chain) ? s.chain.slice() : DEFAULT_CHAIN.slice(),
      roundSeconds: Array.isArray(s.roundSeconds) ? s.roundSeconds.slice() : DEFAULT_ROUND_SECONDS.slice(),
      finalPlayers: 2,
      finalQuestionsEach: Number.isInteger(s.finalQuestionsEach) ? s.finalQuestionsEach : DEFAULT_SETTINGS.finalQuestionsEach,
      finalMultiplier: Number.isInteger(s.finalMultiplier) ? s.finalMultiplier : DEFAULT_SETTINGS.finalMultiplier,
      topOfChainEndsRound: typeof s.topOfChainEndsRound === "boolean"
        ? s.topOfChainEndsRound : DEFAULT_SETTINGS.topOfChainEndsRound,
    };
    const questions = /** @type {Question[]} */ (raw.questions).map((row) => ({
      q: cleanText(row.q, Q_MAX),
      a: cleanText(row.a, A_MAX),
      category: cleanText(row.category, CAT_MAX),
    }));
    return { title: cleanText(raw.title, TITLE_MAX) || "Weakest Link", settings, questions };
  }

  /* ============ Question order ============ */

  /** Fisher-Yates with an injected rng so a shuffle is reproducible. */
  function buildOrder(count, shuffle, rng) {
    const order = [];
    for (let i = 0; i < count; i += 1) order.push(i);
    if (!shuffle) return order;
    const rand = typeof rng === "function" ? rng : Math.random;
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1)) % (i + 1);
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return order;
  }


  /* ============ Export ============ */

  return {
    DEFAULT_CHAIN, DEFAULT_ROUND_SECONDS, DEFAULT_SETTINGS,
    Q_MAX, A_MAX, CAT_MAX, TITLE_MAX, MIN_QUESTIONS, WARN_QUESTIONS,
    isPlainObject, isPosInt, cleanText, fail,
    validateGame, normalizeGame, warningsFor, buildOrder,
  };
});

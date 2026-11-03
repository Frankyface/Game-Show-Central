/* ============================================================
   The Chase — content rules (PURE)
   The JSON contract from spec 15 §2: what a playable Chase file
   may hold, how a loaded file is normalised (text cleaned,
   settings filled in), and how the night's question order is
   drawn. Split out of chase-core.js so every file stays well
   under the 800-line house limit; chase-core.js re-exports
   everything here, so callers only ever touch ChaseCore.

   No DOM, no timers, no randomness of its own (an `rng` is
   injected) and nothing here mutates the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ChaseContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    steps: 7,
    startStep: 3,
    cashBuilderValue: 1000,
    cashBuilderSeconds: 60,
    higherMultiplier: 5,
    lowerDivisor: 2,
    finalSeconds: 120,
    chaserIsHost: true,
    headStartPerMember: 1,
    minHeadStart: 1,
    chaserName: "The Chaser",
  });

  const OPTION_COUNT = 3;        // spec 15 §1: head-to-head questions have three options
  const Q_MAX = 200;             // one question
  const A_MAX = 80;              // a rapid-fire answer
  const OPTION_MAX = 60;         // one multiple-choice option
  const GAME_TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const NAME_MAX = 24;           // a player / chaser name
  const PID_MAX = 40;

  const MIN_RAPID = 80;          // a playable file
  const COMFORTABLE_RAPID = 200; // below this the editor warns
  const MIN_MULTI = 40;
  const COMFORTABLE_MULTI = 60;
  const MAX_QUESTIONS = 2000;    // a structural cap, not a rule of the show

  const MAX_CONTESTANTS = 4;     // spec 15 §1: a team of up to four

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{q:string, a:string}} Rapid
   * @typedef {{q:string, options:string[], answer:number}} Multi
   * @typedef {{title:string, settings:object, rapid:Rapid[], multi:Multi[]}} Game
   */

  /* ============ Small helpers ============ */

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  /** Strip control chars, collapse runs of blanks, trim, cap. "" when empty. */
  function cleanText(raw, max) {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  }

  function fail(message) {
    throw new Error(message);
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

  /** Case-insensitive key, so two options that differ only in case collide. */
  function foldKey(text) {
    return String(text).toLowerCase().replace(new RegExp("’", "g"), "'").trim();
  }

  /* ============ Settings ============ */

  /** The settings a file will actually play with: its own, over the defaults. */
  function settingsOf(game) {
    const raw = isPlainObject(game) && isPlainObject(game.settings) ? game.settings : {};
    return Object.assign({}, DEFAULT_SETTINGS, raw);
  }

  const NUMBER_RULES = [
    ["steps", 3, 12, "steps on the board"],
    ["startStep", 1, 11, "step the contestant starts on"],
    ["cashBuilderValue", 1, 1000000, "value of one Cash Builder answer"],
    ["cashBuilderSeconds", 15, 300, "seconds in the Cash Builder"],
    ["higherMultiplier", 2, 100, "multiplier for the higher offer"],
    ["lowerDivisor", 2, 10, "divisor for the lower offer"],
    ["finalSeconds", 30, 600, "seconds in each half of the Final Chase"],
    ["headStartPerMember", 0, 3, "head start per finalist"],
    ["minHeadStart", 0, 4, "smallest head start"],
  ];

  const FLAGS = ["chaserIsHost"];

  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail("“settings” must be an object.");
    if (raw.currency !== undefined && (typeof raw.currency !== "string" || raw.currency.length > CURRENCY_MAX)) {
      fail(`“settings.currency” must be text of at most ${CURRENCY_MAX} characters.`);
    }
    if (raw.chaserName !== undefined && (typeof raw.chaserName !== "string" || raw.chaserName.length > NAME_MAX)) {
      fail(`“settings.chaserName” must be text of at most ${NAME_MAX} characters.`);
    }
    NUMBER_RULES.forEach(([key, lo, hi, what]) => {
      if (raw[key] !== undefined && !isIntIn(raw[key], lo, hi)) {
        fail(`“settings.${key}” (the ${what}) must be a whole number between ${lo} and ${hi}.`);
      }
    });
    FLAGS.forEach((key) => {
      if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
        fail(`“settings.${key}” must be true or false.`);
      }
    });
    validateBoardShape(Object.assign({}, DEFAULT_SETTINGS, raw));
  }

  /**
   * The board has to leave room for both offers: one step above the start for
   * the higher offer, one below for the lower, and the Chaser above them all.
   */
  function validateBoardShape(s) {
    if (s.startStep >= s.steps) {
      fail(`“settings.startStep” (${s.startStep}) must be below “settings.steps” (${s.steps}) — `
        + "the Chaser starts on the top step.");
    }
    if (s.startStep < 2 || s.startStep > s.steps - 2) {
      fail(`“settings.startStep” must be between 2 and ${s.steps - 2} on a ${s.steps}-step board, `
        + "so the higher and lower offers both have a step to move to.");
    }
  }

  /* ============ Validation ============ */

  /**
   * Throw a plain-English Error when `game` is not a playable Chase file.
   * Returns true so callers can use it as an assertion.
   * @param {unknown} game
   * @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("This file is not a Chase game: expected a JSON object.");
    if (game.title !== undefined && typeof game.title !== "string") fail("“title” must be text.");
    if (typeof game.title === "string" && game.title.length > GAME_TITLE_MAX) {
      fail(`“title” must be at most ${GAME_TITLE_MAX} characters.`);
    }
    validateSettings(game.settings);
    validateRapid(game.rapid);
    validateMulti(game.multi);
    return true;
  }

  function validateRapid(list) {
    if (!Array.isArray(list)) fail("“rapid” must be a list of rapid-fire questions.");
    if (list.length < MIN_RAPID) {
      fail(`A Chase game needs at least ${MIN_RAPID} rapid-fire questions; this file has ${list.length}.`);
    }
    if (list.length > MAX_QUESTIONS) fail(`“rapid” has more than ${MAX_QUESTIONS} questions.`);
    const seen = new Set();
    list.forEach((raw, i) => validateRapidItem(raw, i, seen));
  }

  function validateRapidItem(raw, i, seen) {
    const where = `Rapid-fire question ${i + 1}`;
    if (!isPlainObject(raw)) fail(`${where} must be an object with “q” and “a”.`);
    const q = cleanText(raw.q, Q_MAX);
    const a = cleanText(raw.a, A_MAX);
    if (typeof raw.q !== "string" || !q) fail(`${where} has no question text.`);
    if (raw.q.length > Q_MAX) fail(`${where} is longer than ${Q_MAX} characters.`);
    if (typeof raw.a !== "string" || !a) fail(`${where} (“${q}”) has no answer.`);
    if (raw.a.length > A_MAX) fail(`${where}: the answer is longer than ${A_MAX} characters.`);
    if (seen.has(foldKey(q))) fail(`${where} (“${q}”) is in the list twice.`);
    seen.add(foldKey(q));
  }

  function validateMulti(list) {
    if (!Array.isArray(list)) fail("“multi” must be a list of head-to-head questions.");
    if (list.length < MIN_MULTI) {
      fail(`A Chase game needs at least ${MIN_MULTI} head-to-head questions; this file has ${list.length}.`);
    }
    if (list.length > MAX_QUESTIONS) fail(`“multi” has more than ${MAX_QUESTIONS} questions.`);
    const seen = new Set();
    list.forEach((raw, i) => validateMultiItem(raw, i, seen));
  }

  function validateMultiItem(raw, i, seen) {
    const where = `Head-to-head question ${i + 1}`;
    if (!isPlainObject(raw)) fail(`${where} must be an object with “q”, “options” and “answer”.`);
    const q = cleanText(raw.q, Q_MAX);
    if (typeof raw.q !== "string" || !q) fail(`${where} has no question text.`);
    if (raw.q.length > Q_MAX) fail(`${where} is longer than ${Q_MAX} characters.`);
    if (!Array.isArray(raw.options) || raw.options.length !== OPTION_COUNT) {
      fail(`${where} (“${q}”) needs exactly ${OPTION_COUNT} options.`);
    }
    const folded = new Set();
    raw.options.forEach((opt, n) => {
      const text = cleanText(opt, OPTION_MAX);
      if (typeof opt !== "string" || !text) fail(`${where}: option ${"ABC"[n]} is empty.`);
      if (opt.length > OPTION_MAX) fail(`${where}: option ${"ABC"[n]} is longer than ${OPTION_MAX} characters.`);
      if (folded.has(foldKey(text))) fail(`${where}: option ${"ABC"[n]} (“${text}”) repeats another option.`);
      folded.add(foldKey(text));
    });
    if (!isIntIn(raw.answer, 0, OPTION_COUNT - 1)) {
      fail(`${where} (“${q}”): “answer” must be 0, 1 or 2.`);
    }
    if (seen.has(foldKey(q))) fail(`${where} (“${q}”) is in the list twice.`);
    seen.add(foldKey(q));
  }

  /* ============ Normalisation ============ */

  /**
   * A validated file turned into the exact shape the reducer reads: cleaned
   * text and complete settings. Never mutates `game`.
   * @param {Game} game @returns {Game}
   */
  function normalizeGame(game) {
    validateGame(game);
    const settings = settingsOf(game);
    settings.currency = cleanText(settings.currency, CURRENCY_MAX) || "$";
    settings.chaserName = cleanText(settings.chaserName, NAME_MAX) || "The Chaser";
    settings.chaserIsHost = settings.chaserIsHost !== false;
    return {
      title: cleanText(game.title, GAME_TITLE_MAX) || "The Chase",
      settings,
      rapid: game.rapid.map((r) => ({ q: cleanText(r.q, Q_MAX), a: cleanText(r.a, A_MAX) })),
      multi: game.multi.map((m) => ({
        q: cleanText(m.q, Q_MAX),
        options: m.options.map((o) => cleanText(o, OPTION_MAX)),
        answer: m.answer,
      })),
    };
  }

  /** Non-fatal notes for the editor: playable, but worth a second look. */
  function warningsFor(game) {
    const out = [];
    try {
      validateGame(game);
    } catch (err) {
      return [err.message];
    }
    const s = settingsOf(game);
    if (game.rapid.length < COMFORTABLE_RAPID) {
      out.push(`Only ${game.rapid.length} rapid-fire questions — a four-player game uses about 120, `
        + `and the Final Chase eats more. ${COMFORTABLE_RAPID} or more is comfortable.`);
    }
    if (game.multi.length < COMFORTABLE_MULTI) {
      out.push(`Only ${game.multi.length} head-to-head questions — ${COMFORTABLE_MULTI} or more `
        + "keeps four chases from repeating.");
    }
    const longQ = game.rapid.filter((r) => cleanText(r.q, Q_MAX).length > 110).length;
    if (longQ > game.rapid.length / 5) {
      out.push("Many rapid-fire questions are long; the Cash Builder rewards short ones the host can rattle off.");
    }
    if (s.cashBuilderSeconds < 30) out.push("A Cash Builder under 30 seconds is very short.");
    const spread = countAnswers(game.multi);
    if (spread.some((n) => n > game.multi.length * 0.6)) {
      out.push("Most head-to-head answers sit in the same slot — mix A, B and C so nobody can guess the pattern.");
    }
    return out.slice(0, 6);
  }

  /** How many head-to-head answers land on A, B and C. */
  function countAnswers(multi) {
    const out = [0, 0, 0];
    (Array.isArray(multi) ? multi : []).forEach((m) => {
      if (isPlainObject(m) && isIntIn(m.answer, 0, OPTION_COUNT - 1)) out[m.answer] += 1;
    });
    return out;
  }

  /* ============ Drawing the night's questions ============ */

  /** Fisher-Yates-by-splice with an injected rng, so a test can pin a night. */
  function shuffled(list, rng) {
    const pool = list.slice();
    const out = [];
    while (pool.length) out.push(pool.splice(pickIndex(rng, pool.length), 1)[0]);
    return out;
  }

  /**
   * The order the questions come up in. File order by default (a written round
   * rises in difficulty); Shuffle on the setup screen deals with an injected
   * rng.
   * @param {Game} game @param {{shuffle?:boolean, rng?:() => number}} [opts]
   * @returns {{rapid:Rapid[], multi:Multi[]}}
   */
  function drawOrder(game, opts) {
    const o = opts || {};
    const rapid = (game && Array.isArray(game.rapid) ? game.rapid : []).slice();
    const multi = (game && Array.isArray(game.multi) ? game.multi : []).slice();
    if (!o.shuffle) return { rapid, multi };
    const rng = typeof o.rng === "function" ? o.rng : Math.random;
    return { rapid: shuffled(rapid, rng), multi: shuffled(multi, rng) };
  }

  /**
   * The item at `cursor`, wrapping round the list. `repeating` is true once the
   * night has been all the way through: the host sees a plain notice rather
   * than the game stalling.
   * @param {object[]} order @param {number} cursor
   */
  function itemAt(order, cursor) {
    if (!Array.isArray(order) || !order.length) return { item: null, repeating: false };
    const i = ((cursor % order.length) + order.length) % order.length;
    return { item: order[i], repeating: cursor >= order.length };
  }

  /* ============ Export ============ */

  return {
    // helpers
    isPlainObject, isIntIn, cleanText, fail, foldKey, pickIndex, shuffled,
    // content
    validateGame, normalizeGame, warningsFor, settingsOf, drawOrder, itemAt, countAnswers,
    // constants
    DEFAULT_SETTINGS, OPTION_COUNT, MAX_CONTESTANTS,
    Q_MAX, A_MAX, OPTION_MAX, GAME_TITLE_MAX, CURRENCY_MAX, NAME_MAX, PID_MAX,
    MIN_RAPID, COMFORTABLE_RAPID, MIN_MULTI, COMFORTABLE_MULTI, MAX_QUESTIONS,
  };
});

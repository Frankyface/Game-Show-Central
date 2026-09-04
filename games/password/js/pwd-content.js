/* ============================================================
   Password — content rules (PURE)
   The JSON contract from spec 13 §2: what a playable Password
   file may hold, how a loaded file is normalised (text cleaned,
   settings filled in) and how the night's word order is drawn.
   Split out of pwd-core.js so both files stay well under the
   800-line house limit; pwd-core.js re-exports everything here,
   so callers only ever touch PwdCore.

   No DOM, no timers, no randomness of its own (an `rng` is
   injected) and nothing here mutates the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PwdContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    targetScore: 25,
    startValue: 10,
    lightningSeconds: 60,
    lightningWords: 5,
    lightningValue: 100,
    allFiveBonus: true,
    swapRoles: true,
  });

  const WORD_MAX = 20;          // a password (spec 13 §2)
  const GAME_TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const NAME_MAX = 24;          // a player / team name
  const PID_MAX = 40;

  const MIN_WORDS = 60;         // a playable file
  const COMFORTABLE_WORDS = 120; // below this the editor warns

  const MIN_TARGET = 5;
  const MAX_TARGET = 100;
  const MIN_START_VALUE = 3;
  const MAX_START_VALUE = 20;
  const MIN_SECONDS = 15;
  const MAX_SECONDS = 180;
  const MIN_LIGHTNING_WORDS = 1;
  const MAX_LIGHTNING_WORDS = 10;
  const MAX_VALUE = 1000000;

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  // A password is ONE word: letters (accents welcome), apostrophes and
  // hyphens, nothing else. Spaces are what separate a password from a phrase.
  const WORD_SHAPE = new RegExp("^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\u0027\u2019-]*$");

  /**
   * @typedef {{currency:string, targetScore:number, startValue:number,
   *            lightningSeconds:number, lightningWords:number,
   *            lightningValue:number, allFiveBonus:boolean,
   *            swapRoles:boolean}} Settings
   * @typedef {{title:string, settings:Settings, words:string[]}} Game
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

  /** Case-insensitive key, so "Umbrella" and "umbrella" collide. */
  function foldKey(text) {
    return String(text).toLowerCase().replace(new RegExp("\u2019", "g"), "'").trim();
  }

  /* ============ Settings ============ */

  /** The settings a file will actually play with: its own, over the defaults. */
  function settingsOf(game) {
    const raw = isPlainObject(game) && isPlainObject(game.settings) ? game.settings : {};
    return Object.assign({}, DEFAULT_SETTINGS, raw);
  }

  const NUMBER_RULES = [
    ["targetScore", MIN_TARGET, MAX_TARGET, "points to win the game"],
    ["startValue", MIN_START_VALUE, MAX_START_VALUE, "points the first clue is worth"],
    ["lightningSeconds", MIN_SECONDS, MAX_SECONDS, "seconds in the Lightning Round"],
    ["lightningWords", MIN_LIGHTNING_WORDS, MAX_LIGHTNING_WORDS, "words in the Lightning Round"],
    ["lightningValue", 1, MAX_VALUE, "value of one Lightning Round word"],
  ];

  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail("“settings” must be an object.");
    if (raw.currency !== undefined && (typeof raw.currency !== "string" || raw.currency.length > CURRENCY_MAX)) {
      fail(`“settings.currency” must be text of at most ${CURRENCY_MAX} characters.`);
    }
    NUMBER_RULES.forEach(([key, lo, hi, what]) => {
      if (raw[key] !== undefined && !isIntIn(raw[key], lo, hi)) {
        fail(`“settings.${key}” (the ${what}) must be a whole number between ${lo} and ${hi}.`);
      }
    });
    ["allFiveBonus", "swapRoles"].forEach((key) => {
      if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
        fail(`“settings.${key}” must be true or false.`);
      }
    });
  }

  /* ============ Validation ============ */

  /**
   * Throw a plain-English Error when `game` is not a playable Password file.
   * Returns true so callers can use it as an assertion.
   * @param {unknown} game
   * @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("This file is not a Password game: expected a JSON object.");
    if (game.title !== undefined && typeof game.title !== "string") fail("“title” must be text.");
    if (typeof game.title === "string" && game.title.length > GAME_TITLE_MAX) {
      fail(`“title” must be at most ${GAME_TITLE_MAX} characters.`);
    }
    validateSettings(game.settings);
    validateWords(game.words);
    return true;
  }

  function validateWords(list) {
    if (!Array.isArray(list)) fail("“words” must be a list of passwords.");
    if (list.length < MIN_WORDS) {
      fail(`A Password game needs at least ${MIN_WORDS} passwords; this file has ${list.length}.`);
    }
    const seen = new Set();
    list.forEach((raw, i) => validateWord(raw, i, seen));
  }

  function validateWord(raw, i, seen) {
    const where = `Password ${i + 1}`;
    if (typeof raw !== "string") fail(`${where} must be text.`);
    if (raw.length > WORD_MAX) fail(`${where} is longer than ${WORD_MAX} characters.`);
    const word = cleanText(raw, WORD_MAX);
    if (!word) fail(`${where} is empty.`);
    if (word.indexOf(" ") >= 0) {
      fail(`${where} (“${word}”) has a space in it — a password is a single word.`);
    }
    if (!WORD_SHAPE.test(word)) {
      fail(`${where} (“${word}”) may only use letters, apostrophes and hyphens.`);
    }
    if (seen.has(foldKey(word))) {
      fail(`${where}: “${word}” is in the list twice — every password must be different.`);
    }
    seen.add(foldKey(word));
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
    settings.allFiveBonus = settings.allFiveBonus !== false;
    settings.swapRoles = settings.swapRoles !== false;
    return {
      title: cleanText(game.title, GAME_TITLE_MAX) || "Password",
      settings,
      words: game.words.map((w) => cleanText(w, WORD_MAX)),
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
    if (game.words.length < COMFORTABLE_WORDS) {
      out.push(`Only ${game.words.length} passwords — a long night will come round to repeats. `
        + `${COMFORTABLE_WORDS} or more is comfortable.`);
    }
    const perGame = s.targetScore / 2 + s.lightningWords;
    if (game.words.length < perGame * 3) {
      out.push("Three games in one night would use most of this list.");
    }
    const long = game.words.filter((w) => cleanText(w, WORD_MAX).length > 12);
    if (long.length > game.words.length / 4) {
      out.push("Lots of long passwords — the classic show mixes short and long.");
    }
    return out.slice(0, 6);
  }

  /* ============ Drawing the night's words ============ */

  /**
   * The order the passwords come up in. File order by default (the show reads
   * its list in order); Shuffle on the setup screen deals them with an injected
   * rng, so a test can pin the whole night down.
   * @param {Game} game @param {{shuffle?:boolean, rng?:() => number}} [opts]
   * @returns {string[]}
   */
  function drawOrder(game, opts) {
    const o = opts || {};
    const words = (game && Array.isArray(game.words) ? game.words : []).slice();
    if (!o.shuffle) return words;
    const rng = typeof o.rng === "function" ? o.rng : Math.random;
    const out = [];
    while (words.length) out.push(words.splice(pickIndex(rng, words.length), 1)[0]);
    return out;
  }

  /**
   * The word at `cursor`, wrapping round the list. `repeating` is true once the
   * night has been all the way through the file: the host sees a plain notice
   * rather than the game stalling.
   * @param {string[]} order @param {number} cursor
   * @returns {{word:string, repeating:boolean}}
   */
  function wordAt(order, cursor) {
    if (!Array.isArray(order) || !order.length) return { word: "", repeating: false };
    const i = ((cursor % order.length) + order.length) % order.length;
    return { word: order[i], repeating: cursor >= order.length };
  }

  /* ============ Export ============ */

  return {
    // helpers
    isPlainObject, isIntIn, cleanText, fail, foldKey, pickIndex,
    // content
    validateGame, normalizeGame, warningsFor, settingsOf, drawOrder, wordAt,
    // constants
    DEFAULT_SETTINGS, WORD_SHAPE,
    WORD_MAX, GAME_TITLE_MAX, CURRENCY_MAX, NAME_MAX, PID_MAX,
    MIN_WORDS, COMFORTABLE_WORDS,
    MIN_TARGET, MAX_TARGET, MIN_START_VALUE, MAX_START_VALUE,
    MIN_SECONDS, MAX_SECONDS, MIN_LIGHTNING_WORDS, MAX_LIGHTNING_WORDS, MAX_VALUE,
  };
});

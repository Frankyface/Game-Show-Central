/* ============================================================
   Pyramid — content rules (PURE)
   The JSON contract from spec 11 §2: what a playable Pyramid
   file may hold, how a loaded file is normalised (text cleaned,
   settings filled in, ids stamped) and how the categories for
   one night are drawn without repeats. Split out of pyr-core.js
   so both files stay well under the 800-line house limit;
   pyr-core.js re-exports everything here, so callers only ever
   touch PyrCore.

   No DOM, no timers, no randomness of its own (an `rng` is
   injected) and nothing here mutates the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PyrContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const DEFAULT_CIRCLE_VALUES = [200, 300, 400, 500, 800, 1000];

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    categorySeconds: 30,
    circleSeconds: 60,
    tiebreakSeconds: 15,
    wordsPerCategory: 7,
    categoriesPerTeam: 3,
    swapRoles: true,
    circleValues: DEFAULT_CIRCLE_VALUES,
    grandPrize: 10000,
    grandPrizeLabel: "$10,000",
  });

  const TITLE_MAX = 40;         // a category title (spec 11 §2)
  const HINT_MAX = 60;
  const WORD_MAX = 30;
  const CIRCLE_CAT_MAX = 50;
  const GAME_TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const PRIZE_LABEL_MAX = 24;
  const NAME_MAX = 24;          // a player / team name
  const PID_MAX = 40;

  const MIN_CATEGORIES = 12;    // a full game uses 6 + a tiebreak
  const MIN_CIRCLES = 2;
  const CIRCLE_BOXES = 6;

  const MIN_SECONDS = 5;
  const MAX_SECONDS = 300;
  const MIN_WORDS = 3;
  const MAX_WORDS = 12;
  const MIN_PER_TEAM = 1;
  const MAX_PER_TEAM = 6;
  const MAX_VALUE = 1000000;

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{title:string, hint:string, words:string[]}} Category
   * @typedef {{category:string}} CircleBox
   * @typedef {{boxes:CircleBox[]}} CircleSet
   * @typedef {{currency:string, categorySeconds:number, circleSeconds:number,
   *            tiebreakSeconds:number, wordsPerCategory:number,
   *            categoriesPerTeam:number, swapRoles:boolean,
   *            circleValues:number[], grandPrize:number,
   *            grandPrizeLabel:string}} Settings
   * @typedef {{title:string, settings:Settings, categories:Category[],
   *            circles:CircleSet[]}} Game
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

  /** Case-and-space-insensitive key, so "Ice  Cream" and "ice cream" collide. */
  function foldKey(text) {
    return String(text).toLowerCase().replace(/\s+/g, " ").trim();
  }

  /* ============ Settings ============ */

  /** The settings a file will actually play with: its own, over the defaults. */
  function settingsOf(game) {
    const raw = isPlainObject(game) && isPlainObject(game.settings) ? game.settings : {};
    const out = Object.assign({}, DEFAULT_SETTINGS, raw);
    if (!Array.isArray(raw.circleValues) || raw.circleValues.length !== CIRCLE_BOXES) {
      out.circleValues = DEFAULT_CIRCLE_VALUES.slice();
    } else {
      out.circleValues = raw.circleValues.slice();
    }
    return out;
  }

  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail("“settings” must be an object.");
    const s = raw;
    if (s.currency !== undefined && (typeof s.currency !== "string" || s.currency.length > CURRENCY_MAX)) {
      fail("“settings.currency” must be text of at most 3 characters.");
    }
    ["categorySeconds", "circleSeconds", "tiebreakSeconds"].forEach((key) => {
      if (s[key] !== undefined && !isIntIn(s[key], MIN_SECONDS, MAX_SECONDS)) {
        fail(`“settings.${key}” must be a whole number of seconds between ${MIN_SECONDS} and ${MAX_SECONDS}.`);
      }
    });
    if (s.wordsPerCategory !== undefined && !isIntIn(s.wordsPerCategory, MIN_WORDS, MAX_WORDS)) {
      fail(`“settings.wordsPerCategory” must be between ${MIN_WORDS} and ${MAX_WORDS}.`);
    }
    if (s.categoriesPerTeam !== undefined && !isIntIn(s.categoriesPerTeam, MIN_PER_TEAM, MAX_PER_TEAM)) {
      fail(`“settings.categoriesPerTeam” must be between ${MIN_PER_TEAM} and ${MAX_PER_TEAM}.`);
    }
    if (s.swapRoles !== undefined && typeof s.swapRoles !== "boolean") {
      fail("“settings.swapRoles” must be true or false.");
    }
    validatePrize(s);
  }

  function validatePrize(s) {
    if (s.circleValues !== undefined) {
      if (!Array.isArray(s.circleValues) || s.circleValues.length !== CIRCLE_BOXES) {
        fail(`“settings.circleValues” must be a list of exactly ${CIRCLE_BOXES} numbers.`);
      }
      s.circleValues.forEach((v) => {
        if (!isIntIn(v, 1, MAX_VALUE)) fail("Every Winner’s Circle box value must be a whole number above zero.");
      });
    }
    if (s.grandPrize !== undefined && !isIntIn(s.grandPrize, 1, MAX_VALUE)) {
      fail("“settings.grandPrize” must be a whole number above zero.");
    }
    if (s.grandPrizeLabel !== undefined
      && (typeof s.grandPrizeLabel !== "string" || s.grandPrizeLabel.length > PRIZE_LABEL_MAX)) {
      fail(`“settings.grandPrizeLabel” must be text of at most ${PRIZE_LABEL_MAX} characters.`);
    }
  }

  /* ============ Validation ============ */

  /**
   * Throw a plain-English Error when `game` is not a playable Pyramid file.
   * Returns true so callers can use it as an assertion.
   * @param {unknown} game
   * @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("This file is not a Pyramid game: expected a JSON object.");
    if (game.title !== undefined && typeof game.title !== "string") fail("“title” must be text.");
    if (typeof game.title === "string" && game.title.length > GAME_TITLE_MAX) {
      fail(`“title” must be at most ${GAME_TITLE_MAX} characters.`);
    }
    validateSettings(game.settings);
    const s = settingsOf(game);
    validateCategories(game.categories, s);
    validateCircles(game.circles);
    return true;
  }

  function validateCategories(list, s) {
    if (!Array.isArray(list)) fail("“categories” must be a list.");
    if (list.length < MIN_CATEGORIES) {
      fail(`A Pyramid game needs at least ${MIN_CATEGORIES} categories; this file has ${list.length}.`);
    }
    const needed = s.categoriesPerTeam * 2 + 1;
    if (list.length < needed) {
      fail(`With ${s.categoriesPerTeam} categories per team the file needs at least ${needed} categories `
        + `(six for the board and one for a tiebreak).`);
    }
    const titles = new Set();
    list.forEach((cat, i) => validateCategory(cat, i, s, titles));
  }

  function validateCategory(cat, i, s, titles) {
    const where = `Category ${i + 1}`;
    if (!isPlainObject(cat)) fail(`${where} must be an object.`);
    const title = cleanText(cat.title, TITLE_MAX);
    if (!title) fail(`${where} needs a title.`);
    if (typeof cat.title === "string" && cat.title.length > TITLE_MAX) {
      fail(`${where}: the title must be at most ${TITLE_MAX} characters.`);
    }
    if (titles.has(foldKey(title))) fail(`${where}: “${title}” is used twice — every title must be different.`);
    titles.add(foldKey(title));
    if (cat.hint !== undefined && cat.hint !== null) {
      if (typeof cat.hint !== "string") fail(`${where}: “hint” must be text.`);
      if (cat.hint.length > HINT_MAX) fail(`${where}: the hint must be at most ${HINT_MAX} characters.`);
    }
    validateWords(cat.words, where, s.wordsPerCategory);
  }

  function validateWords(words, where, wanted) {
    if (!Array.isArray(words)) fail(`${where}: “words” must be a list.`);
    if (words.length !== wanted) {
      fail(`${where} has ${words.length} words; every category needs exactly ${wanted}.`);
    }
    const seen = new Set();
    words.forEach((raw, j) => {
      if (typeof raw !== "string") fail(`${where}, word ${j + 1}: every word must be text.`);
      if (raw.length > WORD_MAX) fail(`${where}, word ${j + 1}: at most ${WORD_MAX} characters.`);
      const word = cleanText(raw, WORD_MAX);
      if (!word) fail(`${where}, word ${j + 1} is empty.`);
      if (seen.has(foldKey(word))) fail(`${where}: “${word}” appears twice in the same category.`);
      seen.add(foldKey(word));
    });
  }

  function validateCircles(list) {
    if (!Array.isArray(list)) fail("“circles” must be a list.");
    if (list.length < MIN_CIRCLES) {
      fail(`A Pyramid game needs at least ${MIN_CIRCLES} Winner’s Circle sets; this file has ${list.length}.`);
    }
    list.forEach((set, i) => {
      const where = `Winner’s Circle set ${i + 1}`;
      if (!isPlainObject(set)) fail(`${where} must be an object.`);
      if (!Array.isArray(set.boxes) || set.boxes.length !== CIRCLE_BOXES) {
        fail(`${where} needs exactly ${CIRCLE_BOXES} boxes.`);
      }
      const seen = new Set();
      set.boxes.forEach((box, j) => {
        if (!isPlainObject(box)) fail(`${where}, box ${j + 1} must be an object.`);
        if (typeof box.category === "string" && box.category.length > CIRCLE_CAT_MAX) {
          fail(`${where}, box ${j + 1}: at most ${CIRCLE_CAT_MAX} characters.`);
        }
        const cat = cleanText(box.category, CIRCLE_CAT_MAX);
        if (!cat) fail(`${where}, box ${j + 1} needs a category.`);
        if (seen.has(foldKey(cat))) fail(`${where}: “${cat}” appears twice in the same circle.`);
        seen.add(foldKey(cat));
      });
    });
  }

  /* ============ Normalisation ============ */

  /**
   * A validated file turned into the exact shape the reducer reads: cleaned
   * text, complete settings, an id on every category and circle. Never mutates
   * `game`.
   * @param {Game} game @returns {Game}
   */
  function normalizeGame(game) {
    validateGame(game);
    const settings = settingsOf(game);
    settings.currency = cleanText(settings.currency, CURRENCY_MAX) || "$";
    settings.grandPrizeLabel = cleanText(settings.grandPrizeLabel, PRIZE_LABEL_MAX)
      || `${settings.currency}${settings.grandPrize.toLocaleString("en-US")}`;
    return {
      title: cleanText(game.title, GAME_TITLE_MAX) || "Pyramid",
      settings,
      categories: game.categories.map((cat, i) => ({
        id: `c${i + 1}`,
        title: cleanText(cat.title, TITLE_MAX),
        hint: cleanText(cat.hint, HINT_MAX),
        words: cat.words.map((w) => cleanText(w, WORD_MAX)),
      })),
      circles: game.circles.map((set, i) => ({
        id: `w${i + 1}`,
        boxes: set.boxes.map((box) => ({ category: cleanText(box.category, CIRCLE_CAT_MAX) })),
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
    const needed = s.categoriesPerTeam * 2 + 1;
    if (game.categories.length < needed + 4) {
      out.push(`Only ${game.categories.length} categories — a second game in the same night will repeat some.`);
    }
    if (game.circles.length < 3) out.push("Two Winner’s Circle sets means the third game of the night repeats one.");
    game.categories.forEach((cat, i) => {
      if (!cleanText(cat.hint, HINT_MAX)) {
        out.push(`Category ${i + 1} (“${cleanText(cat.title, TITLE_MAX)}”) has no hint for the giver.`);
      }
    });
    return out.slice(0, 6);
  }

  /* ============ Drawing the night's categories ============ */

  /**
   * Draw `count` categories (plus one tiebreak) and one circle set, avoiding
   * anything in `usedIds`. Deterministic for a deterministic `rng`.
   * @param {Game} game @param {number} count @param {string[]} usedIds
   * @param {() => number} rng
   * @returns {{board:Category[], tiebreak:Category|null, circle:CircleSet}}
   */
  function drawNight(game, count, usedIds, rng) {
    const used = new Set(Array.isArray(usedIds) ? usedIds : []);
    let pool = game.categories.filter((c) => !used.has(c.id));
    if (pool.length < count + 1) pool = game.categories.slice();   // wrap: reuse rather than stall
    const picked = [];
    const left = pool.slice();
    for (let i = 0; i < count + 1 && left.length; i += 1) {
      picked.push(left.splice(pickIndex(rng, left.length), 1)[0]);
    }
    const circles = game.circles.filter((c) => !used.has(c.id));
    const circlePool = circles.length ? circles : game.circles;
    return {
      board: picked.slice(0, count),
      tiebreak: picked.length > count ? picked[count] : null,
      circle: circlePool[pickIndex(rng, circlePool.length)],
    };
  }

  /* ============ Export ============ */

  return {
    // helpers
    isPlainObject, isIntIn, cleanText, fail, foldKey, pickIndex,
    // content
    validateGame, normalizeGame, warningsFor, settingsOf, drawNight,
    // constants
    DEFAULT_SETTINGS, DEFAULT_CIRCLE_VALUES,
    TITLE_MAX, HINT_MAX, WORD_MAX, CIRCLE_CAT_MAX, GAME_TITLE_MAX,
    CURRENCY_MAX, PRIZE_LABEL_MAX, NAME_MAX, PID_MAX,
    MIN_CATEGORIES, MIN_CIRCLES, CIRCLE_BOXES,
    MIN_SECONDS, MAX_SECONDS, MIN_WORDS, MAX_WORDS, MIN_PER_TEAM, MAX_PER_TEAM,
  };
});

/* ============================================================
   Chain Reaction — content rules (PURE)
   The JSON contract from spec 14 §2: what a playable Chain
   Reaction file may contain, how a loaded file is normalised
   (words uppercased and trimmed, settings filled in), and the
   small word helpers the reducer and both UIs need — which
   characters of a word are letters, which letter reveals next,
   whether a word is fully lit.

   Split out of cr-core.js so both files stay well under the
   800-line house limit; cr-core.js re-exports everything here, so
   callers only ever touch CrCore. No DOM, no timers, no mutation
   of the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const CHAIN_LENGTH = 8;          // spec 14 §1: every chain is eight words
  const MIN_CHAINS = 6;
  const MIN_SPEED_CHAINS = 2;
  const MIN_WORD_LETTERS = 2;
  const MAX_WORD_LETTERS = 12;
  const MAX_WORD_CHARS = 16;       // letters plus any apostrophes / hyphens
  const TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const LABEL_MAX = 16;
  const NAME_MAX = 24;             // team name / player name
  const GUESS_MAX = 24;            // spec 14 §5: a typed phone guess
  const PID_MAX = 24;
  const MAX_VALUES = 6;
  const MIN_SPEED_SECONDS = 10;
  const MAX_SPEED_SECONDS = 300;
  const MAX_MONEY = 1000000;

  const DEFAULT_VALUES = [100, 200, 300];
  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    values: DEFAULT_VALUES,
    speedSeconds: 60,
    speedPerWord: 100,
    speedAllClear: 1000,
    speedAllClearLabel: "$1,000",
    revealOnWrong: false,
  });

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");
  const LETTER = /[A-Z]/;
  // A word is letters, with apostrophes or hyphens allowed strictly inside.
  const WORD_SHAPE = /^[A-Z]+(?:['-][A-Z]+)*$/;

  /**
   * @typedef {{currency:string, values:number[], speedSeconds:number,
   *            speedPerWord:number, speedAllClear:number,
   *            speedAllClearLabel:string, revealOnWrong:boolean}} Settings
   * @typedef {{title:string, settings:Settings, chains:string[][],
   *            speedChains:string[][]}} Game
   */

  /* ============ Small helpers ============ */

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function isIntIn(v, lo, hi) {
    return Number.isInteger(v) && v >= lo && v <= hi;
  }

  /** Strip control chars, trim, cap. Returns "" when nothing survives. */
  function cleanText(raw, max) {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL_CHARS, "").trim().slice(0, max).trim();
  }

  function fail(message) {
    throw new Error(message);
  }

  /* ============ Words ============ */

  /**
   * The canonical form of a chain word: uppercase, control chars gone,
   * whitespace collapsed away entirely (a chain word is one token).
   * @param {*} raw @returns {string} "" when nothing usable survives
   */
  function cleanWord(raw) {
    if (typeof raw !== "string") return "";
    return raw
      .replace(CONTROL_CHARS, "")
      .replace(/\s+/g, "")
      .toUpperCase()
      .slice(0, MAX_WORD_CHARS);
  }

  /** How many A–Z characters the word carries (apostrophes do not count). */
  function letterCount(word) {
    let n = 0;
    for (let i = 0; i < word.length; i += 1) if (LETTER.test(word[i])) n += 1;
    return n;
  }

  /** Is this character one the players have to earn? */
  function isLetterAt(word, index) {
    return LETTER.test(word[index] || "");
  }

  /**
   * The reveal mask a word starts with: punctuation is free, letters are not.
   * @param {string} word @param {boolean} [lit] true = every letter shown
   * @returns {boolean[]} one flag per character
   */
  function blankMask(word, lit) {
    const mask = [];
    for (let i = 0; i < word.length; i += 1) mask.push(lit === true || !isLetterAt(word, i));
    return mask;
  }

  /** The index of the next letter to light, or -1 when the word is full. */
  function nextLetterIndex(word, mask) {
    for (let i = 0; i < word.length; i += 1) {
      if (isLetterAt(word, i) && !mask[i]) return i;
    }
    return -1;
  }

  /** Every letter of the word is showing (spec 14 §1: then it is given). */
  function allLettersShown(word, mask) {
    return nextLetterIndex(word, mask) === -1;
  }

  /** How many letters are already showing. */
  function shownCount(word, mask) {
    let n = 0;
    for (let i = 0; i < word.length; i += 1) if (isLetterAt(word, i) && mask[i]) n += 1;
    return n;
  }

  /**
   * Light the next letter. Returns a NEW mask; the caller's is untouched.
   * @param {string} word @param {boolean[]} mask
   */
  function revealNext(word, mask) {
    const at = nextLetterIndex(word, mask);
    if (at < 0) return mask.slice();
    const next = mask.slice();
    next[at] = true;
    return next;
  }

  /** Light every letter (a solved word). */
  function revealAll(word) {
    return blankMask(word, true);
  }

  /**
   * Is what somebody said the word? Case, spaces, apostrophes and hyphens are
   * all forgiven — the host still makes the call, this only powers a hint.
   */
  function sameWord(a, b) {
    const norm = (s) => cleanWord(s).replace(/['-]/g, "");
    const left = norm(a);
    return !!left && left === norm(b);
  }

  /* ============ Validation ============ */

  function validateWord(raw, where) {
    const word = cleanWord(raw);
    if (!word) fail(`${where} is empty.`);
    if (!WORD_SHAPE.test(word)) {
      fail(`${where} ("${word}") must be letters only, with any apostrophe or hyphen inside the word.`);
    }
    const letters = letterCount(word);
    if (letters < MIN_WORD_LETTERS || letters > MAX_WORD_LETTERS) {
      fail(`${where} ("${word}") must be ${MIN_WORD_LETTERS}–${MAX_WORD_LETTERS} letters long.`);
    }
    return word;
  }

  /** One chain: eight words, adjacent ones different, none repeated. */
  function validateChain(raw, where) {
    if (!Array.isArray(raw)) fail(`${where} is not a list of words.`);
    if (raw.length !== CHAIN_LENGTH) {
      fail(`${where} has ${raw.length} words — every chain needs exactly ${CHAIN_LENGTH}.`);
    }
    const words = raw.map((w, i) => validateWord(w, `${where} word ${i + 1}`));
    const seen = new Set();
    words.forEach((word, i) => {
      if (i > 0 && words[i - 1] === word) fail(`${where} repeats "${word}" twice in a row.`);
      if (seen.has(word)) fail(`${where} uses "${word}" more than once.`);
      seen.add(word);
    });
    return words;
  }

  function validateChainList(raw, key, min) {
    if (!Array.isArray(raw)) fail(`"${key}" is missing.`);
    if (raw.length < min) fail(`"${key}" needs at least ${min} chains — this file has ${raw.length}.`);
    return raw.map((chain, i) => validateChain(chain, `${key} ${i + 1}`));
  }

  function validateValues(raw) {
    if (raw === undefined || raw === null) return DEFAULT_VALUES.slice();
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_VALUES) {
      fail(`"settings.values" must be a list of 1–${MAX_VALUES} amounts.`);
    }
    return raw.map((v, i) => {
      if (!isIntIn(v, 1, MAX_MONEY)) fail(`"settings.values" entry ${i + 1} must be a whole number of 1 or more.`);
      return v;
    });
  }

  function numberOr(raw, fallback, lo, hi, label) {
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = typeof raw === "string" ? Number(raw) : raw;
    if (!isIntIn(n, lo, hi)) fail(`"${label}" must be a whole number between ${lo} and ${hi}.`);
    return n;
  }

  function validateSettings(raw) {
    const s = isPlainObject(raw) ? raw : {};
    if (raw !== undefined && raw !== null && !isPlainObject(raw)) fail(`"settings" must be an object.`);
    const values = validateValues(s.values);
    const perWord = numberOr(s.speedPerWord, DEFAULT_SETTINGS.speedPerWord, 0, MAX_MONEY, "settings.speedPerWord");
    const allClear = numberOr(s.speedAllClear, DEFAULT_SETTINGS.speedAllClear, 0, MAX_MONEY, "settings.speedAllClear");
    return {
      currency: cleanText(s.currency, CURRENCY_MAX) || DEFAULT_SETTINGS.currency,
      values,
      speedSeconds: numberOr(s.speedSeconds, DEFAULT_SETTINGS.speedSeconds,
        MIN_SPEED_SECONDS, MAX_SPEED_SECONDS, "settings.speedSeconds"),
      speedPerWord: perWord,
      speedAllClear: allClear,
      speedAllClearLabel: cleanText(s.speedAllClearLabel, LABEL_MAX) || DEFAULT_SETTINGS.speedAllClearLabel,
      revealOnWrong: s.revealOnWrong === true,
    };
  }

  /**
   * Throws with a plain-English message on anything unplayable.
   * @param {*} game @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("That file is not a Chain Reaction game object.");
    if (game.title !== undefined && typeof game.title !== "string") fail(`"title" must be text.`);
    validateSettings(game.settings);
    validateChainList(game.chains, "chains", MIN_CHAINS);
    validateChainList(game.speedChains, "speedChains", MIN_SPEED_CHAINS);
    return true;
  }

  /**
   * Validate and return the canonical copy the reducer plays. Never mutates
   * the input. @param {*} game @returns {Game}
   */
  function normalizeGame(game) {
    validateGame(game);
    return {
      title: cleanText(game.title, TITLE_MAX) || "Chain Reaction",
      settings: validateSettings(game.settings),
      chains: validateChainList(game.chains, "chains", MIN_CHAINS),
      speedChains: validateChainList(game.speedChains, "speedChains", MIN_SPEED_CHAINS),
    };
  }

  /**
   * Non-fatal notes for the setup screen and the editor: things that still
   * play but the host probably wants to know.
   */
  function warningsFor(game) {
    const out = [];
    try {
      const g = normalizeGame(game);
      if (g.chains.length < g.settings.values.length) {
        out.push(`Only ${g.chains.length} chains for ${g.settings.values.length} rounds — the last rounds will reuse chains.`);
      }
      const seen = new Set();
      g.chains.concat(g.speedChains).forEach((chain) => {
        const key = chain.join(" ");
        if (seen.has(key)) out.push(`"${chain[0]} … ${chain[7]}" appears twice.`);
        seen.add(key);
      });
    } catch (err) {
      out.push(err.message);
    }
    return out;
  }

  /**
   * The per-word validation the editor paints live: "" when the word is fine,
   * otherwise the plain-English problem with THIS field.
   * @param {string} raw @param {string[]} siblings the other words in the chain
   * @param {number} index this word's slot
   */
  function wordProblem(raw, siblings, index) {
    const word = cleanWord(raw);
    if (!word) return "Needs a word.";
    try {
      validateWord(word, "This word");
    } catch (err) {
      return err.message.replace(/^This word \("[^"]*"\) /, "").replace(/^This word /, "");
    }
    const others = Array.isArray(siblings) ? siblings : [];
    const before = cleanWord(others[index - 1]);
    const after = cleanWord(others[index + 1]);
    if (before && before === word) return "Same as the word above.";
    if (after && after === word) return "Same as the word below.";
    for (let i = 0; i < others.length; i += 1) {
      if (i !== index && cleanWord(others[i]) === word) return "Already used in this chain.";
    }
    return "";
  }

  return {
    // constants
    CHAIN_LENGTH, MIN_CHAINS, MIN_SPEED_CHAINS,
    MIN_WORD_LETTERS, MAX_WORD_LETTERS, MAX_WORD_CHARS,
    TITLE_MAX, CURRENCY_MAX, LABEL_MAX, NAME_MAX, GUESS_MAX, PID_MAX,
    MAX_VALUES, MIN_SPEED_SECONDS, MAX_SPEED_SECONDS, MAX_MONEY,
    DEFAULT_VALUES, DEFAULT_SETTINGS,
    // helpers
    isPlainObject, isIntIn, cleanText, fail,
    cleanWord, letterCount, isLetterAt, blankMask, nextLetterIndex,
    allLettersShown, shownCount, revealNext, revealAll, sameWord,
    // content
    validateWord, validateChain, validateGame, normalizeGame, warningsFor, wordProblem,
  };
});

/* ============================================================
   Wheel of Fortune — pure content half of the core (spec 04 §4)
   Constants, string sanitisers, the board layout algorithm, and
   the JSON validator / normaliser. Split out of wheel-core.js
   only to keep both files under the 800-line house limit; every
   export here is re-exported by WheelCore, which stays the one
   public API the app, editor, phones and tests code against.
   No DOM, no transport, no timers — pure and dependency-free.
   Browser: globalThis.WheelContent (load BEFORE wheel-core.js).
   Node: module.exports.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WheelContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  // The TV board: 4 rows of 12 / 14 / 14 / 12 tiles (52 tiles total).
  const ROW_CAPS = [12, 14, 14, 12];
  const VOWELS = "AEIOU";
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  // Bonus-round freebies, revealed before the contestant picks (spec §1).
  const BONUS_FREE = ["R", "S", "T", "L", "N", "E"];
  const BANKRUPT = "BANKRUPT";
  const LOSE_TURN = "LOSE A TURN";

  const MAX_ROUNDS = 20;
  const MAX_PLAYERS = 6;
  const MIN_WEDGES = 12;
  const MAX_WEDGES = 32;
  const CATEGORY_MAX = 30;
  const SOLVE_TEXT_MAX = 80;
  const BONUS_SECONDS_MAX = 60;
  const NAME_MAX = 24;
  // Legal puzzle characters after normalising: A-Z, space and ' - & , . ! ?
  const PUZZLE_RE = /^[A-Z '\-&,.!?]+$/;
  // C0 controls + DEL + C1, written as escapes so this file stays printable ASCII.
  const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g");

  const ROUND_TYPES = new Set(["regular", "tossup", "bonus"]);

  /** The default 24-wedge wheel (spec §2). */
  const DEFAULT_WEDGES = Object.freeze([
    800, BANKRUPT, 650, 500, 900, 700, 600, 650, 500, 700, LOSE_TURN, 800,
    500, 650, 600, 700, 900, BANKRUPT, 500, 600, 550, 700, 2500, 650,
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    vowelCost: 250,
    roundMinimum: 1000,
    bonusSeconds: 10,
    bonusPrize: "$25,000",
    tossUpValues: Object.freeze([1000, 2000, 3000]),
    autoOrder: false,
  });

  /* ============ Small helpers ============ */

  const isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;

  const isLetter = (ch) => ch >= "A" && ch <= "Z";

  const isVowel = (ch) =>
    typeof ch === "string" && ch.length === 1 && VOWELS.includes(ch.toUpperCase());

  const stripControls = (text) => String(text).replace(CONTROL_CHARS, "");

  /** Uppercase, strip control chars, collapse runs of whitespace, trim. */
  function normalizePuzzleText(raw) {
    if (typeof raw !== "string") return "";
    return stripControls(raw).toUpperCase().replace(/\s+/g, " ").trim();
  }

  function sanitizeName(raw) {
    if (typeof raw !== "string") return "";
    return stripControls(raw).replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  }

  /** Phone solve text: display-only, the host still judges it (spec §5). */
  function sanitizeSolve(raw) {
    if (typeof raw !== "string") return "";
    return stripControls(raw).replace(/\s+/g, " ").trim().slice(0, SOLVE_TEXT_MAX);
  }

  function formatMoney(amount) {
    const n = typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount) : 0;
    const abs = Math.abs(n).toLocaleString("en-US");
    return n < 0 ? `-$${abs}` : `$${abs}`;
  }

  /** Count the occurrences of one letter in a puzzle. Non-letters count 0. */
  function letterCount(puzzle, letter) {
    if (typeof puzzle !== "string" || typeof letter !== "string") return 0;
    const target = letter.trim().toUpperCase();
    if (target.length !== 1 || !isLetter(target)) return 0;
    const text = puzzle.toUpperCase();
    let n = 0;
    for (let i = 0; i < text.length; i += 1) if (text[i] === target) n += 1;
    return n;
  }

  /** True when at least one letter is hidden and every hidden one is a vowel. */
  function onlyVowelsLeft(puzzle, revealed) {
    if (typeof puzzle !== "string") return false;
    const flags = Array.isArray(revealed) ? revealed : [];
    let hidden = 0;
    let hiddenConsonants = 0;
    for (let i = 0; i < puzzle.length; i += 1) {
      if (!isLetter(puzzle[i]) || flags[i]) continue;
      hidden += 1;
      if (!isVowel(puzzle[i])) hiddenConsonants += 1;
    }
    return hidden > 0 && hiddenConsonants === 0;
  }

  /** True when no letter tile is still hidden. */
  function allRevealed(puzzle, revealed) {
    if (typeof puzzle !== "string") return false;
    const flags = Array.isArray(revealed) ? revealed : [];
    for (let i = 0; i < puzzle.length; i += 1) {
      if (isLetter(puzzle[i]) && !flags[i]) return false;
    }
    return true;
  }

  /* ============ Board layout (spec §3) ============ */

  /** Words with their absolute start index in the normalised puzzle text. */
  function splitWords(text) {
    const words = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === " ") { i += 1; continue; }
      let j = i;
      while (j < text.length && text[j] !== " ") j += 1;
      words.push({ text: text.slice(i, j), start: i });
      i = j;
    }
    return words;
  }

  /** Greedy line-break across ROW_CAPS. Returns null when the puzzle overflows. */
  function packWords(words) {
    const lines = [];
    let row = 0;
    let cur = [];
    let len = 0;
    for (const word of words) {
      const need = len === 0 ? word.text.length : len + 1 + word.text.length;
      if (need <= ROW_CAPS[row]) { cur.push(word); len = need; continue; }
      // This word starts a new row - skip any row too narrow to hold it at all.
      do {
        lines.push(cur);
        cur = [];
        row += 1;
        if (row >= ROW_CAPS.length) return null;
      } while (word.text.length > ROW_CAPS[row]);
      cur = [word];
      len = word.text.length;
    }
    lines.push(cur);
    return lines;
  }

  /** One row of `cap` tiles with its words centred; empty tiles are null. */
  function centreRow(lineWords, cap) {
    const len = rowWidth(lineWords);
    const cells = new Array(cap).fill(null);
    let col = Math.floor((cap - len) / 2);
    lineWords.forEach((word, k) => {
      if (k) col += 1;
      for (let n = 0; n < word.text.length; n += 1) {
        cells[col] = { ch: word.text[n], i: word.start + n };
        col += 1;
      }
    });
    return cells;
  }

  /**
   * Pack a puzzle onto the 12/14/14/12 board. Words are never split: a word
   * goes on the current row if it still fits (with a one-tile gap), otherwise
   * it starts the next row wide enough to hold it. Rows are centred and
   * punctuation occupies a tile like a letter. Deterministic.
   * @param {string} puzzle
   * @returns {Array<Array<{ch:string,i:number}|null>>|null} 4 rows, or null if it can't fit.
   */
  function layoutPuzzle(puzzle) {
    const text = normalizePuzzleText(puzzle);
    if (!text || !PUZZLE_RE.test(text)) return null;
    const lines = packWords(splitWords(text));
    if (!lines) return null;
    const offset = verticalOffset(lines);
    const placed = [];
    for (let row = 0; row < ROW_CAPS.length; row += 1) placed.push(lines[row - offset] || []);
    return placed.map((lineWords, row) => centreRow(lineWords, ROW_CAPS[row]));
  }

  /**
   * How far down to push a short puzzle so it sits in the middle of the board
   * (the TV look). Only applied when every line still fits its new, wider row —
   * a 3-line puzzle packed against 12/14/14 can't slide onto 14/14/12.
   */
  function verticalOffset(lines) {
    const want = Math.floor((ROW_CAPS.length - lines.length) / 2);
    for (let shift = want; shift > 0; shift -= 1) {
      const fits = lines.every((line, i) => rowWidth(line) <= ROW_CAPS[i + shift]);
      if (fits) return shift;
    }
    return 0;
  }

  function rowWidth(lineWords) {
    let len = 0;
    lineWords.forEach((w, k) => { len += w.text.length + (k ? 1 : 0); });
    return len;
  }

  /* ============ Content validation (spec §2) ============ */

  function validateWedges(list, label, fail) {
    const die = typeof fail === "function" ? fail : (m) => { throw new Error(m); };
    if (!Array.isArray(list)) die(`${label} must be an array.`);
    if (list.length < MIN_WEDGES || list.length > MAX_WEDGES) {
      die(`${label} needs between ${MIN_WEDGES} and ${MAX_WEDGES} wedges (found ${list.length}).`);
    }
    let dollars = 0;
    list.forEach((wedge, i) => {
      if (wedge === BANKRUPT || wedge === LOSE_TURN) return;
      if (!isPositiveInt(wedge)) {
        die(`${label} entry ${i + 1} must be a positive whole number, "BANKRUPT" or "LOSE A TURN".`);
      }
      if (wedge % 50 !== 0) die(`${label} entry ${i + 1} ($${wedge}) must be a multiple of 50.`);
      dollars += 1;
    });
    if (dollars === 0) die(`${label} needs at least one dollar wedge.`);
    return list;
  }

  function validateSettings(settings, fail) {
    if (settings === undefined || settings === null) return;
    if (typeof settings !== "object" || Array.isArray(settings)) {
      fail('"settings" must be an object.');
    }
    for (const key of ["vowelCost", "roundMinimum"]) {
      if (settings[key] !== undefined && !isPositiveInt(settings[key])) {
        fail(`"settings.${key}" must be a positive whole number.`);
      }
    }
    if (settings.bonusSeconds !== undefined) {
      const s = settings.bonusSeconds;
      if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > BONUS_SECONDS_MAX) {
        fail(`"settings.bonusSeconds" must be a whole number from 0 to ${BONUS_SECONDS_MAX}.`);
      }
    }
    if (settings.bonusPrize !== undefined && typeof settings.bonusPrize !== "string") {
      fail('"settings.bonusPrize" must be a string.');
    }
    if (settings.tossUpValues !== undefined) {
      const v = settings.tossUpValues;
      if (!Array.isArray(v) || v.length === 0 || !v.every(isPositiveInt)) {
        fail('"settings.tossUpValues" must be a non-empty array of positive whole numbers.');
      }
    }
    if (settings.wedges !== undefined) validateWedges(settings.wedges, '"settings.wedges"', fail);
  }

  /** Validate one round; returns 1 if it was the bonus round, else 0. */
  function validateRound(round, index, total, bonusSeen, fail) {
    const where = `Round ${index + 1}`;
    if (!round || typeof round !== "object" || Array.isArray(round)) {
      fail(`${where} must be an object.`);
    }
    const type = round.type === undefined ? "regular" : round.type;
    if (!ROUND_TYPES.has(type)) fail(`${where}: "type" must be "regular", "tossup" or "bonus".`);
    if (type === "bonus") {
      if (bonusSeen > 0) fail("Only one bonus round is allowed.");
      if (index !== total - 1) fail("The bonus round must be the last round.");
    }
    if (typeof round.category !== "string" || !round.category.trim()) {
      fail(`${where}: "category" is required.`);
    }
    if (round.category.trim().length > CATEGORY_MAX) {
      fail(`${where}: "category" is longer than ${CATEGORY_MAX} characters.`);
    }
    if (typeof round.puzzle !== "string" || !round.puzzle.trim()) {
      fail(`${where}: "puzzle" is required.`);
    }
    const text = normalizePuzzleText(round.puzzle);
    if (!PUZZLE_RE.test(text)) {
      fail(`${where}: "puzzle" may only use letters, spaces and ' - & , . ! ?`);
    }
    if (!/[A-Z]/.test(text)) fail(`${where}: "puzzle" needs at least one letter.`);
    if (!layoutPuzzle(text)) {
      fail(`${where}: "${text}" does not fit the board (4 rows of 12, 14, 14 and 12 tiles, and words are never split).`);
    }
    // null means "not set" here: normalizeGame round-trips through this
    // validator, and hand-written JSON uses null for an absent override too.
    if (round.wedges !== undefined && round.wedges !== null) {
      validateWedges(round.wedges, `${where}: "wedges"`, fail);
    }
    if (round.value !== undefined && round.value !== null && !isPositiveInt(round.value)) {
      fail(`${where}: "value" must be a positive whole number.`);
    }
    return type === "bonus" ? 1 : 0;
  }

  /**
   * Throw a plain-English Error on anything the game cannot play; return the
   * input untouched otherwise. The default loader, file upload, ?game=URL and
   * the editor's Download button all go through this one function.
   */
  function validateGame(data) {
    const fail = (msg) => { throw new Error(msg); };
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail("Puzzle file must be a JSON object.");
    }
    if (data.title !== undefined && typeof data.title !== "string") {
      fail('"title" must be a string.');
    }
    validateSettings(data.settings, fail);
    if (!Array.isArray(data.rounds) || data.rounds.length === 0) {
      fail('"rounds" must be a non-empty array.');
    }
    if (data.rounds.length > MAX_ROUNDS) fail(`Too many rounds (max ${MAX_ROUNDS}).`);
    let bonusSeen = 0;
    data.rounds.forEach((round, i) => {
      bonusSeen += validateRound(round, i, data.rounds.length, bonusSeen, fail);
    });
    return data;
  }

  /** Validate, then produce the canonical shape the reducer runs on. */
  function normalizeGame(data) {
    validateGame(data);
    const src = data.settings && typeof data.settings === "object" ? data.settings : {};
    const settings = {
      vowelCost: isPositiveInt(src.vowelCost) ? src.vowelCost : DEFAULT_SETTINGS.vowelCost,
      roundMinimum: isPositiveInt(src.roundMinimum) ? src.roundMinimum : DEFAULT_SETTINGS.roundMinimum,
      bonusSeconds: Number.isInteger(src.bonusSeconds) ? src.bonusSeconds : DEFAULT_SETTINGS.bonusSeconds,
      bonusPrize: typeof src.bonusPrize === "string" && src.bonusPrize.trim()
        ? src.bonusPrize.trim() : DEFAULT_SETTINGS.bonusPrize,
      tossUpValues: Array.isArray(src.tossUpValues) && src.tossUpValues.length
        ? src.tossUpValues.slice() : DEFAULT_SETTINGS.tossUpValues.slice(),
      wedges: Array.isArray(src.wedges) ? src.wedges.slice() : DEFAULT_WEDGES.slice(),
      autoOrder: src.autoOrder === true,
    };
    let rounds = data.rounds.map((r) => {
      const out = {
        type: r.type === undefined ? "regular" : r.type,
        category: r.category.trim(),
        puzzle: normalizePuzzleText(r.puzzle),
      };
      // Optional keys are omitted rather than nulled so a normalised game can
      // be handed straight back to validateGame (reload-resume does exactly that).
      if (Array.isArray(r.wedges)) out.wedges = r.wedges.slice();
      if (isPositiveInt(r.value)) out.value = r.value;
      return out;
    });
    if (settings.autoOrder) {
      const of = (t) => rounds.filter((r) => r.type === t);
      rounds = [...of("tossup"), ...of("regular"), ...of("bonus")];
    }
    return {
      title: typeof data.title === "string" && data.title.trim()
        ? data.title.trim() : "Wheel of Fortune",
      settings,
      rounds,
    };
  }

  return {
    ROW_CAPS, VOWELS, ALPHABET, BONUS_FREE, BANKRUPT, LOSE_TURN,
    MAX_PLAYERS, MAX_ROUNDS, MIN_WEDGES, MAX_WEDGES, CATEGORY_MAX,
    SOLVE_TEXT_MAX, BONUS_SECONDS_MAX, DEFAULT_WEDGES, DEFAULT_SETTINGS,
    isPositiveInt, isLetter, isVowel, letterCount, onlyVowelsLeft, allRevealed,
    layoutPuzzle, normalizePuzzleText, sanitizeName, sanitizeSolve, formatMoney,
    validateWedges, validateGame, normalizeGame,
  };
});

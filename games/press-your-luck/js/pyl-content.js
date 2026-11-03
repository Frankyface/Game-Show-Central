/* ============================================================
   Press Your Luck — content rules (PURE)
   The JSON contract from spec 17 §2: what a playable Press Your
   Luck file may contain, how a loaded file is normalised, and the
   small helpers both UIs need to describe a square in words.

   Split out of pyl-core.js so both files stay well under the
   800-line house limit; pyl-core.js re-exports everything here, so
   callers only ever touch PylCore. No DOM, no timers, no mutation
   of the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PylContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const SQUARES = 18;              // spec 17 §2: every board is exactly 18 squares
  const MIN_WHAMMIES = 3;
  const MAX_WHAMMIES = 6;
  const MIN_QUESTIONS = 24;
  const OPTIONS = 3;               // every question has exactly three options
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 4;
  const MAX_ALTERNATIVES = 3;

  const TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const NAME_MAX = 24;             // player name
  const PID_MAX = 24;
  const QUESTION_MAX = 200;
  const OPTION_MAX = 60;
  const PRIZE_MAX = 40;
  const MAX_MONEY = 1000000;

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    questionsPerRound: 4,
    buzzSpins: 3,
    pickSpins: 1,
    whammyLimit: 4,
    rounds: 2,
    rotate: false,
  });

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{cash?:number, spin?:boolean, whammy?:boolean, prize?:string,
   *            value?:number, alternatives?:object[]}} Square
   * @typedef {{q:string, options:string[], answer:number}} Question
   * @typedef {{currency:string, questionsPerRound:number, buzzSpins:number,
   *            pickSpins:number, whammyLimit:number, rounds:number,
   *            rotate:boolean}} Settings
   * @typedef {{title:string, settings:Settings, boards:Square[][],
   *            questions:Question[]}} Game
   */

  /* ============ Small helpers ============ */

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function isIntIn(v, lo, hi) {
    return Number.isInteger(v) && v >= lo && v <= hi;
  }

  /** Strip control chars, collapse runs of whitespace, trim, cap. */
  function cleanText(raw, max) {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  }

  function fail(message) {
    throw new Error(message);
  }

  /** Money for a shared screen: no decimals, thousands separated. */
  function formatMoney(amount, currency) {
    const n = Number(amount) || 0;
    const sign = n < 0 ? "-" : "";
    return `${sign}${currency || "$"}${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  }

  /* ============ Squares ============ */

  /** Is this square the one nobody wants? */
  function isWhammy(square) {
    return !!(square && square.whammy === true);
  }

  /** What a square is worth in cash (a prize counts as its value). */
  function squareValue(square) {
    if (!square || isWhammy(square)) return 0;
    if (typeof square.prize === "string" && square.prize) return Number(square.value) || 0;
    return Number(square.cash) || 0;
  }

  /** The one-or-two lines a board tile shows. */
  function squareLabel(square, currency) {
    if (isWhammy(square)) return { top: "WHAMMY", sub: "", whammy: true };
    if (typeof square.prize === "string" && square.prize) {
      return { top: square.prize, sub: formatMoney(square.value, currency), whammy: false };
    }
    return {
      top: formatMoney(square.cash, currency),
      sub: square.spin ? "+ ONE SPIN" : "",
      whammy: false,
    };
  }

  /** A plain-English sentence for the live region and the phones. */
  function squareSentence(square, currency) {
    if (isWhammy(square)) return "Whammy — the total goes back to zero.";
    const label = squareLabel(square, currency);
    if (typeof square.prize === "string" && square.prize) {
      return `${square.prize}, worth ${label.sub}.`;
    }
    return square.spin ? `${label.top} and one more spin.` : `${label.top}.`;
  }

  /**
   * Validate one square and return the canonical copy.
   * @param {*} raw @param {string} where for the message @param {boolean} nested
   */
  function validateSquare(raw, where, nested) {
    if (!isPlainObject(raw)) fail(`${where} is not a square object.`);
    const out = {};
    if (raw.whammy === true) {
      if (raw.cash !== undefined || raw.prize !== undefined) {
        fail(`${where} is a Whammy, so it cannot also carry cash or a prize.`);
      }
      out.whammy = true;
      return withAlternatives(out, raw, where, nested);
    }
    if (typeof raw.prize === "string" && raw.prize.trim()) {
      out.prize = cleanText(raw.prize, PRIZE_MAX);
      if (!isIntIn(raw.value, 1, MAX_MONEY)) {
        fail(`${where} ("${out.prize}") needs a whole "value" between 1 and ${MAX_MONEY}.`);
      }
      out.value = raw.value;
      return withAlternatives(out, raw, where, nested);
    }
    if (!isIntIn(raw.cash, 1, MAX_MONEY)) {
      fail(`${where} needs a whole "cash" amount between 1 and ${MAX_MONEY}, a "prize" with a value, or "whammy": true.`);
    }
    out.cash = raw.cash;
    if (raw.spin === true) out.spin = true;
    return withAlternatives(out, raw, where, nested);
  }

  /**
   * The optional per-square rotation faces (spec 17 §1). Alternatives are
   * squares in their own right but may not nest further.
   */
  function withAlternatives(out, raw, where, nested) {
    if (raw.alternatives === undefined) return out;
    if (nested) fail(`${where}: alternatives cannot have alternatives of their own.`);
    if (!Array.isArray(raw.alternatives)) fail(`${where}: "alternatives" must be a list of squares.`);
    if (raw.alternatives.length > MAX_ALTERNATIVES) {
      fail(`${where}: at most ${MAX_ALTERNATIVES} alternatives per square.`);
    }
    if (!raw.alternatives.length) return out;
    out.alternatives = raw.alternatives.map((alt, i) =>
      validateSquare(alt, `${where}, alternative ${i + 1}`, true));
    return out;
  }

  /** Validate one board: exactly 18 squares, 3–6 of them Whammies. */
  function validateBoard(raw, index) {
    const where = `Board ${index + 1}`;
    if (!Array.isArray(raw)) fail(`${where} must be a list of squares.`);
    if (raw.length !== SQUARES) {
      fail(`${where} has ${raw.length} squares — every board needs exactly ${SQUARES}.`);
    }
    const board = raw.map((sq, i) => validateSquare(sq, `${where}, square ${i + 1}`, false));
    const whammies = board.filter(isWhammy).length;
    if (whammies < MIN_WHAMMIES || whammies > MAX_WHAMMIES) {
      fail(`${where} has ${whammies} Whammies — a board needs between ${MIN_WHAMMIES} and ${MAX_WHAMMIES}.`);
    }
    return board;
  }

  function validateBoards(raw, rounds) {
    if (!Array.isArray(raw) || !raw.length) fail(`"boards" must be a list of at least one board.`);
    const boards = raw.map(validateBoard);
    if (boards.length < rounds) {
      fail(`Settings ask for ${rounds} round(s) but the file only has ${boards.length} board(s).`);
    }
    return boards;
  }

  /* ============ Questions ============ */

  function validateQuestion(raw, index) {
    const where = `Question ${index + 1}`;
    if (!isPlainObject(raw)) fail(`${where} is not a question object.`);
    const q = cleanText(raw.q, QUESTION_MAX);
    if (!q) fail(`${where} needs the question text.`);
    if (!Array.isArray(raw.options) || raw.options.length !== OPTIONS) {
      fail(`${where} ("${q}") needs exactly ${OPTIONS} options.`);
    }
    const options = raw.options.map((o, i) => {
      const text = cleanText(o, OPTION_MAX);
      if (!text) fail(`${where} ("${q}") option ${i + 1} is empty.`);
      return text;
    });
    const lower = options.map((o) => o.toLowerCase());
    if (new Set(lower).size !== options.length) fail(`${where} ("${q}") repeats an option.`);
    if (!isIntIn(raw.answer, 0, OPTIONS - 1)) {
      fail(`${where} ("${q}") needs "answer" between 0 and ${OPTIONS - 1}.`);
    }
    return { q, options, answer: raw.answer };
  }

  function validateQuestions(raw) {
    if (!Array.isArray(raw)) fail(`"questions" must be a list.`);
    if (raw.length < MIN_QUESTIONS) {
      fail(`A game needs at least ${MIN_QUESTIONS} questions — this file has ${raw.length}.`);
    }
    return raw.map(validateQuestion);
  }

  /* ============ Settings ============ */

  function validateSettings(raw) {
    if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
      fail(`"settings" must be an object.`);
    }
    const s = isPlainObject(raw) ? raw : {};
    const out = Object.assign({}, DEFAULT_SETTINGS);
    if (s.currency !== undefined) {
      const c = cleanText(s.currency, CURRENCY_MAX);
      if (!c) fail(`"settings.currency" cannot be empty.`);
      out.currency = c;
    }
    const number = (key, lo, hi) => {
      if (s[key] === undefined) return;
      if (!isIntIn(s[key], lo, hi)) fail(`"settings.${key}" must be a whole number between ${lo} and ${hi}.`);
      out[key] = s[key];
    };
    number("questionsPerRound", 1, 12);
    number("buzzSpins", 0, 10);
    number("pickSpins", 0, 10);
    number("whammyLimit", 1, 10);
    number("rounds", 1, 6);
    if (s.rotate !== undefined) {
      if (typeof s.rotate !== "boolean") fail(`"settings.rotate" must be true or false.`);
      out.rotate = s.rotate;
    }
    if (out.buzzSpins === 0 && out.pickSpins === 0) {
      fail(`With no spins for a buzz and none for a pick nobody could ever reach the board.`);
    }
    return out;
  }

  /* ============ The whole file ============ */

  function validateGame(game) {
    if (!isPlainObject(game)) fail("That file is not a Press Your Luck game object.");
    if (game.title !== undefined && typeof game.title !== "string") fail(`"title" must be text.`);
    const settings = validateSettings(game.settings);
    validateBoards(game.boards, settings.rounds);
    const questions = validateQuestions(game.questions);
    const needed = settings.rounds * settings.questionsPerRound;
    if (questions.length < needed) {
      fail(`${settings.rounds} round(s) of ${settings.questionsPerRound} need ${needed} questions; the file has ${questions.length}.`);
    }
    return true;
  }

  /**
   * Validate and return the canonical copy the reducer plays.
   * Never mutates the input. @param {*} game @returns {Game}
   */
  function normalizeGame(game) {
    validateGame(game);
    const settings = validateSettings(game.settings);
    return {
      title: cleanText(game.title, TITLE_MAX) || "Press Your Luck",
      settings,
      boards: validateBoards(game.boards, settings.rounds),
      questions: validateQuestions(game.questions),
    };
  }

  /** Non-fatal notes for the setup screen and the editor. */
  function warningsFor(game) {
    const out = [];
    try {
      const g = normalizeGame(game);
      g.boards.forEach((board, i) => {
        const cash = board.filter((sq) => !isWhammy(sq));
        const top = Math.max.apply(null, cash.map((sq) => squareValue(sq)));
        const low = Math.min.apply(null, cash.map((sq) => squareValue(sq)));
        if (top < low * 2) {
          out.push(`Board ${i + 1} is very flat (${formatMoney(low, g.settings.currency)}–${formatMoney(top, g.settings.currency)}) — the board is more fun with a spread.`);
        }
        if (!board.some((sq) => sq.spin === true)) {
          out.push(`Board ${i + 1} has no "+ one spin" square, so a hot streak can never extend itself.`);
        }
      });
      const seen = new Set();
      g.questions.forEach((q) => {
        const key = q.q.toLowerCase();
        if (seen.has(key)) out.push(`"${q.q}" appears twice.`);
        seen.add(key);
      });
    } catch (err) {
      out.push(err.message);
    }
    return out;
  }

  /** "" when this square is fine, otherwise the problem with THIS square. */
  function squareProblem(raw) {
    try {
      validateSquare(raw, "This square", false);
      return "";
    } catch (err) {
      return String(err.message).replace(/^This square,? ?/, "").replace(/^\w/, (c) => c.toUpperCase());
    }
  }

  return {
    // constants
    SQUARES, MIN_WHAMMIES, MAX_WHAMMIES, MIN_QUESTIONS, OPTIONS,
    MIN_PLAYERS, MAX_PLAYERS, MAX_ALTERNATIVES,
    NAME_MAX, PID_MAX, QUESTION_MAX, OPTION_MAX, PRIZE_MAX, MAX_MONEY,
    DEFAULT_SETTINGS,
    // helpers
    isPlainObject, isIntIn, cleanText, fail, formatMoney,
    isWhammy, squareValue, squareLabel, squareSentence,
    // validation
    validateSquare, validateBoard, validateBoards, validateQuestion,
    validateQuestions, validateSettings, validateGame, normalizeGame,
    warningsFor, squareProblem,
  };
});

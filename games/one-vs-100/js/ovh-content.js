/* ============================================================
   1 vs 100 — content rules (PURE)
   The JSON contract from spec 16 §2: what a playable 1 vs 100
   file may contain, how a loaded file is normalised (levels
   assigned, ids stamped, questions sorted by level), how a
   question is drawn for a level without repeating one, and the
   small pieces of maths the reducer needs (the per-member
   ladder, an even spread of wrong simulated answers).

   Split out of ovh-core.js so both files stay well under the
   800-line house limit; ovh-core.js re-exports everything here,
   so callers only ever touch OvhCore. No DOM, no timers, and
   nothing here mutates the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OvhContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  /** Money the contestant earns PER eliminated Mob member, by question
      number. The last value repeats for every question past the ladder
      (spec 16 §1). */
  const DEFAULT_LADDER = [100, 200, 300, 500, 1000, 2000, 3000, 5000, 7500, 10000];

  const HELP_KEYS = ["poll", "ask", "trust"];
  const DEFAULT_HELPS = Object.freeze({ poll: true, ask: true, trust: true });

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    ladder: DEFAULT_LADDER,
    answerSeconds: 20,
    helps: DEFAULT_HELPS,
    bonusMultiplier: 2,
    mobSize: 20,
  });

  const OPTION_COUNT = 3;      // 1 vs 100 is a three-option show
  const LEVEL_MAX = 10;        // difficulty bands, independent of the ladder
  const MIN_QUESTIONS = 30;    // spec 16 §2
  const Q_MAX = 200;
  const OPTION_MAX = 60;
  const CAT_MAX = 30;
  const TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const NAME_MAX = 24;
  const MIN_LADDER = 1;
  const MAX_LADDER = 20;
  const MAX_SECONDS = 120;
  const MIN_MOB = 1;
  const MAX_MOB = 100;         // the show's Mob; also the tile-grid cap
  const MAX_BONUS = 10;

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{id:string, level:number, category:string, q:string,
   *            options:string[], answer:number}} Question
   * @typedef {{currency:string, ladder:number[], answerSeconds:number,
   *            helps:Record<string,boolean>, bonusMultiplier:number,
   *            mobSize:number}} Settings
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
   * Throw a plain-English Error when `game` is not a playable 1 vs 100 file.
   * Returns true so callers can use it as an assertion.
   * @param {unknown} game @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("This file is not a 1 vs 100 game: expected a JSON object.");
    if (game.title !== undefined && typeof game.title !== "string") fail("“title” must be text.");
    validateSettings(game.settings);
    validateQuestions(game.questions);
    return true;
  }

  /** @param {unknown} raw */
  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail("“settings” must be an object.");
    const s = raw;
    if (s.currency !== undefined && (typeof s.currency !== "string" || s.currency.length > CURRENCY_MAX)) {
      fail("“settings.currency” must be text of at most 3 characters.");
    }
    if (s.ladder !== undefined) validateLadder(s.ladder);
    if (s.answerSeconds !== undefined && !isIntIn(s.answerSeconds, 0, MAX_SECONDS)) {
      fail(`“settings.answerSeconds” must be a whole number of seconds from 0 to ${MAX_SECONDS}.`);
    }
    if (s.helps !== undefined) validateHelps(s.helps);
    if (s.bonusMultiplier !== undefined
      && !(Number.isFinite(s.bonusMultiplier) && s.bonusMultiplier >= 1 && s.bonusMultiplier <= MAX_BONUS)) {
      fail(`“settings.bonusMultiplier” must be a number from 1 to ${MAX_BONUS} (2 doubles the bank).`);
    }
    if (s.mobSize !== undefined && !isIntIn(s.mobSize, MIN_MOB, MAX_MOB)) {
      fail(`“settings.mobSize” must be a whole number from ${MIN_MOB} to ${MAX_MOB}.`);
    }
  }

  /** @param {unknown} ladder */
  function validateLadder(ladder) {
    if (!Array.isArray(ladder) || ladder.length < MIN_LADDER || ladder.length > MAX_LADDER) {
      fail(`“settings.ladder” must be a list of ${MIN_LADDER} to ${MAX_LADDER} per-member money values.`);
    }
    for (let i = 0; i < ladder.length; i += 1) {
      if (!isPosInt(ladder[i])) {
        fail("Every value on the ladder must be a whole number above zero — it is the money per eliminated Mob member.");
      }
      if (i > 0 && ladder[i] < ladder[i - 1]) {
        fail("The ladder must never go down — a later question is worth at least as much per member as an earlier one.");
      }
    }
  }

  /** @param {unknown} raw */
  function validateHelps(raw) {
    if (!isPlainObject(raw)) fail("“settings.helps” must be an object.");
    Object.keys(raw).forEach((key) => {
      if (HELP_KEYS.indexOf(key) < 0) {
        fail(`“${key}” is not a help. Use ${HELP_KEYS.join(", ")}.`);
      }
      if (typeof raw[key] !== "boolean") fail(`“settings.helps.${key}” must be true or false.`);
    });
  }

  /** @param {unknown} questions */
  function validateQuestions(questions) {
    if (!Array.isArray(questions)) fail("“questions” must be a list.");
    if (questions.length < MIN_QUESTIONS) {
      fail(`A 1 vs 100 game needs at least ${MIN_QUESTIONS} questions — this file has ${questions.length}.`);
    }
    questions.forEach((row, i) => validateQuestion(row, `Question ${i + 1}`));
  }

  function validateQuestion(row, at) {
    if (!isPlainObject(row)) fail(`${at} is not an object.`);
    if (typeof row.q !== "string" || !row.q.trim()) fail(`${at} has no question text.`);
    if (row.q.length > Q_MAX) fail(`${at} is longer than ${Q_MAX} characters.`);
    validateOptions(row.options, at);
    if (!isIntIn(row.answer, 0, OPTION_COUNT - 1)) fail(`${at} needs an “answer” of 0, 1 or 2.`);
    if (row.level !== undefined && row.level !== null && !isIntIn(row.level, 1, LEVEL_MAX)) {
      fail(`${at} has level ${String(row.level)}; levels run from 1 to ${LEVEL_MAX}.`);
    }
    if (row.category !== undefined && row.category !== null) {
      if (typeof row.category !== "string") fail(`${at}'s category must be text.`);
      if (row.category.length > CAT_MAX) fail(`${at}'s category is longer than ${CAT_MAX} characters.`);
    }
  }

  function validateOptions(options, at) {
    if (!Array.isArray(options) || options.length !== OPTION_COUNT) {
      fail(`${at} must have exactly ${OPTION_COUNT} options — 1 vs 100 is a three-option show.`);
    }
    const seen = new Set();
    options.forEach((opt, i) => {
      const letter = "ABC"[i];
      if (typeof opt !== "string" || !opt.trim()) fail(`${at} option ${letter} is empty.`);
      if (opt.length > OPTION_MAX) fail(`${at} option ${letter} is longer than ${OPTION_MAX} characters.`);
      const key = opt.trim().toLowerCase();
      if (seen.has(key)) fail(`${at} repeats the option “${opt.trim()}” — all three must differ.`);
      seen.add(key);
    });
  }

  /**
   * Non-fatal advice about an (already valid) game, for the editor badge.
   * @param {unknown} game @returns {string[]}
   */
  function warningsFor(game) {
    const out = [];
    const norm = safeNormalize(game);
    if (!norm) return ["This game cannot be read yet."];
    const thin = [];
    for (let level = 1; level <= LEVEL_MAX; level += 1) {
      const n = norm.questions.filter((q) => q.level === level).length;
      if (n < 2) thin.push(`${level} (${n})`);
    }
    if (thin.length) {
      out.push(`Levels with fewer than 2 questions: ${thin.join(", ")} — a second contestant may see a repeat.`);
    }
    if (norm.questions.length < LEVEL_MAX * 2) {
      out.push("Fewer than 20 questions means a long run will wrap back to questions already asked.");
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
   * @param {unknown} game @returns {Game}
   */
  function normalizeGame(game) {
    validateGame(game);
    const raw = /** @type {Record<string, unknown>} */ (game);
    const settings = normalizeSettings(raw.settings);
    const questions = assignLevels(/** @type {any[]} */ (raw.questions))
      .map((row, i) => ({
        id: `q${i + 1}`,
        level: row.level,
        category: cleanText(row.source.category, CAT_MAX),
        q: cleanText(row.source.q, Q_MAX),
        options: row.source.options.map((o) => cleanText(o, OPTION_MAX)),
        answer: row.source.answer,
      }))
      .sort((a, b) => (a.level - b.level) || (Number(a.id.slice(1)) - Number(b.id.slice(1))));
    return {
      title: cleanText(raw.title, TITLE_MAX) || "1 vs 100",
      settings,
      questions,
    };
  }

  /** @param {unknown} raw @returns {Settings} */
  function normalizeSettings(raw) {
    const s = isPlainObject(raw) ? raw : {};
    const ladder = Array.isArray(s.ladder) && s.ladder.length ? s.ladder.slice() : DEFAULT_LADDER.slice();
    const helps = {};
    HELP_KEYS.forEach((key) => {
      const given = isPlainObject(s.helps) ? s.helps[key] : undefined;
      helps[key] = typeof given === "boolean" ? given : DEFAULT_HELPS[key];
    });
    return {
      currency: typeof s.currency === "string" && s.currency ? s.currency : DEFAULT_SETTINGS.currency,
      ladder,
      answerSeconds: isIntIn(s.answerSeconds, 0, MAX_SECONDS) ? s.answerSeconds : DEFAULT_SETTINGS.answerSeconds,
      helps,
      bonusMultiplier: Number.isFinite(s.bonusMultiplier) && s.bonusMultiplier >= 1 && s.bonusMultiplier <= MAX_BONUS
        ? s.bonusMultiplier : DEFAULT_SETTINGS.bonusMultiplier,
      mobSize: isIntIn(s.mobSize, MIN_MOB, MAX_MOB) ? s.mobSize : DEFAULT_SETTINGS.mobSize,
    };
  }

  /**
   * Give every question a difficulty level. Explicit levels are kept; the rest
   * are spread evenly over the ten bands by file order (spec 16 §2), so a
   * plain list of 60 questions becomes 6 per band and the show gets its
   * rising difficulty for free.
   */
  function assignLevels(questions) {
    const n = questions.length;
    return questions.map((source, i) => {
      const given = source.level;
      const level = isIntIn(given, 1, LEVEL_MAX) ? given : Math.min(LEVEL_MAX, Math.floor((i * LEVEL_MAX) / n) + 1);
      return { level, source };
    });
  }

  /* ============ Drawing questions ============ */

  /** Every question sitting on a level; falls back to the nearest stocked one. */
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
   * Draw a question for `level` that this game has not used. Once a level is
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

  /** The difficulty band question number `n` (1-based) is drawn from. */
  function levelForQuestion(n) {
    const q = Number.isInteger(n) && n > 0 ? n : 1;
    return Math.min(LEVEL_MAX, q);
  }

  /* ============ Ladder maths ============ */

  /**
   * What one eliminated Mob member is worth on question `n` (1-based). Past
   * the end of the ladder the last value repeats (spec 16 §1).
   * @param {number[]} ladder @param {number} n
   */
  function perMemberValue(ladder, n) {
    const list = Array.isArray(ladder) && ladder.length ? ladder : DEFAULT_LADDER;
    const q = Number.isInteger(n) && n > 0 ? n : 1;
    return list[Math.min(q, list.length) - 1];
  }

  /**
   * Spread `wrong` simulated wrong answers evenly over the two options that
   * are NOT the right one, so a simulated Mob still produces a believable
   * three-way split. Deterministic: no rng, no mutation.
   * @param {number} wrong @param {number} answer
   * @returns {number[]} one option index per wrong member, in seat order
   */
  function spreadWrong(wrong, answer) {
    const n = Number.isInteger(wrong) && wrong > 0 ? wrong : 0;
    const wrongOptions = [];
    for (let i = 0; i < OPTION_COUNT; i += 1) if (i !== answer) wrongOptions.push(i);
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(wrongOptions[i % wrongOptions.length]);
    return out;
  }

  /* ============ Export ============ */

  return {
    DEFAULT_LADDER, DEFAULT_HELPS, DEFAULT_SETTINGS, HELP_KEYS,
    OPTION_COUNT, LEVEL_MAX, MIN_QUESTIONS, Q_MAX, OPTION_MAX, CAT_MAX, TITLE_MAX,
    NAME_MAX, MIN_LADDER, MAX_LADDER, MAX_SECONDS, MIN_MOB, MAX_MOB, MAX_BONUS,
    isPlainObject, isPosInt, isIntIn, cleanText, fail, pickIndex,
    validateGame, validateQuestion, normalizeGame, normalizeSettings, warningsFor,
    poolFor, drawQuestion, levelForQuestion, perMemberValue, spreadWrong,
  };
});

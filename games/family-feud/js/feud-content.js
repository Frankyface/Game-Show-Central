/* ============================================================
   Family Feud — content validation + normalisation (PURE)
   The `questions.json` schema half of the core (spec 03 §2). Kept
   in its own file so `feud-core.js` (state + reducer) stays under
   the 800-line house limit. No DOM, no transport, no app globals.
   Runs in the browser (globalThis.FeudContent) and in Node
   (module.exports). `FeudCore` re-exports everything here, so game
   code and tests can keep calling `FeudCore.validateGame(...)`.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FeudContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_ROUNDS = 12;
  const MIN_ANSWERS = 3;
  const MAX_ANSWERS = 8;
  const QUESTION_MAX = 200;
  const ANSWER_TEXT_MAX = 40;
  const FM_QUESTIONS = 5; // Fast Money always plays exactly five questions.
  const MAX_STRIKES = 5;
  const MAX_TIMER_SECONDS = 120;
  const TEAM_NAME_MAX = 24;
  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII (no literal control bytes in the source).
  const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g");

  const DEFAULT_STRIKES = 3;
  const DEFAULT_MULTIPLIERS = [1, 1, 2, 3];
  const DEFAULT_FM = { enabled: true, target: 200, timer1: 20, timer2: 25 };

  const deepCopy = (value) => JSON.parse(JSON.stringify(value));

  /** Strip control chars, trim, cap. Returns "" when nothing survives. */
  function sanitizeText(raw, max) {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL_CHARS, "").trim().slice(0, max).trim();
  }

  /**
   * Validate a Family Feud content file. Throws `Error(message)` with a
   * host-readable message (Jeopardy's `validateGame` style) on the first
   * problem; returns `data` untouched when it is legal.
   */
  function validateGame(data) {
    const fail = (msg) => { throw new Error(msg); };
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail("Game file must be a JSON object.");
    }
    if (data.title !== undefined && typeof data.title !== "string") {
      fail('"title" must be a string.');
    }
    const settings = resolveSettings(data, fail);
    if (!Array.isArray(data.rounds) || data.rounds.length === 0) {
      fail('"rounds" must be a non-empty array.');
    }
    if (data.rounds.length > MAX_ROUNDS) fail(`Too many rounds (max ${MAX_ROUNDS}).`);
    data.rounds.forEach((round, i) => validateQuestion(round, `Round ${i + 1}`, fail));
    if (data.fastMoney !== undefined && data.fastMoney !== null) {
      if (!Array.isArray(data.fastMoney)) fail('"fastMoney" must be an array of questions.');
      data.fastMoney.forEach((q, i) => validateQuestion(q, `Fast Money question ${i + 1}`, fail));
    }
    if (settings.fastMoney.enabled) {
      const count = Array.isArray(data.fastMoney) ? data.fastMoney.length : 0;
      if (count < FM_QUESTIONS) {
        fail(`Fast Money is switched on, so "fastMoney" needs at least ${FM_QUESTIONS} questions (found ${count}).`);
      }
    }
    return data;
  }

  /**
   * Resolve `settings` to a complete, legal object (throwing through `fail` on
   * junk). `fastMoney.enabled` defaults to true only when the file actually
   * carries Fast Money questions, so a minimal rounds-only file stays valid.
   */
  function resolveSettings(data, fail) {
    const raw = data && data.settings !== undefined && data.settings !== null ? data.settings : {};
    if (typeof raw !== "object" || Array.isArray(raw)) fail('"settings" must be an object.');

    let strikes = DEFAULT_STRIKES;
    if (raw.strikes !== undefined) {
      if (!Number.isInteger(raw.strikes) || raw.strikes < 1 || raw.strikes > MAX_STRIKES) {
        fail(`"settings.strikes" must be a whole number from 1 to ${MAX_STRIKES}.`);
      }
      strikes = raw.strikes;
    }

    let multipliers = DEFAULT_MULTIPLIERS.slice();
    if (raw.multipliers !== undefined) {
      if (!Array.isArray(raw.multipliers) || raw.multipliers.length === 0) {
        fail('"settings.multipliers" must be a non-empty array of positive numbers.');
      }
      raw.multipliers.forEach((m, i) => {
        if (!Number.isFinite(m) || m <= 0) {
          fail(`"settings.multipliers" entry ${i + 1} must be a positive number.`);
        }
      });
      multipliers = raw.multipliers.slice();
    }
    return { strikes, multipliers, fastMoney: resolveFastMoneySettings(data, raw, fail) };
  }

  function resolveFastMoneySettings(data, settings, fail) {
    const raw = settings.fastMoney !== undefined && settings.fastMoney !== null
      ? settings.fastMoney : {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
      fail('"settings.fastMoney" must be an object.');
    }
    const hasQuestions = Array.isArray(data.fastMoney) && data.fastMoney.length > 0;
    let enabled = hasQuestions ? DEFAULT_FM.enabled : false;
    if (raw.enabled !== undefined) {
      if (typeof raw.enabled !== "boolean") {
        fail('"settings.fastMoney.enabled" must be true or false.');
      }
      enabled = raw.enabled;
    }
    return {
      enabled,
      target: intField(raw.target, DEFAULT_FM.target, 0, 100000,
        '"settings.fastMoney.target" must be a whole number from 0 to 100000.', fail),
      timer1: intField(raw.timer1, DEFAULT_FM.timer1, 0, MAX_TIMER_SECONDS,
        `"settings.fastMoney.timer1" must be 0 to ${MAX_TIMER_SECONDS} whole seconds.`, fail),
      timer2: intField(raw.timer2, DEFAULT_FM.timer2, 0, MAX_TIMER_SECONDS,
        `"settings.fastMoney.timer2" must be 0 to ${MAX_TIMER_SECONDS} whole seconds.`, fail),
    };
  }

  function intField(value, fallback, min, max, message, fail) {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) fail(message);
    return value;
  }

  /** Validate one survey question (a round or a Fast Money question). */
  function validateQuestion(q, where, fail) {
    if (!q || typeof q !== "object" || Array.isArray(q)) fail(`${where} must be an object.`);
    if (typeof q.question !== "string" || !q.question.trim()) {
      fail(`${where} needs a non-empty "question".`);
    }
    if (q.question.length > QUESTION_MAX) {
      fail(`${where} question is too long (max ${QUESTION_MAX} characters).`);
    }
    const n = Array.isArray(q.answers) ? q.answers.length : 0;
    if (n < MIN_ANSWERS || n > MAX_ANSWERS) {
      fail(`${where} needs between ${MIN_ANSWERS} and ${MAX_ANSWERS} answers (found ${n}).`);
    }
    const seen = new Set();
    q.answers.forEach((a, i) => validateAnswer(a, `${where}, answer ${i + 1}`, seen, fail));
  }

  function validateAnswer(a, at, seen, fail) {
    if (!a || typeof a !== "object" || Array.isArray(a)) fail(`${at} must be an object.`);
    if (typeof a.text !== "string" || !a.text.trim()) fail(`${at} needs a non-empty "text".`);
    if (a.text.length > ANSWER_TEXT_MAX) {
      fail(`${at} text is too long (max ${ANSWER_TEXT_MAX} characters).`);
    }
    if (!Number.isInteger(a.count) || a.count < 1 || a.count > 100) {
      fail(`${at} needs a whole-number "count" from 1 to 100.`);
    }
    const key = a.text.trim().toLowerCase();
    if (seen.has(key)) fail(`${at} ("${a.text.trim()}") duplicates an earlier answer.`);
    seen.add(key);
  }

  /** Non-fatal content problems the editor shows in amber (spec §2). */
  function warningsFor(data) {
    const out = [];
    if (!data || typeof data !== "object") return out;
    const scan = (list, label) => {
      if (!Array.isArray(list)) return;
      list.forEach((q, i) => {
        if (!q || !Array.isArray(q.answers)) return;
        const sum = q.answers.reduce(
          (t, a) => t + (a && Number.isFinite(a.count) ? a.count : 0), 0);
        if (sum > 100) {
          out.push(`${label} ${i + 1}: the counts add up to ${sum} — a survey of 100 people can't total more than 100.`);
        }
      });
    };
    scan(data.rounds, "Round");
    scan(data.fastMoney, "Fast Money question");
    return out;
  }

  /**
   * Validate, then return a deep copy with answers sorted by count (desc) and
   * settings filled in. Safe to call on already-normalised content.
   */
  function normalizeGame(data) {
    validateGame(data);
    const settings = resolveSettings(data, (m) => { throw new Error(m); });
    const sortQuestion = (q) => ({
      question: q.question.trim(),
      answers: q.answers
        .map((a) => ({ text: a.text.trim(), count: a.count }))
        .sort((x, y) => y.count - x.count),
    });
    return {
      title: typeof data.title === "string" && data.title.trim()
        ? data.title.trim() : "Family Feud",
      settings: deepCopy(settings),
      rounds: data.rounds.map(sortQuestion),
      fastMoney: Array.isArray(data.fastMoney) ? data.fastMoney.map(sortQuestion) : [],
    };
  }

  return {
    MAX_ROUNDS, MIN_ANSWERS, MAX_ANSWERS, QUESTION_MAX, ANSWER_TEXT_MAX,
    FM_QUESTIONS, MAX_STRIKES, MAX_TIMER_SECONDS, TEAM_NAME_MAX,
    DEFAULT_STRIKES, DEFAULT_MULTIPLIERS, DEFAULT_FM,
    validateGame, validateQuestion, resolveSettings, warningsFor, normalizeGame, sanitizeText,
  };
});

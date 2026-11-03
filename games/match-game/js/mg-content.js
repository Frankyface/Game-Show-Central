/* ============================================================
   Match Game — content rules (PURE)
   The JSON contract from spec 18 §2: what a playable Match Game
   file may hold, how a loaded file is normalised (text cleaned,
   settings filled in) and how the night's prompt order is drawn.
   Split out of mg-core.js so both files stay well under the
   800-line house limit; mg-core.js re-exports everything here,
   so callers only ever touch MgCore.

   No DOM, no timers, no randomness of its own (an `rng` is
   injected) and nothing here mutates the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MgContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    panelSize: 6,
    rounds: 2,
    pointsPerMatch: 1,
    audienceValues: Object.freeze([500, 250, 100]),
    multipliers: Object.freeze([10, 20, 30]),
    secondRoundRule: false,
  });

  /** The blank a fill-in-the-blank prompt must carry (spec 18 §2). */
  const BLANK = "___";

  const PROMPT_MAX = 160;
  const HINT_MAX = 60;
  const ANSWER_MAX = 40;        // every answer, from a phone or the host
  const GAME_TITLE_MAX = 80;
  const CURRENCY_MAX = 3;
  const NAME_MAX = 24;
  const PID_MAX = 40;

  const MIN_PROMPTS = 30;       // a playable file (spec 18 §2)
  const MIN_AUDIENCE = 10;
  const COMFORTABLE_PROMPTS = 60;
  const COMFORTABLE_AUDIENCE = 20;
  const MAX_PROMPTS = 500;

  const MIN_PANEL = 2;
  const MAX_PANEL = 6;
  const MIN_ROUNDS = 1;
  const MAX_ROUNDS = 6;
  const MAX_POINTS = 100;
  const MAX_VALUE = 1000000;
  const MAX_MULTIPLIER = 1000;
  const MAX_MULTIPLIERS = 6;

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{currency:string, panelSize:number, rounds:number,
   *            pointsPerMatch:number, audienceValues:number[],
   *            multipliers:number[], secondRoundRule:boolean}} Settings
   * @typedef {{text:string, hint:string}} Prompt
   * @typedef {{title:string, settings:Settings, prompts:Prompt[],
   *            audiencePrompts:Prompt[]}} Game
   */

  /* ============ Small helpers ============ */

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function isIntIn(v, lo, hi) {
    return Number.isInteger(v) && v >= lo && v <= hi;
  }

  /** Every rejection is a plain-English sentence a host can act on. */
  function fail(message) {
    throw new Error(message);
  }

  /** Strip control chars, collapse runs of blanks, trim, cap. "" when empty. */
  function cleanText(raw, max) {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  }

  /**
   * The frequency key for an audience answer (spec 18 §4): trim, case-fold,
   * collapse spaces. Punctuation at the ends goes too, so "Gloves." and
   * "gloves" are the same answer — the host still has merge buttons for the
   * rest.
   */
  function normaliseAnswer(raw) {
    const clean = cleanText(raw, ANSWER_MAX).toLowerCase();
    return clean.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
  }

  /* ============ Prompts ============ */

  function normalizePrompt(raw, i, where, needBlank) {
    const source = typeof raw === "string" ? { text: raw } : raw;
    if (!isPlainObject(source)) fail(`${where} ${i + 1} is not a prompt.`);
    const text = cleanText(source.text, PROMPT_MAX);
    if (!text) fail(`${where} ${i + 1} has no text.`);
    if (needBlank && text.indexOf(BLANK) < 0) {
      fail(`${where} ${i + 1} needs a blank written as ${BLANK} — “${text}”.`);
    }
    return { text, hint: cleanText(source.hint, HINT_MAX) };
  }

  function normalizeList(raw, where, min, needBlank) {
    if (!Array.isArray(raw)) fail(`This file has no ${where.toLowerCase()} list.`);
    if (raw.length > MAX_PROMPTS) fail(`${where}: ${MAX_PROMPTS} is the most this game can hold.`);
    const out = raw.map((p, i) => normalizePrompt(p, i, where, needBlank));
    if (out.length < min) {
      fail(`${where}: ${out.length} isn’t enough — a playable file needs at least ${min}.`);
    }
    return out;
  }

  /* ============ Settings ============ */

  function numberList(raw, fallback, count, hi, where) {
    if (raw === undefined || raw === null) return fallback.slice();
    if (!Array.isArray(raw) || raw.length === 0) fail(`${where} has to be a list of numbers.`);
    if (count && raw.length !== count) fail(`${where} needs exactly ${count} numbers.`);
    if (!count && raw.length > MAX_MULTIPLIERS) {
      fail(`${where}: ${MAX_MULTIPLIERS} is the most this game can spin.`);
    }
    return raw.map((v) => {
      const n = Math.round(Number(v));
      if (!isIntIn(n, 1, hi)) fail(`${where}: ${JSON.stringify(v)} has to be a whole number from 1 to ${hi}.`);
      return n;
    });
  }

  function normalizeSettings(raw) {
    const s = isPlainObject(raw) ? raw : {};
    const out = {
      currency: cleanText(s.currency, CURRENCY_MAX) || DEFAULT_SETTINGS.currency,
      panelSize: pick(s.panelSize, DEFAULT_SETTINGS.panelSize, MIN_PANEL, MAX_PANEL, "Panel size"),
      rounds: pick(s.rounds, DEFAULT_SETTINGS.rounds, MIN_ROUNDS, MAX_ROUNDS, "Rounds"),
      pointsPerMatch: pick(s.pointsPerMatch, DEFAULT_SETTINGS.pointsPerMatch, 1, MAX_POINTS,
        "Points per match"),
      audienceValues: numberList(s.audienceValues, DEFAULT_SETTINGS.audienceValues, 3, MAX_VALUE,
        "Audience Match values"),
      multipliers: numberList(s.multipliers, DEFAULT_SETTINGS.multipliers, 0, MAX_MULTIPLIER,
        "Head-to-Head multipliers"),
      secondRoundRule: s.secondRoundRule === true,
    };
    return out;
  }

  function pick(value, fallback, lo, hi, where) {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Math.round(Number(value));
    if (!isIntIn(n, lo, hi)) fail(`${where} has to be a whole number from ${lo} to ${hi}.`);
    return n;
  }

  /** The settings a loaded (or half-written) file would play with. */
  function settingsOf(game) {
    try {
      return normalizeSettings(game && game.settings);
    } catch (err) {
      return Object.assign({}, DEFAULT_SETTINGS, {
        audienceValues: DEFAULT_SETTINGS.audienceValues.slice(),
        multipliers: DEFAULT_SETTINGS.multipliers.slice(),
      });
    }
  }

  /* ============ The whole file ============ */

  /**
   * Normalise a content file into the exact shape the core plays with.
   * Throws with a plain-English message the editor and the loader show.
   * @param {*} raw @returns {Game}
   */
  function normalizeGame(raw) {
    if (!isPlainObject(raw)) fail("That file isn’t a Match Game file — it should be a JSON object.");
    const settings = normalizeSettings(raw.settings);
    const prompts = normalizeList(raw.prompts, "Prompts", MIN_PROMPTS, true);
    const audiencePrompts = normalizeList(raw.audiencePrompts, "Audience prompts", MIN_AUDIENCE, false);
    return {
      title: cleanText(raw.title, GAME_TITLE_MAX) || "Match Game",
      settings,
      prompts,
      audiencePrompts,
    };
  }

  /** Throws on anything unplayable; returns the file unchanged when it is fine. */
  function validateGame(raw) {
    normalizeGame(raw);
    return raw;
  }

  /** Things worth telling the host that are not bad enough to refuse. */
  function warningsFor(raw) {
    const out = [];
    let game;
    try {
      game = normalizeGame(raw);
    } catch (err) {
      return [err.message];
    }
    if (game.prompts.length < COMFORTABLE_PROMPTS) {
      out.push(`${game.prompts.length} prompts is playable; ${COMFORTABLE_PROMPTS} gives a whole night.`);
    }
    if (game.audiencePrompts.length < COMFORTABLE_AUDIENCE) {
      out.push(`${game.audiencePrompts.length} audience prompts is playable; `
        + `${COMFORTABLE_AUDIENCE} keeps the Super Match fresh.`);
    }
    const dupes = duplicatesIn(game.prompts);
    if (dupes.length) out.push(`These prompts repeat: ${dupes.slice(0, 3).join("; ")}.`);
    const longOnes = game.prompts.filter((p) => p.text.length > 120).length;
    if (longOnes) out.push(`${longOnes} prompts are over 120 characters — they read small on a shared screen.`);
    return out;
  }

  function duplicatesIn(list) {
    const seen = new Set();
    const out = [];
    list.forEach((p) => {
      const key = p.text.toLowerCase();
      if (seen.has(key)) out.push(p.text);
      else seen.add(key);
    });
    return out;
  }

  /* ============ Drawing the night ============ */

  /** Fisher–Yates with an injected rng, on a copy. */
  function shuffled(list, rng) {
    const out = list.slice();
    const random = typeof rng === "function" ? rng : Math.random;
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1)) % (i + 1);
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  /**
   * The order the night's prompts come out in — indexes into the file, so a
   * saved game keeps working when the file is reloaded.
   * @param {Game} game @param {{shuffle?:boolean, rng?:() => number}} [opts]
   * @returns {{prompts:number[], audience:number[]}}
   */
  function drawOrder(game, opts) {
    const o = opts || {};
    const promptIdx = game.prompts.map((_, i) => i);
    const audIdx = game.audiencePrompts.map((_, i) => i);
    return {
      prompts: o.shuffle ? shuffled(promptIdx, o.rng) : promptIdx,
      audience: o.shuffle ? shuffled(audIdx, o.rng) : audIdx,
    };
  }

  /**
   * The prompt at `cursor` in `order`, wrapping round when the list runs out
   * (a long night never runs dry; the host is told it is repeating).
   */
  function promptAt(list, order, cursor) {
    if (!order.length || !list.length) return { text: "", hint: "", index: -1, repeating: false };
    const wrapped = cursor >= order.length;
    const idx = order[cursor % order.length];
    const found = list[idx] || list[0];
    return { text: found.text, hint: found.hint, index: idx, repeating: wrapped };
  }

  return {
    // limits and defaults
    DEFAULT_SETTINGS, BLANK, PROMPT_MAX, HINT_MAX, ANSWER_MAX, GAME_TITLE_MAX,
    CURRENCY_MAX, NAME_MAX, PID_MAX, MIN_PROMPTS, MIN_AUDIENCE, MAX_PROMPTS,
    COMFORTABLE_PROMPTS, COMFORTABLE_AUDIENCE, MIN_PANEL, MAX_PANEL,
    MIN_ROUNDS, MAX_ROUNDS, MAX_VALUE, MAX_MULTIPLIER,
    // helpers
    isPlainObject, isIntIn, cleanText, normaliseAnswer, fail,
    // content
    validateGame, normalizeGame, settingsOf, warningsFor, drawOrder, promptAt, shuffled,
  };
});

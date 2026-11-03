/* ============================================================
   Krillion — content rules (PURE)
   The JSON contract (spec 20 §3): what a playable Krillion file
   may hold, how a loaded file is normalised, how answers are
   normalised and how a player's answer is matched against a
   prompt's RATED ANSWER LIST. Every prompt ships with its own
   list of answers, each carrying a depth tier (Prawn … One in a
   Krillion by default) plus optional aliases; an answer on the
   list takes its tier automatically, anything else goes to the
   judge.

   No DOM, no timers, no randomness of its own (an `rng` is
   injected) and nothing here mutates the caller's objects.
   kr-core.js re-exports everything, so callers only touch KrCore.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KrContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  /**
   * The default depth tiers, shallow to deep. Ids are the JSON values. A file
   * may declare its own list (settings.tiers: 2–6 tiers, strictly increasing
   * points); a tier's position in the list is its Puffer Party meter value
   * (Prawn 0, Schooler 1, Rare 2, Deep Cut 3, One in a Krillion 4).
   */
  const TIERS = Object.freeze([
    Object.freeze({ id: "prawn", name: "Prawn", points: 10 }),
    Object.freeze({ id: "schooler", name: "Schooler", points: 30 }),
    Object.freeze({ id: "rare", name: "Rare", points: 60 }),
    Object.freeze({ id: "deepcut", name: "Deep Cut", points: 85 }),
    Object.freeze({ id: "krillion", name: "One in a Krillion", points: 100 }),
  ]);
  const TIER_IDS = Object.freeze(TIERS.map((t) => t.id));
  const MIN_TIERS = 2;
  const MAX_TIERS = 6;
  const TIER_NAME_MAX = 24;

  const PROMPT_MAX = 120;
  const CATEGORY_MAX = 30;
  const ANSWER_MAX = 40;
  const GAME_TITLE_MAX = 80;
  const NAME_MAX = 24;
  const PID_MAX = 40;
  const MIN_PROMPTS = 40;
  const MAX_PROMPTS = 500;
  const MIN_ANSWERS = 5;           // per prompt
  const MIN_TIERS_COVERED = 3;     // per prompt
  const MAX_ANSWERS = 60;          // per prompt (the judge's additions included)
  const MAX_ALIASES = 8;           // per answer
  const COMFORTABLE_ANSWERS = 10;
  const METRES_PER_POINT = 10;

  const DEFAULT_SETTINGS = Object.freeze({
    mode: "deepDive",
    promptSeconds: 30,
    promptsPerGame: 7,
    tiers: TIERS,
    puffer: Object.freeze({
      hearts: 3, maxHearts: 4, startSeconds: 12, floorSeconds: 3, stepSeconds: 1,
      meterForHeart: 100, roundCap: 0,
    }),
  });

  const MODES = Object.freeze(["deepDive", "puffer"]);

  // C0 + DEL + C1 controls, built from escapes so this file stays printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");
  const COMBINING = new RegExp("[̀-ͯ]", "g");

  /* ============ Small helpers ============ */

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

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

  /** Strip control chars, collapse blanks, trim, cap. "" when empty. */
  function cleanText(raw, max) {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  }

  function tierList(tiers) {
    return Array.isArray(tiers) && tiers.length ? tiers : TIERS;
  }

  /** The tier with this id in `tiers` (the default list when omitted), or null. */
  function tierById(id, tiers) {
    return tierList(tiers).find((t) => t.id === id) || null;
  }

  function isTier(id, tiers) {
    return typeof id === "string" && tierList(tiers).some((t) => t.id === id);
  }

  /* ============ Answer normalisation ============ */

  /**
   * The grouping key for an answer: case-folded, accents stripped, "&" read
   * as "and", apostrophes dropped, every other mark a space, blanks collapsed,
   * and a leading "the", "a" or "an" removed. "The Nile." and "nile" match.
   */
  function normaliseAnswer(raw) {
    const clean = cleanText(raw, ANSWER_MAX * 2).normalize("NFKD").replace(COMBINING, "")
      .toLowerCase().replace(/&/g, " and ").replace(/['’‘`]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const stripped = clean.replace(/^(the|a|an) /, "");
    return stripped || clean;
  }

  /** Loose forms tried after the exact key: no spaces, then simple singulars. */
  function looseForms(key) {
    const out = [];
    const add = (k) => { if (k && k !== key && out.indexOf(k) < 0) out.push(k); };
    const squash = key.replace(/ /g, "");
    add(squash);
    [key, squash].forEach((k) => {
      if (k.length < 4) return;
      if (/ies$/.test(k)) add(`${k.slice(0, -3)}y`);
      if (/(ches|shes|xes|sses|oes)$/.test(k)) add(k.slice(0, -2));
      if (/[^s]s$/.test(k)) add(k.slice(0, -1));
    });
    return out;
  }

  /* ============ Matching an answer to the rated list ============ */

  /** Every key an entry answers to: its text and each alias. */
  function entryKeys(entry) {
    const keys = [normaliseAnswer(entry.text)];
    (entry.aliases || []).forEach((a) => {
      const k = normaliseAnswer(a);
      if (k && keys.indexOf(k) < 0) keys.push(k);
    });
    return keys.filter(Boolean);
  }

  /** key -> entry index; exact keys first, loose forms only where free. */
  function buildIndex(list) {
    const exact = new Map();
    const loose = new Map();
    list.forEach((entry, i) => {
      entryKeys(entry).forEach((k) => {
        if (!exact.has(k)) exact.set(k, i);
        looseForms(k).forEach((f) => { if (!loose.has(f)) loose.set(f, i); });
      });
    });
    return { exact, loose };
  }

  /**
   * Find `text` on a prompt's rated list (plus any answers the judge added
   * this session). Returns {index, entry, tier} or null when it is off-list.
   * @param {{answers:object[]}} prompt @param {string} text @param {object[]} [extra]
   */
  function matchAnswer(prompt, text, extra) {
    const key = normaliseAnswer(text);
    if (!key || !prompt) return null;
    const list = (Array.isArray(prompt.answers) ? prompt.answers : [])
      .concat(Array.isArray(extra) ? extra : []);
    const index = buildIndex(list);
    let at = index.exact.has(key) ? index.exact.get(key) : -1;
    if (at < 0) {
      const tries = [key].concat(looseForms(key));
      for (const form of tries) {
        if (index.exact.has(form)) { at = index.exact.get(form); break; }
        if (index.loose.has(form)) { at = index.loose.get(form); break; }
      }
    }
    if (at < 0) return null;
    const entry = list[at];
    return { index: at, entry, tier: entry.tier };
  }

  /* ============ Settings ============ */

  function pick(value, fallback, lo, hi, where) {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || Math.round(n) !== n || n < lo || n > hi) {
      fail(`${where} has to be a whole number from ${lo} to ${hi}.`);
    }
    return n;
  }

  /** settings.tiers: 2–6 tiers, unique ids, names ≤ 24, strictly rising points. */
  function normalizeTiers(raw) {
    if (raw === undefined || raw === null) return TIERS.map((t) => Object.assign({}, t));
    if (!Array.isArray(raw)) fail("Tiers must be a list.");
    if (raw.length < MIN_TIERS || raw.length > MAX_TIERS) fail(`A file needs ${MIN_TIERS} to ${MAX_TIERS} tiers.`);
    const seen = new Set();
    const out = raw.map((t, i) => {
      if (!isPlainObject(t)) fail(`Tier ${i + 1} is not a tier.`);
      const id = typeof t.id === "string" ? t.id.trim() : "";
      if (!/^[a-z0-9-]{1,24}$/.test(id)) fail(`Tier ${i + 1} needs an id in lower-case letters, digits or hyphens.`);
      if (seen.has(id)) fail(`Two tiers share the id “${id}”.`);
      seen.add(id);
      const name = cleanText(t.name, TIER_NAME_MAX + 1);
      if (!name || name.length > TIER_NAME_MAX) fail(`Tier “${id}” needs a name of ${TIER_NAME_MAX} characters or fewer.`);
      const points = pick(t.points, null, 0, 10000, `Points for ${name}`);
      if (points === null) fail(`${name} needs points.`);
      return { id, name, points };
    });
    out.forEach((t, i) => {
      if (i > 0 && t.points <= out[i - 1].points) fail(`${t.name} has to be worth more than ${out[i - 1].name}.`);
    });
    return out;
  }

  function normalizePuffer(raw) {
    const d = DEFAULT_SETTINGS.puffer;
    const p = isPlainObject(raw) ? raw : {};
    const maxHearts = pick(p.maxHearts, d.maxHearts, 1, 9, "Most hearts");
    const hearts = pick(p.hearts, Math.min(d.hearts, maxHearts), 1, maxHearts, "Starting hearts");
    const startSeconds = pick(p.startSeconds, d.startSeconds, 2, 120, "Puffer clock start");
    const floorSeconds = pick(p.floorSeconds, Math.min(d.floorSeconds, startSeconds), 1, startSeconds,
      "Shortest puffer clock");
    return {
      hearts, maxHearts, startSeconds, floorSeconds,
      stepSeconds: pick(p.stepSeconds, d.stepSeconds, 0, 30, "Puffer clock step"),
      meterForHeart: pick(p.meterForHeart, d.meterForHeart, 1, 1000, "Meter points for a heart"),
      roundCap: pick(p.roundCap, d.roundCap, 0, 200, "Round cap"),
    };
  }

  function normalizeSettings(raw) {
    const s = isPlainObject(raw) ? raw : {};
    const mode = s.mode === undefined || s.mode === null ? DEFAULT_SETTINGS.mode : s.mode;
    if (MODES.indexOf(mode) < 0) fail("Mode has to be “deepDive” or “puffer”.");
    return {
      mode,
      promptSeconds: pick(s.promptSeconds, DEFAULT_SETTINGS.promptSeconds, 5, 300, "Round seconds"),
      promptsPerGame: pick(s.promptsPerGame, DEFAULT_SETTINGS.promptsPerGame, 1, 50, "Prompts per game"),
      tiers: normalizeTiers(s.tiers),
      puffer: normalizePuffer(s.puffer),
    };
  }

  /** The settings a loaded (or half-written) file would play with. */
  function settingsOf(game) {
    try {
      return normalizeSettings(game && game.settings);
    } catch (err) {
      return normalizeSettings({});
    }
  }

  /* ============ Prompts ============ */

  function normalizeEntry(raw, i, where, tiers) {
    if (!isPlainObject(raw)) fail(`${where}, answer ${i + 1} is not an answer.`);
    const text = cleanText(raw.text, ANSWER_MAX + 1);
    if (!text) fail(`${where}, answer ${i + 1} has no text.`);
    if (text.length > ANSWER_MAX) fail(`${where}, “${text}” is longer than ${ANSWER_MAX} characters.`);
    if (!isTier(raw.tier, tiers)) {
      fail(`${where}, “${text}” needs a tier: one of ${tiers.map((t) => t.id).join(", ")}.`);
    }
    const rawAliases = raw.aliases === undefined || raw.aliases === null ? [] : raw.aliases;
    if (!Array.isArray(rawAliases)) fail(`${where}, “${text}”: aliases must be a list.`);
    if (rawAliases.length > MAX_ALIASES) fail(`${where}, “${text}” has more than ${MAX_ALIASES} aliases.`);
    const aliases = rawAliases.map((a) => cleanText(a, ANSWER_MAX)).filter(Boolean);
    return aliases.length ? { text, tier: raw.tier, aliases } : { text, tier: raw.tier };
  }

  function normalizeAnswers(raw, where, tiers) {
    if (!Array.isArray(raw)) fail(`${where} needs a list of rated answers.`);
    if (raw.length > MAX_ANSWERS) fail(`${where} has more than ${MAX_ANSWERS} rated answers.`);
    if (raw.length < MIN_ANSWERS) fail(`${where} needs at least ${MIN_ANSWERS} rated answers.`);
    const list = raw.map((a, i) => normalizeEntry(a, i, where, tiers));
    const need = Math.min(MIN_TIERS_COVERED, tiers.length);
    if (new Set(list.map((a) => a.tier)).size < need) {
      fail(`${where} needs answers in at least ${need} different tiers.`);
    }
    const owner = new Map();
    list.forEach((entry) => {
      entryKeys(entry).forEach((k) => {
        if (owner.has(k) && owner.get(k) !== entry) {
          fail(`${where}: “${entry.text}” and “${owner.get(k).text}” both answer to “${k}”.`);
        }
        owner.set(k, entry);
      });
    });
    return list;
  }

  function normalizePrompt(raw, i, tiers) {
    const source = typeof raw === "string" ? { text: raw } : raw;
    if (!isPlainObject(source)) fail(`Prompt ${i + 1} is not a prompt.`);
    const text = cleanText(source.text, PROMPT_MAX + 1);
    if (!text) fail(`Prompt ${i + 1} has no text.`);
    if (text.length > PROMPT_MAX) fail(`Prompt ${i + 1} is longer than ${PROMPT_MAX} characters.`);
    const where = `Prompt ${i + 1} (“${text.slice(0, 40)}”)`;
    return {
      text,
      category: cleanText(source.category, CATEGORY_MAX),
      answers: normalizeAnswers(source.answers, where, tiers),
    };
  }

  /* ============ The whole file ============ */

  /**
   * Normalise a content file into the exact shape the core plays with.
   * Throws with a plain-English message the editor and the loader show.
   */
  function normalizeGame(raw) {
    if (!isPlainObject(raw)) fail("That file isn’t a Krillion file — it should be a JSON object.");
    const settings = normalizeSettings(raw.settings);
    if (!Array.isArray(raw.prompts)) fail("This file has no prompts list.");
    if (raw.prompts.length > MAX_PROMPTS) fail(`${MAX_PROMPTS} prompts is the most this game can hold.`);
    const prompts = raw.prompts.map((p, i) => normalizePrompt(p, i, settings.tiers));
    if (prompts.length < MIN_PROMPTS) {
      fail(`${prompts.length} prompts isn’t enough — a playable file needs at least ${MIN_PROMPTS}.`);
    }
    return { title: cleanText(raw.title, GAME_TITLE_MAX) || "Krillion", settings, prompts };
  }

  /** Throws on anything unplayable; returns the file unchanged when it is fine. */
  function validateGame(raw) {
    normalizeGame(raw);
    return raw;
  }

  /** One prompt on its own: "" when it is fine, else the plain-English problem. */
  function promptProblem(prompt, settings) {
    try {
      normalizePrompt(prompt, 0, normalizeSettings(settings).tiers);
      return "";
    } catch (err) {
      return err.message.replace(/^Prompt 1( \(“[^”]*”\))?/, "This prompt");
    }
  }

  /** Which tiers a prompt's list has no answer for (names). */
  function missingTiers(prompt, tiers) {
    const seen = new Set((prompt.answers || []).map((a) => a.tier));
    return tierList(tiers).filter((t) => !seen.has(t.id)).map((t) => t.name);
  }

  /** Things worth telling the host that are not bad enough to refuse. */
  function warningsFor(raw) {
    let game;
    try {
      game = normalizeGame(raw);
    } catch (err) {
      return [err.message];
    }
    const out = [];
    const thin = game.prompts.filter((p) => p.answers.length < COMFORTABLE_ANSWERS).length;
    if (thin) out.push(`${thin} prompts have fewer than ${COMFORTABLE_ANSWERS} rated answers, so more goes to the judge.`);
    const gaps = game.prompts.filter((p) => missingTiers(p, game.settings.tiers).length).length;
    if (gaps) out.push(`${gaps} prompts don’t cover every tier.`);
    const seen = new Set();
    const dupes = [];
    game.prompts.forEach((p) => {
      const k = p.text.toLowerCase();
      if (seen.has(k)) dupes.push(p.text);
      seen.add(k);
    });
    if (dupes.length) out.push(`These prompts repeat: ${dupes.slice(0, 3).join("; ")}.`);
    return out;
  }

  /* ============ Remembered answers ============ */

  /**
   * Fold the judge's remembered answers ([{prompt, text, tier}]) into a copy
   * of a content file, skipping any that already match. Returns a new file.
   */
  function applyLearned(game, learned) {
    if (!isPlainObject(game) || !Array.isArray(game.prompts)) return game;
    const copy = JSON.parse(JSON.stringify(game));
    const tiers = settingsOf(game).tiers;
    (Array.isArray(learned) ? learned : []).forEach((item) => {
      if (!isPlainObject(item) || !isTier(item.tier, tiers)) return;
      const text = cleanText(item.text, ANSWER_MAX);
      const target = copy.prompts.find((p) => isPlainObject(p) && cleanText(p.text, PROMPT_MAX) === item.prompt);
      if (!text || !target) return;
      if (!Array.isArray(target.answers)) target.answers = [];
      if (target.answers.length >= MAX_ANSWERS || matchAnswer(target, text)) return;
      target.answers.push({ text, tier: item.tier });
    });
    return copy;
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

  /** Prompt indexes in play order (file order unless shuffled). */
  function drawOrder(game, opts) {
    const o = opts || {};
    const idx = game.prompts.map((_, i) => i);
    return o.shuffle ? shuffled(idx, o.rng) : idx;
  }

  return {
    TIERS, TIER_IDS, MIN_TIERS, MAX_TIERS, TIER_NAME_MAX, MODES, DEFAULT_SETTINGS,
    PROMPT_MAX, CATEGORY_MAX, ANSWER_MAX, GAME_TITLE_MAX, NAME_MAX, PID_MAX,
    MIN_PROMPTS, MAX_PROMPTS, MIN_ANSWERS, MIN_TIERS_COVERED, MAX_ANSWERS, MAX_ALIASES,
    COMFORTABLE_ANSWERS, METRES_PER_POINT,
    has, isPlainObject, isIntIn, cleanText, fail, tierList, tierById, isTier, normalizeTiers,
    normaliseAnswer, looseForms, entryKeys, matchAnswer, missingTiers, promptProblem,
    normalizeGame, validateGame, normalizeSettings, settingsOf, warningsFor, applyLearned,
    shuffled, drawOrder,
  };
});

/* ============================================================
   The Price Is Right — content rules (PURE)
   The JSON contract from spec 10 §2: what a playable prize file
   may contain, how a loaded file is normalised (defaults filled,
   ids stamped, showcase totals computed), and the small shared
   helpers the reducer and the selectors need. Split out of
   tpir-core.js so both files stay well under the 800-line house
   limit; tpir-core.js re-exports everything here, so callers only
   ever touch TpirCore.
   No DOM, no timers, no mutation of the caller's objects.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TpirContent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  const GAME_KINDS = ["cliffhangers", "plinko", "luckyseven"];

  const DEFAULT_WHEEL = [100, 15, 80, 35, 60, 20, 40, 75, 55, 95,
    50, 85, 30, 65, 10, 45, 70, 25, 90, 5];
  const DEFAULT_PLINKO_SLOTS = [100, 500, 1000, 0, 10000, 0, 1000, 500, 100];

  const DEFAULT_SETTINGS = Object.freeze({
    currency: "$",
    exactBidBonus: 500,
    showcaseMargin: 250,
    wheel: DEFAULT_WHEEL,
    wheelDollarBonus: 1000,
    gamesPerShowdown: 3,
    plinko: Object.freeze({ slots: DEFAULT_PLINKO_SLOTS, maxChips: 5 }),
    pricingGames: GAME_KINDS,
  });

  const NAME_MAX = 60;          // prize / item name (spec 10 §2)
  const NOTE_MAX = 120;
  const TITLE_MAX = 80;
  const PID_MAX = 24;
  const PLAYER_NAME_MAX = 24;
  const CURRENCY_MAX = 3;
  const MAX_PRICE = 1000000;    // structural cap on any price in the file
  const MAX_BID = 999999;       // structural cap on a contestant's bid
  const WHEEL_SLOTS = 20;
  const PLINKO_SLOTS = 9;
  const CLIFF_STEPS = 25;       // the climber falls past this
  const CLIFF_ITEMS = 3;
  const PLINKO_PRICES = 4;
  const L7_DIGITS = 5;
  const L7_START = 7;           // dollars in the wallet
  const ROW_SEATS = 4;
  const MAX_PLAYERS = 16;
  const MIN_ONE_BID = 4;
  const MIN_SHOWCASES = 2;

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

  /**
   * @typedef {{name:string, price:number, note:string}} Prize
   * @typedef {{id:string, name:string, price:number, note:string}} OneBidItem
   * @typedef {{id:string, items:Prize[], prize:Prize}} CliffSet
   * @typedef {{id:string, smallPrices:{name:string, shown:number, actual:number}[]}} PlinkoSet
   * @typedef {{id:string, car:string, price:number, note:string}} LuckySeven
   * @typedef {{id:string, prizes:Prize[], total:number}} Showcase
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

  /** A whole number in [lo, hi]. */
  function isIntIn(v, lo, hi) {
    return Number.isInteger(v) && v >= lo && v <= hi;
  }

  function isPosInt(v) {
    return Number.isInteger(v) && v > 0;
  }

  /** Deterministic index from an injected rng; never out of range. */
  function pickIndex(rng, length) {
    if (!length || length <= 0) return -1;
    const rand = typeof rng === "function" ? rng : Math.random;
    const raw = Number(rand());
    const scaled = Number.isFinite(raw) ? Math.floor(raw * length) : 0;
    return Math.min(Math.max(scaled, 0), length - 1);
  }

  /** `$1,234` — the one place money becomes text. */
  function money(currency, amount) {
    const n = Number.isFinite(amount) ? Math.round(amount) : 0;
    const sign = n < 0 ? "-" : "";
    const body = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}${currency || "$"}${body}`;
  }

  /* ============ Validation ============ */

  /** The enabled pricing games a file will actually play with. */
  function enabledGames(game) {
    const s = isPlainObject(game) && isPlainObject(game.settings) ? game.settings : {};
    if (!Array.isArray(s.pricingGames)) return GAME_KINDS.slice();
    const wanted = s.pricingGames.filter((k) => GAME_KINDS.indexOf(k) >= 0);
    return wanted.length ? wanted : GAME_KINDS.slice();
  }

  /**
   * Throw a plain-English Error when `game` is not a playable prize file.
   * Returns true so callers can use it as an assertion.
   * @param {unknown} game @returns {true}
   */
  function validateGame(game) {
    if (!isPlainObject(game)) fail("This file is not a Price Is Right game: expected a JSON object.");
    if (game.title !== undefined && typeof game.title !== "string") fail("“title” must be text.");
    validateSettings(game.settings);
    const on = enabledGames(game);
    validateOneBid(game.oneBid);
    if (on.indexOf("cliffhangers") >= 0) validateCliffhangers(game.cliffhangers);
    if (on.indexOf("plinko") >= 0) validatePlinko(game.plinko);
    if (on.indexOf("luckyseven") >= 0) validateLuckySeven(game.luckyseven);
    validateShowcases(game.showcases);
    return true;
  }

  function validateSettings(raw) {
    if (raw === undefined || raw === null) return;
    if (!isPlainObject(raw)) fail("“settings” must be an object.");
    const s = raw;
    if (s.currency !== undefined && (typeof s.currency !== "string" || s.currency.length > CURRENCY_MAX)) {
      fail("“settings.currency” must be text of at most 3 characters.");
    }
    checkMoneySetting(s, "exactBidBonus");
    checkMoneySetting(s, "showcaseMargin");
    checkMoneySetting(s, "wheelDollarBonus");
    if (s.gamesPerShowdown !== undefined && !isIntIn(s.gamesPerShowdown, 1, 8)) {
      fail("“settings.gamesPerShowdown” must be a whole number from 1 to 8.");
    }
    if (s.wheel !== undefined) validateWheel(s.wheel);
    if (s.plinko !== undefined) validatePlinkoSettings(s.plinko);
    if (s.pricingGames !== undefined) validatePricingGames(s.pricingGames);
  }

  function checkMoneySetting(s, key) {
    if (s[key] === undefined) return;
    if (!isIntIn(s[key], 0, MAX_PRICE)) {
      fail(`“settings.${key}” must be a whole number of ${key === "showcaseMargin" ? "dollars" : "dollars"} from 0 to ${MAX_PRICE}.`);
    }
  }

  function validateWheel(wheel) {
    if (!Array.isArray(wheel) || wheel.length !== WHEEL_SLOTS) {
      fail(`“settings.wheel” must list exactly ${WHEEL_SLOTS} values.`);
    }
    wheel.forEach((v, i) => {
      if (!isIntIn(v, 5, 100) || v % 5 !== 0) {
        fail(`Wheel segment ${i + 1} must be a whole number from 5 to 100 in steps of 5.`);
      }
    });
  }

  function validatePlinkoSettings(p) {
    if (!isPlainObject(p)) fail("“settings.plinko” must be an object.");
    if (p.slots !== undefined) {
      if (!Array.isArray(p.slots) || p.slots.length !== PLINKO_SLOTS) {
        fail(`“settings.plinko.slots” must list exactly ${PLINKO_SLOTS} values.`);
      }
      p.slots.forEach((v, i) => {
        if (!isIntIn(v, 0, MAX_PRICE)) fail(`Plinko slot ${i + 1} must be a whole number of dollars, 0 or more.`);
      });
    }
    if (p.maxChips !== undefined && !isIntIn(p.maxChips, 1, 9)) {
      fail("“settings.plinko.maxChips” must be a whole number from 1 to 9.");
    }
  }

  function validatePricingGames(list) {
    if (!Array.isArray(list) || !list.length) fail("“settings.pricingGames” must list at least one pricing game.");
    list.forEach((k) => {
      if (GAME_KINDS.indexOf(k) < 0) {
        fail(`“${String(k).slice(0, 30)}” is not a pricing game. Use ${GAME_KINDS.join(", ")}.`);
      }
    });
  }

  /** A name/price pair used by One Bid, Cliff Hangers items and showcase prizes. */
  function validatePrize(raw, where, loPrice, hiPrice) {
    if (!isPlainObject(raw)) fail(`${where} must be an object with a name and a price.`);
    if (!cleanText(raw.name, NAME_MAX)) fail(`${where} needs a name.`);
    if (!isIntIn(raw.price, loPrice, hiPrice)) {
      fail(`${where} needs a whole-dollar price from ${loPrice} to ${hiPrice}.`);
    }
    if (raw.note !== undefined && typeof raw.note !== "string") fail(`${where}: “note” must be text.`);
  }

  function validateOneBid(list) {
    if (!Array.isArray(list) || list.length < MIN_ONE_BID) {
      fail(`“oneBid” needs at least ${MIN_ONE_BID} items — one for every Contestants' Row.`);
    }
    list.forEach((item, i) => validatePrize(item, `One Bid item ${i + 1}`, 1, MAX_PRICE));
  }

  function validateCliffhangers(list) {
    if (!Array.isArray(list) || !list.length) {
      fail("Cliff Hangers is switched on, so “cliffhangers” needs at least one set.");
    }
    list.forEach((set, i) => {
      const where = `Cliff Hangers set ${i + 1}`;
      if (!isPlainObject(set)) fail(`${where} must be an object.`);
      if (!Array.isArray(set.items) || set.items.length !== CLIFF_ITEMS) {
        fail(`${where} needs exactly ${CLIFF_ITEMS} small items.`);
      }
      set.items.forEach((item, j) => validatePrize(item, `${where}, item ${j + 1}`, 1, 99));
      validatePrize(set.prize, `${where}: the prize`, 1, MAX_PRICE);
    });
  }

  function validatePlinko(list) {
    if (!Array.isArray(list) || !list.length) {
      fail("Plinko is switched on, so “plinko” needs at least one set.");
    }
    list.forEach((set, i) => {
      const where = `Plinko set ${i + 1}`;
      if (!isPlainObject(set)) fail(`${where} must be an object.`);
      if (!Array.isArray(set.smallPrices) || set.smallPrices.length !== PLINKO_PRICES) {
        fail(`${where} needs exactly ${PLINKO_PRICES} small prices.`);
      }
      set.smallPrices.forEach((p, j) => {
        const at = `${where}, small price ${j + 1}`;
        if (!isPlainObject(p)) fail(`${at} must be an object.`);
        if (!cleanText(p.name, NAME_MAX)) fail(`${at} needs a name.`);
        if (!isIntIn(p.shown, 1, 9)) fail(`${at}: “shown” must be a whole number from 1 to 9.`);
        if (!isIntIn(p.actual, 1, 9)) fail(`${at}: “actual” must be a whole number from 1 to 9.`);
      });
    });
  }

  function validateLuckySeven(list) {
    if (!Array.isArray(list) || !list.length) {
      fail("Lucky Seven is switched on, so “luckyseven” needs at least one car.");
    }
    list.forEach((car, i) => {
      const where = `Lucky Seven car ${i + 1}`;
      if (!isPlainObject(car)) fail(`${where} must be an object.`);
      if (!cleanText(car.car, NAME_MAX)) fail(`${where} needs a name.`);
      if (!isIntIn(car.price, 10000, 99999)) fail(`${where} needs a five-digit price from 10000 to 99999.`);
      if (car.note !== undefined && typeof car.note !== "string") fail(`${where}: “note” must be text.`);
    });
  }

  function validateShowcases(list) {
    if (!Array.isArray(list) || list.length < MIN_SHOWCASES) {
      fail(`“showcases” needs at least ${MIN_SHOWCASES} showcases — one for each finalist.`);
    }
    list.forEach((sc, i) => {
      const where = `Showcase ${i + 1}`;
      if (!isPlainObject(sc)) fail(`${where} must be an object.`);
      if (!Array.isArray(sc.prizes) || sc.prizes.length < 2 || sc.prizes.length > 4) {
        fail(`${where} needs 2 to 4 prizes.`);
      }
      sc.prizes.forEach((p, j) => validatePrize(p, `${where}, prize ${j + 1}`, 1, MAX_PRICE));
    });
  }

  /* ============ Normalisation ============ */

  function cleanPrize(raw, index) {
    return {
      id: `z${index}`,
      name: cleanText(raw.name, NAME_MAX),
      price: raw.price,
      note: cleanText(raw.note, NOTE_MAX),
    };
  }

  function normalizeSettings(raw) {
    const s = isPlainObject(raw) ? raw : {};
    const plinko = isPlainObject(s.plinko) ? s.plinko : {};
    const pick = (v, d) => (v === undefined ? d : v);
    return {
      currency: cleanText(s.currency, CURRENCY_MAX) || DEFAULT_SETTINGS.currency,
      exactBidBonus: pick(s.exactBidBonus, DEFAULT_SETTINGS.exactBidBonus),
      showcaseMargin: pick(s.showcaseMargin, DEFAULT_SETTINGS.showcaseMargin),
      wheel: Array.isArray(s.wheel) && s.wheel.length === WHEEL_SLOTS ? s.wheel.slice() : DEFAULT_WHEEL.slice(),
      wheelDollarBonus: pick(s.wheelDollarBonus, DEFAULT_SETTINGS.wheelDollarBonus),
      gamesPerShowdown: pick(s.gamesPerShowdown, DEFAULT_SETTINGS.gamesPerShowdown),
      plinko: {
        slots: Array.isArray(plinko.slots) && plinko.slots.length === PLINKO_SLOTS
          ? plinko.slots.slice() : DEFAULT_PLINKO_SLOTS.slice(),
        maxChips: pick(plinko.maxChips, DEFAULT_SETTINGS.plinko.maxChips),
      },
      pricingGames: enabledGames({ settings: s }),
    };
  }

  /**
   * A deep, validated, id-stamped copy of a prize file. Never mutates `raw`.
   * Showcase totals are computed here so nothing downstream re-adds them.
   */
  function normalizeGame(raw) {
    validateGame(raw);
    const settings = normalizeSettings(raw.settings);
    const on = settings.pricingGames;
    return {
      title: cleanText(raw.title, TITLE_MAX) || "The Price Is Right",
      settings,
      oneBid: raw.oneBid.map((item, i) => Object.assign(cleanPrize(item, i), { id: `ob${i}` })),
      cliffhangers: on.indexOf("cliffhangers") >= 0 ? normalizeCliffhangers(raw.cliffhangers) : [],
      plinko: on.indexOf("plinko") >= 0 ? normalizePlinko(raw.plinko) : [],
      luckyseven: on.indexOf("luckyseven") >= 0 ? normalizeLuckySeven(raw.luckyseven) : [],
      showcases: normalizeShowcases(raw.showcases),
    };
  }

  function normalizeCliffhangers(list) {
    return list.map((set, i) => ({
      id: `ch${i}`,
      items: set.items.map((item, j) => Object.assign(cleanPrize(item, j), { id: `ch${i}i${j}` })),
      prize: Object.assign(cleanPrize(set.prize, 0), { id: `ch${i}p` }),
    }));
  }

  function normalizePlinko(list) {
    return list.map((set, i) => ({
      id: `pk${i}`,
      smallPrices: set.smallPrices.map((p, j) => ({
        id: `pk${i}s${j}`,
        name: cleanText(p.name, NAME_MAX),
        shown: p.shown,
        actual: p.actual,
      })),
    }));
  }

  function normalizeLuckySeven(list) {
    return list.map((car, i) => ({
      id: `l7${i}`,
      car: cleanText(car.car, NAME_MAX),
      price: car.price,
      note: cleanText(car.note, NOTE_MAX),
    }));
  }

  function normalizeShowcases(list) {
    return list.map((sc, i) => {
      const prizes = sc.prizes.map((p, j) => Object.assign(cleanPrize(p, j), { id: `sc${i}p${j}` }));
      return {
        id: `sc${i}`,
        prizes,
        total: prizes.reduce((sum, p) => sum + p.price, 0),
      };
    });
  }

  /* ============ Warnings (not errors) ============ */

  /**
   * Soft advice for the setup screen and the editor: a file can be perfectly
   * valid and still make for a thin episode.
   */
  function warningsFor(game) {
    const out = [];
    if (!isPlainObject(game)) return out;
    const s = normalizeSettings(game.settings);
    const wanted = s.gamesPerShowdown * 2;
    const items = Array.isArray(game.oneBid) ? game.oneBid.length : 0;
    if (items < wanted) {
      out.push(`Only ${items} One Bid items — a full episode wants ${wanted}, so the night will be shorter.`);
    }
    s.pricingGames.forEach((kind) => {
      const n = Array.isArray(game[kind]) ? game[kind].length : 0;
      if (n && n < 2) out.push(`Only one ${GAME_LABELS[kind]} set — it will be replayed if it comes up twice.`);
    });
    const showcases = Array.isArray(game.showcases) ? game.showcases.length : 0;
    if (showcases === MIN_SHOWCASES) out.push("Exactly two showcases, so both finalists always see the same pair.");
    return out;
  }

  const GAME_LABELS = Object.freeze({
    cliffhangers: "Cliff Hangers",
    plinko: "Plinko",
    luckyseven: "Lucky Seven",
  });

  /* ============ Drawing content without repeating ============ */

  /**
   * Pick the next unused entry from `list`, wrapping (and saying so) once every
   * entry has been used. Mirrors the question draw in the other games.
   * @returns {{index:number, wrapped:boolean}} index -1 when the list is empty
   */
  function drawFrom(list, used, rng) {
    if (!Array.isArray(list) || !list.length) return { index: -1, wrapped: false };
    const seen = Array.isArray(used) ? used : [];
    const fresh = [];
    for (let i = 0; i < list.length; i += 1) if (seen.indexOf(i) < 0) fresh.push(i);
    if (fresh.length) return { index: fresh[pickIndex(rng, fresh.length)], wrapped: false };
    return { index: pickIndex(rng, list.length), wrapped: true };
  }

  /* ============ Export ============ */

  return {
    // constants
    GAME_KINDS, GAME_LABELS, DEFAULT_SETTINGS, DEFAULT_WHEEL, DEFAULT_PLINKO_SLOTS,
    NAME_MAX, NOTE_MAX, TITLE_MAX, PID_MAX, PLAYER_NAME_MAX, MAX_PRICE, MAX_BID,
    WHEEL_SLOTS, PLINKO_SLOTS, CLIFF_STEPS, CLIFF_ITEMS, PLINKO_PRICES,
    L7_DIGITS, L7_START, ROW_SEATS, MAX_PLAYERS, MIN_ONE_BID, MIN_SHOWCASES,
    // helpers
    isPlainObject, isIntIn, isPosInt, cleanText, fail, pickIndex, money,
    // content
    validateGame, normalizeGame, normalizeSettings, enabledGames, warningsFor, drawFrom,
  };
});

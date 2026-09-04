/* ============================================================
   Chain Reaction — ADVERSARIAL suite, part 2: FUZZ AND SAFETY
   (A10-A16). Phone-view masking for every pid in every phase,
   validator fuzz, phone-message fuzz, deep-frozen immutability,
   undo across phase boundaries and prototype-shaped event types.
   Part 1 (cr-adversarial.test.mjs) covers the rules; the fixtures
   below are deliberately repeated so each file stands alone.

   Run with:  cd games/chain-reaction && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/cr-core.js");
const SHIPPED = require("../chains.json");

const rng0 = () => 0;
const rng9 = () => 0.999999;
const TEAMS = [{ name: "Alpha", pids: ["p1", "p2"] }, { name: "Beta", pids: ["p3"] }];
const PIDS = ["p1", "p2", "p3", "stranger", "", null, undefined, "__proto__", "constructor"];

/* ============ Fixtures ============ */

const SIX_CHAINS = [
  ["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"],
  ["FIRE", "WORKS", "SHOP", "FRONT", "DOOR", "BELL", "BOY", "BAND"],
  ["SUN", "FLOWER", "POT", "HOLE", "PUNCH", "LINE", "UP", "GRADE"],
  ["BUTTER", "FLY", "PAPER", "BACK", "PACK", "RAT", "RACE", "TRACK"],
  ["HORSE", "SHOE", "LACE", "CURTAIN", "CALL", "BACK", "FIRE", "PLACE"],
  ["MOON", "LIGHT", "HOUSE", "HOLD", "UP", "RIGHT", "HAND", "BAG"],
];
const SPEEDS = [
  ["CHAIN", "REACTION", "TIME", "OUT", "SIDE", "STEP", "FATHER", "LAND"],
  ["HIGH", "SCHOOL", "BUS", "STOP", "LIGHT", "WEIGHT", "ROOM", "MATE"],
];

function game(settings, chains) {
  return {
    title: "Adversarial",
    settings: Object.assign(
      { currency: "$", values: [100, 200], speedSeconds: 60, speedPerWord: 100, speedAllClear: 1000 },
      settings || {},
    ),
    chains: (chains || SIX_CHAINS).map((c) => c.slice()),
    speedChains: SPEEDS.map((c) => c.slice()),
  };
}

const start = (g, teams) => Core.reduce(Core.createState(g || game(), teams || TEAMS, {}), { type: "start" }, rng0, 0);

/** Reveal at `direction` until the word is the live target, then judge it. */
function play(state, direction, correct) {
  let s = Core.reduce(state, { type: "reveal", direction }, rng0, 0);
  if (s.target === null) return s;              // the reveal spelled it out — it was given
  return Core.reduce(s, { type: "judge", correct: correct !== false }, rng0, 0);
}

/** Sweep the live chain with correct answers; returns the chainDone state. */
function sweep(state) {
  let s = state;
  let guard = 0;
  while (s.phase === "chain" && guard < 500) {
    guard += 1;
    s = play(s, guard % 2 ? "top" : "bottom", true);
  }
  assert.notEqual(guard, 500, "the sweep never terminated");
  return s;
}

/** Every chain played out with clean sweeps. */
function toChainsDone(g) {
  const gg = g || game();
  let s = sweep(start(gg));
  while (Core.chainsLeft(s) > 0) s = sweep(Core.reduce(s, { type: "nextChain" }, rng0, 0));
  return s;
}

function deepFreeze(value, seen) {
  const marks = seen || new Set();
  if (!value || typeof value !== "object" || marks.has(value)) return value;
  marks.add(value);
  Object.getOwnPropertyNames(value).forEach((k) => deepFreeze(value[k], marks));
  return Object.freeze(value);
}

/* ============================================================
   A10 — phoneView never carries a hidden letter, any pid, any phase
   ============================================================ */

/** Assert no phone can see a letter the host has not revealed. */
function assertMasked(state, label) {
  PIDS.forEach((pid) => {
    const view = Core.phoneView(state, pid);
    const payload = JSON.stringify(view);
    assert.ok(payload.indexOf("\"history\"") < 0, `${label}/${pid}: history leaked`);
    assert.equal(view.game, undefined, `${label}/${pid}: the whole game object leaked`);
    assert.equal(view.chainOrder, undefined, `${label}/${pid}: the chain order leaked`);

    [state.chain, state.speed].filter(Boolean).forEach((chain) => {
      chain.words.forEach((word, i) => {
        if (chain.solved[i]) return;
        assert.ok(payload.indexOf(word) < 0, `${label}/${pid}: "${word}" leaked whole`);
        // and character by character: every unlit cell must be null in the view
        (view.column || []).forEach((row) => {
          row.cells.forEach((cell) => {
            if (!cell.lit) assert.equal(cell.ch, null, `${label}/${pid}: an unlit cell carried "${cell.ch}"`);
          });
        });
      });
    });
    if (state.sudden && state.sudden.winner === null && !state.sudden.revealed.every(Boolean)) {
      assert.ok(payload.indexOf(state.sudden.word) < 0, `${label}/${pid}: the tiebreak word leaked`);
    }
  });
}

test("A10 no phone ever holds a hidden letter, across a whole game, for every pid", () => {
  let s = start(game({ values: [100, 100] }));
  assertMasked(s, "fresh chain");
  let guard = 0;
  while (s.phase === "chain" && guard < 500) {
    guard += 1;
    s = Core.reduce(s, { type: "reveal", direction: guard % 2 ? "top" : "bottom" }, rng0, 0);
    assertMasked(s, `chain 1 reveal ${guard}`);
    if (s.target !== null) {
      s = Core.reduce(s, { type: "guess", text: "guessing", pid: "p1" }, rng0, 0);
      assertMasked(s, `chain 1 guess ${guard}`);
      s = Core.reduce(s, { type: "judge", correct: guard % 3 !== 0 }, rng0, 0);
      assertMasked(s, `chain 1 judge ${guard}`);
    }
  }
  assert.equal(s.phase, "chainDone");
  assertMasked(s, "interstitial 1");
  s = sweep(Core.reduce(s, { type: "nextChain" }, rng0, 0));
  assertMasked(s, "interstitial 2");

  if (Core.leader(s) === null) {
    s = Core.reduce(s, { type: "suddenDeath" }, rng0, 0);
    assertMasked(s, "sudden death, blank");
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
    assertMasked(s, "sudden death, one letter");
    s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);
    assertMasked(s, "sudden death, handed over");
    s = Core.reduce(s, { type: "judge", correct: true }, rng0, 0);
  }
  s = Core.reduce(s, { type: "toSpeed", team: null }, rng0, 0);
  assertMasked(s, "speed, set up");
  s = Core.reduce(s, { type: "speedStart" }, rng0, 0);
  assertMasked(s, "speed, running");
  s = Core.reduce(s, { type: "speedMark", result: "pass" }, rng0, 0);
  assertMasked(s, "speed, after a pass");
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  assertMasked(s, "speed, after a got");
  s = Core.reduce(s, { type: "speedExpired" }, rng0, 60000);
  assertMasked(s, "speed, expired");
  s = Core.reduce(s, { type: "finish" }, rng0, 0);
  assert.equal(s.phase, "result");
  assertMasked(s, "result");
});

test("A10 a phone on no team, and an unknown pid, only ever get the watcher's view", () => {
  let s = start();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  ["stranger", "", null, undefined, "__proto__", "toString"].forEach((pid) => {
    const view = Core.phoneView(s, pid);
    assert.equal(view.team, null, `pid ${JSON.stringify(pid)} was given a team`);
    assert.equal(view.mine, false);
    assert.equal(view.screen, "watch");
    assert.equal(view.canPick, undefined, "a watcher gets no direction buttons");
  });
  assert.equal(Core.phoneView(s, "p1").screen, "control");
  assert.equal(Core.phoneView(s, "p2").screen, "control", "both pids on the team in control");
  assert.equal(Core.phoneView(s, "p3").screen, "watch");
});

test("A10 phoneView is total: it answers for junk states without throwing", () => {
  [null, undefined, 0, "", false].forEach((s) => {
    assert.equal(Core.phoneView(s, "p1").screen, "wait", `state ${JSON.stringify(s)}`);
  });
  const broken = Object.assign({}, start(), { phase: "__proto__" });
  assert.equal(Core.phoneView(broken, "p1").screen, "wait", "a prototype-shaped phase falls back to wait");
  const alsoBroken = Object.assign({}, start(), { phase: "toString" });
  assert.equal(Core.phoneView(alsoBroken, "p1").screen, "wait");
});

/* ============================================================
   A11 — validator fuzz
   ============================================================ */

test("A11 a chain of 7 or 9 words is rejected with the word count in the message", () => {
  const short = game({}, [SIX_CHAINS[0].slice(0, 7)].concat(SIX_CHAINS.slice(1)));
  assert.throws(() => Core.validateGame(short), /has 7 words — every chain needs exactly 8/);
  const long = game({}, [SIX_CHAINS[0].concat(["EXTRA"])].concat(SIX_CHAINS.slice(1)));
  assert.throws(() => Core.validateGame(long), /has 9 words — every chain needs exactly 8/);
  const speedShort = game();
  speedShort.speedChains = [SPEEDS[0].slice(0, 7), SPEEDS[1]];
  assert.throws(() => Core.validateGame(speedShort), /speedChains 1 has 7 words/);
});

test("A11 digits, spaces-as-joins and edge punctuation are all caught", () => {
  const bad = [
    ["SPACE1", /letters only/],
    ["5PACE", /letters only/],
    ["-SHIP", /letters only/],
    ["SHIP-", /letters only/],
    ["'SHIP", /letters only/],
    ["SHIP'", /letters only/],
    ["SH--IP", /letters only/],
    ["SH!P", /letters only/],
    ["ÉTÉ", /letters only/],
    ["A", /2–12 letters/],
    ["ABCDEFGHIJKLM", /2–12 letters/],
    ["", /empty/],
    ["   ", /empty/],
  ];
  bad.forEach(([word, pattern]) => {
    const g = game({}, [[word].concat(SIX_CHAINS[0].slice(1))].concat(SIX_CHAINS.slice(1)));
    assert.throws(() => Core.validateGame(g), pattern, `"${word}" was accepted`);
  });
  // A word typed with a space is joined, not split, and then judged as one token.
  const joined = game({}, [["SPACE SHIP"].concat(SIX_CHAINS[0].slice(1))].concat(SIX_CHAINS.slice(1)));
  assert.equal(Core.normalizeGame(joined).chains[0][0], "SPACESHIP", "whitespace is collapsed away");
});

test("A11 adjacent duplicates and in-chain repeats are both rejected", () => {
  const adjacent = game({}, [["SPACE", "SPACE", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"]]
    .concat(SIX_CHAINS.slice(1)));
  assert.throws(() => Core.validateGame(adjacent), /repeats "SPACE" twice in a row/);
  const lower = game({}, [["SPACE", "space", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"]]
    .concat(SIX_CHAINS.slice(1)));
  assert.throws(() => Core.validateGame(lower), /twice in a row/, "case does not hide a duplicate");
  const apart = game({}, [["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "SPACE"]]
    .concat(SIX_CHAINS.slice(1)));
  assert.throws(() => Core.validateGame(apart), /uses "SPACE" more than once/);
});

test("A11 too few chains or speed chains is rejected with the count", () => {
  assert.throws(() => Core.validateGame(game({}, SIX_CHAINS.slice(0, 5))),
    /"chains" needs at least 6 chains — this file has 5/);
  const oneSpeed = game();
  oneSpeed.speedChains = [SPEEDS[0]];
  assert.throws(() => Core.validateGame(oneSpeed), /"speedChains" needs at least 2 chains/);
  const noSpeed = game();
  delete noSpeed.speedChains;
  assert.throws(() => Core.validateGame(noSpeed), /"speedChains" is missing/);
});

test("A11 junk types anywhere throw a plain-English Error, never a TypeError", () => {
  const junk = [
    undefined, null, 0, 1, "", "chains", true, [], [[]], () => {}, new Date(), Symbol,
    { chains: null }, { chains: "nope" }, { chains: {} },
    { chains: SIX_CHAINS, speedChains: "nope" },
    { chains: [null, null, null, null, null, null], speedChains: SPEEDS },
    { chains: [[1, 2, 3, 4, 5, 6, 7, 8]].concat(SIX_CHAINS.slice(1)), speedChains: SPEEDS },
    { chains: SIX_CHAINS, speedChains: SPEEDS, title: 5 },
    { chains: SIX_CHAINS, speedChains: SPEEDS, settings: [] },
    { chains: SIX_CHAINS, speedChains: SPEEDS, settings: { values: "100" } },
    { chains: SIX_CHAINS, speedChains: SPEEDS, settings: { values: [1.5] } },
    { chains: SIX_CHAINS, speedChains: SPEEDS, settings: { values: [-1] } },
    { chains: SIX_CHAINS, speedChains: SPEEDS, settings: { speedSeconds: 301 } },
    { chains: SIX_CHAINS, speedChains: SPEEDS, settings: { speedSeconds: "abc" } },
    { chains: SIX_CHAINS, speedChains: SPEEDS, settings: { speedAllClear: -5 } },
  ];
  junk.forEach((g) => {
    let err = null;
    try { Core.validateGame(g); } catch (e) { err = e; }
    assert.ok(err, `${JSON.stringify(g)} was accepted`);
    assert.equal(err.constructor, Error, `${String(err)} is not a plain Error`);
    assert.ok(err.message.length > 8 && /[a-z]/.test(err.message), `unhelpful message: ${err.message}`);
  });
});

test("A11 a settings object shaped like a prototype does not pollute Object.prototype", () => {
  const g = JSON.parse(JSON.stringify({
    title: "x", chains: SIX_CHAINS, speedChains: SPEEDS,
    settings: { currency: "$", values: [100] },
  }));
  const polluted = JSON.parse('{"__proto__":{"crPwned":true}}');
  g.settings.extra = polluted;
  Core.normalizeGame(g);
  assert.equal({}.crPwned, undefined, "Object.prototype was polluted");
  const normalized = Core.normalizeGame(g);
  assert.equal(normalized.settings.extra, undefined, "unknown settings keys are dropped, not copied");
});

test("A11 normalizeGame is a deep copy: editing the result never touches the file", () => {
  const raw = game();
  const before = JSON.stringify(raw);
  const g = Core.normalizeGame(raw);
  g.chains[0][0] = "MUTATED";
  g.settings.values.push(999);
  assert.equal(JSON.stringify(raw), before, "the caller's object changed");
  assert.equal(Core.normalizeGame(raw).chains[0][0], "SPACE");
});

test("A11 the shipped file survives a re-normalise unchanged (idempotent)", () => {
  const once = Core.normalizeGame(SHIPPED);
  const twice = Core.normalizeGame(once);
  assert.deepEqual(twice, once);
  assert.equal(once.chains.length, 18);
  assert.equal(once.speedChains.length, 4);
});

/* ============================================================
   A12 — phone message fuzz
   ============================================================ */

test("A12 a 25-character guess is cut to 24 and control characters are stripped", () => {
  const long = Core.validatePhoneMsg({ t: "guess", text: "abcdefghijklmnopqrstuvwxy" });
  assert.equal("abcdefghijklmnopqrstuvwxy".length, 25);
  assert.equal(long.text.length, 24);
  assert.equal(long.text, "abcdefghijklmnopqrstuvwx");
  const dirty = Core.validatePhoneMsg({ t: "guess", text: "sh ip" });
  assert.equal(dirty.text, "ship", "every control character is gone");
  const wrapped = Core.validatePhoneMsg({ t: "guess", text: "\n\t  space ship \r\n" });
  assert.equal(wrapped.text, "space ship", "trimmed, but the inner space is the host's to read");
  assert.equal(Core.validatePhoneMsg({ t: "guess", text: " " }), null,
    "a guess of nothing but control characters is dropped");
  const capThenTrim = Core.validatePhoneMsg({ t: "guess", text: `${"a".repeat(23)}   tail` });
  assert.equal(capThenTrim.text.length <= 24, true);
  assert.equal(capThenTrim.text.endsWith(" "), false, "no trailing space survives the cap");
});

test("A12 only the three documented shapes are accepted, with no extra fields carried", () => {
  const dir = Core.validatePhoneMsg({ t: "direction", dir: "top", pid: "p9", score: 999 });
  assert.deepEqual(dir, { t: "direction", dir: "top" }, "extra fields are not forwarded");
  const guess = Core.validatePhoneMsg({ t: "guess", text: "ship", correct: true, pid: "p9" });
  assert.deepEqual(guess, { t: "guess", text: "ship" }, "a phone cannot smuggle a verdict");
  const speed = Core.validatePhoneMsg({ t: "speed", result: "pass", team: 0 });
  assert.deepEqual(speed, { t: "speed", result: "pass" });
  [
    { t: "judge", correct: true }, { t: "start" }, { t: "finish" }, { t: "toSpeed", team: 0 },
    { t: "reveal", direction: "top" }, { t: "undo" }, { t: "view" },
    { t: "DIRECTION", dir: "top" }, { t: "direction", dir: "TOP" },
    { t: "speed", result: "GOT" }, { t: "__proto__" }, { t: "toString" }, { t: "constructor" },
    { t: 1 }, { t: null }, { }, [], "guess", 42, null, undefined,
    JSON.parse('{"__proto__":{"t":"guess","text":"pwned"}}'),
  ].forEach((raw) => assert.equal(Core.validatePhoneMsg(raw), null, `${JSON.stringify(raw)} was accepted`));
  assert.equal({}.t, undefined, "Object.prototype survived the fuzz");
});

test("A12 a `got` from a phone is a shape the host must reject by hand", () => {
  // The wire format allows "got" (spec 14 §5 lets a phone send `pass`); the rule
  // that only the host banks a word lives in cr-room.js, which the loopback
  // harness covers. Here we pin the wire contract itself.
  assert.deepEqual(Core.validatePhoneMsg({ t: "speed", result: "got" }), { t: "speed", result: "got" });
});

test("A12 a guess from a phone is recorded, never judged, whoever sent it", () => {
  let s = start();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  const before = JSON.stringify({ scores: s.scores, solved: s.chain.solved, phase: s.phase });
  // p3 is on the OTHER team; the reducer records the text but still judges nothing.
  s = Core.reduce(s, { type: "guess", text: "SHIP", pid: "p3" }, rng0, 0);
  assert.equal(s.guessText, "SHIP");
  assert.equal(s.guessBy, "p3");
  assert.equal(JSON.stringify({ scores: s.scores, solved: s.chain.solved, phase: s.phase }), before,
    "recording a guess changed the game");
  assert.equal(Core.teamOf(s, "p3"), 1, "and the host glue can see it came from the other team");
  assert.equal(Core.teamOf(s, "p1"), 0);
  assert.notEqual(Core.teamOf(s, "p3"), s.control, "so cr-room.js has what it needs to drop it");
});

test("A12 a guess outside a guessing phase is ignored", () => {
  const done = toChainsDone();
  assert.equal(Core.reduce(done, { type: "guess", text: "anything" }, rng0, 0), done, "interstitial");
  const speed = Core.reduce(done, { type: "toSpeed", team: 0 }, rng0, 0);
  assert.equal(Core.reduce(speed, { type: "guess", text: "anything" }, rng0, 0), speed, "speed chain");
  const result = Core.reduce(done, { type: "finish" }, rng0, 0);
  assert.equal(Core.reduce(result, { type: "guess", text: "anything" }, rng0, 0), result, "result");
});

test("A12 a direction sent outside the chain phase never moves the board", () => {
  const done = toChainsDone();
  assert.equal(Core.reduce(done, { type: "reveal", direction: "top" }, rng0, 0), done);
  const speed = Core.reduce(Core.reduce(done, { type: "toSpeed", team: 0 }, rng0, 0),
    { type: "speedStart" }, rng0, 0);
  assert.equal(Core.reduce(speed, { type: "reveal", direction: "top" }, rng0, 0), speed);
  const result = Core.reduce(done, { type: "finish" }, rng0, 0);
  assert.equal(Core.reduce(result, { type: "reveal", direction: "bottom" }, rng0, 0), result);
});

/* ============================================================
   A13 — immutability under a deep freeze
   ============================================================ */

const EVERY_EVENT = [
  { type: "start" }, { type: "reveal", direction: "top" }, { type: "reveal", direction: "bottom" },
  { type: "guess", text: "probe", pid: "p1" }, { type: "judge", correct: true },
  { type: "judge", correct: false }, { type: "passControl" }, { type: "nextChain" },
  { type: "suddenDeath" }, { type: "toSpeed", team: 0 }, { type: "toSpeed", team: null },
  { type: "speedStart" }, { type: "speedMark", result: "got" }, { type: "speedMark", result: "pass" },
  { type: "speedExpired" }, { type: "notice", text: "hello" }, { type: "finish" }, { type: "undo" },
];

test("A13 every event on a DEEP-FROZEN state of every phase: no mutation, ever", () => {
  const g = game({ values: [100, 100] });
  const chainDone = toChainsDone(g);
  const sudden = Core.reduce(chainDone, { type: "suddenDeath" }, rng0, 0);
  const speed = Core.reduce(Core.reduce(chainDone, { type: "judge", correct: true }, rng0, 0),
    { type: "toSpeed", team: 0 }, rng0, 0);
  const running = Core.reduce(speed, { type: "speedStart" }, rng0, 0);
  const states = {
    setup: Core.createState(g, TEAMS, {}),
    chain: start(g),
    midTurn: Core.reduce(start(g), { type: "reveal", direction: "top" }, rng0, 0),
    chainDone,
    sudden,
    speed,
    running,
    result: Core.reduce(chainDone, { type: "finish" }, rng0, 0),
  };
  Object.keys(states).forEach((name) => {
    const frozen = deepFreeze(states[name]);
    const before = JSON.stringify(frozen);
    EVERY_EVENT.forEach((event) => {
      // A frozen state is strict-mode read-only: any in-place write throws here.
      const next = Core.reduce(frozen, event, rng0, 1000);
      assert.ok(next && typeof next === "object", `${name}/${event.type} returned junk`);
      assert.equal(JSON.stringify(frozen), before, `${name}/${event.type} mutated its input`);
      // `guess`, `notice`, `speedStart` and `undo` deliberately take no undo
      // slot (they may keep the same array); everything else must copy it.
      const noSlot = new Set(["guess", "notice", "speedStart", "undo"]);
      if (next !== frozen && !noSlot.has(event.type)) {
        assert.notEqual(next.history, frozen.history, `${name}/${event.type} reused the history array`);
      }
    });
  });
});

test("A13 the arrays inside a returned state are never the caller's arrays", () => {
  const s = start();
  const next = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  assert.notEqual(next.chain, s.chain);
  assert.notEqual(next.chain.revealed, s.chain.revealed);
  assert.notEqual(next.chain.revealed[1], s.chain.revealed[1]);
  assert.equal(s.chain.revealed[1].some(Boolean), false, "the original mask is untouched");
  const judged = Core.reduce(next, { type: "judge", correct: true }, rng0, 0);
  assert.notEqual(judged.scores, next.scores);
  assert.deepEqual(next.scores, [0, 0]);
});

test("A13 the shipped game object is never written to by a whole play-through", () => {
  const snapshot = JSON.stringify(SHIPPED);
  let s = Core.reduce(Core.createState(SHIPPED, TEAMS, {}), { type: "start" }, rng0, 0);
  s = sweep(s);
  s = sweep(Core.reduce(s, { type: "nextChain" }, rng0, 0));
  s = sweep(Core.reduce(s, { type: "nextChain" }, rng0, 0));
  if (Core.leader(s) === null) s = Core.reduce(Core.reduce(s, { type: "suddenDeath" }, rng0, 0),
    { type: "judge", correct: true }, rng0, 0);
  s = Core.reduce(s, { type: "toSpeed", team: null }, rng0, 0);
  s = Core.reduce(s, { type: "speedStart" }, rng0, 0);
  for (let i = 0; i < 6; i += 1) s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  s = Core.reduce(s, { type: "finish" }, rng0, 0);
  assert.equal(s.phase, "result");
  assert.equal(JSON.stringify(SHIPPED), snapshot, "chains.json was mutated in place");
});

/* ============================================================
   A14 — undo across phase boundaries
   ============================================================ */

test("A14 undo walks back across every phase boundary it crossed", () => {
  const g = game({ values: [100, 100] });
  let s = sweep(start(g));
  assert.equal(s.phase, "chainDone");
  s = Core.reduce(s, { type: "nextChain" }, rng0, 0);
  assert.equal(s.phase, "chain");
  s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.phase, "chainDone", "undo goes back over nextChain");
  assert.equal(s.chainIndex, 0);

  s = sweep(Core.reduce(s, { type: "nextChain" }, rng0, 0));
  assert.equal(Core.chainsLeft(s), 0);
  s = Core.reduce(s, { type: "suddenDeath" }, rng0, 0);
  assert.equal(s.phase, "sudden");
  s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.phase, "chainDone", "undo goes back over suddenDeath");
  assert.equal(s.sudden, null);

  s = Core.reduce(s, { type: "suddenDeath" }, rng0, 0);
  s = Core.reduce(s, { type: "judge", correct: true }, rng0, 0);
  const won = s.scores.slice();
  s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.sudden.winner, null, "undo takes the tiebreak back");
  assert.notDeepEqual(s.scores, won);
  assert.equal(Core.leader(s), null, "and the scores are level again");
});

test("A14 undo unwinds the Speed Chain, including the award", () => {
  let s = Core.reduce(toChainsDone(game({ values: [100, 200] })), { type: "toSpeed", team: null }, rng0, 0);
  const team = s.speed.team;
  const banked = s.scores[team];
  s = Core.reduce(s, { type: "speedStart" }, rng0, 0);
  for (let i = 0; i < 6; i += 1) s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  assert.equal(s.scores[team], banked + 1000);
  s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.speed.over, false, "the round is live again");
  assert.equal(s.scores[team], banked, "the bonus is taken back");
  assert.equal(Core.speedCurrent(s), 6, "the last word is back in the queue");
  // Undo all the way out of the Speed Chain.
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.phase, "speed");
  s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.phase, "chainDone", "undo leaves the Speed Chain entirely");
  assert.equal(s.speed, null);
});

test("A14 undo after finish reopens the game exactly where it was", () => {
  let s = start();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  s = Core.reduce(s, { type: "judge", correct: true }, rng0, 0);
  const live = JSON.stringify({ phase: s.phase, scores: s.scores, chain: s.chain, control: s.control });
  s = Core.reduce(s, { type: "finish" }, rng0, 0);
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.winner, 0);
  s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(JSON.stringify({ phase: s.phase, scores: s.scores, chain: s.chain, control: s.control }), live);
  assert.equal(s.outcome, null, "the result is forgotten too");
});

test("A14 undo never runs off the end, and the stack is bounded", () => {
  let s = Core.createState(game(), TEAMS, {});
  for (let i = 0; i < 5; i += 1) {
    const same = Core.reduce(s, { type: "undo" }, rng0, 0);
    assert.equal(same, s, "undo on an empty history must be a no-op");
  }
  s = start();
  for (let i = 0; i < Core.MAX_HISTORY + 40; i += 1) s = Core.reduce(s, { type: "passControl" }, rng0, 0);
  assert.equal(s.history.length, Core.MAX_HISTORY);
  for (let i = 0; i < Core.MAX_HISTORY; i += 1) s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.history.length, 0);
  assert.equal(Core.reduce(s, { type: "undo" }, rng0, 0), s);
  assert.equal(s.phase, "chain", "the game is still playable after unwinding the whole stack");
  assert.ok(s.game && s.game.chains.length >= 6, "undo kept the game content");
});

test("A14 typing and clock bookkeeping never take an undo slot", () => {
  let s = start();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  const depth = s.history.length;
  for (let i = 0; i < 30; i += 1) s = Core.reduce(s, { type: "guess", text: `try ${i}` }, rng0, 0);
  s = Core.reduce(s, { type: "notice", text: "a note" }, rng0, 0);
  assert.equal(s.history.length, depth, "typing filled the undo stack");
  s = Core.reduce(s, { type: "undo" }, rng0, 0);
  assert.equal(s.target, null, "one undo still lands before the reveal");
});

/* ============================================================
   A15 — prototype-shaped event types
   ============================================================ */

test("A15 prototype-shaped event types reach no handler and corrupt nothing", () => {
  const types = [
    "__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty",
    "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__",
    "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
  ];
  const g = game({ values: [100, 100] });
  const chainDone = toChainsDone(g);
  const states = [
    Core.createState(g, TEAMS, {}), start(g), chainDone,
    Core.reduce(chainDone, { type: "suddenDeath" }, rng0, 0),
    Core.reduce(Core.reduce(chainDone, { type: "judge", correct: true }, rng0, 0),
      { type: "toSpeed", team: null }, rng0, 0),
  ];
  states.forEach((s, i) => {
    types.forEach((type) => {
      assert.equal(Core.reduce(s, { type }, rng0, 0), s, `state ${i}: "${type}" changed the game`);
      assert.equal(Core.reduce(s, { type, correct: true, direction: "top", result: "got" }, rng0, 0), s,
        `state ${i}: "${type}" with a payload changed the game`);
    });
  });
  assert.equal({}.phase, undefined, "Object.prototype was polluted by the probe");
  assert.equal(typeof {}.toString, "function", "Object.prototype.toString was clobbered");
});

test("A15 legalActions never names a prototype key and never lies", () => {
  const g = game({ values: [100, 100] });
  const chainDone = toChainsDone(g);
  const states = [
    Core.createState(g, TEAMS, {}), start(g),
    Core.reduce(start(g), { type: "reveal", direction: "top" }, rng0, 0),
    chainDone,
    Core.reduce(chainDone, { type: "suddenDeath" }, rng0, 0),
    Core.reduce(Core.reduce(chainDone, { type: "judge", correct: true }, rng0, 0),
      { type: "toSpeed", team: null }, rng0, 0),
    Core.reduce(chainDone, { type: "finish" }, rng0, 0),
  ];
  const banned = new Set(["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]);
  const sample = {
    reveal: { direction: "top" }, judge: { correct: true }, guess: { text: "probe" },
    toSpeed: { team: null }, speedMark: { result: "pass" },
  };
  states.forEach((s, i) => {
    const legal = Core.legalActions(s);
    legal.forEach((type) => {
      assert.ok(!banned.has(type), `state ${i} offered "${type}"`);
      const next = Core.reduce(s, Object.assign({ type }, sample[type] || {}), () => 0, 0);
      assert.notEqual(next, s, `state ${i}: legalActions promised "${type}" would do something`);
    });
  });
});

/* ============================================================
   A16 — things the tester expected to be true and checked
   ============================================================ */

test("A16 the shipped file's every adjacent pair is two distinct words, and no chain repeats", () => {
  const g = Core.normalizeGame(SHIPPED);
  const seen = new Set();
  g.chains.concat(g.speedChains).forEach((chain, i) => {
    const key = chain.join(" ");
    assert.ok(!seen.has(key), `chain ${i} is a duplicate of an earlier one`);
    seen.add(key);
    chain.forEach((word, w) => {
      if (w > 0) assert.notEqual(word, chain[w - 1], `chain ${i} repeats ${word}`);
    });
  });
  assert.equal(Core.warningsFor(SHIPPED).length, 0, Core.warningsFor(SHIPPED).join(" "));
});

test("A16 formatMoney honours the file's currency and groups thousands", () => {
  const g = game({ currency: "£", values: [1000] });
  const s = start(g);
  assert.equal(Core.formatMoney(s, 1000), "£1,000");
  assert.equal(Core.formatMoney(s, 0), "£0");
  assert.equal(Core.formatMoney(s, undefined), "£0");
  assert.equal(Core.formatMoney(null, 5), "$5", "a missing state still formats");
});

test("A16 standings and leader agree with the scores at every stage", () => {
  let s = start(game({ values: [100, 200] }));
  assert.equal(Core.leader(s), null);
  assert.deepEqual(Core.standings(s).map((r) => r.winner), [false, false]);
  s = Core.reduce(Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0),
    { type: "judge", correct: true }, rng0, 0);
  assert.equal(Core.leader(s), 0);
  assert.deepEqual(Core.standings(s).map((r) => r.winner), [true, false]);
  assert.deepEqual(Core.standings(s).map((r) => r.score), [100, 0]);
  const ended = Core.reduce(s, { type: "finish" }, rng0, 0);
  assert.deepEqual(ended.outcome.scores, [100, 0]);
  assert.deepEqual(Core.standings(ended).map((r) => r.winner), [true, false]);
});

test("A16 a team name is cleaned, capped and must be unique; pids cannot be shared", () => {
  const g = game();
  assert.throws(() => Core.createState(g, [{ name: "A" }, { name: "A" }], {}), /different names/);
  assert.throws(() => Core.createState(g, [{ name: "A" }, { name: "  a  " }], {}), /different names/);
  assert.throws(() => Core.createState(g, [{ name: " " }, { name: "B" }], {}), /Team 1 needs a name/);
  assert.throws(() => Core.createState(g, [{ name: "A", pids: ["p1"] }, { name: "B", pids: ["p1"] }], {}),
    /cannot play for both teams/);
  assert.throws(() => Core.createState(g, [{ name: "A" }], {}), /exactly two teams/);
  assert.throws(() => Core.createState(g, "AB", {}), /exactly two teams/);
  const long = Core.createState(g, [{ name: "x".repeat(60) }, { name: "B" }], {});
  assert.equal(long.teams[0].name.length, Core.NAME_MAX);
  const duped = Core.createState(g, [{ name: "A", pids: ["p1", "p1", "p1"] }, { name: "B" }], {});
  assert.deepEqual(duped.teams[0].pids, ["p1"], "a pid listed twice is only seated once");
});

test("A16 (was KNOWN GAP, fixed CR-6) with no spare chain the tiebreak still lands on a real word", () => {
  // Six chains, six rounds: there is nothing unplayed left to draw from and
  // every word in the file has been on the board. pickSudden() must still hand
  // back a playable tiebreak rather than nothing - it falls back to the first
  // word it drew, and the round is playable exactly as normal.
  const g = game({ values: [100, 100, 100, 100, 100, 100] });
  const tied = toChainsDone(g);
  assert.equal(Core.leader(tied), null, "six chains, alternating openers, ties");
  assert.equal(tied.chainOrder.length, 6);
  [rng0, () => 0.5, () => 0.999999].forEach((rng) => {
    const s = Core.reduce(tied, { type: "suddenDeath" }, rng, 0);
    assert.equal(s.phase, "sudden");
    const from = g.chains.findIndex((c) => {
      const at = c.indexOf(s.sudden.word);
      return at >= 1 && at <= 6 && c[at - 1] === s.sudden.before && c[at + 1] === s.sudden.after;
    });
    assert.ok(from >= 0, `${s.sudden.word} is not a hidden word of any chain in the file`);
    assert.equal(s.sudden.revealed.length, s.sudden.word.length);
    assert.equal(s.sudden.revealed.some(Boolean), false, "it starts blank");
    assert.equal(s.sudden.winner, null);
    // And it is still a playable round: a letter, then the first correct call.
    const lit = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
    assert.equal(lit.sudden.revealed.filter(Boolean).length, 1);
    const won = Core.reduce(lit, { type: "judge", correct: true }, rng, 0);
    assert.equal(won.phase, "chainDone");
    assert.notEqual(Core.leader(won), null, "the tie is broken");
  });
});

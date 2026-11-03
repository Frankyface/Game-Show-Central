/* ============================================================
   Match Game — independent tester suite (T1)
   Written by the verification agent, not the implementer. Every
   test tries to break a rule from docs/18-match-game-spec.md or a
   cross-cutting rule from docs/reports/00-orchestrator-triage.md.
   Zero deps; node:test only.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { Core, makeGame, CONTESTANTS, panelOf, started, run } from "./mg-fixtures.mjs";

/* ============ helpers ============ */

const R = (s, e) => Core.reduce(s, e);

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    Object.values(obj).forEach(deepFreeze);
  }
  return obj;
}

/** Reduce with every input deep-frozen: any in-place write throws in strict mode. */
function frozenRun(state, events) {
  return events.reduce((s, e) => Core.reduce(deepFreeze(s), deepFreeze(e)), state);
}

/** Panel answers that are unique, so a substring search is a real leak test. */
const secret = (round, seat, slot) => `zq${round}s${seat}k${slot}secret`;

function turn(s, judgements) {
  const cur = s.current;
  let out = s;
  s.panel.forEach((p) => {
    out = R(out, { type: "panelAnswer", pid: p.pid, text: secret(s.round, cur.seat, p.slot) });
  });
  out = R(out, { type: "contestantAnswer", text: `guess${s.round}${cur.seat}` });
  for (let i = 0; i < out.current.order.length; i += 1) {
    out = R(out, { type: "revealNext" });
    out = R(out, { type: "judge", match: !!judgements[i] });
  }
  return out;
}

const AUD_PIDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const allPids = (s) => s.panel.map((p) => p.pid).concat(s.contestants.map((c) => c.pid), AUD_PIDS);

/** Ada wins 2–0 after two rounds with a 3-seat panel; state is at superChoice. */
function toSuperChoice(gameOverrides) {
  let s = started(3, gameOverrides);
  s = turn(s, [true, true]);            // r1 Ada 2
  s = R(s, { type: "nextContestant" });
  s = turn(s, [false, false, false]);   // r1 Ben 0
  s = R(s, { type: "nextContestant" }); // roundScores
  s = R(s, { type: "nextContestant" }); // round 2, Ben opens
  s = turn(s, [false, false, false]);
  s = R(s, { type: "nextContestant" });
  s = turn(s, [false, false, false]);
  s = R(s, { type: "nextContestant" }); // roundScores
  s = R(s, { type: "nextContestant" }); // superChoice
  return s;
}

function toBoard(answers) {
  let s = R(toSuperChoice(), { type: "audienceOpen" });
  answers.forEach(([pid, text]) => { s = R(s, { type: "audienceAnswer", pid, text }); });
  return R(s, { type: "audienceClose" });
}

/* ============ masking / leak ============ */

test("T-leak every phone view hides every unrevealed panel answer, across a whole game", () => {
  let s = started(3);
  const checkAll = (state) => {
    const cards = Core.hostCards(state);
    const cur = state.current;
    allPids(state).forEach((pid) => {
      const view = JSON.stringify(Core.phoneView(state, pid));
      if (!cur) return;
      Object.keys(cur.answers).forEach((slot) => {
        const owner = state.panel[Number(slot)].pid;
        const text = cur.answers[slot];
        if (pid === owner && state.phase === "prompt") return;      // own answer echoed back is fine
        assert.ok(!view.includes(text), `${pid} saw ${text} in phase ${state.phase}`);
      });
      if (state.contestants.some((c) => c.pid === pid)) {
        assert.ok(!view.includes("secret"), `contestant ${pid} saw a panel answer`);
      }
    });
    cards.forEach((c) => { if (!c.revealed) assert.equal(c.text, null); });
  };
  // step through one full turn checking after every single event
  const cur = s.current;
  s.panel.forEach((p) => {
    s = R(s, { type: "panelAnswer", pid: p.pid, text: secret(1, cur.seat, p.slot) });
    checkAll(s);
  });
  s = R(s, { type: "contestantAnswer", text: "guess" });
  checkAll(s);
  for (let i = 0; i < 3; i += 1) {
    s = R(s, { type: "revealNext" }); checkAll(s);
    // once card i is up, the host may see it; cards after it still null
    const cards = Core.hostCards(s);
    assert.equal(cards.filter((c) => c.text !== null).length, i + 1);
    s = R(s, { type: "judge", match: i === 0 }); checkAll(s);
  }
});

test("T-leak a contestant's phone never carries a panel answer, even after the reveal", () => {
  let s = toSuperChoice();
  // re-check a few phases that keep `current` around
  ["c1", "c2"].forEach((pid) => {
    assert.ok(!JSON.stringify(Core.phoneView(s, pid)).includes("secret"));
  });
  s = R(s, { type: "toHeadToHead" });
  s = R(s, { type: "pickPanelist", slot: 0 });
  s = R(s, { type: "hthAnswer", text: "zqhthpanel" });
  s = R(s, { type: "hthAnswer", text: "zqhthcontestant", who: "contestant" });
  allPids(s).forEach((pid) => {
    const view = JSON.stringify(Core.phoneView(s, pid));
    if (pid !== "p1") assert.ok(!view.includes("zqhthpanel"), `${pid} saw the hth panel card`);
    assert.ok(!view.includes("zqhthcontestant"), `${pid} saw the contestant's hth card`);
    assert.ok(!view.includes("secret"), `${pid} saw a main-game answer`);
  });
  assert.equal(Core.phoneView(s, "p1").screen, "hth");
  assert.equal(Core.phoneView(s, "p2").screen, "wait");
});

test("T-leak an audience phone never sees another audience answer", () => {
  let s = R(toSuperChoice(), { type: "audienceOpen" });
  s = R(s, { type: "audienceAnswer", pid: "a1", text: "zqaudone" });
  s = R(s, { type: "audienceAnswer", pid: "a2", text: "zqaudtwo" });
  assert.ok(JSON.stringify(Core.phoneView(s, "a1")).includes("zqaudone"));
  assert.ok(!JSON.stringify(Core.phoneView(s, "a1")).includes("zqaudtwo"));
  assert.ok(!JSON.stringify(Core.phoneView(s, "a2")).includes("zqaudone"));
  // the panel and contestants are not on the audience screen
  ["p1", "p2", "p3", "c1", "c2"].forEach((pid) => assert.equal(Core.phoneView(s, pid).screen, "wait"));
});

/* ============ points and alternation ============ */

test("T-points alternation: r1 Ada,Ben · r2 Ben,Ada · tiebreak r3 Ada; points add per match", () => {
  let s = started(3, { settings: { pointsPerMatch: 2 } });
  const seats = [];
  seats.push(s.current.seat); s = turn(s, [true, false, true]); s = R(s, { type: "nextContestant" });
  seats.push(s.current.seat); s = turn(s, [true, true, false]); s = R(s, { type: "nextContestant" });
  assert.equal(s.phase, "roundScores");
  assert.deepEqual(s.contestants.map((c) => c.points), [4, 4]);
  s = R(s, { type: "nextContestant" });
  seats.push(s.current.seat); s = turn(s, [false, false, false]); s = R(s, { type: "nextContestant" });
  seats.push(s.current.seat); s = turn(s, [false, false, false]); s = R(s, { type: "nextContestant" });
  assert.deepEqual(seats, [0, 1, 1, 0]);
  assert.equal(s.phase, "roundScores");
  assert.equal(R(s, { type: "nextContestant" }), s, "a tie cannot move on to the Super Match");
  s = R(s, { type: "tiebreak" });
  assert.equal(s.current.seat, 0);
  assert.equal(s.tiebreak, 1);
});

/* ============ round-two rule ============ */

test("T-rule2 on: round 2 only offers the slots this contestant has not matched; off: all slots", () => {
  for (const rule of [true, false]) {
    let s = started(3, { settings: { secondRoundRule: rule, rounds: 3 } });
    s = turn(s, [true, false, false]);         // Ada matches slot order[0]
    const adaMatched = s.matched[0].slice();
    s = R(s, { type: "nextContestant" });
    s = turn(s, [false, true, false]);         // Ben matches order[1]
    const benMatched = s.matched[1].slice();
    s = R(s, { type: "nextContestant" });
    s = R(s, { type: "nextContestant" });      // round 2: Ben opens
    assert.equal(s.current.seat, 1);
    if (rule) {
      assert.deepEqual(s.current.locked, benMatched);
      assert.ok(benMatched.every((slot) => s.current.order.indexOf(slot) < 0));
      // a locked slot cannot be answered or scored
      const before = s;
      s = R(s, { type: "panelAnswer", slot: benMatched[0], text: "x" });
      assert.equal(s, before);
      // the locked panelist's phone is told to sit out
      assert.equal(Core.phoneView(s, s.panel[benMatched[0]].pid).screen, "wait");
    } else {
      assert.deepEqual(s.current.locked, []);
      assert.equal(s.current.order.length, 3);
    }
    s = turn(s, [true, true]);
    s = R(s, { type: "nextContestant" });
    if (rule) assert.deepEqual(s.current.locked, adaMatched);
    s = turn(s, [true, true, true].slice(0, s.current.order.length));
    s = R(s, { type: "nextContestant" });      // round scores
    s = R(s, { type: "nextContestant" });      // round 3
    if (rule) {
      // round 3 is cumulative: Ada opens round 3 and is locked out of everything she matched
      assert.deepEqual([...s.current.locked].sort(), [...new Set(s.matched[s.current.seat])].sort());
    }
  }
});

/* ============ tiebreak ============ */

test("T-tiebreak repeats while level, and the leader after a tiebreak plays the Super Match", () => {
  let s = started(2, { settings: { rounds: 1 } });
  s = turn(s, [false, false]); s = R(s, { type: "nextContestant" });
  s = turn(s, [false, false]); s = R(s, { type: "nextContestant" });
  assert.equal(s.phase, "roundScores");
  s = R(s, { type: "tiebreak" });
  s = turn(s, [true, false]); s = R(s, { type: "nextContestant" });
  s = turn(s, [true, false]); s = R(s, { type: "nextContestant" });
  assert.equal(s.phase, "roundScores");
  assert.equal(R(s, { type: "nextContestant" }), s);
  s = R(s, { type: "tiebreak" });
  assert.equal(s.tiebreak, 2);
  s = turn(s, [false, false]); s = R(s, { type: "nextContestant" });
  s = turn(s, [true, false]); s = R(s, { type: "nextContestant" });
  assert.equal(R(s, { type: "tiebreak" }), s, "no tiebreak when not level");
  s = R(s, { type: "nextContestant" });
  assert.equal(s.phase, "superChoice");
  assert.equal(s.winner, s.current.seat);
});

/* ============ top three ============ */

test("T-top3 normalisation folds case, spaces and end punctuation; articles are left to the merge buttons", () => {
  const s = toBoard([
    ["a1", "  Ice   Scraper "], ["a2", "ice scraper"], ["a3", "ICE SCRAPER!"],
    ["a4", "map"], ["a5", "a map"], ["a6", "the map"], ["a7", "napkins"],
  ]);
  const rows = Core.groupedAnswers(s);
  assert.equal(rows[0].key, "ice scraper");
  assert.equal(rows[0].count, 3);
  // Documented behaviour: "a map" / "the map" are NOT folded automatically (spec says trim,
  // case-fold, collapse spaces). The host can fold them with merges:
  assert.ok(rows.some((r) => r.key === "a map"));
  let m = R(s, { type: "mergeAnswers", from: "a map", into: "map" });
  m = R(m, { type: "mergeAnswers", from: "the map", into: "map" });
  const top = Core.topThree(m);
  // 3 v 3: a tie on count keeps the first-said answer on top
  assert.deepEqual(top.map((r) => [r.key, r.count, r.value]),
    [["ice scraper", 3, 500], ["map", 3, 250], ["napkins", 1, 100]]);
});

test("T-top3 row-into-row merge re-ranks; off-board pair merges climb onto the board", () => {
  let s = toBoard([
    ["a1", "gloves"], ["a2", "gloves"], ["a3", "gloves"],
    ["a4", "maps"], ["a5", "maps"],
    ["a6", "map"], ["a7", "torch"], ["a8", "flashlight"],
  ]);
  assert.deepEqual(Core.topThree(s).map((r) => r.key), ["gloves", "maps", "map"]);
  s = R(s, { type: "mergeAnswers", from: "map", into: "maps" });      // board row 3 into row 2
  assert.deepEqual(Core.topThree(s).map((r) => [r.key, r.count]), [["gloves", 3], ["maps", 3], ["torch", 1]]);
  s = R(s, { type: "mergeAnswers", from: "flashlight", into: "torch" }); // off-board pair
  const top = Core.topThree(s);
  assert.deepEqual(top.map((r) => [r.key, r.count]), [["gloves", 3], ["maps", 3], ["torch", 2]]);
  assert.deepEqual(top.map((r) => r.value), [500, 250, 100]);
  // merge a row into a lower row: maps (3) into torch (2) → torch 5 tops the board
  s = R(s, { type: "mergeAnswers", from: "maps", into: "torch" });
  assert.deepEqual(Core.topThree(s)[0].key, "torch");
  assert.equal(Core.topThree(s)[0].count, 5);
});

test("T-top3 cycles are refused, direct and through a chain; self-merge is refused", () => {
  let s = toBoard([["a1", "a"], ["a2", "b"], ["a3", "c"], ["a4", "d"]]);
  s = R(s, { type: "mergeAnswers", from: "a", into: "b" });
  s = R(s, { type: "mergeAnswers", from: "b", into: "c" });
  assert.equal(R(s, { type: "mergeAnswers", from: "b", into: "a" }), s);
  assert.equal(R(s, { type: "mergeAnswers", from: "c", into: "a" }), s);
  assert.equal(R(s, { type: "mergeAnswers", from: "c", into: "C." }), s, "same key after normalising");
  assert.equal(Core.groupedAnswers(s)[0].count, 3);
  // a very long chain does not hang, even past MERGE_DEPTH
  let t = toBoard(Array.from({ length: 30 }, (_, i) => [`x${i}`, `w${i}`]));
  for (let i = 0; i < 29; i += 1) t = R(t, { type: "mergeAnswers", from: `w${i}`, into: `w${i + 1}` });
  t = R(t, { type: "mergeAnswers", from: "w29", into: "w0" });
  const rows = Core.groupedAnswers(t);
  assert.equal(rows.reduce((n, r) => n + r.count, 0), 30, "every answer still counted exactly once");
});

/* ============ audience values ============ */

test("T-values 500/250/100 by rank; junk idx is a miss; three misses end it; a fourth is refused", () => {
  const ans = [["a1", "x"], ["a2", "x"], ["a3", "x"], ["a4", "y"], ["a5", "y"], ["a6", "z"]];
  [[0, 500], [1, 250], [2, 100]].forEach(([idx, value]) => {
    const s = R(toBoard(ans), { type: "audiencePick", idx });
    assert.equal(s.phase, "hthPick");
    assert.equal(s.audience.won, value);
    assert.equal(s.contestants[s.winner].money, value);
  });
  let s = toBoard(ans);
  ["0", 3, -1].forEach((idx) => { s = R(s, { type: "audiencePick", idx }); });
  assert.equal(s.phase, "hthPick");
  assert.equal(s.audience.won, 0);
  assert.equal(s.contestants[0].money, 0);
  assert.equal(R(s, { type: "audiencePick", idx: 0 }), s);
  assert.equal(Core.headToHeadBase(s), 100);
});

/* ============ spin ============ */

test("T-spin lands per band under an rng, clamps junk rolls, refuses after judging", () => {
  let s = R(R(toSuperChoice(), { type: "toHeadToHead" }), { type: "pickPanelist", slot: 2 });
  assert.equal(s.hth.multiplier, 10, "first multiplier before any spin");
  const cases = [[0, 10], [0.33, 10], [0.34, 20], [0.66, 20], [0.67, 30], [0.9999, 30], [1, 30], [5, 30],
    [-3, 10], [NaN, 10]];
  cases.forEach(([roll, want]) => {
    assert.equal(R(s, { type: "spin", rng: () => roll }).hth.multiplier, want, `rng ${roll}`);
  });
  assert.equal(R(s, { type: "spin", roll: 0.5 }).hth.multiplier, 20);
  s = R(s, { type: "spin", roll: 0.9 });
  s = R(s, { type: "hthAnswer", text: "a" });
  s = R(s, { type: "hthAnswer", text: "a", who: "contestant" });
  s = R(s, { type: "revealNext" });
  s = R(s, { type: "hthJudge", match: true });
  assert.equal(s.phase, "hthResult");
  assert.equal(R(s, { type: "spin", roll: 0 }), s);
});

/* ============ head-to-head ============ */

test("T-hth with an Audience Match pays won × multiplier; without, min(values) × multiplier", () => {
  // with: 250 × 20
  let s = toBoard([["a1", "x"], ["a2", "x"], ["a3", "y"]]);
  s = run(s, [{ type: "audiencePick", idx: -1 }, { type: "audiencePick", idx: 1 },
    { type: "pickPanelist", pid: "p2" }, { type: "spin", roll: 0.5 },
    { type: "hthAnswer", text: "same" }, { type: "hthAnswer", text: "same", who: "contestant" },
    { type: "revealNext" }, { type: "hthJudge", match: true }]);
  assert.equal(s.hth.base, 250);
  assert.equal(s.hth.won, 5000);
  assert.equal(s.contestants[0].money, 5250);
  // without: skip straight from superChoice → 100 × 30
  let t = run(toSuperChoice(), [{ type: "toHeadToHead" }, { type: "pickPanelist", slot: 0 },
    { type: "spin", roll: 0.99 }, { type: "hthAnswer", text: "a" },
    { type: "hthAnswer", text: "b", who: "contestant" }, { type: "revealNext" },
    { type: "hthJudge", match: true }]);
  assert.equal(t.audience, null);
  assert.equal(t.hth.won, 3000);
  assert.equal(t.contestants[0].money, 3000);
  t = R(t, { type: "finish" });
  assert.equal(t.phase, "standings");
  assert.equal(Core.standings(t)[0].money, 3000);
  // a reveal needs both cards
  let u = run(toSuperChoice(), [{ type: "toHeadToHead" }, { type: "pickPanelist", slot: 0 },
    { type: "hthAnswer", text: "only panel" }]);
  assert.equal(R(u, { type: "revealNext" }), u);
  assert.equal(R(u, { type: "hthJudge", match: true }), u);
});

/* ============ undo ============ */

test("T-undo walks back across every phase boundary to the exact earlier state", () => {
  const states = [];
  const events = [];
  let s = started(2, { settings: { rounds: 1 } });
  const push = (e) => { states.push(s); events.push(e); s = R(s, e); };
  const turnEv = (judge) => {
    s.panel.forEach((p) => push({ type: "panelAnswer", slot: p.slot, text: `t${p.slot}` }));
    push({ type: "contestantAnswer", text: "g" });
    judge.forEach((m) => { push({ type: "revealNext" }); push({ type: "judge", match: m }); });
    push({ type: "nextContestant" });
  };
  turnEv([true, false]);
  turnEv([false, false]);
  push({ type: "nextContestant" });               // superChoice
  push({ type: "audienceOpen" });
  push({ type: "audienceAnswer", pid: "a1", text: "x" });
  push({ type: "audienceClose" });
  push({ type: "mergeAnswers", from: "x", into: "y" });
  push({ type: "audiencePick", idx: -1 });
  push({ type: "toHeadToHead" });
  push({ type: "pickPanelist", slot: 1 });
  push({ type: "spin", roll: 0.7 });
  push({ type: "hthAnswer", text: "a" });
  push({ type: "hthAnswer", text: "a", who: "contestant" });
  push({ type: "revealNext" });
  push({ type: "hthJudge", match: true });
  push({ type: "finish" });
  assert.equal(s.phase, "standings");
  // history is capped at 40, so walk back at most that far
  const steps = Math.min(Core.MAX_HISTORY, states.length);
  for (let i = 1; i <= steps; i += 1) {
    s = R(s, { type: "undo" });
    const want = states[states.length - i];
    const strip = (x) => JSON.stringify(Object.assign({}, x, { history: null }));
    assert.equal(strip(s), strip(want), `undo #${i} (${events[events.length - i].type})`);
  }
});

/* ============ validator fuzz ============ */

test("T-validate refuses 29 prompts, a missing blank, 161 chars, panelSize 7 and junk — always in English", () => {
  const bad = [
    makeGame({ prompts: makeGame().prompts.slice(0, 29) }),
    makeGame({ prompts: makeGame().prompts.map((p, i) => (i === 4 ? { text: "No blank here." } : p)) }),
    makeGame({ settings: { panelSize: 7 } }),
    makeGame({ settings: { panelSize: 1 } }),
    makeGame({ settings: { audienceValues: [500, 250] } }),
    makeGame({ settings: { audienceValues: [500, 0, 100] } }),
    makeGame({ settings: { multipliers: [] } }),
    makeGame({ settings: { multipliers: [1, 2, 3, 4, 5, 6, 7] } }),
    makeGame({ settings: { multipliers: ["abc"] } }),
    makeGame({ settings: { rounds: Infinity } }),
    makeGame({ audiencePrompts: makeGame().audiencePrompts.slice(0, 9) }),
    makeGame({ prompts: "nope" }),
    makeGame({ prompts: [42, ...makeGame().prompts] }),
    makeGame({ prompts: [{ text: "   ___  ".replace(/_/g, "") }, ...makeGame().prompts] }),
    null, 7, "string", [], { prompts: [] },
  ];
  bad.forEach((g, i) => {
    assert.throws(() => Core.validateGame(g), (err) => {
      assert.ok(err instanceof Error, `case ${i}`);
      assert.match(err.message, /^[A-Z“"0-9].*[.!]$|[a-z]/, `case ${i}: ${err.message}`);
      assert.ok(!/undefined|NaN|\[object/.test(err.message), `case ${i}: ${err.message}`);
      return true;
    }, `case ${i} should be refused`);
  });
  // exactly 160 characters is fine
  const ok = makeGame({ prompts: makeGame().prompts.map((p, i) => (i === 0 ? { text: `___ ${"y".repeat(156)}` } : p)) });
  assert.equal(ok.prompts[0].text.length, 160);
  assert.doesNotThrow(() => Core.validateGame(ok));
});

test("T-validate a 161-character prompt is refused, not silently cut to 160 (MG-D4)", {
  todo: "open defect MG-D4: normalizePrompt truncates instead of refusing; M-U1 pins the truncation",
}, () => {
  const g = makeGame({ prompts: makeGame().prompts.map((p, i) => (i === 0 ? { text: `___ ${"y".repeat(157)}` } : p)) });
  assert.equal(g.prompts[0].text.length, 161);
  assert.throws(() => Core.validateGame(g));
  // worse: a blank in the last characters is cut off and the error then blames the blank
  const h = makeGame({ prompts: makeGame().prompts.map((p, i) => (i === 0 ? { text: `${"y".repeat(158)}___` } : p)) });
  assert.throws(() => Core.validateGame(h), /longer than 160/);
});

/* ============ phone message fuzz ============ */

/** The exact inbound path of js/mg-room.js onMessage, minus the DOM. */
function phoneSend(state, pid, raw) {
  const msg = Core.validatePhoneMsg(raw);
  if (!msg || msg.t === "ready") return state;
  if (!Core.phoneMaySend(state, pid, msg.t)) return state;
  const map = {
    panel: { type: "panelAnswer", pid, text: msg.text },
    audience: { type: "audienceAnswer", pid, text: msg.text },
    hth: { type: "hthAnswer", text: msg.text, who: "panel" },
  };
  return R(state, map[msg.t]);
}

test("T-phone 41 chars is capped at 40; control chars are stripped; junk frames are null", () => {
  const v = Core.validatePhoneMsg({ t: "panel", text: "a".repeat(41) });
  assert.equal(v.text.length, 40);
  assert.equal(Core.validatePhoneMsg({ t: "panel", text: "a\u0000b\u0007c\u001b[31md\u009f" }).text, "a b c [31md");
  [null, 1, "panel", [], { t: "panel" }, { t: "panel", text: 5 }, { t: "panel", text: ["x"] },
    { t: "panel", text: "\u0000\u0001 " }, { t: "score", text: "1" }, { t: "__proto__", text: "x" },
    { t: "toString", text: "x" }, { t: "constructor", text: "x" }, { t: "panel", text: "x".repeat(5000) },
    { t: { toString: () => "panel" }, text: "x" }]
    .forEach((raw, i) => assert.equal(Core.validatePhoneMsg(raw), null, `frame ${i}`));
});

test("T-phone an audience phone cannot answer for the panel; the wrong panelist cannot write the hth", () => {
  let s = started(3);
  assert.equal(phoneSend(s, "a1", { t: "panel", text: "sneak" }), s);
  assert.equal(phoneSend(s, "c1", { t: "panel", text: "sneak" }), s, "contestant phone");
  s = phoneSend(s, "p2", { t: "panel", text: "real" });
  assert.equal(s.current.answers[1], "real");
  // a phone cannot pick someone else's slot by sending slot/pid fields
  const t = phoneSend(s, "p2", { t: "panel", text: "evil", slot: 0, pid: "p1" });
  assert.equal(t.current.answers[0], undefined);
  assert.equal(t.current.answers[1], "evil");
  // panel phones are refused during the Audience Match
  let a = R(toSuperChoice(), { type: "audienceOpen" });
  assert.equal(phoneSend(a, "p1", { t: "audience", text: "x" }), a);
  assert.equal(phoneSend(a, "c1", { t: "audience", text: "x" }), a);
  a = phoneSend(a, "a9", { t: "audience", text: "x" });
  assert.equal(a.audience.submissions.length, 1);
  // head-to-head: only the chosen panelist
  let h = run(toSuperChoice(), [{ type: "toHeadToHead" }, { type: "pickPanelist", slot: 1 }]);
  ["p1", "p3", "c1", "c2", "a1"].forEach((pid) => {
    assert.equal(phoneSend(h, pid, { t: "hth", text: "wrong" }), h, pid);
  });
  h = phoneSend(h, "p2", { t: "hth", text: "right" });
  assert.equal(h.hth.panelText, "right");
  assert.equal(h.hth.contestantText, "", "a phone can never write the contestant's card");
  // after the reveal the panelist is pencils-down
  h = R(h, { type: "hthAnswer", text: "c", who: "contestant" });
  h = R(h, { type: "revealNext" });
  assert.equal(phoneSend(h, "p2", { t: "hth", text: "late" }), h);
});

/* ============ deep-frozen immutability ============ */

test("T-frozen a whole game runs on deep-frozen states and events without a single write", () => {
  let s = deepFreeze(started(3));
  const cur = s.current;
  const ev = [];
  s.panel.forEach((p) => ev.push({ type: "panelAnswer", slot: p.slot, text: `f${p.slot}` }));
  ev.push({ type: "contestantAnswer", text: "g" });
  for (let i = 0; i < 3; i += 1) ev.push({ type: "revealNext" }, { type: "judge", match: i < 2 });
  ev.push({ type: "nextContestant" });
  s = frozenRun(s, ev);
  assert.equal(s.contestants[cur.seat].points, 2);
  let t = deepFreeze(toSuperChoice());
  t = frozenRun(t, [
    { type: "audienceOpen" }, { type: "audienceAnswer", pid: "a1", text: "x" },
    { type: "audienceAnswer", pid: "a2", text: "y" }, { type: "audienceAnswer", pid: "a1", text: "z" },
    { type: "mergeAnswers", from: "y", into: "z" }, { type: "audienceClose" },
    { type: "mergeAnswers", from: "z", into: "y" }, { type: "audiencePick", idx: 0 },
    { type: "pickPanelist", slot: 0 }, { type: "spin", roll: 0.2 },
    { type: "hthAnswer", text: "q" }, { type: "hthAnswer", text: "q", who: "contestant" },
    { type: "revealNext" }, { type: "hthJudge", match: true }, { type: "undo" }, { type: "undo" },
    { type: "tiebreak" }, { type: "finish" },
  ]);
  assert.equal(t.phase, "standings");
});

/* ============ prototype-shaped input ============ */

test("T-proto prototype-shaped types, pids, slots and merge keys never reach or corrupt state", () => {
  const s = started(3);
  ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf",
    "__defineGetter__", "propertyIsEnumerable"].forEach((type) => {
    assert.equal(R(s, { type }), s, type);
    assert.equal(R(s, JSON.parse(`{"type":"${type}","__proto__":{"type":"start"}}`)), s, type);
  });
  assert.equal(R(s, { type: "panelAnswer", slot: "__proto__", text: "x" }), s);
  assert.equal(R(s, { type: "panelAnswer", pid: "constructor", text: "x" }), s);
  assert.equal(R(s, { type: "panelAnswer", slot: 1.5, text: "x" }), s);
  assert.equal(R(s, { type: "panelAnswer", slot: -1, text: "x" }), s);
  let a = R(toSuperChoice(), { type: "audienceOpen" });
  a = R(a, { type: "audienceAnswer", pid: "__proto__", text: "constructor" });
  a = R(a, { type: "audienceAnswer", pid: "a2", text: "hasOwnProperty" });
  a = R(a, { type: "mergeAnswers", from: "constructor", into: "hasownproperty" });
  a = R(a, { type: "audienceClose" });
  const rows = Core.groupedAnswers(a);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(typeof ({}).hasOwnProperty, "function");
  assert.equal(({}).constructor, Object);
  // the state still serialises and reloads to the same board
  assert.deepEqual(Core.groupedAnswers(JSON.parse(JSON.stringify(a))), rows);
});

void CONTESTANTS; void panelOf;

test("T-top3 a merged row keeps the TARGET's wording, not the folded-in answer (MG-D3)", {
  todo: "open defect MG-D3: bestLabel ties on exact text, so 'Map' folded into flashlight/Flashlight labels the row 'Map'",
}, () => {
  let s = toBoard([["a1", "Map"], ["a2", "flashlight"], ["a3", "Flashlight"], ["a4", "gloves"]]);
  s = R(s, { type: "mergeAnswers", from: "map", into: "flashlight" });
  const top = Core.topThree(s);
  assert.equal(top[0].key, "flashlight");
  assert.equal(top[0].count, 3);
  assert.match(top[0].text, /flashlight/i);
});

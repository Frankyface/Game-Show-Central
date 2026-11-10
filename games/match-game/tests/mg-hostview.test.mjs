/* ============================================================
   Match Game — the host phone's view (docs/22 §5.1, §5.5)
   hostView holds the right private information at each phase,
   nothing in phases with no secret, stays small, is pure — and
   phoneView is unchanged by any of it.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";

import { Core, started, run, playTurn } from "./mg-fixtures.mjs";

const R = (s, e) => Core.reduce(s, e);

function toSuper() {
  let s = started(3, { settings: { rounds: 1 } });
  s = playTurn(s, [true, true, false]);
  s = R(s, { type: "nextContestant" });
  s = playTurn(s, [false, false, false]);
  return run(s, [{ type: "nextContestant" }, { type: "nextContestant" }]);
}

test("HV the setup, scores and result phases carry nothing secret", () => {
  assert.deepEqual(Core.hostView(null), { phase: "setup", phaseLabel: "Setting up", secret: false, item: "" });
  const base = Core.createState(started(2).game, {
    contestants: [{ pid: "c1", name: "Ada" }, { pid: "c2", name: "Ben" }],
    panel: [{ pid: "p1", name: "Cleo" }, { pid: "p2", name: "Dev" }],
  });
  assert.equal(Core.hostView(base).secret, false);
  const sup = toSuper();
  assert.equal(sup.phase, "superChoice");
  assert.equal(Core.hostView(sup).secret, false);
  assert.equal(Core.hostView(R(sup, { type: "finish" })).secret, false);
  const blob = JSON.stringify(Core.hostView(R(sup, { type: "finish" })));
  assert.ok(!/answer|hint|board/.test(blob), blob);
});

test("HV a prompt: the item and its hint, before anyone has written", () => {
  const s = started(3);
  const v = Core.hostView(s);
  assert.equal(v.phase, "prompt");
  assert.equal(v.secret, true);
  assert.equal(v.item, s.current.text);
  assert.equal(v.hint, s.current.hint);
  assert.equal(v.who, "Ada");
  assert.equal(v.contestant, "");
  assert.deepEqual(v.panel.map((p) => p.answer), [null, null, null]);
});

test("HV panel answers appear as they arrive, before their reveal", () => {
  let s = started(3);
  s = R(s, { type: "panelAnswer", pid: "p2", text: "zq-bravo", fromPhone: true });
  let v = Core.hostView(s);
  assert.deepEqual(v.panel.map((p) => p.answer), [null, "zq-bravo", null]);
  assert.equal(v.answered, 1);
  assert.equal(v.panel[1].revealed, false);
  assert.equal(Core.hostCards(s)[1].text, null, "the shared screen still has nothing");
  s = run(s, [{ type: "panelAnswer", slot: 0, text: "zq-alpha" }, { type: "contestantAnswer", text: "zq-guess" }]);
  v = Core.hostView(s);
  assert.equal(v.contestant, "zq-guess", "the contestant's answer once it is locked");
  s = run(s, [{ type: "revealNext" }, { type: "judge", match: true }]);
  v = Core.hostView(s);
  assert.equal(v.panel[0].revealed, true);
  assert.equal(v.panel[0].judged, true);
  assert.equal(v.panel[1].revealed, false);
});

test("HV the round-two rule marks a locked seat as out", () => {
  let s = started(2, { settings: { rounds: 2, secondRoundRule: true } });
  s = playTurn(s, [true, false]);
  s = R(s, { type: "nextContestant" });
  s = playTurn(s, [false, false]);
  s = run(s, [{ type: "nextContestant" }, { type: "nextContestant" }]);
  s = playTurn(s, [false, false]);
  s = R(s, { type: "nextContestant" });
  const v = Core.hostView(s);
  assert.equal(v.panel[0].out, true);
  assert.equal(v.playing, 1);
});

test("HV the Audience Match: the live top three, then the board before it is revealed", () => {
  let s = R(toSuper(), { type: "audienceOpen" });
  s = run(s, [
    { type: "audienceAnswer", pid: "a1", text: "zq-gloves" },
    { type: "audienceAnswer", pid: "a2", text: "ZQ-Gloves" },
    { type: "audienceAnswer", pid: "a3", text: "zq-maps" },
  ]);
  let v = Core.hostView(s);
  assert.equal(v.phase, "audience");
  assert.equal(v.secret, true);
  assert.equal(v.item, s.audience.text);
  assert.deepEqual(v.board.map((r) => [r.rank, r.count, r.value]), [[1, 2, "$500"], [2, 1, "$250"]]);
  s = R(s, { type: "audienceClose" });
  v = Core.hostView(s);
  assert.equal(v.phase, "audienceBoard");
  assert.ok(v.board.every((r) => r.revealed === false));
  s = R(s, { type: "audiencePick", idx: -1, text: "nope" });
  assert.equal(Core.hostView(s).guessesLeft, 2);
  s = R(s, { type: "audiencePick", idx: 1, text: "maps" });
  assert.equal(s.phase, "hthPick");
  assert.equal(Core.hostView(s).secret, false);
});

test("HV the Head-to-Head: both cards before they are turned over", () => {
  let s = run(toSuper(), [{ type: "toHeadToHead" }, { type: "pickPanelist", slot: 1 }]);
  let v = Core.hostView(s);
  assert.equal(v.phase, "hthPrompt");
  assert.equal(v.panelist, "Dev");
  assert.equal(v.panelText, "");
  s = run(s, [
    { type: "hthAnswer", text: "zq-panel", fromPhone: true },
    { type: "hthAnswer", text: "zq-cont", who: "contestant" },
    { type: "spin", roll: 0.5 },
  ]);
  v = Core.hostView(s);
  assert.equal(v.panelText, "zq-panel");
  assert.equal(v.contestantText, "zq-cont");
  assert.equal(v.stake, "$100 × 20");
  assert.equal(v.revealed, false);
});

test("HV is pure, deterministic, JSON and small even with long answers everywhere", () => {
  let s = started(6);
  for (let slot = 0; slot < 6; slot += 1) s = R(s, { type: "panelAnswer", slot, text: "x".repeat(40) });
  const before = JSON.stringify(s);
  const a = Core.hostView(s);
  assert.equal(JSON.stringify(s), before, "never mutates");
  assert.deepEqual(Core.hostView(s), a, "deterministic");
  assert.ok(Buffer.byteLength(JSON.stringify(a)) < 2048);
});

test("HV phoneView is unchanged: no phone ever receives a host-view field", () => {
  let s = started(3);
  s = R(s, { type: "panelAnswer", pid: "p1", text: "zq-alpha", fromPhone: true });
  ["p1", "p2", "c1", "a1"].forEach((pid) => {
    const v = Core.phoneView(s, pid);
    assert.ok(!("hint" in v) || pid.startsWith("p"), pid);
    assert.ok(!("panel" in v) && !("board" in v) && !("secret" in v), pid);
  });
  assert.ok(!JSON.stringify(Core.phoneView(s, "p2")).includes("zq-alpha"));
});

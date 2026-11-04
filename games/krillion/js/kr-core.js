/* ============================================================
   Krillion — pure game core
   The immutable reducer for both modes:

   Deep Dive   setup → intro → prompt (clock) → reveal (judge the
               off-list answers, then surface to abyss) → depth
               board → … → result.
   Puffer      setup → pufferReady → puffer (holder answers before
               the clock pops) → popped → … → result.

   Every answer is matched against the prompt's RATED list: an
   on-list answer takes its listed tier at once; an off-list one
   waits for the judge (`review` in Deep Dive, `pufferJudge` in
   Puffer Party), who may also `remember` it for the session.

   No DOM, no network, no timers of its own: clocks are deadlines
   computed from an injected `now`, and `freeze`/`thaw` turn a
   running clock into remaining time and back, so a save, an undo
   or a reload never loses or gains a second. Reducers never
   mutate their inputs; an illegal or unknown event returns the
   state unchanged rather than throwing.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./kr-content.js") : root.KrContent;
  const select = node ? require("./kr-select.js") : root.KrSelect;
  const api = factory(content, select);
  if (node) module.exports = api;
  root.KrCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content, Select) {
  "use strict";

  const { has, isPlainObject, cleanText, normaliseAnswer, isTier, tierById, fail,
    normalizeGame, drawOrder, NAME_MAX, PID_MAX, ANSWER_MAX } = Content;
  const { matchFor, reviewQueue, pendingReviews, revealOrder, nextAlive, alive,
    pufferSeconds, nameOf, depthBoard, pufferStandings, tierRank } = Select;

  const PHASES = Object.freeze([
    "setup", "intro", "prompt", "reveal", "depth", "pufferReady", "puffer", "popped", "result",
  ]);
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 16;
  const MAX_HISTORY = 40;
  const MAX_LEARNED = 300;

  /** Bookkeeping, not decisions: undo skips over these. */
  const NO_HISTORY = new Set(["undo", "pauseClock", "resumeClock"]);

  const patch = (state, fields) => Object.assign({}, state, fields);
  const withDive = (s, f) => patch(s, { dive: Object.assign({}, s.dive, f) });
  const withPuffer = (s, f) => patch(s, { puffer: Object.assign({}, s.puffer, f) });
  const finite = (n) => typeof n === "number" && Number.isFinite(n);

  function withPlayer(state, pid, fields) {
    return patch(state, {
      players: state.players.map((p) => (p.pid === pid ? Object.assign({}, p, fields) : p)),
    });
  }

  /* ============ Construction ============ */

  function normalizePlayers(raw) {
    if (!Array.isArray(raw)) fail("Add some players first.");
    const seen = new Set();
    const players = raw.map((p, i) => {
      if (!isPlainObject(p)) fail(`Player ${i + 1} is missing.`);
      const pid = cleanText(p.pid, PID_MAX);
      const name = cleanText(p.name, NAME_MAX);
      if (!pid) fail(`Player ${i + 1} has no id.`);
      if (!name) fail(`Player ${i + 1} needs a name.`);
      if (seen.has(pid)) fail(`${name} is in the line-up twice.`);
      seen.add(pid);
      return { pid, name, manual: p.manual === true };
    });
    if (players.length < MIN_PLAYERS) fail(`Krillion needs at least ${MIN_PLAYERS} players.`);
    if (players.length > MAX_PLAYERS) fail(`${MAX_PLAYERS} players is the most Krillion can seat.`);
    return players;
  }

  /**
   * Build the state for one game.
   * @param {object} game content file (validated here)
   * @param {{players:object[], mode?:string, shuffle?:boolean, rng?:() => number}} opts
   */
  function createState(game, opts) {
    const g = normalizeGame(game);
    const o = opts || {};
    const mode = o.mode === "puffer" || o.mode === "deepDive" ? o.mode : g.settings.mode;
    const hearts = g.settings.puffer.hearts;
    const players = normalizePlayers(o.players).map((p) => Object.assign(p, {
      score: 0, lastGain: 0, hearts, meter: 0, answers: 0, out: false,
    }));
    return {
      phase: "setup", mode, game: g, players,
      order: drawOrder(g, { shuffle: !!o.shuffle, rng: o.rng }),
      cursor: 0, round: 0, clock: null, dive: null, puffer: null,
      learned: [], winners: [], history: [],
    };
  }

  function promptIndex(state, cursor) {
    const order = state.order;
    return order.length ? order[cursor % order.length] : 0;
  }

  function makeDive(state, cursor) {
    const index = promptIndex(state, cursor);
    const p = state.game.prompts[index];
    return { index, text: p.text, category: p.category, answers: {}, rulings: {}, revealed: 0, banked: false };
  }

  function makePuffer(state, cursor, holder) {
    const index = promptIndex(state, cursor);
    const p = state.game.prompts[index];
    return { index, text: p.text, category: p.category, holder, starter: holder, passes: 0,
      used: [], pending: null, notice: null, popped: null };
  }

  function startClock(state, seconds, now) {
    return patch(state, { clock: { deadline: now + seconds * 1000, remainingMs: null, seconds } });
  }

  /* ============ Clock: freeze and thaw ============ */

  /** Running clock → remaining time. For saves, snapshots and pauses. */
  function freeze(state, now) {
    if (!state || !state.clock || !finite(state.clock.deadline) || !finite(now)) return state;
    return patch(state, { clock: Object.assign({}, state.clock, {
      deadline: null, remainingMs: Math.max(0, state.clock.deadline - now),
    }) });
  }

  /** Remaining time → a running clock again. */
  function thaw(state, now) {
    const c = state && state.clock;
    if (!c || finite(c.deadline) || !finite(c.remainingMs) || !finite(now)) return state;
    return patch(state, { clock: Object.assign({}, c, { deadline: now + c.remainingMs, remainingMs: null }) });
  }

  /* ============ Start ============ */

  function evStart(state) {
    if (state.phase !== "setup") return state;
    if (state.mode === "puffer") {
      return patch(state, { phase: "pufferReady", round: 1,
        puffer: makePuffer(state, 0, state.players[0].pid) });
    }
    return patch(state, { phase: "intro", round: 1, dive: makeDive(state, 0) });
  }

  /* ============ Deep Dive ============ */

  function evOpenPrompt(state, event) {
    if (state.phase !== "intro" || !state.dive || !finite(event.now)) return state;
    return patch(startClock(state, state.game.settings.promptSeconds, event.now), { phase: "prompt" });
  }

  function closeDive(state) {
    return patch(state, { phase: "reveal", clock: null });
  }

  /** One answer per player; a resend replaces it until the prompt closes. */
  function evAnswer(state, event) {
    if (state.phase !== "prompt" || !state.dive) return state;
    const pid = cleanText(event.pid, PID_MAX);
    const text = cleanText(event.text, ANSWER_MAX);
    if (!state.players.some((p) => p.pid === pid) || !text || !normaliseAnswer(text)) return state;
    const next = withDive(state, { answers: Object.assign({}, state.dive.answers, { [pid]: text }) });
    const everyone = next.players.every((p) => has(next.dive.answers, p.pid));
    return everyone ? closeDive(next) : next;
  }

  function evClosePrompt(state) {
    if (state.phase !== "prompt") return state;
    return closeDive(state);
  }

  /** The judge rules an off-list group: a tier id, or null for not valid. */
  function evReview(state, event) {
    if (state.phase !== "reveal" || !state.dive || state.dive.revealed > 0) return state;
    const tier = event.tier === null ? null : event.tier;
    if (tier !== null && !isTier(tier, state.game.settings.tiers)) return state;
    const group = typeof event.group === "string" ? event.group : "";
    if (!reviewQueue(state).some((g) => g.id === group && !g.remembered)) return state;
    return withDive(state, { rulings: Object.assign({}, state.dive.rulings, { [group]: tier }) });
  }

  /** Bank this prompt's points: the depth markers settle. */
  function bank(state) {
    const gains = {};
    revealOrder(state).forEach((g) => g.pids.forEach((pid) => { gains[pid] = g.points; }));
    const players = state.players.map((p) => {
      const gain = has(gains, p.pid) ? gains[p.pid] : 0;
      return Object.assign({}, p, { score: p.score + gain, lastGain: gain });
    });
    return patch(state, { phase: "depth", players, dive: Object.assign({}, state.dive, { banked: true }) });
  }

  /** Surface to abyss, one group at a time; past the last one, bank. */
  function evRevealNext(state) {
    if (state.phase !== "reveal" || !state.dive || pendingReviews(state) > 0) return state;
    const total = revealOrder(state).length;
    if (state.dive.revealed < total) return withDive(state, { revealed: state.dive.revealed + 1 });
    return bank(state);
  }

  /** Depth board → the next prompt (or the result). From intro: swap the prompt. */
  function evNextPrompt(state) {
    if (state.phase === "intro" && state.dive) {
      return patch(state, { cursor: state.cursor + 1, dive: makeDive(state, state.cursor + 1) });
    }
    if (state.phase !== "depth") return state;
    if (state.round >= state.game.settings.promptsPerGame) return finishState(state);
    const cursor = state.cursor + 1;
    return patch(state, { phase: "intro", round: state.round + 1, cursor, dive: makeDive(state, cursor) });
  }

  /* ============ Remembering a judged answer ============ */

  function rememberable(state, group) {
    if (state.dive && ["reveal", "depth"].indexOf(state.phase) >= 0) {
      const item = reviewQueue(state).find((g) => g.id === group);
      return item && item.tier ? { index: state.dive.index, prompt: state.dive.text, text: item.label, tier: item.tier } : null;
    }
    if (state.puffer && ["puffer", "popped"].indexOf(state.phase) >= 0) {
      const used = state.puffer.used.find((u) => !u.onList && u.key === group);
      return used ? { index: state.puffer.index, prompt: state.puffer.text, text: used.text, tier: used.tier } : null;
    }
    return null;
  }

  /** "Add to this question": the ruling becomes part of the session content. */
  function evRemember(state, event) {
    const item = rememberable(state, typeof event.group === "string" ? event.group : "");
    if (!item || state.learned.length >= MAX_LEARNED) return state;
    if (matchFor(state, item.index, item.text)) return state;          // already on the list
    return patch(state, { learned: state.learned.concat([item]) });
  }

  /* ============ Puffer Party ============ */

  function evPufferStart(state, event) {
    if (state.phase !== "pufferReady" || !state.puffer || !finite(event.now)) return state;
    return patch(startClock(state, pufferSeconds(state, 0), event.now), { phase: "puffer" });
  }

  /** A valid answer: meter, maybe a heart, the puffer moves on, the clock shrinks. */
  function pass(state, item, now) {
    const pf = state.puffer;
    const settings = state.game.settings.puffer;
    const holder = state.players.find((p) => p.pid === pf.holder);
    // A tier's meter value is its position: Prawn 0, Schooler 1 … One in a Krillion 4.
    let meter = holder.meter + Math.max(0, tierRank(state, item.tier));
    let hearts = holder.hearts;
    if (meter >= settings.meterForHeart && hearts < settings.maxHearts) {
      meter -= settings.meterForHeart;
      hearts += 1;
    }
    const scored = withPlayer(state, holder.pid, { meter, hearts, answers: holder.answers + 1 });
    const passes = pf.passes + 1;
    const tier = tierById(item.tier, state.game.settings.tiers);
    const moved = withPuffer(scored, {
      used: pf.used.concat([Object.assign({ pid: holder.pid }, item)]),
      holder: nextAlive(scored, holder.pid) || holder.pid, passes, pending: null,
      notice: { kind: hearts > holder.hearts ? "heart" : "pass",
        text: `${holder.name}: ${item.text} — ${tier ? tier.name : ""}` },
    });
    return startClock(moved, pufferSeconds(state, passes), now);
  }

  function evPufferAnswer(state, event) {
    if (state.phase !== "puffer" || !state.puffer || !finite(event.now)) return state;
    if (cleanText(event.pid, PID_MAX) !== state.puffer.holder) return state;
    const text = cleanText(event.text, ANSWER_MAX);
    const raw = normaliseAnswer(text);
    if (!raw) return state;
    const m = matchFor(state, state.puffer.index, text);
    const key = m ? normaliseAnswer(m.entry.text) : raw;
    if (state.puffer.used.some((u) => u.key === key)) {
      return withPuffer(state, { pending: null, notice: { kind: "used", text: `“${text}” was already used.` } });
    }
    if (m) return pass(state, { key, text: m.entry.text, tier: m.tier, onList: true }, event.now);
    return withPuffer(state, { pending: { pid: state.puffer.holder, text, key },
      notice: { kind: "judge", text: `“${text}” is off the list — the judge is ruling.` } });
  }

  /**
   * The judge's ruling on an off-list Puffer answer. `{tier}` (an id, or null
   * for not valid) is what the host screen sends; the spec's `{valid, niche}`
   * shape also works: valid alone rates it the shallowest tier, niche the deepest.
   */
  function judgedTier(state, event) {
    const tiers = state.game.settings.tiers;
    if (has(event, "tier")) return event.tier === null ? null : (isTier(event.tier, tiers) ? event.tier : undefined);
    if (event.valid === false) return null;
    if (event.valid === true) return event.niche === true ? tiers[tiers.length - 1].id : tiers[0].id;
    return undefined;
  }

  /** The judge rules the pending off-list answer: a tier passes it, not valid keeps the puffer. */
  function evPufferJudge(state, event) {
    if (state.phase !== "puffer" || !state.puffer || !state.puffer.pending || !finite(event.now)) return state;
    const pending = state.puffer.pending;
    const tier = judgedTier(state, event);
    if (tier === undefined) return state;
    if (tier === null) {
      return withPuffer(state, { pending: null,
        notice: { kind: "invalid", text: `“${pending.text}” isn’t valid — keep going.` } });
    }
    return pass(state, { key: pending.key, text: pending.text, tier, onList: false }, event.now);
  }

  /** Pop: the holder loses a heart, the round ends. Last one floating wins. */
  function evPufferPop(state) {
    if (state.phase !== "puffer" || !state.puffer) return state;
    const holder = state.players.find((p) => p.pid === state.puffer.holder);
    const hearts = Math.max(0, holder.hearts - 1);
    // outAt orders the eliminated: whoever lasts longer places higher.
    const outAt = hearts === 0 ? state.players.filter((p) => p.out).length + 1 : 0;
    const popped = withPlayer(state, holder.pid, { hearts, out: hearts === 0, outAt });
    const next = patch(withPuffer(popped, { popped: holder.pid, pending: null,
      notice: { kind: "pop", text: hearts === 0 ? `${holder.name} is out.` : `${holder.name} popped.` } }),
    { phase: "popped", clock: null });
    const cap = next.game.settings.puffer.roundCap;
    if (alive(next).length <= 1 || (cap > 0 && next.round >= cap)) return finishState(next);
    return next;
  }

  function evNextRound(state) {
    if (state.phase !== "popped" || !state.puffer) return state;
    const cursor = state.cursor + 1;
    const holder = nextAlive(state, state.puffer.popped);
    return patch(state, { phase: "pufferReady", round: state.round + 1, cursor,
      puffer: makePuffer(state, cursor, holder) });
  }

  /* ============ The end, undo, pauses ============ */

  function finishState(state) {
    const rows = state.mode === "puffer" ? pufferStandings(state) : depthBoard(state);
    const winners = rows.filter((r) => r.rank === 1).map((r) => r.pid);
    return patch(state, { phase: "result", clock: null, winners });
  }

  function evFinish(state) {
    if (state.phase === "setup" || state.phase === "result") return state;
    return finishState(state);
  }

  function evUndo(state, event) {
    if (!state.history.length) return state;
    const prev = state.history[state.history.length - 1];
    const restored = patch(prev, { game: state.game, history: state.history.slice(0, -1) });
    return thaw(restored, event.now);
  }

  function evPauseClock(state, event) {
    if (["prompt", "puffer"].indexOf(state.phase) < 0) return state;
    return freeze(state, event.now);
  }

  function evResumeClock(state, event) {
    if (["prompt", "puffer"].indexOf(state.phase) < 0) return state;
    return thaw(state, event.now);
  }

  const HANDLERS = {
    start: evStart,
    openPrompt: evOpenPrompt,
    answer: evAnswer,
    hostAnswer: evAnswer,
    closePrompt: evClosePrompt,
    review: evReview,
    remember: evRemember,
    revealNext: evRevealNext,
    nextPrompt: evNextPrompt,
    pufferStart: evPufferStart,
    pufferAnswer: evPufferAnswer,
    pufferJudge: evPufferJudge,
    pufferPop: evPufferPop,
    nextRound: evNextRound,
    pauseClock: evPauseClock,
    resumeClock: evResumeClock,
    finish: evFinish,
    undo: evUndo,
  };

  /* ============ Reducer ============ */

  /** A history entry: no game (it never changes), no history, clock frozen. */
  function snapshot(state, now) {
    return patch(freeze(state, now), { history: [], game: null });
  }

  /**
   * Apply `event` to `state`. Illegal or unknown events return `state`
   * unchanged (never throw). The handler lookup is guarded, so a
   * prototype-shaped type (`toString`, `__proto__`) finds nothing.
   */
  function reduce(state, event) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    const handler = has(HANDLERS, event.type) ? HANDLERS[event.type] : null;
    if (typeof handler !== "function") return state;
    const next = handler(state, event);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return patch(next, { history: state.history.concat([snapshot(state, event.now)]).slice(-MAX_HISTORY) });
  }

  void nameOf;

  return Object.assign({}, Content, Select, {
    createState, reduce, snapshot, freeze, thaw,
    PHASES, MIN_PLAYERS, MAX_PLAYERS, MAX_HISTORY,
  });
});

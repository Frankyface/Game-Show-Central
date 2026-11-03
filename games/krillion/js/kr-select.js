/* ============================================================
   Krillion — pure selectors
   Everything that READS the state: the answer groups of a Deep
   Dive prompt (each player's answer matched against the prompt's
   rated list, off-list answers grouped by their normalised key),
   the judge's review queue, the reveal order (misses, then
   surface to abyss), depth, standings, the Puffer Party ring and
   the masked view each phone is allowed to see.

   THE RULE THIS FILE ENFORCES: `phoneView` never carries another
   player's answer before that answer's group is revealed, and it
   never carries a word of the prompt's rated answer list. A leak
   would have to be invented somewhere else (success state KR-U10).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./kr-content.js") : root.KrContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.KrSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const { TIERS, has, isPlainObject, cleanText, normaliseAnswer, matchAnswer, tierById,
    ANSWER_MAX, METRES_PER_POINT } = Content;

  const PHONE_MSGS = Object.freeze(["answer", "puffer"]);
  const NO_ANSWER = "";      // the group id for players who sent nothing

  /* ============ The prompt in play ============ */

  function promptOf(state, index) {
    return state && state.game && state.game.prompts[index] ? state.game.prompts[index] : null;
  }

  /** Answers the judge added to this prompt during the session. */
  function learnedFor(state, index) {
    return (state.learned || []).filter((l) => l.index === index)
      .map((l) => ({ text: l.text, tier: l.tier }));
  }

  /** Match `text` against prompt `index`, remembered answers included. */
  function matchFor(state, index, text) {
    return matchAnswer(promptOf(state, index), text, learnedFor(state, index));
  }

  function tiersOf(state) {
    return state && state.game && state.game.settings ? state.game.settings.tiers : TIERS;
  }

  /** A tier's position in the file's list: -1 for a miss. Also its Puffer meter value. */
  function tierRank(state, tier) {
    return tiersOf(state).findIndex((t) => t.id === tier);
  }

  function pointsFor(state, tier) {
    const t = tier ? tierById(tier, tiersOf(state)) : null;
    return t ? t.points : 0;
  }

  /** How many players landed in each tier (and how many missed). */
  function tierTally(state, revealedOnly) {
    const order = revealOrder(state);
    const upto = revealedOnly && state.dive && !state.dive.banked ? state.dive.revealed : order.length;
    const counts = tiersOf(state).map((t) => ({ id: t.id, name: t.name, count: 0 }));
    let misses = 0;
    order.slice(0, upto).forEach((g) => {
      const row = counts.find((c) => c.id === g.tier);
      if (row) row.count += g.count;
      else if (g.tier !== undefined) misses += g.count;
    });
    return { tiers: counts, misses };
  }

  /* ============ Deep Dive: the answer groups ============ */

  function bestLabel(texts) {
    let best = "";
    let count = -1;
    texts.forEach((n, text) => { if (n > count) { best = text; count = n; } });
    return best;
  }

  function addToGroup(byId, id, seed, player, text) {
    if (!byId.has(id)) byId.set(id, Object.assign({ id, pids: [], names: [], texts: new Map() }, seed));
    const g = byId.get(id);
    g.pids.push(player.pid);
    g.names.push(player.name);
    if (text) g.texts.set(text, (g.texts.get(text) || 0) + 1);
  }

  /**
   * Every answer group of the current Deep Dive prompt. On-list answers group
   * by the rated entry they matched (so "NYC" sits with "New York"); off-list
   * answers group by their normalised key and carry the judge's ruling:
   * `tier` is a tier id, null (not valid) or undefined (not ruled yet).
   */
  function groups(state) {
    const dive = state && state.dive;
    if (!dive) return [];
    const byId = new Map();
    state.players.forEach((player, order) => {
      const text = has(dive.answers, player.pid) ? dive.answers[player.pid] : "";
      if (!text) {
        addToGroup(byId, NO_ANSWER, { first: order, onList: false, noAnswer: true, tier: null }, player, "");
        return;
      }
      const m = matchFor(state, dive.index, text);
      if (m) {
        addToGroup(byId, `#${m.index}`, { first: order, onList: true, noAnswer: false,
          tier: m.tier, canonical: m.entry.text }, player, text);
        return;
      }
      const key = normaliseAnswer(text);
      const tier = has(dive.rulings, key) ? dive.rulings[key] : undefined;
      addToGroup(byId, key, { first: order, onList: false, noAnswer: false, tier }, player, text);
    });
    return [...byId.values()].map((g) => ({
      id: g.id, onList: g.onList, noAnswer: g.noAnswer, tier: g.tier, pending: g.tier === undefined,
      label: g.noAnswer ? "No answer" : (g.canonical || bestLabel(g.texts)),
      variants: [...g.texts.keys()], pids: g.pids, names: g.names, count: g.pids.length,
      first: g.first, points: pointsFor(state, g.tier),
    }));
  }

  /**
   * The reveal order: misses (not valid, no answer) first, then surface to
   * abyss — Prawn up to One in a Krillion — so the rarest answers land last.
   * Inside a tier the bigger group goes first; ties keep seat order.
   */
  function revealOrder(state) {
    return groups(state).sort((a, b) => (tierRank(state, a.tier) - tierRank(state, b.tier))
      || (Number(a.noAnswer) - Number(b.noAnswer))
      || (b.count - a.count) || (a.first - b.first));
  }

  /** Off-list answers waiting for (or holding) the judge's ruling. */
  function reviewQueue(state) {
    return groups(state).filter((g) => !g.onList && !g.noAnswer).map((g) => ({
      id: g.id, label: g.label, variants: g.variants, pids: g.pids, names: g.names,
      count: g.count, tier: g.tier, ruled: g.tier !== undefined, first: g.first,
    })).sort((a, b) => a.first - b.first);
  }

  function pendingReviews(state) {
    return reviewQueue(state).filter((g) => !g.ruled).length;
  }

  function answeredCount(state) {
    if (!state || !state.dive) return { done: 0, total: 0 };
    const done = state.players.filter((p) => has(state.dive.answers, p.pid)).length;
    return { done, total: state.players.length };
  }

  /** What one player scored on this prompt (once their group is decided). */
  function resultFor(state, pid) {
    const order = revealOrder(state);
    const at = order.findIndex((g) => g.pids.indexOf(pid) >= 0);
    if (at < 0) return null;
    const g = order[at];
    return { revealed: at < (state.dive ? state.dive.revealed : 0) || !!(state.dive && state.dive.banked),
      tier: g.tier, label: g.label, points: g.points, noAnswer: g.noAnswer };
  }

  /* ============ Depth and standings ============ */

  function metres(points) {
    return Math.round(points * METRES_PER_POINT);
  }

  /** Points already shown in the reveal of the current prompt, per pid. */
  function revealedGains(state) {
    const out = {};
    if (!state.dive || state.dive.banked) return out;
    revealOrder(state).slice(0, state.dive.revealed).forEach((g) => {
      g.pids.forEach((pid) => { out[pid] = g.points; });
    });
    return out;
  }

  /** Shared ranks: equal scores share a place (ties stay ties). */
  function ranked(rows, keyOf) {
    let place = 0;
    let last = null;
    return rows.map((row, i) => {
      const key = keyOf(row);
      if (last === null || key !== last) { place = i + 1; last = key; }
      return Object.assign({}, row, { rank: place });
    });
  }

  /** Deep Dive: everyone's depth, the current reveal included. */
  function depthBoard(state) {
    const gains = revealedGains(state);
    const rows = state.players.map((p, i) => {
      const live = p.score + (has(gains, p.pid) ? gains[p.pid] : 0);
      return { pid: p.pid, name: p.name, seat: i, score: live, depth: metres(live),
        gained: has(gains, p.pid) ? gains[p.pid] : (p.lastGain || 0) };
    });
    rows.sort((a, b) => (b.score - a.score) || (a.seat - b.seat));
    return ranked(rows, (r) => r.score);
  }

  function depth(state, pid) {
    const row = depthBoard(state).find((r) => r.pid === pid);
    return row ? row.depth : 0;
  }

  /** Puffer Party: still floating first, then hearts, then meter. */
  function pufferStandings(state) {
    const rows = state.players.map((p, i) => ({
      pid: p.pid, name: p.name, seat: i, hearts: p.hearts, meter: p.meter, out: !!p.out,
      answers: p.answers || 0, outAt: p.outAt || 0,
    }));
    rows.sort((a, b) => (Number(a.out) - Number(b.out)) || (b.hearts - a.hearts)
      || (b.outAt - a.outAt) || (b.answers - a.answers) || (a.seat - b.seat));
    return ranked(rows, (r) => `${r.out}|${r.hearts}|${r.outAt}|${r.answers}`);
  }

  function standings(state) {
    return state.mode === "puffer" ? pufferStandings(state) : depthBoard(state);
  }

  /* ============ Puffer Party ============ */

  function alive(state) {
    return state.players.filter((p) => !p.out);
  }

  /** The next floating player after `pid` round the ring. */
  function nextAlive(state, pid) {
    const n = state.players.length;
    const at = state.players.findIndex((p) => p.pid === pid);
    for (let step = 1; step <= n; step += 1) {
      const p = state.players[(at + step + n) % n];
      if (!p.out) return p.pid;
    }
    return null;
  }

  function pufferSeconds(state, passes) {
    const s = state.game.settings.puffer;
    return Math.max(s.floorSeconds, s.startSeconds - passes * s.stepSeconds);
  }

  function ring(state) {
    const holder = state.puffer ? state.puffer.holder : null;
    return state.players.map((p, seat) => ({
      seat, pid: p.pid, name: p.name, hearts: p.hearts, meter: p.meter, out: !!p.out,
      holder: p.pid === holder,
    }));
  }

  function nameOf(state, pid) {
    const p = state.players.find((x) => x.pid === pid);
    return p ? p.name : "";
  }

  /* ============ The phones ============ */

  function clockLeft(state, now) {
    const c = state.clock;
    if (!c) return null;
    if (Number.isFinite(c.deadline)) return Math.max(0, c.deadline - (Number.isFinite(now) ? now : 0));
    return Number.isFinite(c.remainingMs) ? c.remainingMs : null;
  }

  function usedList(state) {
    return state.puffer ? state.puffer.used.map((u) => u.text) : [];
  }

  function diveView(state, pid, now) {
    const dive = state.dive;
    if (state.phase === "prompt") {
      const mine = has(dive.answers, pid) ? dive.answers[pid] : "";
      return { screen: "answer", prompt: dive.text, category: dive.category, mine, sent: !!mine,
        remainingMs: clockLeft(state, now), round: state.round,
        rounds: state.game.settings.promptsPerGame };
    }
    const r = resultFor(state, pid);
    if (!r || !r.revealed) {
      return { screen: "wait", sub: pendingReviews(state) ? "The judge is reviewing answers…"
        : "Answers are being revealed…", prompt: dive.text };
    }
    const tier = r.tier ? tierById(r.tier, tiersOf(state)) : null;
    return { screen: "reveal", prompt: dive.text, mine: r.noAnswer ? "" : r.label,
      tier: tier ? tier.name : (r.noAnswer ? "No answer" : "Not valid"),
      miss: !tier, points: r.points, depth: depth(state, pid) };
  }

  function pufferView(state, pid, now) {
    const pf = state.puffer;
    const me = state.players.find((p) => p.pid === pid);
    const base = { prompt: pf.text, category: pf.category, used: usedList(state),
      hearts: me.hearts, holder: nameOf(state, pf.holder) };
    if (me.out) return Object.assign(base, { screen: "out" });
    if (state.phase === "puffer" && pf.holder === pid) {
      return Object.assign(base, { screen: "puffer-hold", remainingMs: clockLeft(state, now),
        waiting: !!pf.pending, notice: pf.notice ? pf.notice.text : "" });
    }
    const sub = state.phase === "popped" ? `${nameOf(state, pf.popped)} popped!`
      : (state.phase === "pufferReady" ? `${base.holder} starts the next round.` : "");
    return Object.assign(base, { screen: "puffer-watch", sub });
  }

  function resultView(state, pid) {
    const rows = standings(state);
    const mine = rows.find((r) => r.pid === pid);
    const winners = state.winners || [];
    return {
      screen: "result",
      standings: rows.map((r) => ({ name: r.name, rank: r.rank,
        line: state.mode === "puffer" ? (r.out ? "out" : `${r.hearts} hearts`) : `${r.depth} m` })),
      mine: mine ? (state.mode === "puffer" ? (mine.out ? "Out" : `${mine.hearts} hearts left`)
        : `${mine.depth} m deep`) : "",
      won: winners.indexOf(pid) >= 0,
    };
  }

  const WAIT_LINES = {
    setup: "The host is still setting up.",
    intro: "The next prompt is coming up.",
    depth: "Depth board.",
  };

  /**
   * The ONE view this phone is allowed to see. Never another player's answer
   * before it is revealed; never the prompt's rated answer list.
   */
  function phoneView(state, pid, now) {
    if (!state || !Array.isArray(state.players) || !pid) return { screen: "wait", sub: "Stand by." };
    const me = state.players.find((p) => p.pid === pid);
    if (!me) return { screen: "wait", sub: "You’ll be in the next game — watch the big screen." };
    if (state.phase === "result") return resultView(state, pid);
    if (state.mode === "deepDive" && state.dive && ["prompt", "reveal"].indexOf(state.phase) >= 0) {
      return diveView(state, pid, now);
    }
    if (state.phase === "depth" && state.dive) {
      return Object.assign(diveView(state, pid, now), { sub: "Depth board." });
    }
    if (state.mode === "puffer" && state.puffer) return pufferView(state, pid, now);
    const sub = has(WAIT_LINES, state.phase) ? WAIT_LINES[state.phase] : "Stand by.";
    return { screen: "wait", sub, depth: state.mode === "deepDive" ? depth(state, pid) : undefined };
  }

  /**
   * Every frame a phone can send, checked before it can touch state: a known
   * `t`, a string `text` no longer than 40 characters, control chars stripped.
   */
  function validatePhoneMsg(raw) {
    if (!isPlainObject(raw) || typeof raw.t !== "string") return null;
    if (raw.t === "ready") return { t: "ready" };
    if (PHONE_MSGS.indexOf(raw.t) < 0) return null;
    if (typeof raw.text !== "string" || raw.text.length > 4000) return null;
    const text = cleanText(raw.text, ANSWER_MAX);
    if (!text || !normaliseAnswer(text)) return null;
    return { t: raw.t, text };
  }

  /** May this phone send `t` right now? The reducer re-checks anyway. */
  function phoneMaySend(state, pid, t) {
    if (!state || !pid) return false;
    if (t === "answer") {
      return state.phase === "prompt" && state.players.some((p) => p.pid === pid);
    }
    if (t === "puffer") {
      return state.phase === "puffer" && !!state.puffer && state.puffer.holder === pid;
    }
    return false;
  }

  return {
    promptOf, learnedFor, matchFor, tiersOf, tierRank, pointsFor, tierTally,
    groups, revealOrder, reviewQueue, pendingReviews, answeredCount, resultFor,
    metres, depthBoard, depth, pufferStandings, standings, ranked,
    alive, nextAlive, pufferSeconds, ring, nameOf, clockLeft, usedList,
    phoneView, validatePhoneMsg, phoneMaySend, PHONE_MSGS, NO_ANSWER,
  };
});

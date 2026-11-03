/* ============================================================
   Match Game — pure selectors
   Everything that READS the state: the host's panel cards, the
   Audience Match board (frequency after normalisation and the
   host's merges), the standings, and the masked view each phone
   is allowed to see. Split out of mg-core.js so both files stay
   well under the 800-line house limit; mg-core.js re-exports
   everything here, so callers only ever touch MgCore.

   THE RULE THIS FILE ENFORCES: `hostCards` returns `text:null`
   for every card that has not been flipped, and `phoneView`
   never carries another seat's answer. A leak would have to be
   invented somewhere else — it cannot come out of here
   (spec 18 §4, success state M-U10).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./mg-content.js") : root.MgContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.MgSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const { isPlainObject, isIntIn, cleanText, normaliseAnswer, ANSWER_MAX } = Content;

  const PHONE_MSGS = Object.freeze(["panel", "audience", "hth"]);
  const MERGE_DEPTH = 20;
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /* ============ Scores ============ */

  /** Who is ahead on points, or null when they are level. */
  function leader(state) {
    const [a, b] = state.contestants;
    if (a.points === b.points) return null;
    return a.points > b.points ? 0 : 1;
  }

  function isTied(state) {
    return state.contestants[0].points === state.contestants[1].points;
  }

  function standings(state) {
    return state.contestants
      .map((c, i) => ({ index: i, pid: c.pid, name: c.name, points: c.points, money: c.money }))
      .sort((a, b) => (b.money - a.money) || (b.points - a.points) || (a.index - b.index));
  }

  function moneyText(state, amount) {
    const currency = state.game.settings.currency || "";
    return `${currency}${Number(amount || 0).toLocaleString("en-US")}`;
  }

  /* ============ The host's panel ============ */

  /**
   * One row per panel seat. `text` is null for every card that has not been
   * flipped, so the host UI literally cannot paint an unrevealed answer.
   */
  function hostCards(state) {
    const cur = state.current;
    return state.panel.map((seat) => {
      const row = { slot: seat.slot, name: seat.name, pid: seat.pid, answered: false,
        revealed: false, text: null, judged: null, locked: false, live: false, place: -1 };
      if (!cur) return row;
      const place = cur.order.indexOf(seat.slot);
      const revealed = place >= 0 && place < cur.revealed;
      const judged = place >= 0 && place < cur.judged.length ? cur.judged[place] : null;
      return Object.assign(row, {
        place,
        answered: has(cur.answers, seat.slot),
        revealed,
        text: revealed ? cur.answers[seat.slot] || "" : null,
        judged,
        locked: cur.locked.indexOf(seat.slot) >= 0,
        live: revealed && judged === null,
      });
    });
  }

  /** How many of the panel have written something, out of how many are playing. */
  function answeredCount(state) {
    if (!state.current) return { done: 0, total: 0 };
    const cur = state.current;
    return {
      done: cur.order.filter((slot) => has(cur.answers, slot)).length,
      total: cur.order.length,
    };
  }

  /** The card that is face up and still unjudged, or null. */
  function liveCard(state) {
    return hostCards(state).find((c) => c.live) || null;
  }

  /* ============ The Audience Match board ============ */

  /** Resolve a merge chain (`from` → `into` → …) without ever looping. */
  function resolveKey(merges, key) {
    let out = key;
    for (let i = 0; i < MERGE_DEPTH; i += 1) {
      if (!has(merges, out)) return out;
      const next = merges[out];
      if (next === out) return out;
      out = next;
    }
    return out;
  }

  /**
   * The wording most people used for THIS answer; a tie goes to the first one
   * seen. Only texts whose own key is the group's key count, so an answer the
   * host folded in never names the row (MG-D3). All variants are the fallback.
   */
  function bestLabel(texts, key) {
    let best = "";
    let bestCount = -1;
    const pick = (own) => texts.forEach((row, text) => {
      if (own && row.key !== key) return;
      if (row.count > bestCount) { best = text; bestCount = row.count; }
    });
    pick(true);
    if (!best) pick(false);
    return best;
  }

  /**
   * Every distinct audience answer, most-said first (spec 18 §4): frequency
   * after normalisation, then the merges the host made, then first-said wins
   * a tie so the board never jumps around under the host's cursor.
   */
  function groupedAnswers(state) {
    const aud = state.audience;
    if (!aud) return [];
    const merges = aud.merges || {};
    const byKey = new Map();
    (aud.submissions || []).forEach((entry, order) => {
      const key = resolveKey(merges, entry.key);
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, { key, count: 0, order, pids: [], texts: new Map() });
      const group = byKey.get(key);
      group.count += 1;
      group.pids.push(entry.pid);
      const seen = group.texts.get(entry.text) || { count: 0, key: entry.key };
      group.texts.set(entry.text, { count: seen.count + 1, key: entry.key });
    });
    const rows = [...byKey.values()].map((group) => ({
      key: group.key,
      count: group.count,
      order: group.order,
      pids: group.pids,
      text: bestLabel(group.texts, group.key),
      variants: [...group.texts.keys()],
    }));
    rows.sort((a, b) => (b.count - a.count) || (a.order - b.order));
    return rows;
  }

  /** The three the Super Match pays for, with their money attached. */
  function topThree(state) {
    const values = state.game.settings.audienceValues;
    return groupedAnswers(state).slice(0, 3).map((row, i) => Object.assign({}, row, {
      rank: i,
      value: values[i] === undefined ? 0 : values[i],
    }));
  }

  /** What the Head-to-Head plays for: the audience money, or the smallest prize. */
  function headToHeadBase(state) {
    const values = state.game.settings.audienceValues;
    const won = state.audience ? state.audience.won : 0;
    return won > 0 ? won : Math.min.apply(null, values);
  }

  /** How many people have answered the Audience Match so far. */
  function audienceCount(state) {
    return state.audience ? state.audience.submissions.length : 0;
  }

  /* ============ The phones ============ */

  function seatOf(state, pid) {
    return state.panel.find((p) => p.pid && p.pid === pid) || null;
  }

  function isContestant(state, pid) {
    return !!pid && state.contestants.some((c) => c.pid && c.pid === pid);
  }

  function scoreLine(state) {
    return state.contestants.map((c) => `${c.name} ${c.points}`).join(" · ");
  }

  function panelView(state, seat) {
    const cur = state.current;
    const mine = cur.answers[seat.slot];
    const locked = cur.revealed > 0;
    if (cur.order.indexOf(seat.slot) < 0) {
      return {
        screen: "wait",
        scores: scoreLine(state),
        sub: `${state.contestants[cur.seat].name} already matched you — sit this one out.`,
      };
    }
    return {
      screen: "panel",
      prompt: cur.text,
      hint: cur.hint,
      mine: mine || "",
      sent: !!mine,
      locked,
      seat: seat.slot + 1,
      scores: scoreLine(state),
      sub: locked
        ? "Pencils down — the host is revealing the panel."
        : `Write the funniest answer that fits. ${state.contestants[cur.seat].name} is playing.`,
    };
  }

  function audienceView(state, pid) {
    const mine = (state.audience.submissions.find((s) => s.pid === pid) || {}).text || "";
    return {
      screen: "audience",
      prompt: state.audience.text,
      mine,
      sent: !!mine,
      locked: false,
      scores: scoreLine(state),
      sub: "Audience Match — type the answer you think most people will say.",
    };
  }

  function hthView(state, hth) {
    return {
      screen: "hth",
      prompt: hth.text,
      hint: hth.hint,
      mine: hth.panelText || "",
      sent: !!hth.panelText,
      locked: !!hth.revealed,
      scores: scoreLine(state),
      sub: hth.revealed
        ? "Pencils down — the host is revealing both cards."
        : "Head-to-Head. Write the answer you think they will write.",
    };
  }

  function resultView(state, pid) {
    const mine = state.contestants.find((c) => c.pid && c.pid === pid);
    return {
      screen: "result",
      standings: standings(state).map((row) => ({
        name: row.name, points: row.points, money: moneyText(state, row.money),
      })),
      mine: mine ? `${mine.name} — ${mine.points} points, ${moneyText(state, mine.money)}` : "",
      scores: scoreLine(state),
      sub: "That’s the game. Thanks for playing.",
    };
  }

  const WAIT_LINES = {
    setup: "The host is still setting up.",
    roundScores: "Scores.",
    audience: "Audience Match.",
    audienceBoard: "Audience Match.",
    superChoice: "Super Match coming up.",
    hthPick: "Head-to-Head.",
    hthPrompt: "Head-to-Head.",
    hthResult: "Super Match result.",
  };

  function waitLine(state, seat) {
    if (state.phase === "prompt") return seat ? "Stand by." : "The panel is writing.";
    return has(WAIT_LINES, state.phase) ? WAIT_LINES[state.phase] : "Stand by.";
  }

  /**
   * The ONE view this phone is allowed to see. A panelist gets the prompt and
   * their own answer back; nobody ever receives another seat's answer, and no
   * phone receives the contestant's typed answer before the reveal.
   */
  function phoneView(state, pid) {
    const base = { screen: "wait", scores: "", sub: "" };
    if (!state || !state.contestants) return base;
    base.scores = scoreLine(state);
    if (!pid) return base;
    if (state.phase === "standings") return resultView(state, pid);
    const seat = seatOf(state, pid);
    if (state.phase === "prompt" && state.current && seat) return panelView(state, seat);
    if (state.phase === "audience" && state.audience && state.audience.open
      && !seat && !isContestant(state, pid)) return audienceView(state, pid);
    if (state.phase === "hthPrompt" && state.hth && seat && seat.slot === state.hth.slot) {
      return hthView(state, state.hth);
    }
    return Object.assign(base, { sub: waitLine(state, seat) });
  }

  /**
   * Every frame a phone can send, checked before it can touch state: a known
   * `t`, a string `text` no longer than 40 characters, control chars stripped.
   * @returns {{t:string, text?:string}|null}
   */
  function validatePhoneMsg(raw) {
    if (!isPlainObject(raw) || typeof raw.t !== "string") return null;
    if (raw.t === "ready") return { t: "ready" };
    if (PHONE_MSGS.indexOf(raw.t) < 0) return null;
    if (typeof raw.text !== "string" || raw.text.length > 4000) return null;
    const text = cleanText(raw.text, ANSWER_MAX);
    if (!text) return null;
    return { t: raw.t, text };
  }

  /** May this phone send `t` right now? The reducer re-checks anyway. */
  function phoneMaySend(state, pid, t) {
    const view = phoneView(state, pid);
    if (t === "panel") return view.screen === "panel" && !view.locked;
    if (t === "audience") return view.screen === "audience";
    if (t === "hth") return view.screen === "hth" && !view.locked;
    return false;
  }

  void isIntIn;

  return {
    leader, isTied, standings, moneyText,
    hostCards, answeredCount, liveCard,
    resolveKey, groupedAnswers, topThree, headToHeadBase, audienceCount,
    seatOf, isContestant, scoreLine, phoneView, validatePhoneMsg, phoneMaySend,
    PHONE_MSGS, MERGE_DEPTH,
  };
});

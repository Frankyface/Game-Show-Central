/* ============================================================
   Match Game — the Super Match screens
   The winner's choice, the Audience Match (live collection, the
   top-three board with the host's merge controls, the three
   guesses), and the Head-to-Head (pick a panelist, the
   multiplier spinner, two cards, the host's judgement).

   Split out of mg-view.js so both files stay well under the
   800-line house limit. Same rules: textContent only, and the
   Head-to-Head cards read their text from MgCore, which returns
   nothing until the host turns them over.
   ============================================================ */

"use strict";

const MgSuper = (function () {
  const core = () => window.MgCore;

  const BLOCKS = {
    superChoice: "mg-super-choice",
    audience: "mg-audience-live",
    audienceBoard: "mg-audience-board",
    hthPick: "mg-hth-pick",
    hthPrompt: "mg-hth-play",
    hthResult: "mg-hth-result",
  };

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /* ============ The banner ============ */

  const SUBS = {
    superChoice: "The winner plays for the money.",
    audience: "Audience Match — the room is writing.",
    audienceBoard: "Audience Match — the top three.",
    hthPick: "Head-to-Head — pick a panelist.",
    hthPrompt: "Head-to-Head — both write, then both turn over.",
    hthResult: "Super Match result.",
  };

  function renderBanner(app) {
    const state = app.core;
    const winner = state.contestants[state.winner === null ? 0 : state.winner];
    setText("mg-super-title", "Super Match");
    setText("mg-super-sub", has(SUBS, state.phase) ? SUBS[state.phase] : "");
    setText("mg-super-badge", `${winner.name} — ${core().moneyText(state, winner.money)}`);
  }

  /* ============ 1. the winner's choice ============ */

  function renderChoice(app) {
    const state = app.core;
    const winner = state.contestants[state.winner];
    setText("mg-super-winner", `${winner.name} wins the game`);
  }

  /* ============ 2. collecting from the room ============ */

  function renderLive(app) {
    const state = app.core;
    const n = core().audienceCount(state);
    setText("mg-aud-prompt", state.audience.text);
    setText("mg-aud-count", n === 1 ? "1 answer in" : `${n} answers in`);
    $("btn-aud-close").disabled = n === 0;
    $("btn-aud-undo").disabled = !state.history.length;
  }

  /* ============ 3. the board, the merges, the three guesses ============ */

  function renderBoard(app) {
    const state = app.core;
    setText("mg-board-prompt", state.audience.text);
    const rows = core().groupedAnswers(state);
    const board = core().topThree(state);
    // docs/22 §5.4: with a host phone assigned, the top three's wording stays
    // off this screen until a guess hits a row (or the per-item fallback).
    window.MgHostScreen.renderBoardNote($("mg-board-private"), app, state, board);
    const label = (target) => window.MgHostScreen.targetLabel(app, state, target, board);
    renderTopThree($("mg-board"), state, board, label);
    renderOthers($("mg-others"), board, rows, label);
    renderGuesses($("mg-guesses"), state, board);
    renderPickButtons($("mg-pick-buttons"), state, board);
    setText("mg-pick-state", pickState(state, board));
    $("btn-board-undo").disabled = !state.history.length;
  }

  function renderTopThree(list, state, board, label) {
    list.replaceChildren();
    const done = state.audience.guesses.length > 0;
    board.forEach((row) => {
      const li = el("li", "board-row");
      li.appendChild(el("span", "board-rank", `#${row.rank + 1}`));
      li.appendChild(el("span", `board-answer${label(row) ? " is-private" : ""}`, label(row) ? "Hidden" : row.text));
      li.appendChild(el("span", "board-count", row.count === 1 ? "1 said it" : `${row.count} said it`));
      li.appendChild(el("span", "board-value", core().moneyText(state, row.value)));
      // Two rows of the board can be the same answer said two ways ("map" and
      // "maps"), so a board row can be merged into another board row too.
      if (!done && board.length > 1) li.appendChild(mergeBox(row, board, label));
      list.appendChild(li);
    });
    if (!board.length) list.appendChild(el("li", "hint", "Nobody answered — skip to the Head-to-Head."));
  }

  const MERGE_TARGETS = 5;

  /**
   * "Count this answer as that one" — a button per other answer, most-said
   * first: the three on the board, then the loudest of the rest, so two
   * off-board answers ("a torch" and "flashlight") can be joined as well.
   */
  function mergeBox(row, targets, label) {
    const box = el("span", "merge-box");
    const name = (t) => label(t) || shortLabel(t.text);
    const full = (t) => label(t) || `“${t.text}”`;
    targets.filter((t) => t.key !== row.key).slice(0, MERGE_TARGETS).forEach((target) => {
      // A short label keeps a long answer from squeezing the row (MG-D5); the
      // full wording is in the title. A private row is named by rank only.
      const btn = el("button", "btn btn-ghost btn-small merge-btn", `→ ${name(target)}`);
      btn.type = "button";
      btn.title = `Count ${full(row)} as ${full(target)}`;
      btn.addEventListener("click", () => window.MgApp.merge(row.key, target.key));
      box.appendChild(btn);
    });
    return box;
  }

  function shortLabel(text) {
    return text.length > 16 ? `${text.slice(0, 15)}…` : text;
  }

  /** Everything off the board, each with a "merge into" control per top-three row. */
  function renderOthers(list, board, rows, label) {
    list.replaceChildren();
    const rest = rows.slice(3);
    if (!rest.length) {
      list.appendChild(el("li", "hint", "Nothing else was said."));
      return;
    }
    rest.forEach((row) => {
      const li = el("li", "other-row");
      li.appendChild(el("span", "other-answer", row.text));
      li.appendChild(el("span", "other-count", `×${row.count}`));
      li.appendChild(mergeBox(row, board.concat(rest), label));
      list.appendChild(li);
    });
  }

  const GUESS_WORDS = ["First guess", "Second guess", "Third guess"];

  function renderGuesses(list, state, board) {
    list.replaceChildren();
    for (let i = 0; i < core().MAX_GUESSES; i += 1) {
      const guess = state.audience.guesses[i];
      const li = el("li", `guess-slot${guess ? (guess.hit >= 0 ? " is-hit" : " is-miss") : ""}`);
      li.appendChild(el("span", "guess-label", GUESS_WORDS[i] || `Guess ${i + 1}`));
      li.appendChild(el("span", "guess-text", guess ? (guess.text || "—") : ""));
      li.appendChild(el("span", "guess-result", guessResult(state, guess)));
      list.appendChild(li);
    }
    void board;
  }

  function guessResult(state, guess) {
    if (!guess) return "";
    if (guess.hit < 0) return "no match";
    return `#${guess.hit + 1} — ${core().moneyText(state, guess.value)}`;
  }

  function renderPickButtons(box, state, board) {
    box.replaceChildren();
    const done = state.audience.guesses.length >= core().MAX_GUESSES
      || state.audience.guesses.some((g) => g.hit >= 0);
    board.forEach((row) => {
      const btn = el("button", "btn btn-green", `Matched #${row.rank + 1}`);
      btn.type = "button";
      btn.disabled = done;
      btn.addEventListener("click", () => window.MgApp.audiencePick(row.rank));
      box.appendChild(btn);
    });
    const miss = el("button", "btn btn-danger", "No match");
    miss.type = "button";
    miss.disabled = done || !board.length;
    miss.addEventListener("click", () => window.MgApp.audiencePick(-1));
    box.appendChild(miss);
  }

  function pickState(state, board) {
    if (!board.length) return "No answers came in. Skip to the Head-to-Head.";
    const guesses = state.audience.guesses;
    if (!guesses.length) return "Type what the contestant said, then say which row it matched.";
    const left = core().MAX_GUESSES - guesses.length;
    if (guesses.some((g) => g.hit >= 0)) return "They got it.";
    return left ? `${left} ${left === 1 ? "guess" : "guesses"} left.` : "Out of guesses.";
  }

  /* ============ 4. pick a panelist ============ */

  function renderPick(app) {
    const state = app.core;
    setText("mg-hth-base", `Playing for ${core().moneyText(state, core().headToHeadBase(state))}`
      + " times the multiplier.");
    // Name-only cards: the previous prompt's answers and marks are not shown
    // again on the pick screen (MG-D13).
    const cards = state.panel.map((seat) => ({
      slot: seat.slot, name: seat.name, pid: seat.pid, answered: false, revealed: false,
      text: null, judged: null, locked: false, live: false,
    }));
    window.MgView.renderCards($("mg-hth-cards"), cards, { sig: "pick", pickable: true });
    $("btn-pick-undo").disabled = !state.history.length;
  }

  /* ============ 5. the Head-to-Head ============ */

  function renderPlay(app) {
    const state = app.core;
    const hth = state.hth;
    setText("mg-hth-prompt", hth.text);
    setText("mg-spinner", app.spinning ? "×…" : `×${hth.multiplier}`);
    $("mg-spinner").classList.toggle("is-spinning", !!app.spinning);
    // One spin per Head-to-Head, as on the show (MG-D12).
    $("btn-spin").disabled = !!app.spinning || hth.spun || hth.revealed;
    $("btn-spin").textContent = hth.spun ? "Spun" : "Spin the wheel";
    window.MgView.renderCards($("mg-hth-cards-play"), hthCards(state), { sig: `hth-${hth.index}` });
    show($("mg-hth-form"), !hth.contestantText);
    // No phone on that seat: the host types the panelist's card too (MG-D1).
    const seat = state.panel[hth.slot];
    const phoneless = window.MgHostScreen.phoneless(app, seat.pid);
    show($("mg-hth-panel-form"), !hth.panelText && phoneless);
    setText("mg-hth-panel-label", `What ${seat.name} wrote`);
    // Typing is masked whenever a host phone is assigned (docs/22 §5.4).
    const masked = app.hideTyping || app.answersPrivate;
    $("mg-hth-panel-text").type = masked ? "password" : "text";
    $("mg-hth-text").type = masked ? "password" : "text";
    setText("mg-hth-state", hthState(state, hth));
    $("btn-hth-reveal").disabled = hth.revealed || !hth.panelText || !hth.contestantText;
    $("btn-hth-match").disabled = !hth.revealed;
    $("btn-hth-no").disabled = !hth.revealed;
    $("btn-hth-undo").disabled = !state.history.length;
  }

  /** Two cards only: the chosen panelist's and the contestant's. */
  function hthCards(state) {
    const hth = state.hth;
    const seat = state.panel[hth.slot];
    return [
      { slot: hth.slot, name: seat.name, answered: !!hth.panelText, revealed: !!hth.revealed,
        text: hth.revealed ? hth.panelText : null, judged: hth.match, locked: false, live: false },
      { slot: -1, name: state.contestants[state.winner].name, answered: !!hth.contestantText,
        revealed: !!hth.revealed, text: hth.revealed ? hth.contestantText : null,
        judged: hth.match, locked: false, live: false },
    ];
  }

  function hthState(state, hth) {
    if (hth.revealed) return "Same idea? Press Match.";
    const waiting = [];
    if (!hth.panelText) waiting.push(state.panel[hth.slot].name);
    if (!hth.contestantText) waiting.push(state.contestants[state.winner].name);
    if (waiting.length) return `Waiting for ${waiting.join(" and ")}.`;
    return "Both cards are in. Turn them over.";
  }

  /* ============ 6. the result ============ */

  function renderResult(app) {
    const state = app.core;
    const hth = state.hth;
    const winner = state.contestants[state.winner];
    setText("mg-result-kicker", hth.match ? "Head-to-Head: a match" : "Head-to-Head: no match");
    setText("mg-result-name", winner.name);
    setText("mg-result-amount", core().moneyText(state, hth.won));
    setText("mg-result-sub", hth.match
      ? `${core().moneyText(state, hth.base)} × ${hth.multiplier} — and `
        + `${core().moneyText(state, winner.money)} on the night.`
      : `No match, so the Head-to-Head pays nothing. ${winner.name} keeps `
        + `${core().moneyText(state, winner.money)}.`);
    $("btn-result-undo").disabled = !state.history.length;
  }

  /* ============ The whole Super Match screen ============ */

  const RENDERERS = {
    superChoice: renderChoice,
    audience: renderLive,
    audienceBoard: renderBoard,
    hthPick: renderPick,
    hthPrompt: renderPlay,
    hthResult: renderResult,
  };

  function render(app) {
    const phase = app.core.phase;
    Object.keys(BLOCKS).forEach((key) => show($(BLOCKS[key]), key === phase));
    renderBanner(app);
    if (has(RENDERERS, phase)) RENDERERS[phase](app);
  }

  return { render, hthCards, BLOCKS };
})();

window.MgSuper = MgSuper;

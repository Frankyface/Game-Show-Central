/* ============================================================
   Family Feud — Fast Money host screen (spec 03 §3.3)
   The five-row answer sheet, the red-block cue timer, per-row
   reveal, duplicate detection and the win/lose flourish. Rules
   still live in FeudCore; this file types answers into the reducer
   and paints what comes back. Player 1's column is hidden while
   player 2 is answering — the host screen is on the shared screen.
   ============================================================ */

"use strict";

const FeudFM = (function () {
  const { $, el, button, show, group } = window.FeudApp.helpers;

  /** Host's override of which team plays Fast Money (null = the leader). */
  let teamChoice = null;
  /** Slot+question of the most recent duplicate, so we flash it once. */
  let lastDuplicate = "";

  const S = () => window.FeudApp.getState();
  const core = () => window.FeudCore;

  /* ============ Starting Fast Money ============ */

  /** A picker for the round-over screen: which team goes to Fast Money. */
  function teamPicker() {
    const state = S();
    if (!state || !state.fastMoneyEnabled) return null;
    const box = group("Fast Money team");
    const select = el("select", "fm-team-select");
    select.setAttribute("aria-label", "Team playing Fast Money");
    const leader = state.teams[1].score > state.teams[0].score ? 1 : 0;
    [["Leading team", null], [state.teams[0].name, 0], [state.teams[1].name, 1]]
      .forEach(([label, value]) => {
        const option = el("option", null, value === null ? `${label} (${state.teams[leader].name})` : label);
        option.value = value === null ? "" : String(value);
        select.appendChild(option);
      });
    select.value = teamChoice === null ? "" : String(teamChoice);
    select.addEventListener("change", () => {
      teamChoice = select.value === "" ? null : Number.parseInt(select.value, 10);
    });
    box.appendChild(select);
    return box;
  }

  /** Move to the Fast Money screen with two players seated. */
  function begin() {
    const state = S();
    if (!state) return;
    const team = teamChoice === null
      ? (state.teams[1].score > state.teams[0].score ? 1 : 0)
      : teamChoice;
    const roster = state.teams[team].players;
    window.FeudApp.dispatch({
      type: "beginFastMoney",
      team,
      players: [roster[0] || null, roster[1] || null],
    });
  }

  /* ============ Render ============ */

  function render() {
    const state = S();
    const fm = state.fastMoney;
    $("fm-banner").textContent = bannerText(state);
    show($("fm-cover"), fm.stage === "cover");
    show($("fm-table"), fm.stage !== "cover");
    // The table is rebuilt on every keystroke (each one is a reducer event), so
    // remember where the host's cursor was and put it back afterwards.
    const focused = document.activeElement;
    const focusId = focused && focused.id && focused.id.indexOf("fm-input-") === 0 ? focused.id : null;
    const caret = focusId ? focused.selectionStart : null;
    renderTable(state);
    restoreFocus(focusId, caret);
    renderTotals(state);
    renderResult(state);
    renderControls(state);
    syncTimer(state);
  }

  function restoreFocus(focusId, caret) {
    if (!focusId) return;
    const node = $(focusId);
    if (!node) return;
    node.focus();
    if (caret !== null && caret !== undefined) {
      try {
        node.setSelectionRange(caret, caret);
      } catch (err) {
        console.warn("Could not restore the cursor position:", err);
      }
    }
  }

  function bannerText(state) {
    const fm = state.fastMoney;
    const who = `Player ${fm.slot}`;
    if (fm.stage === "cover") return "Fast Money — swap players";
    if (fm.stage === "done") return "Fast Money — the result";
    if (fm.stage === "reveal") return `Fast Money — ${who}: survey says…`;
    return `Fast Money — ${who} (${playerName(state, fm.slot)})`;
  }

  function playerName(state, slot) {
    const pid = state.fastMoney.players[slot - 1];
    if (!pid) return "typed by the host";
    const player = state.roster.find((p) => p.pid === pid);
    return player ? player.name : pid;
  }

  function renderTable(state) {
    const host = $("fm-table");
    host.replaceChildren();
    const fm = state.fastMoney;
    if (fm.slot === 2 && fm.stage !== "play") host.appendChild(previousStrip(state));
    host.appendChild(headRow());
    core().fmQuestions(state).forEach((question, index) => {
      host.appendChild(answerRow(state, question, index));
    });
  }

  function headRow() {
    const head = el("div", "fm-head");
    ["Question", "What they said", "Board answer", "Points"].forEach((label) => {
      head.appendChild(el("span", null, label));
    });
    return head;
  }

  /** Player 1's finished sheet, shown once they are done (never during play). */
  function previousStrip(state) {
    const box = el("div", "fm-row");
    box.appendChild(el("span", "fm-question", `${playerName(state, 1)} scored`));
    const rows = state.fastMoney.rows[1];
    const said = rows.filter((r) => r.revealed && !r.duplicate).length;
    box.appendChild(el("span", null, `${said} of 5 on the board`));
    box.appendChild(el("span", null, ""));
    box.appendChild(el("span", "fm-points", String(slotTotal(state, 1))));
    return box;
  }

  function slotTotal(state, slot) {
    return state.fastMoney.rows[slot].reduce((t, r) => t + (r.revealed ? r.points : 0), 0);
  }

  function answerRow(state, question, index) {
    const fm = state.fastMoney;
    const row = fm.rows[fm.slot][index];
    const node = el("div", `fm-row${row.duplicate ? " duplicate" : ""}`);
    node.appendChild(el("span", "fm-question", question.question));
    node.appendChild(answerCell(state, index, row));
    node.appendChild(revealCell(state, question, index, row));
    const points = el("span", "fm-points", row.revealed ? String(row.points) : "—");
    node.appendChild(points);
    return node;
  }

  /** The typed answer: an input while answering, plain text once revealed. */
  function answerCell(state, index, row) {
    if (row.revealed) {
      const cell = el("span", null, row.text || "(no answer)");
      if (row.duplicate) cell.appendChild(el("span", "fm-dup-flag", " Try again — duplicate"));
      return cell;
    }
    const input = el("input");
    input.id = `fm-input-${state.fastMoney.slot}-${index}`;
    input.type = "text";
    input.maxLength = 60;
    input.autocomplete = "off";
    input.value = row.text;
    input.placeholder = `Answer ${index + 1}`;
    input.setAttribute("aria-label", `What player ${state.fastMoney.slot} said for question ${index + 1}`);
    input.addEventListener("input", () => {
      window.FeudApp.dispatch({
        type: "fmAnswer", slot: state.fastMoney.slot, q: index, text: input.value,
      });
    });
    return input;
  }

  /** The board-answer picker, only meaningful in the reveal stage. */
  function revealCell(state, question, index, row) {
    const fm = state.fastMoney;
    if (row.revealed) {
      const chosen = row.answerIndex === null ? "No match" : question.answers[row.answerIndex].text;
      return el("span", null, chosen);
    }
    if (fm.stage !== "reveal") return el("span", null, "");
    const select = el("select");
    select.setAttribute("aria-label", `Board answer for question ${index + 1}`);
    const blank = el("option", null, "Pick the board answer…");
    blank.value = "";
    select.appendChild(blank);
    question.answers.forEach((answer, i) => {
      const option = el("option", null, `${answer.text} — ${answer.count}`);
      option.value = String(i);
      select.appendChild(option);
    });
    const none = el("option", null, "No match → 0");
    none.value = "none";
    select.appendChild(none);
    select.addEventListener("change", () => {
      if (select.value === "") return;
      revealRow(index, select.value === "none" ? null : Number.parseInt(select.value, 10));
    });
    return select;
  }

  function revealRow(index, answerIndex) {
    const state = S();
    const slot = state.fastMoney.slot;
    window.FeudApp.dispatch({ type: "fmReveal", slot, q: index, answerIndex });
    const after = S().fastMoney.rows[slot][index];
    const key = `${slot}-${index}`;
    if (after.duplicate && lastDuplicate !== key) {
      lastDuplicate = key;
      window.FeudSound?.play("tryAgain");
    } else if (!after.duplicate && after.points > 0) {
      window.FeudSound?.play("ding");
    }
  }

  function renderTotals(state) {
    $("fm-total").textContent = String(core().fmTotal(state));
    $("fm-target").textContent = `of ${state.game.settings.fastMoney.target} to win`;
  }

  function renderResult(state) {
    const fm = state.fastMoney;
    const node = $("fm-result");
    node.className = "fm-result";
    if (fm.stage !== "done") {
      node.textContent = "";
      return;
    }
    if (fm.winner) {
      node.classList.add("win");
      node.textContent = `Winner! ${state.teams[fm.team].name} takes the grand prize.`;
    } else {
      node.classList.add("lose");
      node.textContent = "So close — no grand prize this time.";
    }
  }

  /* ============ Controls ============ */

  function renderControls(state) {
    const host = $("fm-controls");
    host.replaceChildren();
    const fm = state.fastMoney;
    if (fm.stage === "play") playControls(state).forEach((n) => host.appendChild(n));
    else if (fm.stage === "reveal") host.appendChild(revealControls(state));
    else if (fm.stage === "cover") host.appendChild(coverControls());
    else if (fm.stage === "done") host.appendChild(doneControls());
  }

  function playControls(state) {
    const fm = state.fastMoney;
    const seconds = clockSeconds(state);
    const clock = group(seconds > 0 ? `Clock (${seconds}s)` : "Clock");
    if (seconds > 0) {
      clock.appendChild(button("btn btn-gold", fm.timer.running ? "Restart timer" : "Start timer",
        () => window.FeudApp.dispatch({ type: "fmTimer", action: "start", now: Date.now() })));
      clock.appendChild(button("btn btn-ghost btn-small", "Stop",
        () => window.FeudApp.dispatch({ type: "fmTimer", action: "stop" })));
    } else {
      // A timer of 0 is legal content meaning "no clock" — say so rather than
      // render a Start button that could never do anything.
      clock.appendChild(el("span", "control-note",
        "No clock — this question file sets the timer to 0."));
    }
    const next = group("When they're done");
    next.appendChild(button("btn btn-gold btn-big", "Lock in — reveal the answers",
      () => window.FeudApp.dispatch({ type: "fmAdvance" })));
    return [clock, next];
  }

  function clockSeconds(state) {
    const settings = state.game.settings.fastMoney;
    return state.fastMoney.slot === 1 ? settings.timer1 : settings.timer2;
  }

  function revealControls(state) {
    const fm = state.fastMoney;
    const left = fm.rows[fm.slot].filter((r) => !r.revealed).length;
    const box = group(left ? `${left} still to reveal` : "All revealed");
    const label = fm.slot === 1 ? "Bring in player 2" : "Show the result";
    box.appendChild(button("btn btn-gold btn-big", label,
      () => window.FeudApp.dispatch({ type: "fmAdvance" }), { disabled: left > 0 }));
    return box;
  }

  function coverControls() {
    const box = group("Player 2");
    box.appendChild(button("btn btn-gold btn-big", "Player 2 is ready",
      () => window.FeudApp.dispatch({ type: "fmAdvance" })));
    return box;
  }

  function doneControls() {
    const box = group("Fast Money over");
    box.appendChild(button("btn btn-gold btn-big", "Final standings",
      () => window.FeudApp.dispatch({ type: "finish" })));
    return box;
  }

  /* ============ Timer cue ============ */

  function syncTimer(state) {
    const timer = state.fastMoney.timer;
    const running = timer.running && state.fastMoney.stage === "play";
    const key = running ? `fm-${timer.slot}-${timer.startedAt}` : null;
    const elapsed = running ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0;
    window.FeudTimer?.sync("host", key, Math.max(timer.seconds - elapsed, 0), timer.seconds);
  }

  /** Play the fanfare exactly once, when the result first lands. */
  let fanfarePlayed = false;
  function onPhaseTick() {
    const state = S();
    if (!state || state.phase !== "fastmoney") {
      fanfarePlayed = false;
      return;
    }
    if (state.fastMoney.stage === "done" && state.fastMoney.winner && !fanfarePlayed) {
      fanfarePlayed = true;
      window.FeudSound?.play("fanfare");
    }
  }

  return {
    begin,
    teamPicker,
    render: () => { render(); onPhaseTick(); },
  };
})();

window.FeudFM = FeudFM;

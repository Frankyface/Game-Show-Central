/* ============================================================
   Wheel of Fortune — phone controller (spec 04 §5)
   A thin renderer: it paints the `view` the host sent and posts
   intents back. It never scores, never advances a round and
   never decides what is legal — the buttons it enables come
   straight from the host's legalActions, and the host validates
   everything again on arrival. Works at 320 px portrait.
   ============================================================ */

"use strict";

(function () {
  const $ = (id) => document.getElementById(id);
  const show = (node, visible) => { if (node) node.classList.toggle("hidden", !visible); };
  const core = () => window.WheelCore;

  let me = null;
  let view = null;
  let bonusPicks = [];
  let connected = true;
  let composing = false; // the player tapped Solve and is typing

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const send = (msg) => { if (me) me.send(msg); };

  /* ============ Rendering ============ */

  function screens(name) {
    for (const id of ["p-wait", "p-turn", "p-solve", "p-tossup", "p-bonus", "p-result"]) {
      show($(id), id === `p-${name}`);
    }
  }

  function render() {
    if (!view) {
      $("p-banner").textContent = connected ? "Waiting for the host…" : "Reconnecting…";
      screens("wait");
      return;
    }
    $("p-name").textContent = view.name || (me ? me.name : "");
    $("p-money").textContent = `${core().formatMoney(view.round)} · ${core().formatMoney(view.total)} banked`;
    $("p-banner").textContent = connected ? view.banner : "Reconnecting…";
    $("p-category").textContent = view.category || "";
    renderBoard(view.board);
    if (composing && view.screen === "turn") { renderSolve(); return; }
    composing = false;
    if (view.screen === "turn") renderTurn();
    else if (view.screen === "solve") renderSolve();
    else if (view.screen === "tossup") renderTossup();
    else if (view.screen === "bonus") renderBonus();
    else if (view.screen === "result") renderResult();
    else renderWait();
  }

  function renderBoard(board) {
    const node = $("p-board");
    node.replaceChildren();
    if (!board || !board.rows.length) return;
    for (const row of board.rows) {
      const rowNode = el("div", "p-board-row");
      for (const cell of row) {
        rowNode.appendChild(el("span", cell ? "p-tile" : "p-tile blank", cell && cell.revealed ? cell.ch : ""));
      }
      node.appendChild(rowNode);
    }
  }

  function renderWait() {
    screens("wait");
    $("p-wait-text").textContent = view.turnName
      ? `${view.turnName} is playing. Sit tight.` : "Waiting for the host…";
  }

  function renderTurn() {
    screens("turn");
    const actions = view.actions;
    show($("p-btn-spin"), actions.spin);
    show($("p-btn-vowel"), actions.buyVowel);
    show($("p-btn-solve"), actions.solve);
    $("p-btn-vowel").textContent = `Buy a vowel (${core().formatMoney(view.vowelCost)})`;
    $("p-wedge").textContent = view.wedge
      ? `${core().formatMoney(view.wedge.value)} — pick a consonant` : "";
    renderKeys($("p-keyboard"), actions.letters, (letter) => send({ t: "letter", letter }));
  }

  // Looked up per render, not captured at build time — the buttons outlive the
  // handler (the bonus keypad's picker changes as letters are chosen).
  const keyHandlers = new WeakMap();

  function renderKeys(node, allowed, onPick) {
    const letters = core().ALPHABET.split("");
    keyHandlers.set(node, onPick);
    if (node.children.length !== letters.length) {
      node.replaceChildren();
      for (const letter of letters) {
        const button = el("button", "key", letter);
        button.type = "button";
        button.dataset.letter = letter;
        button.addEventListener("click", () => {
          const handler = keyHandlers.get(node);
          if (!button.disabled && handler) handler(button.dataset.letter);
        });
        node.appendChild(button);
      }
    }
    const ok = new Set(allowed);
    show(node, allowed.length > 0);
    for (const button of node.children) {
      button.disabled = !ok.has(button.dataset.letter);
      button.classList.toggle("key-vowel", core().isVowel(button.dataset.letter));
    }
  }

  function renderSolve() {
    screens("solve");
    $("p-btn-solve-send").disabled = !!view.submitted;
    show($("p-btn-solve-back"), composing && !view.submitted);
    $("p-note").textContent = view.submitted
      ? "Sent — the host is judging." : "The host will judge it.";
  }

  function renderTossup() {
    screens("tossup");
    const button = $("p-btn-buzz");
    button.classList.toggle("armed", !!view.armed);
    button.classList.toggle("mine", !!view.mine);
    button.classList.toggle("locked", !!view.locked);
    button.disabled = !view.armed;
    button.textContent = view.mine ? "SAY IT!" : view.locked ? "LOCKED OUT" : view.armed ? "BUZZ" : "WAIT";
  }

  function renderBonus() {
    screens("bonus");
    const picked = !!view.picked;
    $("p-bonus-picks").textContent = (picked ? view.picks : bonusPicks).join(" ") || "R S T L N E free";
    const need = bonusPicks.length < 3 ? view.consonants : view.vowels;
    const left = picked ? [] : need.filter((L) => !bonusPicks.includes(L));
    renderKeys($("p-bonus-keys"), bonusPicks.length >= 4 ? [] : left, (letter) => {
      if (bonusPicks.length >= 4) return;
      bonusPicks = [...bonusPicks, letter];
      render();
    });
    show($("p-btn-bonus-send"), !picked);
    show($("p-btn-bonus-clear"), !picked && bonusPicks.length > 0);
    $("p-btn-bonus-send").disabled = bonusPicks.length !== 4;
    if (window.WheelTimer) {
      window.WheelTimer.sync("phoneBonus", picked && !view.result ? "bonus" : null, view.seconds);
    }
  }

  function renderResult() {
    screens("result");
    const list = $("p-standings");
    list.replaceChildren();
    view.standings.forEach((player, i) => {
      const row = el("li", i === 0 ? "final-row final-win" : "final-row");
      row.appendChild(el("span", "final-name", player.name));
      row.appendChild(el("span", "final-money", core().formatMoney(player.total)));
      list.appendChild(row);
    });
  }

  /* ============ Wiring ============ */

  function wire() {
    $("p-btn-spin").addEventListener("click", () => send({ t: "spin" }));
    $("p-btn-vowel").addEventListener("click", () => send({ t: "buy-vowel" }));
    $("p-btn-solve").addEventListener("click", () => { composing = true; render(); $("p-solve-input").focus(); });
    $("p-btn-solve-back").addEventListener("click", () => { composing = false; render(); });
    $("p-btn-solve-send").addEventListener("click", () => {
      const text = $("p-solve-input").value.trim();
      if (!text) return;
      send({ t: "solve", text });
      composing = false;
      $("p-solve-input").value = "";
      $("p-note").textContent = "Sent — the host is judging.";
      $("p-btn-solve-send").disabled = true;
    });
    $("p-btn-buzz").addEventListener("click", () => send({ t: "buzz" }));
    $("p-btn-bonus-clear").addEventListener("click", () => { bonusPicks = []; render(); });
    $("p-btn-bonus-send").addEventListener("click", () => {
      if (bonusPicks.length !== 4) return;
      send({ t: "bonus-pick", letters: bonusPicks });
      bonusPicks = [];
    });
  }

  /* ============ Boot ============ */

  async function boot() {
    if (!window.GSC || !window.GSC.mode.endsWith("-player")) return;
    document.body.classList.add("player-mode");
    if (window.GSC.mode === "embed-player") document.body.classList.add("gsc-embedded");
    show($("player"), true);
    wire();
    render();
    try {
      me = await window.GSC.player({
        onMessage(msg) {
          if (!msg || typeof msg !== "object" || msg.t !== "view") return;
          const wasPicked = view && view.picked;
          view = msg;
          if (view.picked && !wasPicked) bonusPicks = [];
          render();
        },
        onStatus(up) { connected = !!up; render(); },
      });
    } catch (err) {
      console.warn("Could not join the room:", err);
      $("p-banner").textContent = `Could not join: ${err.message}`;
      return;
    }
    $("p-name").textContent = me.name;
    render();
    window.WheelPhone = { me, getView: () => view, render };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());

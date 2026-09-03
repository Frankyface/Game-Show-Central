/* ============================================================
   Wheel of Fortune — DOM builders for the host screen
   Dumb renderers: they take a selector result from WheelCore and
   paint it. No game rules, no state, no transport. Split out of
   wheel-app.js to keep both files under the 800-line house limit.
   Everything is built with createElement + textContent, never from
   markup text. Browser only; exported as window.WheelView.
   ============================================================ */

"use strict";

const WheelView = (function () {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const VOWELS = "AEIOU";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const money = (n) => (window.WheelCore ? window.WheelCore.formatMoney(n) : `$${n}`);

  /* ============ Puzzle board ============ */

  /**
   * Paint the 12/14/14/12 board. The tile elements are rebuilt only when the
   * round changes (`key`); within a round tiles are updated in place so a
   * newly revealed one can flip. Every tile stays on screen all round — that
   * is what makes the board read as the TV board.
   */
  function renderBoard(node, view, key) {
    if (!node) return;
    if (node.dataset.boardKey !== key) {
      node.replaceChildren();
      node.dataset.boardKey = key;
      view.rows.forEach((row, r) => {
        const rowNode = el("div", "board-row");
        rowNode.dataset.row = String(r);
        row.forEach((cell, c) => {
          const tile = el("div", cell ? "tile" : "tile tile-blank");
          tile.dataset.cell = `${r}-${c}`;
          rowNode.appendChild(tile);
        });
        node.appendChild(rowNode);
      });
    }
    view.rows.forEach((row, r) => {
      const rowNode = node.children[r];
      if (!rowNode) return;
      row.forEach((cell, c) => {
        const tile = rowNode.children[c];
        if (!tile) return;
        if (!cell) return;
        const was = tile.classList.contains("tile-on");
        tile.textContent = cell.revealed ? cell.ch : "";
        tile.classList.toggle("tile-punct", cell.revealed && !cell.letter);
        if (cell.revealed && !was) {
          tile.classList.add("tile-on", "tile-flip");
        } else if (!cell.revealed && was) {
          tile.classList.remove("tile-on", "tile-flip");
        }
      });
    });
  }

  /* ============ Used letters (A-Z tracker) ============ */

  function renderUsed(node, used) {
    if (!node) return;
    if (node.children.length !== ALPHABET.length) {
      node.replaceChildren();
      for (const letter of ALPHABET) {
        const chip = el("span", VOWELS.includes(letter) ? "used-chip used-vowel" : "used-chip", letter);
        chip.dataset.letter = letter;
        node.appendChild(chip);
      }
    }
    const taken = new Set(used);
    for (const chip of node.children) {
      chip.classList.toggle("is-used", taken.has(chip.dataset.letter));
    }
  }

  /* ============ On-screen keyboard ============ */

  // The buttons are built once and reused, so the click handler is looked up
  // per render instead of captured at build time — otherwise the bonus round
  // would still be running the regular round's "call a letter" handler.
  const keyHandlers = new WeakMap();

  /**
   * A-Z buttons. `allowed` is the legalActions letter list, so a used letter
   * or a vowel after a spin is disabled by exactly the same rule the phones use.
   */
  function renderKeyboard(node, allowed, onPick) {
    if (!node) return;
    keyHandlers.set(node, onPick);
    if (node.children.length !== ALPHABET.length) {
      node.replaceChildren();
      for (const letter of ALPHABET) {
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
    for (const button of node.children) {
      button.disabled = !ok.has(button.dataset.letter);
      button.classList.toggle("key-vowel", VOWELS.includes(button.dataset.letter));
    }
  }

  /* ============ Podiums ============ */

  function podiumCard(player, phone, onClick) {
    const card = el("button", "podium");
    card.type = "button";
    card.dataset.pid = player.pid;
    card.classList.toggle("podium-active", player.active);
    card.classList.toggle("podium-locked", player.locked);
    card.classList.toggle("podium-buzzed", player.buzzed);
    const name = el("span", "podium-name", player.name);
    if (phone) name.appendChild(el("span", "podium-phone", " \u{1F4F1}"));
    card.appendChild(name);
    card.appendChild(el("span", "podium-round", money(player.round)));
    const total = el("span", "podium-total");
    total.appendChild(el("span", "podium-total-label", "Total "));
    total.appendChild(el("span", "podium-total-value", money(player.total)));
    card.appendChild(total);
    if (player.leader) card.appendChild(el("span", "podium-leader", "LEADER"));
    card.addEventListener("click", () => onClick(player.pid));
    return card;
  }

  function renderPodiums(node, players, phonePids, onClick) {
    if (!node) return;
    node.replaceChildren();
    for (const player of players) {
      node.appendChild(podiumCard(player, phonePids.has(player.pid), onClick));
    }
    if (!players.length) node.appendChild(el("p", "setup-hint", "No players yet."));
  }

  /* ============ Setup player list ============ */

  function renderPlayerList(node, players, phonePids, onRemove) {
    if (!node) return;
    node.replaceChildren();
    if (!players.length) {
      node.appendChild(el("li", "setup-hint", "Add at least one player to start."));
      return;
    }
    for (const player of players) {
      const row = el("li", "player-row");
      const phone = phonePids.has(player.pid);
      row.appendChild(el("span", "player-row-name", player.name + (phone ? " \u{1F4F1}" : "")));
      if (!phone) {
        const drop = el("button", "btn btn-ghost btn-small", "Remove");
        drop.type = "button";
        drop.addEventListener("click", () => onRemove(player.pid));
        row.appendChild(drop);
      } else {
        row.appendChild(el("span", "setup-hint", "on a phone"));
      }
      node.appendChild(row);
    }
  }

  /* ============ Standings ============ */

  function renderStandings(node, standings) {
    if (!node) return;
    node.replaceChildren();
    standings.forEach((player, i) => {
      const row = el("li", i === 0 ? "final-row final-win" : "final-row");
      row.appendChild(el("span", "final-name", player.name));
      row.appendChild(el("span", "final-money", money(player.total)));
      node.appendChild(row);
    });
    if (!standings.length) node.appendChild(el("li", "setup-hint", "Nobody played."));
  }

  return { el, money, renderBoard, renderUsed, renderKeyboard, renderPodiums, renderPlayerList, renderStandings };
})();

window.WheelView = WheelView;

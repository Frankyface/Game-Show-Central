/* ============================================================
   Wheel of Fortune — the host phone's screen (docs/22 §5.3, §5.7)
   Renders the view the laptop handed the hub (WheelSelect.hostView)
   on a phone whose role is "host": a small "Host" header, the
   round and category, the solution laid out like the board (tiles
   still face-down on the shared screen are marked), the answer in
   the accent, the letters still hidden, and what comes next.
   Read-only: it sends nothing and has no buttons in v1. Built
   with createElement + textContent only.
   Browser only; exported as window.WheelHostCard.
   ============================================================ */

"use strict";

const WheelHostCard = (function () {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const money = (n) => (window.WheelCore ? window.WheelCore.formatMoney(n) : `$${n}`);

  /** The solution on a miniature board: every letter, hidden ones marked. */
  function board(rows) {
    const wrap = el("div", "hc-board");
    wrap.setAttribute("aria-hidden", "true"); // the answer line below carries it as text
    for (const row of rows || []) {
      const line = el("div", "hc-board-row");
      for (const cell of row) {
        if (!cell) { line.appendChild(el("span", "hc-tile hc-blank")); continue; }
        line.appendChild(el("span", cell.shown ? "hc-tile" : "hc-tile hc-hidden", cell.ch));
      }
      wrap.appendChild(line);
    }
    return wrap;
  }

  function line(label, value) {
    const p = el("p", "hc-line");
    p.appendChild(el("span", "hc-label", `${label} `));
    p.appendChild(el("span", "hc-value", value));
    return p;
  }

  /** Round-specific detail under the answer. */
  function details(view) {
    const out = [];
    if (view.turn) out.push(line(view.roundType === "bonus" ? "Playing:" : "On turn:", view.turn));
    if (view.wedge !== null && view.wedge !== undefined) {
      out.push(line("Wedge:", typeof view.wedge === "number" ? money(view.wedge) : String(view.wedge)));
    }
    if (view.solving) out.push(line("They said:", view.solving));
    if (view.roundType === "tossup") {
      out.push(line("Worth:", money(view.value || 0)));
      if (view.buzzed) out.push(line("Buzzed:", view.buzzed));
    }
    if (view.roundType === "bonus") {
      out.push(line("Prize:", view.prize || ""));
      if (view.picks && view.picks.length) out.push(line("Picked:", view.picks.join(" ")));
    }
    const hidden = Array.isArray(view.hidden) ? view.hidden : [];
    out.push(line("Still hidden:", hidden.length ? hidden.join(" ") : "none — the board is full"));
    return out;
  }

  function next(view) {
    if (!view.next) return null;
    const box = el("div", "hc-next");
    box.appendChild(el("p", "hc-next-head",
      `Up next — ${view.next.label} ${view.next.number}: ${view.next.category}`));
    box.appendChild(el("p", "hc-next-answer", view.next.solution));
    return box;
  }

  /**
   * Paint `view` into `host`. `connected` false dims the card and says the
   * view may be stale (docs/22 §5.7).
   */
  function render(host, view, connected) {
    if (!host) return;
    host.replaceChildren();
    host.classList.toggle("hc-stale", connected === false);
    host.appendChild(el("p", "hc-top", "Host · Wheel of Fortune"));
    if (connected === false) host.appendChild(el("p", "hc-stale-note", "Reconnecting — this may be out of date"));
    if (!view) { host.appendChild(el("p", "hc-empty", "Waiting for the laptop…")); return; }
    if (view.tooBig) {
      host.appendChild(el("p", "hc-empty", "Too much to show — use the button on the laptop"));
      return;
    }
    if (!view.secret) {
      host.appendChild(el("p", "hc-empty", "Nothing secret right now"));
      host.appendChild(el("p", "hc-phase", view.phaseLabel || ""));
      const upcoming = next(view);
      if (upcoming) host.appendChild(upcoming);
      return;
    }
    host.appendChild(el("p", "hc-item",
      `${view.roundLabel} ${view.roundNumber} of ${view.roundCount} · ${view.category}`));
    host.appendChild(board(view.rows));
    host.appendChild(el("p", "hc-answer", view.solution));
    for (const node of details(view)) host.appendChild(node);
    const upcoming = next(view);
    if (upcoming) host.appendChild(upcoming);
  }

  return { render };
})();

window.WheelHostCard = WheelHostCard;

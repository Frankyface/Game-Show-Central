/* ============================================================
   The Chase — the board (DOM only)
   Draws the lit slabs from the Chaser's top step down to HOME
   and slides the two markers between them. The rungs are rebuilt
   only when the board's shape changes; the markers move by
   setting one inline `top` percentage, so the browser animates
   the slide (and does not, under prefers-reduced-motion, because
   the transition lives inside the no-preference guard in
   css/chase.css).

   Colour is never the only signal: the contestant's marker
   carries their initial and the word "you", the Chaser's carries
   a chevron and the Chaser's name.
   ============================================================ */

"use strict";

(function (root) {
  /** How tall one rung is as a share of the board, given `steps` rungs + HOME. */
  function rowPercent(steps) {
    return 100 / (steps + 1);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** The signature of a board layout: rebuild only when this changes. */
  function shapeKey(view) {
    return `${view.steps}|${view.name}|${view.chaserName}`;
  }

  function buildRungs(box, view) {
    const rungs = el("div", "board-rungs");
    view.rows.forEach((row) => {
      const rung = el("div", `board-rung${row.home ? " is-home" : ""}`);
      rung.dataset.pos = String(row.pos);
      rung.appendChild(el("span", "rung-num", row.home ? "HOME" : String(row.pos)));
      rung.appendChild(el("span", "rung-bar"));
      rungs.appendChild(rung);
    });
    box.appendChild(rungs);
  }

  function buildMarker(box, kind, label, note) {
    const marker = el("div", `board-marker marker-${kind}`);
    marker.appendChild(el("span", "marker-glyph", label));
    marker.appendChild(el("span", "marker-name", note));
    box.appendChild(marker);
    return marker;
  }

  function initial(name) {
    const clean = String(name || "").trim();
    return clean ? clean.slice(0, 1).toUpperCase() : "?";
  }

  /**
   * Paint `view` (ChaseCore.board output) into `box`.
   * @param {HTMLElement} box @param {object} view
   */
  function render(box, view) {
    if (!box || !view) return;
    const key = shapeKey(view);
    if (box.dataset.shape !== key) {
      box.replaceChildren();
      box.dataset.shape = key;
      buildRungs(box, view);
      buildMarker(box, "contestant", initial(view.name), view.name);
      buildMarker(box, "chaser", initial(view.chaserName), view.chaserName);
    }
    const pct = rowPercent(view.steps);
    const rungs = box.querySelectorAll(".board-rung");
    rungs.forEach((rung) => {
      const pos = Number(rung.dataset.pos);
      rung.classList.toggle("is-live", pos <= view.chaser && pos >= view.contestant);
      rung.classList.toggle("is-taken", pos > view.contestant && pos >= view.chaser);
    });
    place(box.querySelector(".marker-contestant"), view.steps, view.contestant, pct);
    place(box.querySelector(".marker-chaser"), view.steps, view.chaser, pct);
    box.classList.toggle("is-caught", view.outcome === "caught");
    box.classList.toggle("is-home", view.outcome === "home");
    box.setAttribute("aria-label", describe(view));
  }

  function place(marker, steps, pos, pct) {
    if (!marker) return;
    marker.style.top = `${(steps - pos) * pct}%`;
    marker.style.height = `${pct}%`;
  }

  /** The board in words, for a screen reader and for the harness. */
  function describe(view) {
    if (view.outcome === "caught") return `${view.name} has been caught by ${view.chaserName}.`;
    if (view.outcome === "home") return `${view.name} is home with ${view.amount}.`;
    return `${view.name} is ${view.toHome} ${view.toHome === 1 ? "step" : "steps"} from home; `
      + `${view.chaserName} is ${view.gap} behind.`;
  }

  /** A row of pips for the Final Chase tracks. `lit` of `total` are filled. */
  function pips(box, lit, total, className) {
    if (!box) return;
    const want = Math.max(total, lit, 1);
    if (box.childElementCount !== want) {
      box.replaceChildren();
      for (let i = 0; i < want; i += 1) box.appendChild(el("i", `pip ${className || ""}`.trim()));
    }
    [...box.children].forEach((pip, i) => pip.classList.toggle("is-lit", i < lit));
  }

  root.ChaseBoard = { render, pips, describe, rowPercent };
})(typeof window !== "undefined" ? window : globalThis);

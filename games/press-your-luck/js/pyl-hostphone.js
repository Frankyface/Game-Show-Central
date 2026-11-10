/* ============================================================
   Press Your Luck — the host phone (docs/22 §5.3, §5.7)
   A private second screen for the host. In the question round: the
   question large, the three options with the right one marked, the
   answer in the accent, who buzzed, and the next question below.
   On the Big Board: whose turn and the spins — nothing secret.

   Read-only: it renders the view the hub hands it and SENDS
   NOTHING. Built with createElement/textContent only. pyl-phone.js
   hands over to this module before the contestant renderer ever
   runs, so the player card never redraws over it.
   ============================================================ */

"use strict";

(function () {
  let view = null;
  let connected = true;

  function card() {
    let node = $("pyl-host-card");
    if (node) return node;
    node = el("div", "host-card");
    node.id = "pyl-host-card";
    node.setAttribute("aria-live", "polite");
    $("screen-phone").appendChild(node);
    return node;
  }

  function line(box, cls, text) {
    if (text === undefined || text === null || text === "") return null;
    return box.appendChild(el("p", cls, text));
  }

  function renderOptions(box, v) {
    const list = el("ol", "host-options");
    (v.options || []).forEach((text, i) => {
      const right = v.correct === i;
      const li = el("li", `host-option${right ? " is-right" : ""}`);
      li.appendChild(el("span", "host-opt-letter", ["A", "B", "C"][i] || "?"));
      li.appendChild(el("span", "host-opt-text", text));
      if (right) li.appendChild(el("span", "host-opt-tag", "Correct"));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderNext(box, next) {
    if (!next) return;
    const wrap = el("div", "host-next");
    wrap.appendChild(el("p", "host-label", "Next question"));
    wrap.appendChild(el("p", "host-next-q", next.q));
    wrap.appendChild(el("p", "host-next-a", `${next.letter} — ${next.answer}`));
    box.appendChild(wrap);
  }

  function renderBody(box, v) {
    if (v.tooBig) {
      line(box, "host-item", v.item || "");
      line(box, "host-note", "Too much to show — use the button on the laptop.");
      return;
    }
    line(box, "host-phase", v.phaseLabel);
    if (v.phase === "question") {
      line(box, "host-item", v.item);
      line(box, "host-label", "Answer");
      line(box, "host-answer", v.answer ? `${v.letter} — ${v.answer}` : "");
      renderOptions(box, v);
      line(box, "host-note", v.who);
      if (v.revealed) line(box, "host-note", "Revealed to the room.");
      renderNext(box, v.next);
      return;
    }
    line(box, "host-item", "Nothing secret right now");
    if (v.phase === "board" && v.who) {
      line(box, "host-note", `${v.who} is on the board — ${v.spins} spin${v.spins === 1 ? "" : "s"} left`
        + (v.passed ? ` (${v.passed} passed to them)` : "") + ".");
    }
  }

  function render() {
    const box = card();
    box.replaceChildren();
    box.classList.toggle("is-stale", !connected);
    const head = el("div", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "Press Your Luck"));
    box.appendChild(head);
    if (!connected) line(box, "host-stale", "Reconnecting — this may be out of date");
    if (!view) {
      line(box, "host-item", "Nothing secret right now");
      line(box, "host-phase", "Waiting for the host to start.");
      return;
    }
    renderBody(box, view);
  }

  window.PylHostPhone = {
    /** The phone page in role=host: hide the player card, show ours. */
    start() {
      document.body.classList.add("host-phone");
      show($("pyl-phone-card"), false);
      render();
    },
    show(v) {
      if (!v || typeof v !== "object" || v.t !== "host") return;
      view = v;
      render();
    },
    status(up) {
      connected = !!up;
      render();
    },
    view: () => view,
    text: () => ($("pyl-host-card") ? $("pyl-host-card").textContent : ""),
  };
})();

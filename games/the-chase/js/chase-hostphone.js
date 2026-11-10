/* ============================================================
   The Chase — the host phone (docs/22 §5.3, §5.7)
   A private second screen for the host: the current question
   large with its answer, the next one below, and in the head to
   head the three options with the right one marked — unless the
   host is playing the Chaser and has not locked yet (review F4),
   in which case the host view simply does not carry it.

   Read-only: it renders the view the hub hands it and SENDS
   NOTHING. Built with createElement/textContent only.
   ============================================================ */

"use strict";

(function () {
  const LETTERS = ["A", "B", "C"];
  let view = null;
  let connected = true;

  function card() {
    let node = $("chase-host-card");
    if (node) return node;
    node = el("div", "host-card");
    node.id = "chase-host-card";
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
      li.appendChild(el("span", "host-opt-letter", LETTERS[i]));
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
    wrap.appendChild(el("p", "host-next-a", next.a));
    box.appendChild(wrap);
  }

  function renderBody(box, v) {
    if (v.tooBig) {
      line(box, "host-item", v.item || "");
      line(box, "host-note", "Too much to show — use the button on the laptop.");
      return;
    }
    line(box, "host-phase", [v.phaseLabel, v.who].filter(Boolean).join(" · "));
    if (!v.secret && !v.withheld) {
      line(box, "host-item", "Nothing secret right now");
      return;
    }
    if (v.pushback) line(box, "host-label", "Pushback — the team answer this one");
    line(box, "host-item", v.item);
    if (v.options) {
      renderOptions(box, v);
      line(box, "host-note", v.note);
      return;
    }
    if (v.answer) {
      line(box, "host-label", "Answer");
      line(box, "host-answer", v.answer);
    }
    line(box, "host-note", v.note);
    renderNext(box, v.next);
  }

  function render() {
    const box = card();
    box.replaceChildren();
    box.classList.toggle("is-stale", !connected);
    const head = el("div", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "The Chase"));
    box.appendChild(head);
    if (!connected) line(box, "host-stale", "Reconnecting — this may be out of date");
    if (!view) {
      line(box, "host-item", "Nothing secret right now");
      line(box, "host-phase", "Waiting for the host to start.");
      return;
    }
    renderBody(box, view);
  }

  window.ChaseHostPhone = {
    /** The phone page in role=host: hide the player card, show ours. */
    start() {
      document.body.classList.add("host-phone");
      show($("chase-phone-card"), false);
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
    text: () => ($("chase-host-card") ? $("chase-host-card").textContent : ""),
  };
})();

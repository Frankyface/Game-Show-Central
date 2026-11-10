/* ============================================================
   Deal or No Deal — the host phone (docs/22 §5.3, §5.7)
   A private second screen for the host: the banker's next offer
   large, before it is announced, with how it is computed — the
   board average, the round's factor and the jitter band — and the
   amounts still in play below. Never the contents of a case: the
   host view does not carry them.

   Read-only: it renders the view the hub hands it and SENDS
   NOTHING. Built with createElement/textContent only. Uses the
   page's $/el/show helpers (js/dond-view.js).
   ============================================================ */

"use strict";

(function () {
  let view = null;
  let connected = true;

  function card() {
    let node = $("dond-host-card");
    if (node) return node;
    node = el("div", "host-card");
    node.id = "dond-host-card";
    node.setAttribute("aria-live", "polite");
    $("screen-phone").appendChild(node);
    return node;
  }

  function line(box, cls, text) {
    if (text === undefined || text === null || text === "") return null;
    return box.appendChild(el("p", cls, text));
  }

  /** The amounts still sealed, as one wrapped line of plain values. */
  function renderLeft(box, left) {
    if (!left || !left.count) return;
    const wrap = el("div", "host-next");
    wrap.appendChild(el("p", "host-label", `Still in play (${left.count})`));
    const list = el("ul", "host-amounts");
    left.amounts.forEach((a) => list.appendChild(el("li", null, a)));
    if (left.more) list.appendChild(el("li", "host-more", `+${left.more} more`));
    wrap.appendChild(list);
    box.appendChild(wrap);
  }

  function renderBody(box, v) {
    if (v.tooBig) {
      line(box, "host-item", v.item || "");
      line(box, "host-note", "Too much to show — use the button on the laptop.");
      return;
    }
    line(box, "host-phase", [v.phaseLabel, v.who].filter(Boolean).join(" · "));
    if (!v.secret) {
      line(box, "host-item", "Nothing secret right now");
      return;
    }
    line(box, "host-item", v.item);
    line(box, "host-answer", v.offer);
    if (v.range) line(box, "host-range", `With the jitter: ${v.range}`);
    line(box, "host-label", "How it is computed");
    line(box, "host-math", `Board average ${v.ev}`);
    line(box, "host-math", v.rule);
    line(box, "host-note", v.note);
    renderLeft(box, v.left);
  }

  function render() {
    const box = card();
    box.replaceChildren();
    box.classList.toggle("is-stale", !connected);
    const head = el("div", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "Deal or No Deal"));
    box.appendChild(head);
    if (!connected) line(box, "host-stale", "Reconnecting — this may be out of date");
    if (!view) {
      line(box, "host-item", "Nothing secret right now");
      line(box, "host-phase", "Waiting for the host to start.");
      return;
    }
    renderBody(box, view);
  }

  window.DondHostPhone = {
    /** The phone page in role=host: hide the contestant card, show ours. */
    start() {
      document.body.classList.add("host-phone");
      show($("dond-phone-card"), false);
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
    text: () => ($("dond-host-card") ? $("dond-host-card").textContent : ""),
  };
})();

/* ============================================================
   The Price Is Right — the host phone page (docs/22 §5.3, §5.7)
   A private second screen: the item in play large, its actual
   retail price below it, and the rest of what is in play (all three
   Cliff Hangers items, the four Plinko prices, the car's digits,
   both showcase totals) listed under it.

   Read-only: it renders the view the hub hands it and SENDS
   NOTHING. No images. Built with createElement/textContent only.
   The contestant renderer in tpir-phone.js never runs for a host
   phone, so nothing redraws over this card.
   ============================================================ */

"use strict";

(function () {
  let view = null;
  let connected = true;

  function card() {
    let node = $("tpir-host-card");
    if (node) return node;
    node = el("div", "host-card");
    node.id = "tpir-host-card";
    node.setAttribute("aria-live", "polite");
    $("screen-phone").appendChild(node);
    return node;
  }

  function line(box, cls, text) {
    if (text === undefined || text === null || text === "") return null;
    return box.appendChild(el("p", cls, text));
  }

  function renderLines(box, lines) {
    if (!Array.isArray(lines) || !lines.length) return;
    const list = el("ol", "host-list");
    lines.forEach((l) => {
      const li = el("li", `host-row${l.current ? " is-current" : ""}${l.done ? " is-done" : ""}`);
      li.appendChild(el("span", "host-row-label", l.label));
      li.appendChild(el("span", "host-row-value", l.value));
      if (l.current) li.appendChild(el("span", "host-row-tag", "Now"));
      else if (l.done) li.appendChild(el("span", "host-row-tag", "Done"));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderBody(box, v) {
    if (v.tooBig) {
      line(box, "host-item", v.item || "");
      line(box, "host-note", "Too much to show — use the button on the laptop.");
      return;
    }
    line(box, "host-phase", v.phaseLabel);
    if (!v.secret) {
      line(box, "host-item", "Nothing secret right now");
      line(box, "host-note", v.note);
      return;
    }
    line(box, "host-item", v.item);
    line(box, "host-label", "Actual retail price");
    line(box, "host-answer", v.answer);
    line(box, "host-note", v.note);
    renderLines(box, v.lines);
  }

  function render() {
    const box = card();
    box.replaceChildren();
    box.classList.toggle("is-stale", !connected);
    const head = el("div", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "The Price Is Right"));
    box.appendChild(head);
    if (!connected) line(box, "host-stale", "Reconnecting — this may be out of date");
    if (!view) {
      line(box, "host-item", "Nothing secret right now");
      line(box, "host-phase", "Waiting for the host to start.");
      return;
    }
    renderBody(box, view);
  }

  window.TpirHostPhone = {
    /** The phone page in role=host: hide the contestant card, show ours. */
    start() {
      document.body.classList.add("host-phone");
      show($("tpir-phone-card"), false);
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
    text: () => ($("tpir-host-card") ? $("tpir-host-card").textContent : ""),
  };
})();

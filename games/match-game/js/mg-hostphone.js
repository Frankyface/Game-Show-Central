/* ============================================================
   Match Game — the host phone (docs/22 §5.3, §5.7)
   A private second screen for the host: the prompt with its hint,
   every panel answer as it comes in (so the match calls are ready
   before each card flips), the contestant's answer once locked,
   the Super Match top three before they are revealed, and both
   Head-to-Head cards before they are turned over.

   Read-only: it renders the view the hub hands it and SENDS
   NOTHING. Dims with "Reconnecting — this may be out of date"
   when the transport drops; shows "Too much to show" for a
   tooBig view. Built with createElement/textContent only.
   ============================================================ */

"use strict";

(function () {
  let view = null;
  let connected = true;

  const MARK = { true: "Match", false: "No match" };

  function card() {
    let node = $("mg-host-card");
    if (node) return node;
    node = el("div", "host-card");
    node.id = "mg-host-card";
    node.setAttribute("aria-live", "polite");
    $("screen-phone").appendChild(node);
    return node;
  }

  function line(box, cls, text) {
    if (text === undefined || text === null || text === "") return null;
    return box.appendChild(el("p", cls, text));
  }

  /** One row per panel seat: the answer in the accent, or "waiting". */
  function renderPanel(box, v) {
    const list = el("ol", "host-panel");
    (v.panel || []).forEach((row) => {
      const li = el("li", `host-seat${row.revealed ? " is-revealed" : ""}${row.out ? " is-out" : ""}`);
      li.appendChild(el("span", "host-seat-name", row.name));
      let text = "waiting…";
      if (row.out) text = "already matched";
      else if (row.answer !== null) text = row.answer;
      li.appendChild(el("span", row.answer !== null && !row.out ? "host-seat-answer" : "host-seat-wait", text));
      const state = row.judged === null ? (row.revealed ? "on screen" : "") : MARK[String(row.judged)];
      if (state) li.appendChild(el("span", "host-seat-tag", state));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderPrompt(box, v) {
    line(box, "host-item", v.item);
    if (v.hint) {
      line(box, "host-label", "Hint");
      line(box, "host-answer", v.hint);
    }
    line(box, "host-label", `${v.who || "The contestant"} said`);
    line(box, v.contestant ? "host-said" : "host-note", v.contestant || "Not yet.");
    line(box, "host-label", `The panel — ${v.answered} of ${v.playing} in`);
    renderPanel(box, v);
  }

  function renderBoard(box, v) {
    line(box, "host-item", v.item);
    line(box, "host-label", `The top three — ${v.answers} ${v.answers === 1 ? "answer" : "answers"} in`);
    const list = el("ol", "host-board");
    (v.board || []).forEach((row) => {
      const li = el("li", `host-row${row.revealed ? " is-revealed" : ""}`);
      li.appendChild(el("span", "host-row-rank", `#${row.rank}`));
      li.appendChild(el("span", "host-row-text", row.text));
      li.appendChild(el("span", "host-row-meta", `${row.count} · ${row.value}${row.revealed ? " · on screen" : ""}`));
      list.appendChild(li);
    });
    if (!(v.board || []).length) list.appendChild(el("li", "host-note", "No answers yet."));
    box.appendChild(list);
    line(box, "host-note", v.note);
  }

  function renderHth(box, v) {
    line(box, "host-item", v.item);
    line(box, "host-note", `Playing for ${v.stake}`);
    line(box, "host-label", `${v.panelist} wrote`);
    line(box, v.panelText ? "host-answer" : "host-note", v.panelText || "Not yet.");
    line(box, "host-label", `${v.who} wrote`);
    line(box, v.contestantText ? "host-said" : "host-note", v.contestantText || "Not yet.");
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
    if (v.phase === "prompt") renderPrompt(box, v);
    else if (v.phase === "audience" || v.phase === "audienceBoard") renderBoard(box, v);
    else if (v.phase === "hthPrompt") renderHth(box, v);
  }

  function render() {
    const box = card();
    box.replaceChildren();
    box.classList.toggle("is-stale", !connected);
    const head = el("div", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "Match Game"));
    box.appendChild(head);
    if (!connected) line(box, "host-stale", "Reconnecting — this may be out of date");
    if (!view) {
      line(box, "host-item", "Nothing secret right now");
      line(box, "host-phase", "Waiting for the host to start.");
      return;
    }
    renderBody(box, view);
  }

  window.MgHostPhone = {
    /** The phone page in role=host: hide the contestant card, show ours. */
    start() {
      document.body.classList.add("host-phone");
      show($("mg-phone-card"), false);
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
    text: () => ($("mg-host-card") ? $("mg-host-card").textContent : ""),
  };
})();

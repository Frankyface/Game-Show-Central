/* ============================================================
   Password — the host phone page (docs/22 §5.3, §5.7)
   A private second screen for the host, shown instead of the
   contestant card when this phone's role is "host": the password
   large in the accent, the ladder position and whose clue it is,
   the next password below; in the Lightning Round every word with
   its status, the current one marked.

   Read-only. It renders the view the hub hands it and SENDS
   NOTHING. It dims and says "Reconnecting — this may be out of
   date" while the transport is down, and renders a tooBig view as
   a plain sentence. createElement/textContent only.
   ============================================================ */

"use strict";

(function () {
  const STATUS_WORDS = { pending: "to come", got: "got it", passed: "passed" };
  let view = null;
  let connected = true;

  function card() {
    let node = $("pwd-host-card");
    if (node) return node;
    node = el("div", "host-card");
    node.id = "pwd-host-card";
    node.setAttribute("aria-live", "polite");
    $("screen-phone").appendChild(node);
    return node;
  }

  function line(box, cls, text) {
    if (text === undefined || text === null || text === "") return null;
    return box.appendChild(el("p", cls, text));
  }

  function renderWords(box, words) {
    const list = el("ol", "host-words");
    words.forEach((w) => {
      const li = el("li", `host-word is-${w.status}${w.current ? " is-current" : ""}`);
      li.appendChild(el("span", "host-word-text", w.text));
      li.appendChild(el("span", "host-word-note", w.current ? "now" : (STATUS_WORDS[w.status] || "")));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderLive(box, v) {
    line(box, "host-label", "Password");
    line(box, "host-answer", v.answer);
    line(box, "host-meta", `Worth ${v.value} · ${v.clues} of ${v.maxClues} clues · ${v.turnName} to clue`);
    if (Array.isArray(v.givers)) line(box, "host-note", `Givers: ${v.givers.join(" and ")}`);
    if (v.next) {
      const wrap = el("div", "host-next");
      wrap.appendChild(el("p", "host-label", "Next password"));
      wrap.appendChild(el("p", "host-next-a", v.next));
      box.appendChild(wrap);
    }
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
      return;
    }
    line(box, "host-item", v.item);
    if (v.stage === "live") { renderLive(box, v); return; }
    if (v.stage === "between") {
      line(box, "host-label", "Next password");
      line(box, "host-answer", v.answer);
      line(box, "host-note", v.note);
      return;
    }
    // Lightning Round, or the words about to be dealt for it.
    if (v.stage === "lightning") {
      line(box, "host-label", "Now");
      line(box, "host-answer", v.answer);
      line(box, "host-meta", `${v.giverName} gives · ${v.money} so far`);
    }
    if (Array.isArray(v.words)) renderWords(box, v.words);
    line(box, "host-note", v.note);
  }

  function render() {
    const box = card();
    box.replaceChildren();
    box.classList.toggle("is-stale", !connected);
    const head = el("div", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "Password"));
    box.appendChild(head);
    if (!connected) line(box, "host-stale", "Reconnecting — this may be out of date");
    if (!view) {
      line(box, "host-item", "Nothing secret right now");
      line(box, "host-phase", "Waiting for the host to start.");
      return;
    }
    renderBody(box, view);
  }

  window.PwdHostPhonePage = {
    /** The phone page in role=host: hide the contestant card, show ours. */
    start() {
      document.body.classList.add("host-phone");
      show($("pwd-phone-card"), false);
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
    text: () => ($("pwd-host-card") ? $("pwd-host-card").textContent : ""),
  };
})();

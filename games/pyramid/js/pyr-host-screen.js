/* ============================================================
   Pyramid — host phone, phone side (docs/22 §5.3, §5.7)

   When this page runs as the host's second screen (`me.role ===
   "host"`; the hub's `&role=host` URL is only a layout hint), it
   shows the host view instead of the contestant card: a small "Host"
   header, the item label, the current word (or Winner's Circle
   subject) large in the game's accent, then every word of the
   category — or every subject of the circle — with how it went.

   It sends nothing and has no buttons in v1. When the transport is
   down the card dims and says "Reconnecting — this may be out of
   date"; a view the SDK refused as too big reads "Too much to show —
   use the button on the laptop". pyr-phone.js stops painting the
   contestant card while this is active, so neither redraws over the
   other. Every node is built with createElement + textContent.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);
  let view = null;
  let connected = true;
  let active = false;

  const STATUS_WORD = {
    pending: "to come", passed: "passed", correct: "got it", illegal: "illegal clue",
    won: "won", blocked: "blocked",
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** One row of the list: the word (or subject), and how it went in words. */
  function row(label, status, current, extra) {
    const li = el("li", `host-row is-${status}${current ? " is-current" : ""}`);
    li.appendChild(el("span", "host-row-text", label));
    li.appendChild(el("span", "host-row-status", current ? "now" : (STATUS_WORD[status] || status)));
    if (extra) li.appendChild(el("span", "host-row-extra", extra));
    return li;
  }

  function roundBody(r, out) {
    out.push(el("p", "host-cat", r.tiebreak ? `Tiebreak · ${r.title}` : r.title));
    if (r.hint) out.push(el("p", "host-hint", `Theme: ${r.hint}`));
    out.push(el("p", "host-who", `${r.giver} gives · ${r.guesser} guesses · ${r.team}`));
    if (r.expired) out.push(el("p", "host-flag", "Time is up — judge the word in flight"));
    out.push(el("p", "host-answer", r.current || ""));
    out.push(el("p", "host-count", `${r.done} taken · ${r.left} still in play`));
    const list = el("ol", "host-list");
    r.words.forEach((w) => list.appendChild(row(w.text, w.status, w.current)));
    out.push(list);
  }

  function circleBody(c, out) {
    out.push(el("p", "host-cat", `Winner’s Circle · ${c.team}`));
    out.push(el("p", "host-who", `${c.giver} gives examples · ${c.guesser} names it`));
    if (c.expired) out.push(el("p", "host-flag", "Time is up — judge the subject in flight"));
    out.push(el("p", "host-answer", c.current || ""));
    out.push(el("p", "host-count", `Worth ${c.currentValue} · won so far ${c.winnings}`));
    const list = el("ol", "host-list");
    c.boxes.forEach((b) => list.appendChild(row(b.category, b.status, b.current, b.value)));
    out.push(list);
  }

  function body(v) {
    const out = [];
    if (!v) { out.push(el("p", "host-empty", "Waiting for the game…")); return out; }
    if (v.tooBig) { out.push(el("p", "host-empty", "Too much to show — use the button on the laptop")); return out; }
    if (v.item) out.push(el("p", "host-item", v.item));
    if (!v.secret) {
      out.push(el("p", "host-empty", "Nothing secret right now"));
      if (v.phaseLabel) out.push(el("p", "host-phase", v.phaseLabel));
      return out;
    }
    if (v.round) roundBody(v.round, out);
    if (v.circle) circleBody(v.circle, out);
    return out;
  }

  function render() {
    const card = $id("pyr-host-card");
    if (!card || !active) return;
    const head = el("header", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "Pyramid"));
    const nodes = [head];
    if (!connected) nodes.push(el("p", "host-stale", "Reconnecting — this may be out of date"));
    nodes.push.apply(nodes, body(view));
    card.replaceChildren.apply(card, nodes);
    card.classList.toggle("is-stale", !connected);
  }

  /** Switch the phone page over to the host screen. */
  function start() {
    active = true;
    ["pyr-phone-card", "gsc-join"].forEach((id) => { const n = $id(id); if (n) n.classList.add("hidden"); });
    const card = $id("pyr-host-card");
    if (card) card.classList.remove("hidden");
    document.body.classList.add("host-phone");
    render();
  }

  /** Init said this phone is a player after all (role revoked): back to the card. */
  function stop() {
    if (!active) return;
    active = false;
    const card = $id("pyr-host-card");
    if (card) card.classList.add("hidden");
    const player = $id("pyr-phone-card");
    if (player) player.classList.remove("hidden");
    document.body.classList.remove("host-phone");
  }

  function onHostView(v) {
    view = v && typeof v === "object" ? v : null;
    render();
  }

  function onStatus(up) {
    connected = !!up;
    render();
  }

  // The URL hint lets a host phone show its own screen before init arrives.
  if (new URLSearchParams(location.search).get("role") === "host") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }

  window.PyrHostScreen = {
    start, stop, onHostView, onStatus,
    isActive: () => active,
    view: () => view,
    text: () => ($id("pyr-host-card") ? $id("pyr-host-card").textContent : ""),
  };
})();

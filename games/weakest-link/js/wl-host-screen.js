/* ============================================================
   Weakest Link — host phone, phone side (docs/22 §5.3, §5.7)

   When this page runs as the host's second screen (`me.role ===
   "host"`; the hub's `&role=host` URL is only a layout hint), it
   shows the host view instead of the contestant card: a small
   "Host" header, the current question large with its answer in the
   game's accent, then what comes next. It sends nothing and has no
   buttons in v1. When the transport is down the card dims and says
   "Reconnecting — this may be out of date"; a view the SDK refused
   as too big reads "Too much to show — use the button on the laptop".
   Every node is built with createElement + textContent.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);
  let view = null;
  let connected = true;
  let active = false;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** One question block: who, the category, the question, the answer. */
  function questionBlock(row, big) {
    const box = el("div", big ? "host-q host-q-current" : "host-q");
    if (row.player) box.appendChild(el("p", "host-who", big ? `${row.player} — on turn` : row.player));
    if (row.category) box.appendChild(el("p", "host-cat", row.category));
    box.appendChild(el("p", big ? "host-question" : "host-question-next", row.q));
    box.appendChild(el("p", big ? "host-answer" : "host-answer-next", row.a));
    return box;
  }

  function body(v) {
    const out = [];
    if (!v) { out.push(el("p", "host-empty", "Waiting for the game…")); return out; }
    if (v.tooBig) { out.push(el("p", "host-empty", "Too much to show — use the button on the laptop")); return out; }
    out.push(el("p", "host-phase", v.phaseLabel || ""));
    if (!v.secret) { out.push(el("p", "host-empty", "Nothing secret right now")); return out; }
    if (v.expired) out.push(el("p", "host-flag", "Time is up — this is the last question of the round"));
    if (v.note) out.push(el("p", "host-note", v.note));
    if (v.current && v.current.q) out.push(questionBlock(v.current, true));
    if (Array.isArray(v.next) && v.next.length) {
      out.push(el("h2", "host-next-title", "Next"));
      v.next.forEach((row) => out.push(questionBlock(row, false)));
    }
    return out;
  }

  function render() {
    const card = $id("wl-host-card");
    if (!card || !active) return;
    const head = el("header", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "Weakest Link"));
    const nodes = [head];
    if (!connected) nodes.push(el("p", "host-stale", "Reconnecting — this may be out of date"));
    nodes.push.apply(nodes, body(view));
    card.replaceChildren.apply(card, nodes);
    card.classList.toggle("is-stale", !connected);
  }

  /** Switch the phone page over to the host screen. */
  function start() {
    active = true;
    const player = $id("wl-phone-card");
    if (player) player.classList.add("hidden");
    const join = $id("gsc-join");
    if (join) join.classList.add("hidden");
    const card = $id("wl-host-card");
    if (card) card.classList.remove("hidden");
    document.body.classList.add("host-phone");
    render();
  }

  /** Init said this phone is a player after all (role revoked): back to the card. */
  function stop() {
    if (!active) return;
    active = false;
    const card = $id("wl-host-card");
    if (card) card.classList.add("hidden");
    const player = $id("wl-phone-card");
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

  window.WlHostScreen = { start, stop, onHostView, onStatus, isActive: () => active };
})();

/* ============================================================
   Millionaire — host phone, phone side (docs/22 §5.3, §5.7)

   When this page runs as the host's second screen (`me.role ===
   "host"`; the hub's `&role=host` URL is only a layout hint), it
   shows the host view instead of the contestant card: a small "Host"
   header, the current item (the question, or the Fastest Finger
   prompt) with its answer large in the game's accent, then the four
   options with the right one marked, the money at stake and what a
   wrong answer or a walk would pay. It sends nothing and has no
   buttons in v1. Transport down: the card dims and says
   "Reconnecting — this may be out of date". A view the SDK refused
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

  function moneyRow(label, value) {
    const row = el("div", "host-money-row");
    row.appendChild(el("span", "host-money-k", label));
    row.appendChild(el("span", "host-money-v", value));
    return row;
  }

  function questionBody(v) {
    const out = [];
    out.push(el("p", "host-who", `${v.contestant} — question ${v.number} of ${v.of}`));
    if (v.category) out.push(el("p", "host-cat", v.category));
    out.push(el("p", "host-question", v.q));
    out.push(el("p", "host-answer", v.answerText));
    const list = el("ol", "host-options");
    v.options.forEach((o) => {
      const li = el("li", "host-option");
      if (o.correct) li.classList.add("is-right");
      if (o.removed) li.classList.add("is-removed");
      li.appendChild(el("span", "host-opt-letter", o.letter));
      li.appendChild(el("span", "host-opt-text", o.text));
      const tag = o.correct ? "Correct" : (o.removed ? "Removed" : "");
      if (tag) li.appendChild(el("span", "host-opt-tag", tag));
      list.appendChild(li);
    });
    out.push(list);
    if (v.remaining) out.push(el("p", "host-note", `50:50 left: ${v.remaining.join(" and ")}`));
    if (v.selected) {
      out.push(el("p", "host-note", `${v.contestant} has chosen ${v.selected}${v.locked ? " (locked in)" : ""}`
        + `${v.revealed ? " — revealed" : ""}`));
    }
    const money = el("div", "host-money");
    money.appendChild(moneyRow("Playing for", v.atStake));
    money.appendChild(moneyRow("If wrong", v.ifWrong));
    money.appendChild(moneyRow("Walk away", v.ifWalk));
    out.push(money);
    return out;
  }

  function fffBody(v) {
    const out = [el("p", "host-question", v.q), el("p", "host-answer", v.answerText)];
    const list = el("ol", "host-options");
    v.order.forEach((o) => {
      const li = el("li", "host-option");
      li.appendChild(el("span", "host-opt-letter", String(o.place)));
      li.appendChild(el("span", "host-opt-text", `${o.letter} — ${o.text}`));
      list.appendChild(li);
    });
    out.push(list);
    out.push(el("p", "host-note", `${v.arrivals} ${v.arrivals === 1 ? "answer" : "answers"} in${v.revealed ? " — revealed" : ""}`));
    return out;
  }

  function body(v) {
    if (!v) return [el("p", "host-empty", "Waiting for the game…")];
    if (v.tooBig) return [el("p", "host-empty", "Too much to show — use the button on the laptop")];
    const out = [el("p", "host-phase", v.phaseLabel || "")];
    if (!v.secret) { out.push(el("p", "host-empty", "Nothing secret right now")); return out; }
    if (v.kind === "question") return out.concat(questionBody(v));
    if (v.kind === "fff") return out.concat(fffBody(v));
    return out;
  }

  function render() {
    const card = $id("wwm-host-card");
    if (!card || !active) return;
    const head = el("header", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "Millionaire"));
    const nodes = [head];
    if (!connected) nodes.push(el("p", "host-stale", "Reconnecting — this may be out of date"));
    nodes.push.apply(nodes, body(view));
    card.replaceChildren.apply(card, nodes);
    card.classList.toggle("is-stale", !connected);
  }

  /** Switch the phone page over to the host screen. */
  function start() {
    active = true;
    ["wwm-phone-card", "gsc-join"].forEach((id) => { const n = $id(id); if (n) n.classList.add("hidden"); });
    const screen = $id("screen-phone");
    if (screen) screen.classList.remove("hidden");
    const card = $id("wwm-host-card");
    if (card) card.classList.remove("hidden");
    document.body.classList.add("host-phone");
    render();
  }

  /** Init said this phone is a player after all (role revoked): back to the card. */
  function stop() {
    if (!active) return;
    active = false;
    const card = $id("wwm-host-card");
    if (card) card.classList.add("hidden");
    const player = $id("wwm-phone-card");
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

  window.WwmHostScreen = {
    start, stop, onHostView, onStatus,
    isActive: () => active,
    view: () => view,
    text: () => { const c = $id("wwm-host-card"); return c ? c.textContent : ""; },
  };
})();

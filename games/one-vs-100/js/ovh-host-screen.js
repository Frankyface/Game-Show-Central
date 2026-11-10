/* ============================================================
   1 vs 100 — host phone, phone side (docs/22 §5.3, §5.7)

   When this page runs as the host's second screen (`me.role ===
   "host"`; the hub's `&role=host` URL is only a layout hint), it
   shows the host view instead of the contestant card: a small
   "Host" header, the question large with the right option marked
   and the answer in the accent, the Mob's live split and how many
   would fall, then the next question. It sends nothing and has no
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

  /** The three options, the right one marked by a word as well as the accent. */
  function optionList(row) {
    const list = el("ol", "host-options");
    row.options.forEach((opt) => {
      const li = el("li", opt.correct ? "host-option is-right" : "host-option");
      li.appendChild(el("span", "host-opt-letter", opt.letter));
      li.appendChild(el("span", "host-opt-text", opt.text));
      if (opt.correct) li.appendChild(el("span", "host-opt-mark", "Correct"));
      list.appendChild(li);
    });
    return list;
  }

  function questionBlock(row, big) {
    const box = el("div", big ? "host-q host-q-current" : "host-q");
    if (row.category) box.appendChild(el("p", "host-cat", row.category));
    box.appendChild(el("p", big ? "host-question" : "host-question-next", row.q));
    box.appendChild(el("p", big ? "host-answer" : "host-answer-next", `${row.answerLetter} — ${row.answerText}`));
    if (big) box.appendChild(optionList(row));
    return box;
  }

  function mobBlock(m, locked) {
    const box = el("div", "host-mob");
    const state = m.closed ? "The Mob has locked" : (m.open ? "The Mob is answering" : "Window not open yet");
    box.appendChild(el("p", "host-mob-line", m.simulated
      ? `${state} · simulated Mob of ${m.total}`
      : `${state} · answered ${m.answered} of ${m.total}`));
    if (!m.simulated || m.closed) {
      box.appendChild(el("p", "host-mob-line", `Split: A ${m.counts[0]} · B ${m.counts[1]} · C ${m.counts[2]}`));
    }
    box.appendChild(el("p", "host-fall", m.wipeOut
      ? `If right: the whole Mob falls (${m.wouldFall}) — bank plus bonus`
      : `If right: ${m.wouldFall} fall, ${m.wouldStay} stay — banks ${m.wouldEarnText}`));
    if (locked) box.appendChild(el("p", "host-mob-line", `Contestant locked ${locked}`));
    return box;
  }

  function body(v) {
    const out = [];
    if (!v) { out.push(el("p", "host-empty", "Waiting for the game…")); return out; }
    if (v.tooBig) { out.push(el("p", "host-empty", "Too much to show — use the button on the laptop")); return out; }
    out.push(el("p", "host-phase", v.bank ? `${v.phaseLabel} · bank ${v.bank}` : (v.phaseLabel || "")));
    if (!v.secret) { out.push(el("p", "host-empty", "Nothing secret right now")); return out; }
    if (v.note) out.push(el("p", "host-note", v.note));
    if (v.current && v.current.q) {
      out.push(questionBlock(v.current, true));
      if (v.mob) out.push(mobBlock(v.mob, v.locked));
    }
    if (v.next && v.next.q) {
      out.push(el("h2", "host-next-title", `Next — question ${v.next.qNumber}`));
      out.push(questionBlock(v.next, false));
    }
    return out;
  }

  function render() {
    const card = $id("ovh-host-card");
    if (!card || !active) return;
    const head = el("header", "host-head");
    head.appendChild(el("span", "host-tag", "Host"));
    head.appendChild(el("span", "host-game", "1 vs 100"));
    const nodes = [head];
    if (!connected) nodes.push(el("p", "host-stale", "Reconnecting — this may be out of date"));
    nodes.push.apply(nodes, body(view));
    card.replaceChildren.apply(card, nodes);
    card.classList.toggle("is-stale", !connected);
  }

  /** Switch the phone page over to the host screen. */
  function start() {
    active = true;
    const player = $id("ovh-phone-card");
    if (player) player.classList.add("hidden");
    const join = $id("gsc-join");
    if (join) join.classList.add("hidden");
    const card = $id("ovh-host-card");
    if (card) card.classList.remove("hidden");
    document.body.classList.add("host-phone");
    render();
  }

  /** Init said this phone is a player after all (role revoked): back to the card. */
  function stop() {
    if (!active) return;
    active = false;
    const card = $id("ovh-host-card");
    if (card) card.classList.add("hidden");
    const player = $id("ovh-phone-card");
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

  window.OvhHostScreen = {
    start, stop, onHostView, onStatus,
    isActive: () => active,
    view: () => view,
    text: () => { const c = $id("ovh-host-card"); return c ? c.textContent : ""; },
  };
})();

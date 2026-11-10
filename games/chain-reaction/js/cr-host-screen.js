/* ============================================================
   Chain Reaction — host phone, phone side (docs/22 §5.3, §5.7)

   When this page runs as the host's second screen (`me.role ===
   "host"`; the hub's `&role=host` URL is only a layout hint), it
   shows the host view instead of the contestant card: a small "Host"
   header, the word in play large in the game's accent, then the
   whole chain stacked top to bottom like the show — every letter of
   every word, the ones the room can already see filled in, the two
   frontier words marked in words. It sends nothing and has no buttons
   in v1. When the transport is down the card dims and says
   "Reconnecting — this may be out of date"; a view the SDK refused as
   too big reads "Too much to show — use the button on the laptop".
   Every node is built with createElement + textContent.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);
  let view = null;
  let connected = true;
  let active = false;

  const FRONTIER = { top: "Next from the top", bottom: "Next from the bottom", both: "Last word" };
  const SPEED = { got: "Got it", pass: "Passed, comes back", open: "To call", given: "" };
  const CHAIN = { given: "", solved: "Solved", spelled: "Spelled out", hidden: "" };

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /** The big line: the word the room is guessing, in the accent. */
  function answer(label, word) {
    const box = node("div", "host-current");
    box.appendChild(node("p", "host-label", label));
    box.appendChild(node("p", "host-answer", word));
    return box;
  }

  /** One word as letter tiles: every letter, the room's ones filled. */
  function wordRow(w, note) {
    const li = node("li", "host-row");
    if (w.target) li.classList.add("is-target");
    if (w.frontier) li.classList.add("is-frontier");
    if (w.status === "given" || w.status === "solved" || w.status === "spelled" || w.status === "got") {
      li.classList.add("is-out");
    }
    const tiles = node("div", "host-tiles");
    tiles.style.setProperty("--len", String(w.word.length));
    for (let i = 0; i < w.word.length; i += 1) {
      tiles.appendChild(node("span", w.lit[i] ? "host-tile is-lit" : "host-tile", w.word[i]));
    }
    li.appendChild(tiles);
    if (note) li.appendChild(node("p", "host-row-note", note));
    return li;
  }

  function column(words, noteFor) {
    const list = node("ol", "host-chain");
    const widest = words.reduce((m, w) => Math.max(m, w.word.length), 0);
    list.style.setProperty("--cr-cols", String(Math.max(2, widest)));
    words.forEach((w) => list.appendChild(wordRow(w, noteFor(w))));
    return list;
  }

  function chainBody(v, out) {
    out.push(node("p", "host-phase", `${v.phaseLabel} · ${v.value} a word · ${v.control} in control`));
    if (v.current) {
      out.push(answer(`Guessing now, from the ${v.current.from}`, v.current.word));
    } else {
      v.words.filter((w) => w.frontier).forEach((w) => out.push(answer(FRONTIER[w.frontier], w.word)));
    }
    out.push(node("h2", "host-next-title", "The chain"));
    out.push(column(v.words, (w) => (w.target ? "Guessing now" : (w.frontier ? FRONTIER[w.frontier] : CHAIN[w.status]))));
  }

  function speedBody(v, out) {
    out.push(node("p", "host-phase", `${v.phaseLabel} · ${v.team}`));
    if (v.current) out.push(answer("Call this one", v.current.word));
    out.push(node("h2", "host-next-title", "The chain"));
    out.push(column(v.words, (w) => (w.target ? "Calling now" : SPEED[w.status] || "")));
  }

  function suddenBody(v, out) {
    out.push(node("p", "host-phase", v.phaseLabel));
    out.push(node("p", "host-neighbour", v.before));
    if (v.current) out.push(answer("The tiebreak word", v.current.word));
    out.push(node("p", "host-neighbour", v.after));
  }

  function body(v) {
    const out = [];
    if (!v) { out.push(node("p", "host-empty", "Waiting for the game…")); return out; }
    if (v.tooBig) { out.push(node("p", "host-empty", "Too much to show — use the button on the laptop")); return out; }
    if (!v.secret) {
      out.push(node("p", "host-phase", v.phaseLabel || ""));
      out.push(node("p", "host-empty", "Nothing secret right now"));
      return out;
    }
    if (v.phase === "chain") chainBody(v, out);
    else if (v.phase === "speed") speedBody(v, out);
    else if (v.phase === "sudden") suddenBody(v, out);
    return out;
  }

  function render() {
    const card = $id("cr-host-card");
    if (!card || !active) return;
    const head = node("header", "host-head");
    head.appendChild(node("span", "host-tag", "Host"));
    head.appendChild(node("span", "host-game", "Chain Reaction"));
    const nodes = [head];
    if (!connected) nodes.push(node("p", "host-stale", "Reconnecting — this may be out of date"));
    nodes.push.apply(nodes, body(view));
    card.replaceChildren.apply(card, nodes);
    card.classList.toggle("is-stale", !connected);
  }

  /** Switch the phone page over to the host screen. */
  function start() {
    active = true;
    ["cr-phone-card", "gsc-join"].forEach((id) => { const n = $id(id); if (n) n.classList.add("hidden"); });
    const card = $id("cr-host-card");
    if (card) card.classList.remove("hidden");
    document.body.classList.add("host-phone");
    render();
  }

  /** Init said this phone is a player after all: back to the contestant card. */
  function stop() {
    if (!active) return;
    active = false;
    const card = $id("cr-host-card");
    if (card) card.classList.add("hidden");
    const player = $id("cr-phone-card");
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

  window.CrHostScreen = {
    start, stop, onHostView, onStatus,
    isActive: () => active,
    view: () => view,
    text: () => { const c = $id("cr-host-card"); return c ? c.textContent : ""; },
  };
})();

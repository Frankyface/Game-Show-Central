/* ============================================================
   Krillion — host phone, phone side (docs/22 §5.3, §5.7)

   When this page runs as the host's second screen (`me.role ===
   "host"`; the hub's `&role=host` URL is only a layout hint), it
   shows the host view instead of the contestant card: a small
   "Host" header, the prompt large, the answers coming in with the
   tier each one matched (or "pending"), the judge's queue, and the
   prompt's rated list in the accent — the answers the host judges
   against. Puffer Party: holder, pending ruling, used answers, list.
   It sends nothing and has no buttons. Transport down: the card dims
   and says "Reconnecting — this may be out of date". A view the SDK
   refused as too big reads "Too much to show — use the button on
   the laptop". Every node is built with createElement + textContent.
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

  function section(title, rows, more) {
    const box = el("section", "kr-host-section");
    box.appendChild(el("h2", "kr-host-title", title));
    rows.forEach((row) => box.appendChild(row));
    if (more) box.appendChild(el("p", "kr-host-more", `and ${more} more`));
    return box;
  }

  function line(left, right, cls) {
    const row = el("p", `kr-host-row${cls ? ` ${cls}` : ""}`);
    row.appendChild(el("span", "kr-host-left", left));
    row.appendChild(el("span", "kr-host-right", right));
    return row;
  }

  /** The rated list: tier name, then its answers large in the accent. */
  function ratedList(v) {
    const rows = (v.list || []).map((t) => {
      const box = el("div", "kr-host-tier");
      box.appendChild(el("p", "kr-host-tier-name", t.name));
      box.appendChild(el("p", "kr-host-answers", t.answers.join(", ") + (t.more ? ` and ${t.more} more` : "")));
      return box;
    });
    return section("The rated list", rows, 0);
  }

  function diveBody(v, out) {
    out.push(el("p", "kr-host-meta", `${v.answered} answered${v.reviewing ? " · judge’s review" : ""}`));
    const answers = (v.answers || []).map((a) => line(`${a.name}: ${a.text}`,
      a.onList && a.match.toLowerCase() !== a.text.toLowerCase() ? `${a.tier} (${a.match})` : a.tier,
      a.tier === "pending" ? "is-pending" : ""));
    if (answers.length) out.push(section("Answers in", answers, v.answersMore));
    const queue = (v.queue || []).map((q) => line(`${q.text}${q.count > 1 ? ` ×${q.count}` : ""}`, q.tier,
      q.tier === "to rule" ? "is-pending" : ""));
    if (queue.length) out.push(section("Judge’s queue", queue, v.queueMore));
  }

  function pufferBody(v, out) {
    out.push(el("p", "kr-host-meta", `${v.holder} has the puffer`));
    if (v.pending) out.push(line(`Waiting for your ruling: ${v.pending.text}`, "", "is-pending"));
    const used = (v.used || []).map((u) => line(u.text, u.tier));
    if (used.length) out.push(section("Used this round", used, v.usedMore));
  }

  function body(v) {
    const out = [];
    if (!v) { out.push(el("p", "kr-host-empty", "Waiting for the game…")); return out; }
    if (v.tooBig) { out.push(el("p", "kr-host-empty", "Too much to show — use the button on the laptop")); return out; }
    out.push(el("p", "kr-host-phase", v.phaseLabel || ""));
    if (!v.secret) { out.push(el("p", "kr-host-empty", "Nothing secret right now")); return out; }
    if (v.prompt) {
      if (v.prompt.category) out.push(el("p", "kr-host-cat", v.prompt.category));
      out.push(el("p", "kr-host-prompt", v.prompt.text));
    }
    if (v.mode === "puffer") pufferBody(v, out);
    else diveBody(v, out);
    out.push(ratedList(v));
    return out;
  }

  function render() {
    const card = $id("kr-host-card");
    if (!card || !active) return;
    const head = el("header", "kr-host-head");
    head.appendChild(el("span", "kr-host-tag", "Host"));
    head.appendChild(el("span", "kr-host-game", "Krillion"));
    const nodes = [head];
    if (!connected) nodes.push(el("p", "kr-host-stale", "Reconnecting — this may be out of date"));
    nodes.push.apply(nodes, body(view));
    card.replaceChildren.apply(card, nodes);
    card.classList.toggle("is-stale", !connected);
  }

  /** Switch the phone page over to the host screen. */
  function start() {
    active = true;
    ["kr-phone-card", "gsc-join"].forEach((id) => { const n = $id(id); if (n) n.classList.add("hidden"); });
    const card = $id("kr-host-card");
    if (card) card.classList.remove("hidden");
    document.body.classList.add("host-phone");
    render();
  }

  /** Init said this phone is a player after all: back to the contestant card. */
  function stop() {
    if (!active) return;
    active = false;
    const card = $id("kr-host-card");
    if (card) card.classList.add("hidden");
    const player = $id("kr-phone-card");
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

  window.KrHostScreen = { start, stop, onHostView, onStatus, isActive: () => active };
})();

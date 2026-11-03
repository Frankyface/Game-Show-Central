/* ============================================================
   Match Game — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one answer. It never scores, never advances, and
   never learns anything the host did not address to it — the
   host only ever sends this phone its OWN view
   (MgCore.phoneView).

   Which is the whole trick of this game: six people write in
   secret, and until the host turns a card over nobody — not the
   other panelists, not the contestants, not the shared screen —
   has seen a word of it.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;
  let lastKey = "";       // the screen+prompt we last painted, so typing survives

  const KICKERS = {
    panel: "You are on the panel",
    audience: "Audience Match",
    hth: "Head-to-Head",
    result: "Final scores",
    wait: "Match Game",
  };

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /* ============ Small builders ============ */

  function mine(box, label, text) {
    const cell = el("div", "phone-mine");
    cell.appendChild(el("p", "k", label));
    cell.appendChild(el("p", "v", text));
    box.appendChild(cell);
  }

  function standings(box, rows) {
    const list = el("ul", "phone-standings");
    (rows || []).forEach((row) => {
      const li = el("li");
      li.appendChild(el("span", null, `${row.name} — ${row.points} pts`));
      li.appendChild(el("span", null, row.money));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  /* ============ Rendering ============ */

  /** A writing screen: the prompt, a field and one big button. */
  function paintForm(writable) {
    const form = $("mg-phone-form");
    show(form, writable);
    const field = $("mg-phone-text");
    const send = $("btn-phone-send");
    if (!writable) return;
    field.disabled = false;
    send.disabled = false;
    send.textContent = view.sent ? "Change my answer" : "Send it";
    field.placeholder = view.sent ? "Type a different answer" : "Your answer";
  }

  function render() {
    const card = $("mg-phone-card");
    if (!card) return;
    const extra = $("mg-phone-extra");
    extra.replaceChildren();
    // A new screen (or a new prompt) empties the field; a repaint of the same
    // screen leaves whatever the player is halfway through typing alone.
    const key = `${view.screen}|${view.prompt || ""}`;
    if (key !== lastKey) {
      lastKey = key;
      $("mg-phone-text").value = "";
    }
    const writable = ["panel", "audience", "hth"].indexOf(view.screen) >= 0 && !view.locked;
    card.className = `phone-card is-${view.screen}${view.sent ? " is-sent" : ""}`;
    setText("mg-phone-kicker", kickerFor());
    setText("mg-phone-prompt", view.screen === "wait" || view.screen === "result"
      ? (view.sub || "Waiting for the host…") : (view.prompt || ""));
    setText("mg-phone-hint", view.hint ? `Hint: ${view.hint}` : "");
    paintForm(writable);
    setText("mg-phone-sub", view.screen === "wait" || view.screen === "result"
      ? (view.mine || "") : (view.sub || ""));
    if (view.sent && view.mine) mine(extra, "Your answer", view.mine);
    if (view.screen === "result") standings(extra, view.standings);
    if (view.scores) extra.appendChild(el("p", "phone-score", view.scores));
    setText("mg-phone-status", connected ? statusLine() : "Reconnecting…");
  }

  function kickerFor() {
    const base = has(KICKERS, view.screen) ? KICKERS[view.screen] : KICKERS.wait;
    if (view.screen === "panel" && view.seat) return `${base} · seat ${view.seat}`;
    return base;
  }

  function statusLine() {
    if (view.locked) return "Pencils down.";
    if (view.sent) return "Sent ✓";
    return "";
  }

  /* ============ Sending ============ */

  const SEND_AS = { panel: "panel", audience: "audience", hth: "hth" };

  function send(text) {
    if (!me || !has(SEND_AS, view.screen)) return;
    const clean = String(text).trim();
    if (!clean) { setText("mg-phone-status", "Type something first."); return; }
    me.send({ t: SEND_AS[view.screen], text: clean });
    setText("mg-phone-status", "Sent ✓");
  }

  /* ============ Transport ============ */

  function onMessage(raw) {
    if (!raw || typeof raw !== "object" || raw.t !== "view") return;
    view = raw;
    render();
  }

  function onStatus(up) {
    connected = !!up;
    render();
  }

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || !GSC.mode.endsWith("-player")) return;
    document.body.classList.add("player-mode");
    if (GSC.mode === "embed-player") document.body.classList.add("gsc-embedded");
    show($("screen-phone"), true);
    $("mg-phone-form").addEventListener("submit", (e) => {
      e.preventDefault();
      send($("mg-phone-text").value);
    });
    try {
      me = await GSC.player({ onMessage, onStatus });
    } catch (err) {
      setText("mg-phone-prompt", "Could not join");
      setText("mg-phone-sub", err.message);
      return;
    }
    me.send({ t: "ready" });
    setText("mg-phone-status", "Connected. Waiting for the host…");
    render();
    window.MgPhone = {
      me, onMessage,
      view: () => view,
      promptText: () => ($("mg-phone-prompt") ? $("mg-phone-prompt").textContent : ""),
      type: (text) => { $("mg-phone-text").value = text; },
      send: () => send($("mg-phone-text").value),
      field: () => $("mg-phone-text"),
      button: () => $("btn-phone-send"),
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

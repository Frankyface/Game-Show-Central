/* ============================================================
   Krillion — phone controller
   Thin by design: it renders exactly the view the host sent and
   sends back one answer. It never rates, never reveals, never
   advances, and never learns anything the host did not address
   to it — the host only ever sends this phone its OWN view
   (KrCore.phoneView): no other player's answer before it is
   revealed, and never a word of the rated answer list.

   The countdown is local: the host sends the time remaining when
   it builds the view and the phone counts down from the moment
   it arrives, so phone and laptop clocks never need to agree.
   ============================================================ */

"use strict";

(function () {
  let me = null;
  let view = { screen: "wait" };
  let connected = true;
  let lastKey = "";
  let clockEnds = null;
  let clockTimer = 0;

  const KICKERS = {
    wait: "Krillion", answer: "Your answer", reveal: "Your dive", "puffer-hold": "You have the puffer",
    "puffer-watch": "Puffer Party", out: "You’re out", result: "Final result",
  };
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const WRITABLE = { answer: "answer", "puffer-hold": "puffer" };

  /* ============ Clock ============ */

  function paintClock() {
    const node = $("kr-phone-clock");
    if (!node) return;
    if (clockEnds === null) { node.textContent = ""; return; }
    const secs = Math.max(0, Math.ceil((clockEnds - Date.now()) / 1000));
    node.textContent = secs > 0 ? `${secs}s` : "Time";
    node.classList.toggle("is-low", secs <= 5);
  }

  function syncClock() {
    const live = has(WRITABLE, view.screen) && Number.isFinite(view.remainingMs);
    clockEnds = live ? Date.now() + view.remainingMs : null;
    if (live && !clockTimer) clockTimer = window.setInterval(paintClock, 250);
    if (!live && clockTimer) { window.clearInterval(clockTimer); clockTimer = 0; }
    paintClock();
  }

  /* ============ Rendering ============ */

  function list(box, items, className) {
    const ul = el("ul", className);
    items.forEach((text) => ul.appendChild(el("li", null, text)));
    box.appendChild(ul);
  }

  function paintExtra(extra) {
    if (view.screen === "reveal") {
      const card = el("div", `kr-phone-result${view.miss ? " is-miss" : ""}`);
      card.appendChild(el("p", "kr-phone-tier", view.tier || ""));
      card.appendChild(el("p", "kr-phone-points", view.miss ? "0 points" : `+${view.points} points`));
      if (view.mine) card.appendChild(el("p", "kr-phone-mine", `You said: ${view.mine}`));
      card.appendChild(el("p", "kr-phone-depth", `You are ${Number(view.depth || 0).toLocaleString("en-US")} m deep`));
      extra.appendChild(card);
    }
    if ((view.screen === "puffer-watch" || view.screen === "puffer-hold" || view.screen === "out")
      && Array.isArray(view.used) && view.used.length) {
      extra.appendChild(el("p", "kr-phone-label", "Used this round"));
      list(extra, view.used, "kr-phone-used");
    }
    if (view.screen === "result" && Array.isArray(view.standings)) {
      list(extra, view.standings.map((r) => `${r.rank}. ${r.name} — ${r.line}`), "kr-phone-standings");
    }
  }

  function subLine() {
    if (view.screen === "answer") return view.sent ? "Sent ✓ — you can change it until the clock ends." : "One answer. The rarer, the deeper.";
    if (view.screen === "puffer-hold") {
      if (view.waiting) return "The judge is ruling on your answer…";
      return view.notice || "Name one that hasn’t been used.";
    }
    if (view.screen === "puffer-watch") return view.sub || `${view.holder} has the puffer.`;
    if (view.screen === "out") return "Out of hearts — watch the big screen.";
    if (view.screen === "result") return view.won ? `You win! ${view.mine}` : view.mine;
    return view.sub || "";
  }

  function render() {
    if (!$("kr-phone-card")) return;
    // A host phone shows the host screen (kr-hostscreen.js) and never this card.
    if (window.KrHostScreen && window.KrHostScreen.isActive()) return;
    const key = `${view.screen}|${view.prompt || ""}`;
    if (key !== lastKey) { lastKey = key; $("kr-phone-text").value = ""; }
    const writable = has(WRITABLE, view.screen) && !view.waiting;
    $("kr-phone-card").className = `kr-phone-card is-${view.screen}${view.sent ? " is-sent" : ""}`;
    setText("kr-phone-kicker", has(KICKERS, view.screen) ? KICKERS[view.screen] : KICKERS.wait);
    const showPrompt = ["answer", "reveal", "puffer-hold", "puffer-watch", "out"].indexOf(view.screen) >= 0;
    setText("kr-phone-prompt", showPrompt && view.prompt ? view.prompt
      : (view.screen === "result" ? "That’s the game." : "Waiting for the host…"));
    show($("kr-phone-form"), writable);
    $("btn-phone-send").textContent = view.screen === "answer" && view.sent ? "Change my answer" : "Send";
    setText("kr-phone-sub", subLine());
    const extra = $("kr-phone-extra");
    extra.replaceChildren();
    paintExtra(extra);
    if (view.screen === "answer" && view.sent && view.mine) extra.appendChild(el("p", "kr-phone-mine", `Your answer: ${view.mine}`));
    setText("kr-phone-status", connected ? "" : "Reconnecting…");
    syncClock();
  }

  /* ============ Sending ============ */

  function send(text) {
    if (!me || !has(WRITABLE, view.screen)) return;
    const clean = String(text).trim();
    if (!clean) { setText("kr-phone-status", "Type something first."); return; }
    me.send({ t: WRITABLE[view.screen], text: clean.slice(0, 40) });
    setText("kr-phone-status", "Sent ✓");
  }

  function onMessage(raw) {
    if (!raw || typeof raw !== "object" || raw.t !== "view") return;
    view = raw;
    render();
  }

  function onStatus(up) {
    connected = !!up;
    if (window.KrHostScreen) window.KrHostScreen.onStatus(up);
    render();
  }

  function onHostView(v) {
    if (window.KrHostScreen) window.KrHostScreen.onHostView(v);
  }

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || !GSC.mode.endsWith("-player")) return;
    document.body.classList.add("player-mode");
    if (GSC.mode === "embed-player") document.body.classList.add("gsc-embedded");
    show($("screen-phone"), true);
    $("kr-phone-form").addEventListener("submit", (e) => {
      e.preventDefault();
      send($("kr-phone-text").value);
    });
    try {
      me = await GSC.player({ onMessage, onStatus, onHostView });
    } catch (err) {
      setText("kr-phone-prompt", "Could not join");
      setText("kr-phone-sub", err.message);
      return;
    }
    // The role comes from init, never from the URL (that is a layout hint).
    // A host phone sends nothing at all (docs/22 §5.7).
    if (window.KrHostScreen) {
      if (me.role === "host") { window.KrHostScreen.start(); return; }
      window.KrHostScreen.stop();
    }
    me.send({ t: "ready" });
    render();
    setText("kr-phone-status", "Connected. Waiting for the host…");
    window.KrPhone = {
      me, onMessage,
      view: () => view,
      promptText: () => $("kr-phone-prompt").textContent,
      type: (text) => { $("kr-phone-text").value = text; },
      button: () => $("btn-phone-send"),
      field: () => $("kr-phone-text"),
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();

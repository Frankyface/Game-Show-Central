/* ============================================================
   Krillion — host phone, shared-screen side (docs/22 §5.2, §5.4, §5.6)

   attach(room) is called by kr-room.js once GSC.host() resolves.
   From then on, on every state change:

   • room.setHostView({t:"host", item, seq, ...KrHostView.hostView(core)})
     — `seq` bumps only when the view's content changes; no cache and no
     resend: the SDK and the hub de-duplicate and hold it.
   • Answers-private mode (room.answersPrivate(): a property of the
     ROSTER, not of the connection): the rated-list panels and their
     "Show the rated list" toggles are taken out of the document, and the
     remembered showList switch is ignored (not cleared). In their place:
     "Answers are on your host phone", or — while no host phone is
     connected — "Host phone disconnected" and ONE "Show answer on this
     screen" button that shows the current prompt's rated list only and
     clears when the next prompt comes up. The judge's review and the
     public reveal are unchanged.
   • Seat reconciliation once, embedded only (§5.6, review F11).

   With no host phone assigned none of this touches the page.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);

  /** The host-only rated-list panels and the toggles that open them. */
  const SPOTS = [
    { screen: "screen-prompt", toggle: "btn-plist", box: "kr-plist-box" },
    { screen: "screen-reveal", toggle: "btn-list", box: "kr-list-box" },
  ];
  const NOTE_CONNECTED = "Answers are on your host phone";
  const NOTE_AWAY = "Host phone disconnected";

  let room = null;
  let privateMode = false;
  let phones = [];
  let parked = [];            // [{node, parent, next}] — detached while private
  let notes = [];             // [{wrap, text, btn, list}] — one per spot
  let revealedItem = null;    // the item the fallback button opened, or null
  let lastJson = "";
  let seq = 0;

  const hv = () => window.KrHostView;
  const core = () => window.KrApp.core();

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* ============ answers-private mode ============ */

  /** Take the panels and toggles out; put a note (and a fallback list box) in their place. */
  function park() {
    SPOTS.forEach((spot) => {
      const toggle = $id(spot.toggle);
      const box = $id(spot.box);
      if (!toggle || !box) return;
      const wrap = el("div", "kr-hp-note");
      const text = el("span", "kr-hp-note-text");
      text.setAttribute("role", "status");
      const btn = el("button", "kr-btn kr-btn-line kr-hp-show", "Show answer on this screen");
      btn.type = "button";
      btn.addEventListener("click", () => {
        revealedItem = hv().itemKey(core());
        paint();
      });
      wrap.appendChild(text);
      wrap.appendChild(btn);
      toggle.parentNode.insertBefore(wrap, toggle);
      const list = el("aside", "kr-list kr-hp-list hidden");
      list.setAttribute("aria-label", "The rated answer list");
      box.parentNode.insertBefore(list, box);
      [toggle, box].forEach((node) => {
        parked.push({ node, parent: node.parentNode, next: node.nextSibling });
        node.remove();
      });
      notes.push({ wrap, text, btn, list });
    });
  }

  /** Put everything back (the last host phone left the roster). */
  function unpark() {
    parked.slice().reverse().forEach(({ node, parent, next }) => {
      parent.insertBefore(node, next && next.parentNode === parent ? next : null);
    });
    parked = [];
    notes.forEach((n) => { n.wrap.remove(); n.list.remove(); });
    notes = [];
    revealedItem = null;
  }

  /** The fallback: this prompt's rated list, tier by tier. */
  function fillList(box, c) {
    box.replaceChildren(el("h3", "kr-label", "The rated list"));
    const ul = el("ul", "kr-list-items");
    hv().currentList(c).forEach((row) => {
      const li = el("li", "kr-list-row");
      li.appendChild(el("span", "kr-list-tier", row.name));
      li.appendChild(el("span", "kr-list-words", row.answers.join(", ") + (row.more ? ` and ${row.more} more` : "")));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function paint() {
    if (!privateMode) return;
    const c = core();
    const item = hv().itemKey(c);
    if (revealedItem !== null && revealedItem !== item) revealedItem = null;   // next item: clear
    const hasList = !!c && hv().currentList(c).length > 0;
    const connected = phones.some((p) => p.connected);
    const open = !connected && hasList && revealedItem === item;
    notes.forEach(({ text, btn, list }) => {
      text.textContent = connected ? NOTE_CONNECTED : NOTE_AWAY;
      btn.classList.toggle("hidden", connected || !hasList || open);
      if (open) fillList(list, c);
      else list.replaceChildren();
      list.classList.toggle("hidden", !open);
    });
  }

  function applyMode() {
    const want = !!(room && room.answersPrivate && room.answersPrivate());
    if (want && !privateMode) { privateMode = true; park(); }
    else if (!want && privateMode) { privateMode = false; unpark(); window.KrApp.set({}); }
    paint();
  }

  /* ============ the host view ============ */

  function pushHostView(c) {
    if (!room || !room.setHostView) return;
    const view = hv().hostView(c);
    const json = JSON.stringify(view);
    if (json !== lastJson) { lastJson = json; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item: hv().itemKey(c), seq }, view));
  }

  /* ============ seat reconciliation (§5.6, review F11) ============ */

  /**
   * Embedded only: there the roster from init is authoritative (standalone,
   * the room is closed at boot and an empty roster would empty the list).
   * Phone seats in the saved setup whose pid is no longer a player are
   * dropped; a running or parked game keeps such a seat — the host types for
   * it, phone views only ever go to room.players() — and says so once.
   */
  function reconcile() {
    if (!window.GSC || window.GSC.mode !== "embed-host" || !room.players) return;
    const live = new Set(room.players().map((p) => p.pid));
    const app = window.KrApp.state();
    const keep = app.setup.players.filter((p) => p.manual || live.has(p.pid));
    if (keep.length !== app.setup.players.length) {
      window.KrApp.set({ setup: Object.assign({}, app.setup, { players: keep }) });
    }
    const seated = (app.core && app.core.players) || (app.resumable && app.resumable.players) || [];
    const orphans = seated.filter((p) => !p.manual && !live.has(p.pid)).map((p) => p.name);
    if (orphans.length) {
      window.KrApp.note(`${orphans.join(", ")} ${orphans.length === 1 ? "is" : "are"} no longer a player in this room`
        + " (now the host phone, or gone) — type their answers from this screen, or start a new game.");
    }
  }

  /* ============ wiring ============ */

  function onRender(c) {
    pushHostView(c);
    paint();
  }

  function onHostPhones(list) {
    phones = Array.isArray(list) ? list : [];
    applyMode();
  }

  function attach(r) {
    room = r;
    phones = room.hostPhones ? room.hostPhones() : [];
    reconcile();
    applyMode();
    window.KrApp.subscribe(onRender);
    onRender(core());
  }

  window.KrHostPhone = {
    attach, onHostPhones,
    isPrivate: () => privateMode,
    NOTE_CONNECTED, NOTE_AWAY,
  };
})();

/* ============================================================
   The Price Is Right — the prize editor
   Tabs for the settings and each list (One Bid, Cliff Hangers,
   Plinko, Lucky Seven, Showcases) with add / remove / reorder and
   live validation, plus Download JSON, Use in game, Reset to
   shipped and Start blank. The draft auto-saves under
   `gsc-tpir-draft-v1` so a reload never loses typing.

   Typing updates the draft in place and only repaints the
   validation banner; the panel is rebuilt on structural changes,
   so an input never loses focus mid-word.
   ============================================================ */

"use strict";

const TpirEditor = (function () {
  // Namespaced by ?store= the same way the saved show is (tpir-app.js).
  const DRAFT_KEY = `gsc-tpir-draft-v1${window.TpirApp.storeSuffix()}`;
  const core = () => window.TpirCore;

  let draft = null;
  let tab = "oneBid";

  const TABS = [
    ["settings", "Settings"], ["oneBid", "One Bid"], ["cliffhangers", "Cliff Hangers"],
    ["plinko", "Plinko"], ["luckyseven", "Lucky Seven"], ["showcases", "Showcases"],
  ];

  /* ============ Draft plumbing ============ */

  const clone = (v) => JSON.parse(JSON.stringify(v));

  function blankPrize(name) {
    return { name: name || "", price: 1, note: "" };
  }

  function blankDraft() {
    return {
      title: "New prize file",
      settings: clone(core().DEFAULT_SETTINGS),
      oneBid: [1, 2, 3, 4].map((n) => Object.assign(blankPrize(`Item ${n}`), { price: 100 * n })),
      cliffhangers: [blankCliff()],
      plinko: [blankPlinko()],
      luckyseven: [{ car: "A car", price: 20000, note: "" }],
      showcases: [blankShowcase(), blankShowcase()],
    };
  }

  const blankCliff = () => ({
    items: [10, 20, 30].map((p, i) => Object.assign(blankPrize(`Small item ${i + 1}`), { price: p })),
    prize: Object.assign(blankPrize("The prize"), { price: 1000 }),
  });

  const blankPlinko = () => ({
    smallPrices: [1, 2, 3, 4].map((n) => ({ name: `Small price ${n}`, shown: n, actual: n })),
  });

  const blankShowcase = () => ({
    prizes: [Object.assign(blankPrize("Prize one"), { price: 1000 }),
      Object.assign(blankPrize("Prize two"), { price: 2000 })],
  });

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (err) {
      console.warn("Could not save the editor draft:", err);
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      console.warn("Ignoring a corrupt editor draft:", err);
      return null;
    }
  }

  function setDraft(next) {
    draft = next;
    saveDraft();
    renderPanel();
    renderStatus();
  }

  /** A structural change: rebuild the panel so ids and order stay right. */
  function mutate(fn) {
    fn(draft);
    saveDraft();
    renderPanel();
    renderStatus();
  }

  /* ============ Small field builders ============ */

  function field(label, value, onInput, options) {
    const opts = options || {};
    const wrap = el("label", `ed-field ${opts.className || ""}`.trim());
    wrap.appendChild(el("span", null, label));
    const input = el("input");
    input.type = opts.type || "text";
    if (opts.type === "number") {
      input.inputMode = "numeric";
      input.step = "1";
      if (opts.min !== undefined) input.min = String(opts.min);
      if (opts.max !== undefined) input.max = String(opts.max);
    }
    if (opts.maxLength) input.maxLength = opts.maxLength;
    input.value = value === undefined || value === null ? "" : String(value);
    input.addEventListener("input", () => {
      onInput(opts.type === "number" ? Math.round(Number(input.value)) : input.value);
      saveDraft();
      renderStatus();
    });
    wrap.appendChild(input);
    return wrap;
  }

  const nameField = (obj, key) => field("Name", obj[key], (v) => { obj[key] = v; },
    { maxLength: 60, className: "ed-field-wide" });

  const priceField = (obj, min, max) => field("Price", obj.price, (v) => { obj.price = v; },
    { type: "number", min: min || 1, max: max || 1000000, className: "ed-field-num" });

  const noteField = (obj) => field("Note", obj.note, (v) => { obj.note = v; },
    { maxLength: 120, className: "ed-field-wide" });

  /**
   * The camera control for one prize (docs/19 §3). Typing a URL or embedding a
   * file mutates the draft in place, then saves and refreshes the banner and
   * the size meter exactly like every other field.
   */
  const photoField = (obj) => {
    const media = window.TpirEditorMedia;
    if (!media) return el("span", "ed-photo-off", "");
    return media.buildImageControl({
      model: obj,
      onChange: () => { saveDraft(); renderStatus(); },
    });
  };

  /** Up / down / remove for one entry in a list. */
  function rowActions(list, index, min) {
    const box = el("div", "ed-actions");
    const up = TpirView.button("↑", "btn btn-ghost btn-small", () => mutate(() => move(list, index, -1)));
    up.disabled = index === 0;
    up.setAttribute("aria-label", "Move up");
    const down = TpirView.button("↓", "btn btn-ghost btn-small", () => mutate(() => move(list, index, 1)));
    down.disabled = index === list.length - 1;
    down.setAttribute("aria-label", "Move down");
    const remove = TpirView.button("Remove", "btn btn-ghost btn-small",
      () => mutate(() => { if (list.length > (min || 0)) list.splice(index, 1); }));
    remove.disabled = list.length <= (min || 0);
    box.appendChild(up);
    box.appendChild(down);
    box.appendChild(remove);
    return box;
  }

  function move(list, index, delta) {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(to, 0, item);
  }

  function row(fields, actions) {
    const node = el("div", "ed-row");
    const box = el("div", "ed-fields");
    fields.forEach((f) => box.appendChild(f));
    node.appendChild(box);
    if (actions) node.appendChild(actions);
    return node;
  }

  function addButton(label, onClick) {
    return TpirView.button(label, "btn btn-ghost", () => mutate(onClick));
  }

  /* ============ Panels ============ */

  const PANELS = {
    settings: settingsPanel,
    oneBid: oneBidPanel,
    cliffhangers: cliffPanel,
    plinko: plinkoPanel,
    luckyseven: l7Panel,
    showcases: showcasePanel,
  };

  function settingsPanel(panel) {
    const s = draft.settings;
    panel.appendChild(row([
      field("Title", draft.title, (v) => { draft.title = v; }, { maxLength: 80, className: "ed-field-wide" }),
      field("Currency", s.currency, (v) => { s.currency = v; }, { maxLength: 3 }),
    ]));
    panel.appendChild(row([
      field("Exact-bid bonus", s.exactBidBonus, (v) => { s.exactBidBonus = v; }, { type: "number", min: 0, className: "ed-field-num" }),
      field("Showcase margin", s.showcaseMargin, (v) => { s.showcaseMargin = v; }, { type: "number", min: 0, className: "ed-field-num" }),
      field("Dollar bonus", s.wheelDollarBonus, (v) => { s.wheelDollarBonus = v; }, { type: "number", min: 0, className: "ed-field-num" }),
      field("Games per showdown", s.gamesPerShowdown, (v) => { s.gamesPerShowdown = v; }, { type: "number", min: 1, max: 8, className: "ed-field-num" }),
    ]));
    panel.appendChild(row([
      field("Wheel (20 values, 5–100 by 5)", s.wheel.join(", "),
        (v) => { s.wheel = numberList(v); }, { className: "ed-field-wide" }),
    ]));
    panel.appendChild(row([
      field("Plinko slots (9 values)", s.plinko.slots.join(", "),
        (v) => { s.plinko.slots = numberList(v); }, { className: "ed-field-wide" }),
      field("Max chips", s.plinko.maxChips, (v) => { s.plinko.maxChips = v; }, { type: "number", min: 1, max: 9, className: "ed-field-num" }),
    ]));
    const games = el("div", "ed-row");
    const box = el("div", "ed-fields");
    box.appendChild(el("p", "ed-group-title", "Pricing games in this file"));
    core().GAME_KINDS.forEach((kind) => {
      const label = el("label", "check");
      const input = el("input");
      input.type = "checkbox";
      input.checked = s.pricingGames.indexOf(kind) >= 0;
      input.addEventListener("change", () => mutate(() => {
        s.pricingGames = core().GAME_KINDS.filter((k) => (k === kind
          ? input.checked : s.pricingGames.indexOf(k) >= 0));
      }));
      label.appendChild(input);
      label.appendChild(el("span", null, core().GAME_LABELS[kind]));
      box.appendChild(label);
    });
    games.appendChild(box);
    panel.appendChild(games);
  }

  function numberList(text) {
    return String(text).split(",").map((part) => Math.round(Number(part.trim())))
      .filter((n) => Number.isFinite(n));
  }

  function oneBidPanel(panel) {
    draft.oneBid.forEach((item, i) => {
      panel.appendChild(row([nameField(item, "name"), priceField(item), noteField(item), photoField(item)],
        rowActions(draft.oneBid, i, 4)));
    });
    panel.appendChild(addButton("+ Add a One Bid item",
      () => draft.oneBid.push(Object.assign(blankPrize("New item"), { price: 100 }))));
  }

  function cliffPanel(panel) {
    draft.cliffhangers.forEach((set, i) => {
      const group = el("div", "ed-row");
      const box = el("div", "ed-fields");
      box.appendChild(el("p", "ed-group-title", `Set ${i + 1}`));
      const sub = el("div", "ed-sub");
      set.items.forEach((item) => {
        sub.appendChild(row([nameField(item, "name"), priceField(item, 1, 99), photoField(item)]));
      });
      sub.appendChild(row([
        el("p", "ed-group-title", "Prize"), nameField(set.prize, "name"),
        priceField(set.prize), noteField(set.prize), photoField(set.prize),
      ]));
      box.appendChild(sub);
      group.appendChild(box);
      group.appendChild(rowActions(draft.cliffhangers, i, 0));
      panel.appendChild(group);
    });
    panel.appendChild(addButton("+ Add a Cliff Hangers set", () => draft.cliffhangers.push(blankCliff())));
  }

  function plinkoPanel(panel) {
    draft.plinko.forEach((set, i) => {
      const group = el("div", "ed-row");
      const box = el("div", "ed-fields");
      box.appendChild(el("p", "ed-group-title", `Set ${i + 1}`));
      const sub = el("div", "ed-sub");
      set.smallPrices.forEach((p) => {
        sub.appendChild(row([
          nameField(p, "name"),
          field("Shown", p.shown, (v) => { p.shown = v; }, { type: "number", min: 1, max: 9, className: "ed-field-num" }),
          field("Actual", p.actual, (v) => { p.actual = v; }, { type: "number", min: 1, max: 9, className: "ed-field-num" }),
        ]));
      });
      box.appendChild(sub);
      group.appendChild(box);
      group.appendChild(rowActions(draft.plinko, i, 0));
      panel.appendChild(group);
    });
    panel.appendChild(addButton("+ Add a Plinko set", () => draft.plinko.push(blankPlinko())));
  }

  function l7Panel(panel) {
    draft.luckyseven.forEach((car, i) => {
      panel.appendChild(row([
        field("Car", car.car, (v) => { car.car = v; }, { maxLength: 60, className: "ed-field-wide" }),
        field("Price (5 digits)", car.price, (v) => { car.price = v; },
          { type: "number", min: 10000, max: 99999, className: "ed-field-num" }),
        noteField(car), photoField(car),
      ], rowActions(draft.luckyseven, i, 0)));
    });
    panel.appendChild(addButton("+ Add a car",
      () => draft.luckyseven.push({ car: "A car", price: 20000, note: "" })));
  }

  function showcasePanel(panel) {
    draft.showcases.forEach((sc, i) => {
      const group = el("div", "ed-row");
      const box = el("div", "ed-fields");
      const total = sc.prizes.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
      box.appendChild(el("p", "ed-group-title", `Showcase ${i + 1} — total ${total}`));
      const sub = el("div", "ed-sub");
      sc.prizes.forEach((p, j) => {
        sub.appendChild(row([nameField(p, "name"), priceField(p), noteField(p), photoField(p)],
          rowActions(sc.prizes, j, 2)));
      });
      sub.appendChild(addButton("+ Add a prize", () => {
        if (sc.prizes.length < 4) sc.prizes.push(Object.assign(blankPrize("Another prize"), { price: 500 }));
      }));
      box.appendChild(sub);
      group.appendChild(box);
      group.appendChild(rowActions(draft.showcases, i, 2));
      panel.appendChild(group);
    });
    panel.appendChild(addButton("+ Add a showcase", () => draft.showcases.push(blankShowcase())));
  }

  /* ============ Rendering ============ */

  function renderTabs() {
    const box = $("tpir-editor-tabs");
    box.replaceChildren();
    TABS.forEach(([key, label]) => {
      const btn = el("button", "editor-tab", label);
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.dataset.tab = key;
      btn.setAttribute("aria-selected", String(tab === key));
      btn.addEventListener("click", () => { tab = key; renderTabs(); renderPanel(); });
      box.appendChild(btn);
    });
  }

  function renderPanel() {
    const panel = $("tpir-editor-panel");
    if (!panel || !draft) return;
    panel.replaceChildren();
    (PANELS[tab] || oneBidPanel)(panel);
  }

  /** The one place the editor says whether the draft would load. */
  function renderStatus() {
    const msg = $("tpir-editor-msg");
    const warn = $("tpir-editor-warn");
    if (window.TpirEditorMedia) window.TpirEditorMedia.renderMeter(draft, $("tpir-editor-meter"));
    try {
      core().validateGame(draft);
      msg.textContent = "";
      show(msg, false);
      const warnings = core().warningsFor(draft);
      warn.textContent = warnings.length ? warnings.join(" ") : "This file is ready to play.";
      $("btn-editor-use").disabled = false;
      $("btn-editor-download").disabled = false;
    } catch (err) {
      msg.textContent = err.message;
      show(msg, true);
      warn.textContent = "";
      $("btn-editor-use").disabled = true;
      $("btn-editor-download").disabled = true;
    }
  }

  /* ============ Actions ============ */

  function open() {
    if (!draft) draft = loadDraft() || clone(window.TpirApp.state().content || blankDraft());
    renderTabs();
    renderPanel();
    renderStatus();
    window.TpirApp.set({ editorOpen: true });
  }

  function close() {
    window.TpirApp.set({ editorOpen: false });
    // Every price in the file sits in these inputs: drop them on close so a
    // hidden editor never holds an unrevealed price (docs/22 §5.4).
    const panel = $("tpir-editor-panel");
    if (panel) panel.replaceChildren();
  }

  function useInGame() {
    try {
      window.TpirApp.useContent(clone(draft), "Custom prizes (editor)", "editor");
      close();
    } catch (err) {
      window.TpirApp.error(err.message);
    }
  }

  function download(fileName) {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || "prizes.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** "Kids' night" -> "kids-night.json", always a bare, safe file name. */
  function setFileName(title) {
    const stem = String(title || "prizes").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return `${stem || "prizes"}.json`;
  }

  /** What the manifest row for this draft should say. */
  function manifestEntry(fileName) {
    const count = (list) => (Array.isArray(list) ? list.length : 0);
    return {
      file: fileName,
      name: draft.title || "Untitled set",
      description: "",
      by: "",
      counts: {
        "one bid": count(draft.oneBid),
        cliffhangers: count(draft.cliffhangers),
        plinko: count(draft.plinko),
        "lucky seven": count(draft.luckyseven),
        showcases: count(draft.showcases),
      },
    };
  }

  /**
   * Static hosting cannot write files, so this is the honest workflow: the
   * browser downloads the set, and the editor prints the exact manifest row to
   * paste into sets/index.json and the path to commit it to (docs/19 §2).
   */
  function downloadForLibrary() {
    const fileName = setFileName(draft.title);
    download(fileName);
    const box = $("tpir-editor-manifest");
    if (!box) return;
    box.replaceChildren();
    box.appendChild(el("p", "ed-manifest-lead",
      `Saved ${fileName}. Commit it to games/price-is-right/sets/${fileName}, then add this row to games/price-is-right/sets/index.json:`));
    const pre = el("pre", "ed-manifest-line");
    pre.textContent = JSON.stringify(manifestEntry(fileName), null, 2);
    box.appendChild(pre);
    show(box, true);
  }

  function wire() {
    const editor = $("btn-editor");
    if (editor) editor.addEventListener("click", () => (window.TpirApp.state().editorOpen ? close() : open()));
    const bind = (id, fn) => { const n = $(id); if (n) n.addEventListener("click", fn); };
    bind("btn-editor-close", close);
    bind("btn-editor-use", useInGame);
    bind("btn-editor-download", () => download("prizes.json"));
    bind("btn-editor-library", downloadForLibrary);
    bind("btn-editor-reset", () => setDraft(clone(globalThis.TPIR_DEFAULT_GAME || blankDraft())));
    bind("btn-editor-blank", () => setDraft(blankDraft()));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  return {
    open, close, draft: () => draft, setDraft, DRAFT_KEY,
    setFileName, manifestEntry, downloadForLibrary,
    tab: (key) => { if (key) { tab = key; renderTabs(); renderPanel(); } return tab; },
  };
})();

window.TpirEditor = TpirEditor;

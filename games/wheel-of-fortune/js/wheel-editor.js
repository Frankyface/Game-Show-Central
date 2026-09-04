/* ============================================================
   Wheel of Fortune — in-page puzzle editor (spec 04 §6)
   Build or tweak a puzzle set in the browser, see the board and
   the wheel exactly as the game will draw them, then Download
   JSON or Use in game. The working draft auto-saves under its
   own localStorage key so a refresh never loses work. Every
   route out of here goes through WheelCore.validateGame, so the
   editor can never hand the game content it would reject.
   Relies on globals: WheelCore, WheelDraw, WheelApp.
   ============================================================ */

"use strict";

(function () {
  // Namespaced by ?store= the same way the saved game is (wheel-app.js), so a
  // harness run cannot overwrite the real host's draft on the same origin.
  const DRAFT_KEY = `gsc-wheel-draft-v1${
    window.WheelApp && window.WheelApp.storeSuffix ? window.WheelApp.storeSuffix() : ""}`;
  const $ = (id) => document.getElementById(id);
  const show = (node, visible) => { if (node) node.classList.toggle("hidden", !visible); };
  const core = () => window.WheelCore;

  let draft = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ============ Draft ============ */

  const blankRound = () => ({ type: "regular", category: "", puzzle: "" });

  const blankDraft = () => ({
    title: "My Wheel of Fortune",
    settings: {
      vowelCost: 250, roundMinimum: 1000, bonusSeconds: 10, bonusPrize: "$25,000",
      tossUpValues: [1000, 2000, 3000], autoOrder: false,
      wedges: core().DEFAULT_WEDGES.slice(),
    },
    rounds: [blankRound()],
  });

  const copy = (value) => JSON.parse(JSON.stringify(value));

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
      console.warn("Could not auto-save the editor draft:", err);
      setError("Draft too large to auto-save in this browser — use Download JSON to keep your work.");
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.rounds) || saved.rounds.length === 0) return null;
      return saved;
    } catch (err) {
      console.warn("Ignoring a corrupt editor draft:", err);
      return null;
    }
  }

  /** Turn the loaded game back into an editable draft. */
  function draftFromGame() {
    const state = window.WheelApp ? window.WheelApp.getState() : null;
    if (!state || !state.game) return blankDraft();
    const g = state.game;
    return {
      title: g.title,
      settings: {
        vowelCost: g.settings.vowelCost, roundMinimum: g.settings.roundMinimum,
        bonusSeconds: g.settings.bonusSeconds, bonusPrize: g.settings.bonusPrize,
        tossUpValues: g.settings.tossUpValues.slice(), autoOrder: g.settings.autoOrder,
        wedges: g.settings.wedges.slice(),
      },
      rounds: g.rounds.map((r) => {
        const out = { type: r.type, category: r.category, puzzle: r.puzzle };
        if (r.wedges) out.wedges = r.wedges.slice();
        if (r.value) out.value = r.value;
        return out;
      }),
    };
  }

  const setError = (message) => { $("editor-error").textContent = message || ""; };

  /* ============ Rendering ============ */

  function render() {
    $("ed-title").value = draft.title || "";
    $("ed-vowel-cost").value = draft.settings.vowelCost;
    $("ed-round-min").value = draft.settings.roundMinimum;
    $("ed-bonus-seconds").value = draft.settings.bonusSeconds;
    $("ed-bonus-prize").value = draft.settings.bonusPrize;
    $("ed-tossup-values").value = draft.settings.tossUpValues.join(", ");
    $("ed-auto-order").checked = !!draft.settings.autoOrder;
    renderWedges();
    renderRounds();
    validateNow();
  }

  function renderWedges() {
    const node = $("ed-wedges");
    node.replaceChildren();
    draft.settings.wedges.forEach((wedge, i) => {
      const label = wedge === core().BANKRUPT ? "BANKRUPT"
        : wedge === core().LOSE_TURN ? "LOSE A TURN" : `$${wedge}`;
      const chip = el("button", "wedge-chip", `${label} ×`);
      chip.type = "button";
      chip.title = "Remove this wedge";
      if (wedge === core().BANKRUPT) chip.classList.add("wedge-chip-bankrupt");
      if (wedge === core().LOSE_TURN) chip.classList.add("wedge-chip-lose");
      chip.addEventListener("click", () => {
        draft.settings.wedges = draft.settings.wedges.filter((_, k) => k !== i);
        commit();
      });
      node.appendChild(chip);
    });
    window.WheelDraw.build($("ed-wheel"), draft.settings.wedges);
  }

  function renderRounds() {
    const list = $("ed-rounds");
    list.replaceChildren();
    draft.rounds.forEach((round, index) => list.appendChild(roundCard(round, index)));
  }

  /**
   * One round row: type / category / puzzle plus the live board preview.
   * Slightly over 50 lines because it is a single form group whose controls
   * all close over the same `index`; splitting it would need that plumbing
   * repeated in every helper.
   */
  function roundCard(round, index) {
    const card = el("li", "ed-round");
    const head = el("div", "ed-round-head");
    head.appendChild(el("span", "ed-round-num", `Round ${index + 1}`));

    const type = document.createElement("select");
    for (const value of ["regular", "tossup", "bonus"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "tossup" ? "Toss-up" : value === "bonus" ? "Bonus" : "Regular";
      type.appendChild(option);
    }
    type.value = round.type || "regular";
    type.addEventListener("change", () => { round.type = type.value; commit(); });
    head.appendChild(type);

    head.appendChild(moveButton("↑ Up", index, -1));
    head.appendChild(moveButton("↓ Down", index, 1));
    const drop = el("button", "btn btn-ghost btn-small", "Remove");
    drop.type = "button";
    drop.addEventListener("click", () => {
      if (draft.rounds.length <= 1) { setError("A game needs at least one round."); return; }
      draft.rounds.splice(index, 1);
      commit();
    });
    head.appendChild(drop);
    card.appendChild(head);

    const row = el("div", "ed-round-row");
    row.appendChild(textField("Category", round.category, 30, (value) => {
      round.category = value;
      commitSoft();
    }));
    row.appendChild(textField("Puzzle", round.puzzle, 70, (value) => {
      round.puzzle = value;
      repaint();
      commitSoft();
    }));
    card.appendChild(row);
    card.appendChild(wedgeOverride(round));

    // The preview is swapped in place so typing never steals focus from the input.
    let preview = previewBoard(core().layoutPuzzle(round.puzzle || ""));
    const fit = el("p", "ed-fit");
    card.appendChild(preview);
    card.appendChild(fit);

    function repaint() {
      const rows = core().layoutPuzzle(round.puzzle || "");
      const next = previewBoard(rows);
      card.replaceChild(next, preview);
      preview = next;
      const typed = (round.puzzle || "").trim();
      fit.className = rows ? "ed-fit ed-fit-ok" : typed ? "ed-fit ed-fit-bad" : "ed-fit";
      fit.textContent = rows ? "Fits the board."
        : typed ? "Doesn’t fit: 4 rows of 12, 14, 14, 12 tiles, and words are never split."
          : "Type a puzzle to see the board.";
    }

    repaint();
    return card;
  }

  function wedgeOverride(round) {
    const wrap = el("label", "editor-check");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Array.isArray(round.wedges);
    box.addEventListener("change", () => {
      if (box.checked) round.wedges = draft.settings.wedges.slice();
      else delete round.wedges;
      commit();
    });
    wrap.appendChild(box);
    wrap.appendChild(document.createTextNode(
      Array.isArray(round.wedges)
        ? `Custom wheel for this round (${round.wedges.length} wedges — copied from the wheel above)`
        : "Custom wheel for this round"));
    return wrap;
  }

  function moveButton(label, index, delta) {
    const button = el("button", "btn btn-ghost btn-small", label);
    button.type = "button";
    button.disabled = index + delta < 0 || index + delta >= draft.rounds.length;
    button.addEventListener("click", () => {
      const [moved] = draft.rounds.splice(index, 1);
      draft.rounds.splice(index + delta, 0, moved);
      commit();
    });
    return button;
  }

  function textField(label, value, maxLength, onInput) {
    const wrap = el("label", "editor-field", label);
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = maxLength;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    wrap.appendChild(input);
    return wrap;
  }

  /** The same layoutPuzzle result the game will draw, in miniature. */
  function previewBoard(rows) {
    const board = el("div", "ed-preview");
    const grid = rows || core().ROW_CAPS.map((cap) => new Array(cap).fill(null));
    grid.forEach((row) => {
      const rowNode = el("div", "ed-preview-row");
      row.forEach((cell) => {
        rowNode.appendChild(el("span", cell ? "ed-preview-tile" : "ed-preview-tile blank", cell ? cell.ch : ""));
      });
      board.appendChild(rowNode);
    });
    return board;
  }

  /* ============ Validation + commit ============ */

  /** Re-validate the draft and gate Download / Use on the result. */
  function validateNow() {
    try {
      core().validateGame(draft);
      setError("");
      $("btn-editor-download").disabled = false;
      $("btn-editor-library").disabled = false;
      $("btn-editor-use").disabled = false;
      return true;
    } catch (err) {
      setError(err.message);
      $("btn-editor-download").disabled = true;
      $("btn-editor-library").disabled = true;
      $("btn-editor-use").disabled = true;
      return false;
    }
  }

  /** Re-render everything except the focused input, then save + validate. */
  function commit() {
    saveDraft();
    const focused = document.activeElement;
    const keepId = focused && focused.id ? focused.id : null;
    renderWedges();
    renderRounds();
    validateNow();
    if (keepId && $(keepId)) $(keepId).focus();
  }

  /** Light commit for inputs inside the rounds list (no re-render, no focus loss). */
  function commitSoft() {
    saveDraft();
    validateNow();
  }

  /* ============ Open / close / export ============ */

  function open() {
    if (!draft) draft = loadDraft() || draftFromGame();
    show($("screen-editor"), true);
    show($("screen-setup"), false);
    show($("screen-game"), false);
    show($("screen-final"), false);
    render();
  }

  function close() {
    show($("screen-editor"), false);
    if (window.WheelApp) window.WheelApp.render();
  }

  /** Push `draft` to the browser as a download called `filename`. */
  function saveAs(filename) {
    const blob = new Blob([`${JSON.stringify(draft, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download() {
    if (!validateNow()) return;
    saveAs("puzzles.json");
  }

  /** A title turned into a bare, safe `*.json` file name for sets/. */
  function setFileName(title) {
    const stem = String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "my-set";
    return `${stem}.json`;
  }

  /** The counts the picker's Preview line shows for this draft. */
  function setCounts() {
    const types = draft.rounds.map((r) => r.type || "regular");
    const counts = { rounds: draft.rounds.length };
    const tossups = types.filter((t) => t === "tossup").length;
    const bonus = types.filter((t) => t === "bonus").length;
    if (tossups) counts["toss-ups"] = tossups;
    if (bonus) counts.bonus = bonus;
    return counts;
  }

  /**
   * "Download for the library" (docs/19 §2). Static hosting cannot write into
   * the repo, so this is the honest workflow: download the file, then show the
   * exact path to commit it to and the exact manifest line to paste.
   */
  function downloadForLibrary() {
    if (!validateNow()) return;
    const file = setFileName(draft.title);
    saveAs(file);
    const entry = {
      file,
      name: (draft.title || "My set").slice(0, 60),
      description: `${draft.rounds.length} rounds.`,
      by: "",
      counts: setCounts(),
    };
    $("editor-library-step1").textContent =
      `1. Commit the downloaded file as games/wheel-of-fortune/sets/${file}`;
    $("editor-library-line").value = `${JSON.stringify(entry, null, 2)},`;
    $("editor-library-copied").textContent = "";
    show($("editor-library-help"), true);
    $("editor-library-line").focus();
    $("editor-library-line").select();
  }

  async function copyLibraryLine() {
    const box = $("editor-library-line");
    box.focus();
    box.select();
    try {
      await navigator.clipboard.writeText(box.value);
      $("editor-library-copied").textContent = "Copied — paste it into sets/index.json.";
    } catch (err) {
      console.warn("Clipboard unavailable:", err);
      $("editor-library-copied").textContent =
        "This browser blocked the clipboard — the line is selected, press Ctrl/Cmd+C.";
    }
  }

  function useInGame() {
    if (!validateNow()) return;
    window.WheelApp.useGame(copy(draft), { text: "the puzzle editor", kind: "upload", url: null });
    close();
  }

  /* ============ Wiring ============ */

  function numberField(id, key, min) {
    $(id).addEventListener("input", () => {
      const value = Math.round(Number($(id).value));
      draft.settings[key] = Number.isFinite(value) && value >= min ? value : draft.settings[key];
      commitSoft();
    });
  }

  function wire() {
    $("btn-editor").addEventListener("click", open);
    $("btn-editor-close").addEventListener("click", close);
    $("btn-editor-download").addEventListener("click", download);
    $("btn-editor-library").addEventListener("click", downloadForLibrary);
    $("btn-library-copy").addEventListener("click", copyLibraryLine);
    $("btn-library-dismiss").addEventListener("click", () => show($("editor-library-help"), false));
    $("btn-editor-use").addEventListener("click", useInGame);
    $("btn-editor-blank").addEventListener("click", () => { draft = blankDraft(); saveDraft(); render(); });
    $("btn-editor-reset").addEventListener("click", () => { draft = draftFromGame(); saveDraft(); render(); });
    $("btn-add-round").addEventListener("click", () => { draft.rounds.push(blankRound()); commit(); });

    $("ed-title").addEventListener("input", () => { draft.title = $("ed-title").value; commitSoft(); });
    numberField("ed-vowel-cost", "vowelCost", 1);
    numberField("ed-round-min", "roundMinimum", 1);
    $("ed-bonus-seconds").addEventListener("input", () => {
      const value = Math.round(Number($("ed-bonus-seconds").value));
      if (Number.isFinite(value) && value >= 0 && value <= 60) draft.settings.bonusSeconds = value;
      commitSoft();
    });
    $("ed-bonus-prize").addEventListener("input", () => {
      draft.settings.bonusPrize = $("ed-bonus-prize").value;
      commitSoft();
    });
    $("ed-tossup-values").addEventListener("input", () => {
      const values = $("ed-tossup-values").value.split(",")
        .map((part) => Math.round(Number(part.trim())))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (values.length) draft.settings.tossUpValues = values;
      commitSoft();
    });
    $("ed-auto-order").addEventListener("change", () => {
      draft.settings.autoOrder = $("ed-auto-order").checked;
      commitSoft();
    });

    $("ed-wedge-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const value = Math.round(Number($("ed-wedge-input").value));
      if (!Number.isFinite(value) || value <= 0) { setError("A wedge value must be a positive number."); return; }
      draft.settings.wedges = [...draft.settings.wedges, value];
      $("ed-wedge-input").value = "";
      commit();
    });
    $("btn-add-bankrupt").addEventListener("click", () => {
      draft.settings.wedges = [...draft.settings.wedges, core().BANKRUPT];
      commit();
    });
    $("btn-add-lose").addEventListener("click", () => {
      draft.settings.wedges = [...draft.settings.wedges, core().LOSE_TURN];
      commit();
    });
  }

  function boot() {
    if (document.body.classList.contains("player-mode")) return;
    wire();
    window.WheelEditor = {
      open, close, download, downloadForLibrary, setFileName, setCounts,
      getDraft: () => draft, setDraft(next) { draft = next; render(); }, DRAFT_KEY,
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());

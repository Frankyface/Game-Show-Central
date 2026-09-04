/* ============================================================
   Deal or No Deal — in-page board editor
   Build or tweak a board, download it as board.json, or load it
   straight into the session. The amounts are shown exactly as the
   host screen will show them (the two columns, low and high), so
   a custom board can be judged at a glance. The working draft
   auto-saves under its own key so a refresh never loses work.
   Built with createElement/textContent: no innerHTML anywhere.
   ============================================================ */

"use strict";

// Namespaced by ?store= the same way the saved night is (dond-app.js), which
// has already run by the time this file is evaluated.
const DOND_DRAFT_KEY = `gsc-dond-draft-v1${window.DondApp.storeSuffix()}`;

let dondDraft = null;
let dondLibraryShown = false;

/* ============ Draft plumbing ============ */

function dondDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function dondBlankDraft() {
  return {
    title: "My Deal or No Deal",
    settings: {
      currency: "$",
      amounts: window.DondCore.DEFAULT_AMOUNTS.slice(),
      rounds: window.DondCore.DEFAULT_ROUNDS.slice(),
      offerFactors: window.DondCore.DEFAULT_FACTORS.slice(),
      jitter: 0.05,
      allowSwap: true,
      audienceAdvice: true,
    },
  };
}

function dondSaveDraft() {
  try {
    localStorage.setItem(DOND_DRAFT_KEY, JSON.stringify(dondDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    dondEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function dondLoadDraft() {
  try {
    const raw = localStorage.getItem(DOND_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object" || !draft.settings) return null;
    if (!Array.isArray(draft.settings.amounts)) return null;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function dondEditorMessage(message) {
  const node = $("dond-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** Every change goes through here: persist, then repaint. */
function dondTouchDraft() {
  dondSaveDraft();
  dondRenderEditor();
}

/* ============ Parsing the comma-separated fields ============ */

function dondParseList(text, allowFractions) {
  return String(text).split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => (allowFractions ? n : Math.round(n)));
}

/* ============ Rendering ============ */

function dondRenderEditor() {
  if (!dondDraft) return;
  if (!dondLibraryShown) show($("dond-editor-library"), false);
  const s = dondDraft.settings;
  $("dond-ed-title").value = dondDraft.title || "";
  $("dond-ed-currency").value = s.currency || "$";
  $("dond-ed-amounts").value = s.amounts.join(", ");
  $("dond-ed-rounds").value = s.rounds.join(", ");
  $("dond-ed-factors").value = (s.offerFactors || []).join(", ");
  $("dond-ed-jitter").value = String(s.jitter);
  $("dond-ed-swap").checked = s.allowSwap !== false;
  $("dond-ed-advice").checked = s.audienceAdvice !== false;
  setText("dond-ed-count", `${s.amounts.length} cases`);
  dondRenderRoundsPreview();
  dondRenderBoardPreview();
  dondRenderWarnings();
}

/** One chip per round: how many cases it opens and what the banker pays. */
function dondRenderRoundsPreview() {
  const list = $("dond-ed-rounds-preview");
  list.replaceChildren();
  const s = dondDraft.settings;
  s.rounds.forEach((count, i) => {
    const li = el("li");
    li.appendChild(el("b", null, `R${i + 1}`));
    const factor = Array.isArray(s.offerFactors) && Number.isFinite(s.offerFactors[i])
      ? `${Math.round(s.offerFactors[i] * 100)}% of the average`
      : "no factor set";
    li.appendChild(document.createTextNode(` open ${count} · ${factor}`));
    list.appendChild(li);
  });
  const sum = s.rounds.reduce((a, b) => a + b, 0);
  const li = el("li", null, `${sum} of ${s.amounts.length} cases opened, ${s.amounts.length - sum} left sealed`);
  list.appendChild(li);
}

/** The same two columns the host screen shows, so the board reads at a glance. */
function dondRenderBoardPreview() {
  const s = dondDraft.settings;
  const sorted = s.amounts.slice().sort((a, b) => a - b);
  const half = Math.ceil(sorted.length / 2);
  fillPreviewColumn($("dond-ed-col-left"), sorted.slice(0, half), s.currency);
  fillPreviewColumn($("dond-ed-col-right"), sorted.slice(half), s.currency);
}

function fillPreviewColumn(node, amounts, currency) {
  if (!node) return;
  node.replaceChildren();
  amounts.forEach((amount) => {
    const li = el("li", "amount-row");
    const frac = Math.abs(amount % 1) > 0 ? 2 : 0;
    const label = (currency || "$") + amount.toLocaleString("en-US", {
      minimumFractionDigits: frac, maximumFractionDigits: 2,
    });
    li.appendChild(el("span", "amount-label", label));
    node.appendChild(li);
  });
}

/** Refuse nothing here — say plainly what is wrong and what is merely odd. */
function dondRenderWarnings() {
  const notice = $("dond-editor-warn");
  if (!notice) return;
  try {
    window.DondCore.validateBoard(dondDraft);
    const warnings = window.DondCore.warningsFor(dondDraft);
    notice.textContent = warnings.length ? warnings.join(" ") : "This board is ready to play.";
    dondEditorMessage("");
  } catch (err) {
    notice.textContent = "";
    dondEditorMessage(err.message);
  }
}

/* ============ Wiring the fields ============ */

function dondWireFields() {
  const on = (id, handler) => $(id).addEventListener("input", handler);
  on("dond-ed-title", (e) => { dondDraft.title = e.target.value.slice(0, 80); dondSaveDraft(); });
  on("dond-ed-currency", (e) => { dondDraft.settings.currency = e.target.value.slice(0, 3); dondTouchDraft(); });
  on("dond-ed-amounts", (e) => {
    const amounts = dondParseList(e.target.value, true);
    if (amounts.length) dondDraft.settings.amounts = amounts;
    dondSaveDraft();
    dondRenderBoardPreview();
    setText("dond-ed-count", `${dondDraft.settings.amounts.length} cases`);
    dondRenderRoundsPreview();
    dondRenderWarnings();
  });
  on("dond-ed-rounds", (e) => {
    const rounds = dondParseList(e.target.value, false).filter((n) => n > 0);
    if (rounds.length) dondDraft.settings.rounds = rounds;
    dondSaveDraft();
    dondRenderRoundsPreview();
    dondRenderWarnings();
  });
  on("dond-ed-factors", (e) => {
    const factors = dondParseList(e.target.value, true);
    dondDraft.settings.offerFactors = factors;
    dondSaveDraft();
    dondRenderRoundsPreview();
    dondRenderWarnings();
  });
  on("dond-ed-jitter", (e) => {
    const n = Number(e.target.value);
    dondDraft.settings.jitter = Number.isFinite(n) ? n : 0;
    dondSaveDraft();
    dondRenderWarnings();
  });
  $("dond-ed-swap").addEventListener("change", (e) => {
    dondDraft.settings.allowSwap = e.target.checked;
    dondTouchDraft();
  });
  $("dond-ed-advice").addEventListener("change", (e) => {
    dondDraft.settings.audienceAdvice = e.target.checked;
    dondTouchDraft();
  });
}

/* ============ Download / use / open / close ============ */

function dondEditorDownload() {
  try {
    window.DondCore.validateBoard(dondDraft);
  } catch (err) {
    dondEditorMessage(`This board can’t be saved yet: ${err.message}`);
    return;
  }
  dondDownload(dondDraft, "board.json");
  dondEditorMessage("");
}

/** Hand `data` to the browser as the file `name`. Shared by both buttons. */
function dondDownload(data, name) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A bare, safe `*.json` file name built from the board's title. */
function dondSlug(title) {
  const clean = String(title || "board").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${clean || "board"}.json`;
}

/**
 * Download for the library (docs 19 §2). Static hosting cannot write files, so
 * the honest workflow is: download it, commit it under sets/, then paste the
 * manifest line. Both strings are shown on screen, ready to copy.
 */
function dondEditorLibrary() {
  try {
    window.DondCore.validateBoard(dondDraft);
  } catch (err) {
    dondEditorMessage(`This board cannot go in the library yet: ${err.message}`);
    return;
  }
  const board = window.DondCore.normalizeBoard(dondDraft);
  const top = board.settings.amounts[board.settings.amounts.length - 1];
  const file = dondSlug(dondDraft.title);
  dondDownload(dondDraft, file);
  const entry = {
    file,
    name: board.title,
    description: `${board.settings.amounts.length} cases, top prize `
      + `${window.DondCore.formatMoney({ game: board }, top)}.`,
    by: "",
    counts: { cases: board.settings.amounts.length, rounds: board.settings.rounds.length },
  };
  setText("dond-library-path", `Commit it as: games/deal-or-no-deal/sets/${file}`);
  setText("dond-library-line", `Then paste into sets/index.json: ${JSON.stringify(entry)}`);
  dondLibraryShown = true;
  show($("dond-editor-library"), true);
  dondEditorMessage("");
}

function dondEditorUse() {
  try {
    window.DondApp.useBoard(dondDeepCopy(dondDraft), "Custom board (from the editor)", "editor");
    dondCloseEditor();
  } catch (err) {
    dondEditorMessage(`This board can’t be used yet: ${err.message}`);
  }
}

/** The draft a first-time editor opens: the board currently loaded. */
function dondStartingDraft() {
  const app = window.DondApp.state();
  if (app.game) return dondDeepCopy(app.game);
  if (window.DOND_DEFAULT_BOARD) return dondDeepCopy(window.DOND_DEFAULT_BOARD);
  return dondBlankDraft();
}

function dondOpenEditor() {
  if (!dondDraft) dondDraft = dondLoadDraft() || dondStartingDraft();
  window.DondApp.set({ editorOpen: true });
  dondRenderEditor();
}

function dondCloseEditor() {
  window.DondApp.set({ editorOpen: false });
}

/* ============ Wiring ============ */

function dondWireEditor() {
  $("btn-editor").addEventListener("click", dondOpenEditor);
  $("btn-editor-close").addEventListener("click", dondCloseEditor);
  $("btn-editor-download").addEventListener("click", dondEditorDownload);
  $("btn-editor-library").addEventListener("click", dondEditorLibrary);
  $("btn-editor-use").addEventListener("click", dondEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    dondDraft = dondDeepCopy(window.DOND_DEFAULT_BOARD || dondBlankDraft());
    dondTouchDraft();
  });
  $("btn-editor-blank").addEventListener("click", () => { dondDraft = dondBlankDraft(); dondTouchDraft(); });
  dondWireFields();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", dondWireEditor);
  } else {
    dondWireEditor();
  }
}

window.DondEditor = {
  open: dondOpenEditor,
  close: dondCloseEditor,
  draft: () => dondDraft,
  setDraft: (draft) => { dondDraft = draft; dondTouchDraft(); },
  DRAFT_KEY: DOND_DRAFT_KEY,
};

/* ============================================================
   Pyramid — in-page category editor
   Build or tweak a game, download it as categories.json, or load
   it straight into the session. The working draft auto-saves
   under its own key so a refresh never loses work. Everything is
   built with createElement/textContent — no innerHTML anywhere.

   Typing never rebuilds the rows (that would steal the caret):
   text inputs write into the draft and re-run the validator, and
   only structural changes — add, remove, resize — repaint.
   ============================================================ */

"use strict";

// Namespaced by ?store= the same way the saved game is (pyr-app.js), which has
// already run by the time this script is evaluated.
const PYR_DRAFT_KEY = `gsc-pyr-draft-v1${window.PyrApp.storeSuffix()}`;

let pyrDraft = null;

/* ============ Draft plumbing ============ */

function pyrDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function pyrBlankCategory(words) {
  return { title: "", hint: "", words: Array.from({ length: words }, () => "") };
}

function pyrBlankCircle() {
  return { boxes: Array.from({ length: 6 }, () => ({ category: "" })) };
}

function pyrBlankDraft() {
  const settings = Object.assign({}, window.PyrCore.DEFAULT_SETTINGS, {
    circleValues: window.PyrCore.DEFAULT_SETTINGS.circleValues.slice(),
  });
  return {
    title: "My Pyramid",
    settings,
    categories: Array.from({ length: 12 }, () => pyrBlankCategory(settings.wordsPerCategory)),
    circles: [pyrBlankCircle(), pyrBlankCircle()],
  };
}

function pyrSaveDraft() {
  try {
    localStorage.setItem(PYR_DRAFT_KEY, JSON.stringify(pyrDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    pyrEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function pyrLoadDraft() {
  try {
    const raw = localStorage.getItem(PYR_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.categories)) return null;
    if (!Array.isArray(draft.circles)) draft.circles = [pyrBlankCircle(), pyrBlankCircle()];
    if (!draft.settings || typeof draft.settings !== "object") draft.settings = pyrBlankDraft().settings;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function pyrEditorMessage(message) {
  const node = $("pyr-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** A text edit: persist and re-check, but never repaint (the caret lives there). */
function pyrTouchDraft() {
  pyrSaveDraft();
  pyrRenderWarnings();
  pyrRenderCounts();
}

/** A structural change: persist and repaint everything. */
function pyrRebuildDraft() {
  pyrSaveDraft();
  pyrRenderEditor();
}

/* ============ Settings pane ============ */

const PYR_ED_NUMBERS = [
  ["pyr-ed-catsecs", "categorySeconds", 5, 300],
  ["pyr-ed-circlesecs", "circleSeconds", 5, 300],
  ["pyr-ed-tbsecs", "tiebreakSeconds", 5, 300],
  ["pyr-ed-perteam", "categoriesPerTeam", 1, 6],
];

function pyrRenderSettings() {
  const s = pyrDraft.settings;
  $("pyr-ed-title").value = pyrDraft.title || "";
  $("pyr-ed-currency").value = s.currency || "$";
  PYR_ED_NUMBERS.forEach(([id, key]) => { $(id).value = String(s[key]); });
  $("pyr-ed-words").value = String(s.wordsPerCategory);
  $("pyr-ed-swap").checked = s.swapRoles !== false;
  $("pyr-ed-values").value = (s.circleValues || []).join(", ");
  $("pyr-ed-prize").value = String(s.grandPrize);
  $("pyr-ed-prize-label").value = s.grandPrizeLabel || "";
}

function pyrParseNumberList(text) {
  return String(text).split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
}

function pyrWireSettings() {
  $("pyr-ed-title").addEventListener("input", (e) => { pyrDraft.title = e.target.value; pyrTouchDraft(); });
  $("pyr-ed-currency").addEventListener("input", (e) => {
    pyrDraft.settings.currency = e.target.value.slice(0, 3);
    pyrTouchDraft();
  });
  PYR_ED_NUMBERS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) { e.target.value = String(pyrDraft.settings[key]); return; }
      pyrDraft.settings[key] = value;
      pyrTouchDraft();
    });
  });
  $("pyr-ed-words").addEventListener("change", pyrOnWordCount);
  $("pyr-ed-swap").addEventListener("change", (e) => { pyrDraft.settings.swapRoles = e.target.checked; pyrTouchDraft(); });
  $("pyr-ed-values").addEventListener("input", (e) => {
    const values = pyrParseNumberList(e.target.value);
    if (values.length === 6) pyrDraft.settings.circleValues = values;
    pyrTouchDraft();
  });
  $("pyr-ed-prize").addEventListener("change", (e) => {
    const value = Math.round(Number(e.target.value));
    if (Number.isFinite(value) && value > 0) pyrDraft.settings.grandPrize = value;
    else e.target.value = String(pyrDraft.settings.grandPrize);
    pyrTouchDraft();
  });
  $("pyr-ed-prize-label").addEventListener("input", (e) => {
    pyrDraft.settings.grandPrizeLabel = e.target.value.slice(0, 24);
    pyrTouchDraft();
  });
}

/** Changing the words-per-category resizes every category, keeping what is typed. */
function pyrOnWordCount(event) {
  const wanted = Math.round(Number(event.target.value));
  if (!Number.isFinite(wanted) || wanted < 3 || wanted > 12) {
    event.target.value = String(pyrDraft.settings.wordsPerCategory);
    return;
  }
  pyrDraft.settings.wordsPerCategory = wanted;
  pyrDraft.categories.forEach((cat) => {
    const words = Array.isArray(cat.words) ? cat.words.slice(0, wanted) : [];
    while (words.length < wanted) words.push("");
    cat.words = words;
  });
  pyrRebuildDraft();
}

/* ============ Category rows ============ */

function pyrTextInput(value, max, onInput, placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = max;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", (e) => onInput(e.target.value));
  return input;
}

function pyrRenderRows() {
  const box = $("pyr-ed-rows");
  box.replaceChildren();
  pyrDraft.categories.forEach((cat, i) => box.appendChild(pyrCategoryRow(cat, i)));
}

function pyrCategoryRow(cat, index) {
  const row = el("div", "ed-row");
  const head = el("div", "ed-row-head");
  head.appendChild(el("span", "ed-index", String(index + 1)));
  head.appendChild(pyrTextInput(cat.title, 40, (v) => { cat.title = v; pyrTouchDraft(); }, "Playful title"));
  head.appendChild(pyrTextInput(cat.hint, 60, (v) => { cat.hint = v; pyrTouchDraft(); }, "The theme, for the giver"));
  const drop = el("button", "btn btn-ghost btn-small", "Remove");
  drop.type = "button";
  drop.addEventListener("click", () => {
    pyrDraft.categories.splice(index, 1);
    pyrRebuildDraft();
  });
  head.appendChild(drop);
  row.appendChild(head);

  const words = el("div", "ed-words");
  cat.words.forEach((word, w) => {
    words.appendChild(pyrTextInput(word, 30, (v) => { cat.words[w] = v; pyrTouchDraft(); }, `Word ${w + 1}`));
  });
  row.appendChild(words);
  return row;
}

/* ============ Circle sets ============ */

function pyrRenderCircles() {
  const box = $("pyr-ed-circles");
  box.replaceChildren();
  pyrDraft.circles.forEach((set, i) => box.appendChild(pyrCircleRow(set, i)));
}

function pyrCircleRow(set, index) {
  const row = el("div", "ed-circle");
  const head = el("div", "ed-row-head");
  head.appendChild(el("span", "ed-index", `W${index + 1}`));
  head.appendChild(el("span", "hint", "Six subjects, cheapest first"));
  const drop = el("button", "btn btn-ghost btn-small", "Remove");
  drop.type = "button";
  drop.addEventListener("click", () => { pyrDraft.circles.splice(index, 1); pyrRebuildDraft(); });
  head.appendChild(drop);
  row.appendChild(head);

  const boxes = el("div", "ed-boxes");
  set.boxes.forEach((box, b) => {
    boxes.appendChild(pyrTextInput(box.category, 50,
      (v) => { box.category = v; pyrTouchDraft(); },
      `${(pyrDraft.settings.circleValues || [])[b] || ""}`));
  });
  row.appendChild(boxes);
  return row;
}

/* ============ Counts, warnings, whole render ============ */

function pyrRenderCounts() {
  setText("pyr-ed-count", `${pyrDraft.categories.length}`);
  setText("pyr-ed-circle-count", `${pyrDraft.circles.length}`);
}

function pyrRenderWarnings() {
  const node = $("pyr-editor-warn");
  try {
    window.PyrCore.validateGame(pyrDraft);
    const warnings = window.PyrCore.warningsFor(pyrDraft);
    node.textContent = warnings.length ? warnings.join(" ") : "This file is ready to play.";
    pyrEditorMessage("");
  } catch (err) {
    node.textContent = "";
    pyrEditorMessage(`Not playable yet: ${err.message}`);
  }
}

function pyrRenderEditor() {
  if (!pyrDraft) return;
  pyrRenderSettings();
  pyrRenderRows();
  pyrRenderCircles();
  pyrRenderCounts();
  pyrRenderWarnings();
}

/* ============ Actions ============ */

function pyrEditorDownload() {
  try {
    window.PyrCore.validateGame(pyrDraft);
  } catch (err) {
    pyrEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  const blob = new Blob([JSON.stringify(pyrDraft, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "categories.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  pyrEditorMessage("");
}

function pyrEditorUse() {
  try {
    window.PyrApp.useGame(pyrDeepCopy(pyrDraft), "Custom categories (from the editor)", "editor");
    pyrCloseEditor();
  } catch (err) {
    pyrEditorMessage(`This game can’t be used yet: ${err.message}`);
  }
}

/** The draft a first-time editor opens: the game currently loaded. */
function pyrStartingDraft() {
  const app = window.PyrApp.state();
  if (app.game) return pyrDeepCopy(app.game);
  if (window.PYR_DEFAULT_GAME) return pyrDeepCopy(window.PYR_DEFAULT_GAME);
  return pyrBlankDraft();
}

function pyrOpenEditor() {
  if (!pyrDraft) pyrDraft = pyrLoadDraft() || pyrStartingDraft();
  window.PyrApp.set({ editorOpen: true });
  pyrRenderEditor();
}

function pyrCloseEditor() {
  window.PyrApp.set({ editorOpen: false });
}

/* ============ Wiring ============ */

function pyrWireEditor() {
  $("btn-editor").addEventListener("click", pyrOpenEditor);
  $("btn-editor-close").addEventListener("click", pyrCloseEditor);
  $("btn-editor-download").addEventListener("click", pyrEditorDownload);
  $("btn-editor-use").addEventListener("click", pyrEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    pyrDraft = pyrDeepCopy(window.PYR_DEFAULT_GAME || pyrBlankDraft());
    pyrRebuildDraft();
  });
  $("btn-editor-blank").addEventListener("click", () => { pyrDraft = pyrBlankDraft(); pyrRebuildDraft(); });
  $("btn-ed-add").addEventListener("click", () => {
    pyrDraft.categories.push(pyrBlankCategory(pyrDraft.settings.wordsPerCategory));
    pyrRebuildDraft();
  });
  $("btn-ed-add-circle").addEventListener("click", () => { pyrDraft.circles.push(pyrBlankCircle()); pyrRebuildDraft(); });
  pyrWireSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pyrWireEditor);
  } else {
    pyrWireEditor();
  }
}

window.PyrEditor = {
  open: pyrOpenEditor,
  close: pyrCloseEditor,
  draft: () => pyrDraft,
  setDraft: (draft) => { pyrDraft = draft; pyrRebuildDraft(); },
  DRAFT_KEY: PYR_DRAFT_KEY,
};

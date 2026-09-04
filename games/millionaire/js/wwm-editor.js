/* ============================================================
   Millionaire — in-page question editor
   Build or tweak a game, download it as questions.json, or load
   it straight into the session. The working draft auto-saves
   under its own key so a refresh never loses work. Everything is
   built with createElement/textContent — no innerHTML anywhere.
   ============================================================ */

"use strict";

// Namespaced by ?store= the same way the saved game is (wwm-app.js), so a
// harness run never overwrites the real host's draft on the same origin.
const WWM_DRAFT_KEY = `gsc-wwm-draft-v1${window.WwmApp ? window.WwmApp.storeSuffix() : ""}`;

let wwmDraft = null;
let wwmOnlyThin = false;

/* ============ Draft plumbing ============ */

function wwmDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function wwmBlankQuestion(level) {
  return { level, category: "", q: "", options: ["", "", "", ""], answer: 0 };
}

function wwmBlankDraft() {
  const tree = window.WwmCore.DEFAULT_MONEY_TREE.slice();
  return {
    title: "My Millionaire",
    settings: {
      currency: "$",
      moneyTree: tree,
      safeHavens: window.WwmCore.DEFAULT_SAFE_HAVENS.slice(),
      lifelines: Object.assign({}, window.WwmCore.DEFAULT_LIFELINES),
      phoneSeconds: 30,
      audienceSeconds: 20,
      fastestFinger: true,
    },
    questions: tree.map((_, i) => wwmBlankQuestion(i + 1)),
    fastestFinger: [{ q: "", options: ["", "", "", ""], order: [0, 1, 2, 3] }],
  };
}

function wwmSaveDraft() {
  try {
    localStorage.setItem(WWM_DRAFT_KEY, JSON.stringify(wwmDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    wwmEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function wwmLoadDraft() {
  try {
    const raw = localStorage.getItem(WWM_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.questions)) return null;
    if (!Array.isArray(draft.fastestFinger)) draft.fastestFinger = [];
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function wwmEditorMessage(message) {
  const node = $("wwm-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** Every change goes through here: persist, then repaint. */
function wwmTouchDraft() {
  wwmSaveDraft();
  wwmRenderEditor();
}

/* ============ Settings pane ============ */

function wwmParseNumberList(text) {
  return String(text).split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
}

function wwmRenderSettings() {
  const s = wwmDraft.settings;
  $("wwm-ed-title").value = wwmDraft.title || "";
  $("wwm-ed-currency").value = s.currency || "$";
  $("wwm-ed-tree").value = s.moneyTree.join(", ");
  $("wwm-ed-havens").value = (s.safeHavens || []).join(", ");
  $("wwm-ed-phone-secs").value = String(s.phoneSeconds);
  $("wwm-ed-audience-secs").value = String(s.audienceSeconds);
  window.WwmCore.LIFELINE_KEYS.forEach((key) => { $(`wwm-ed-ll-${key}`).checked = !!s.lifelines[key]; });
  $("wwm-ed-ll-fff").checked = s.fastestFinger !== false;
  wwmRenderTreePreview();
}

function wwmRenderTreePreview() {
  const list = $("wwm-ed-tree-preview");
  list.replaceChildren();
  const havens = wwmDraft.settings.safeHavens || [];
  wwmDraft.settings.moneyTree.forEach((value, i) => {
    const li = el("li", havens.indexOf(i + 1) >= 0 ? "safe" : null,
      `${i + 1}. ${wwmDraft.settings.currency}${value.toLocaleString("en-US")}`);
    list.appendChild(li);
  });
}

function wwmWireSettings() {
  const on = (id, handler) => $(id).addEventListener("input", handler);
  on("wwm-ed-title", (e) => { wwmDraft.title = e.target.value; wwmSaveDraft(); });
  on("wwm-ed-currency", (e) => { wwmDraft.settings.currency = e.target.value.slice(0, 3); wwmTouchDraft(); });
  on("wwm-ed-tree", (e) => {
    const tree = wwmParseNumberList(e.target.value);
    if (tree.length) wwmDraft.settings.moneyTree = tree;
    wwmSaveDraft();
    wwmRenderTreePreview();
    wwmRenderLevelBadges();
  });
  on("wwm-ed-havens", (e) => {
    wwmDraft.settings.safeHavens = wwmParseNumberList(e.target.value);
    wwmSaveDraft();
    wwmRenderTreePreview();
  });
  on("wwm-ed-phone-secs", (e) => { wwmDraft.settings.phoneSeconds = Number(e.target.value) || 0; wwmSaveDraft(); });
  on("wwm-ed-audience-secs", (e) => { wwmDraft.settings.audienceSeconds = Number(e.target.value) || 0; wwmSaveDraft(); });
  window.WwmCore.LIFELINE_KEYS.forEach((key) => {
    $(`wwm-ed-ll-${key}`).addEventListener("change", (e) => {
      wwmDraft.settings.lifelines[key] = e.target.checked;
      wwmSaveDraft();
    });
  });
  $("wwm-ed-ll-fff").addEventListener("change", (e) => {
    wwmDraft.settings.fastestFinger = e.target.checked;
    wwmSaveDraft();
  });
}

/* ============ Question rows ============ */

function wwmLevelSelect(row, index) {
  const select = el("select", "ed-level");
  select.setAttribute("aria-label", `Level for question ${index + 1}`);
  wwmDraft.settings.moneyTree.forEach((value, i) => {
    const option = el("option", null, `${i + 1}`);
    option.value = String(i + 1);
    select.appendChild(option);
  });
  select.value = String(row.level || 1);
  select.addEventListener("change", (e) => { row.level = Number(e.target.value); wwmTouchDraft(); });
  return select;
}

function wwmOptionField(row, index, optIndex) {
  const wrap = el("label", "ed-option");
  const radio = el("input");
  radio.type = "radio";
  radio.name = `wwm-ans-${index}`;
  radio.checked = row.answer === optIndex;
  radio.setAttribute("aria-label", `Option ${"ABCD"[optIndex]} is the answer`);
  radio.addEventListener("change", () => { row.answer = optIndex; wwmSaveDraft(); });
  const field = el("input");
  field.type = "text";
  field.maxLength = 60;
  field.value = row.options[optIndex] || "";
  field.placeholder = `Option ${"ABCD"[optIndex]}`;
  field.addEventListener("input", (e) => { row.options[optIndex] = e.target.value; wwmSaveDraft(); });
  wrap.appendChild(radio);
  wrap.appendChild(field);
  return wrap;
}

function wwmQuestionRow(row, index) {
  const box = el("div", "ed-row");
  box.appendChild(wwmLevelSelect(row, index));
  const question = el("input");
  question.type = "text";
  question.maxLength = 200;
  question.value = row.q || "";
  question.placeholder = `Question ${index + 1}`;
  question.setAttribute("aria-label", `Question ${index + 1} text`);
  question.addEventListener("input", (e) => { row.q = e.target.value; wwmSaveDraft(); });
  box.appendChild(question);
  const category = el("input");
  category.type = "text";
  category.maxLength = 30;
  category.value = row.category || "";
  category.placeholder = "Category";
  category.setAttribute("aria-label", `Category for question ${index + 1}`);
  category.addEventListener("input", (e) => { row.category = e.target.value; wwmSaveDraft(); });
  box.appendChild(category);
  const remove = el("button", "btn btn-ghost btn-small", "✕");
  remove.type = "button";
  remove.title = `Remove question ${index + 1}`;
  remove.addEventListener("click", () => {
    wwmDraft.questions.splice(index, 1);
    wwmTouchDraft();
  });
  box.appendChild(remove);
  const options = el("div", "ed-options");
  [0, 1, 2, 3].forEach((i) => options.appendChild(wwmOptionField(row, index, i)));
  box.appendChild(options);
  return box;
}

function wwmThinLevels() {
  const counts = wwmLevelCounts();
  return new Set(counts.filter((c) => c.count < 2).map((c) => c.level));
}

function wwmRenderRows() {
  const host = $("wwm-ed-rows");
  host.replaceChildren();
  const thin = wwmOnlyThin ? wwmThinLevels() : null;
  wwmDraft.questions.forEach((row, index) => {
    if (thin && !thin.has(row.level)) return;
    host.appendChild(wwmQuestionRow(row, index));
  });
  setText("wwm-ed-count", `${wwmDraft.questions.length}`);
}

function wwmLevelCounts() {
  return wwmDraft.settings.moneyTree.map((_, i) => ({
    level: i + 1,
    count: wwmDraft.questions.filter((q) => Number(q.level) === i + 1).length,
  }));
}

function wwmRenderLevelBadges() {
  const box = $("wwm-ed-levels");
  box.replaceChildren();
  wwmLevelCounts().forEach((row) => {
    const badge = el("span", row.count < 2 ? "level-badge thin" : "level-badge",
      `L${row.level}: ${row.count}`);
    box.appendChild(badge);
  });
}

/* ============ Fastest Finger rows ============ */

function wwmFffOrderSelect(row, place) {
  const select = el("select");
  select.setAttribute("aria-label", `Item in position ${place + 1}`);
  ["A", "B", "C", "D"].forEach((letter, idx) => {
    const option = el("option", null, letter);
    option.value = String(idx);
    select.appendChild(option);
  });
  select.value = String(row.order[place]);
  select.addEventListener("change", (e) => {
    row.order[place] = Number(e.target.value);
    wwmSaveDraft();
    wwmRenderFff();
  });
  return select;
}

function wwmFffRow(row, index) {
  const box = el("div", "ed-row ed-row-fff");
  const question = el("input");
  question.type = "text";
  question.maxLength = 200;
  question.value = row.q || "";
  question.placeholder = "Put these in order…";
  question.setAttribute("aria-label", `Fastest Finger question ${index + 1}`);
  question.addEventListener("input", (e) => { row.q = e.target.value; wwmSaveDraft(); });
  box.appendChild(question);
  const remove = el("button", "btn btn-ghost btn-small", "✕");
  remove.type = "button";
  remove.title = `Remove Fastest Finger question ${index + 1}`;
  remove.addEventListener("click", () => { wwmDraft.fastestFinger.splice(index, 1); wwmTouchDraft(); });
  box.appendChild(remove);
  const options = el("div", "ed-options");
  [0, 1, 2, 3].forEach((i) => {
    const field = el("input");
    field.type = "text";
    field.maxLength = 60;
    field.value = row.options[i] || "";
    field.placeholder = `Item ${"ABCD"[i]}`;
    field.addEventListener("input", (e) => { row.options[i] = e.target.value; wwmSaveDraft(); });
    options.appendChild(field);
  });
  box.appendChild(options);
  const order = el("div", "ed-order");
  [0, 1, 2, 3].forEach((place) => order.appendChild(wwmFffOrderSelect(row, place)));
  box.appendChild(order);
  return box;
}

function wwmRenderFff() {
  const host = $("wwm-ed-fff");
  host.replaceChildren();
  wwmDraft.fastestFinger.forEach((row, index) => host.appendChild(wwmFffRow(row, index)));
  setText("wwm-ed-fff-count", `${wwmDraft.fastestFinger.length}`);
}

/* ============ Whole-editor render ============ */

function wwmRenderEditor() {
  if (!wwmDraft) return;
  wwmRenderSettings();
  wwmRenderRows();
  wwmRenderLevelBadges();
  wwmRenderFff();
  wwmRenderWarnings();
}

function wwmRenderWarnings() {
  const node = $("wwm-editor-warn");
  try {
    window.WwmCore.validateGame(wwmDraft);
    const warnings = window.WwmCore.warningsFor(wwmDraft);
    node.textContent = warnings.length ? warnings.join(" ") : "This file is ready to play.";
    wwmEditorMessage("");
  } catch (err) {
    node.textContent = "";
    wwmEditorMessage(`Not playable yet: ${err.message}`);
  }
}

/* ============ Actions ============ */

function wwmDownloadJson(game, filename) {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wwmEditorDownload() {
  try {
    window.WwmCore.validateGame(wwmDraft);
  } catch (err) {
    wwmEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  wwmDownloadJson(wwmDraft, "questions.json");
  wwmEditorMessage("");
}

/**
 * Download for the library (docs/19 §2). Static hosting cannot write files, so
 * this is the honest workflow: it downloads the set under a filename derived
 * from the title and prints the exact manifest line to paste into
 * sets/index.json plus the path to commit the file to.
 */
function wwmEditorLibraryDownload() {
  try {
    window.WwmCore.validateGame(wwmDraft);
  } catch (err) {
    wwmEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  const file = wwmLibraryFileName(wwmDraft.title);
  wwmDownloadJson(wwmDraft, file);
  wwmShowManifestLine(file);
  wwmEditorMessage("");
}

/** "Movies & TV night!" -> "movies-tv-night.json" (the manifest's file rule). */
function wwmLibraryFileName(title) {
  const stem = String(title || "set")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${stem || "set"}.json`;
}

/** The two lines a host has to act on, each with its own copy button. */
function wwmShowManifestLine(file) {
  const box = $("wwm-editor-manifest");
  if (!box) return;
  const entry = {
    file,
    name: wwmDraft.title || file.replace(/\.json$/, ""),
    description: "",
    by: "",
    counts: { questions: wwmDraft.questions.length, "fastest finger": wwmDraft.fastestFinger.length },
  };
  box.replaceChildren();
  box.appendChild(el("p", "manifest-head", "Saved. To put it in the library, commit two things:"));
  box.appendChild(wwmManifestRow("1. the file", `games/millionaire/sets/${file}`));
  box.appendChild(wwmManifestRow("2. this line in games/millionaire/sets/index.json",
    JSON.stringify(entry)));
  show(box, true);
}

function wwmManifestRow(label, value) {
  const row = el("div", "manifest-row");
  row.appendChild(el("p", "manifest-label", label));
  const code = el("code", "manifest-code", value);
  row.appendChild(code);
  const copy = el("button", "btn btn-ghost btn-small", "Copy");
  copy.type = "button";
  copy.addEventListener("click", () => {
    const done = () => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, () => { copy.textContent = "Select it by hand"; });
    } else {
      copy.textContent = "Select it by hand";
    }
  });
  row.appendChild(copy);
  return row;
}

function wwmEditorUse() {
  try {
    window.WwmApp.useGame(wwmDeepCopy(wwmDraft), "Custom questions (from the editor)", "editor");
    wwmCloseEditor();
  } catch (err) {
    wwmEditorMessage(`This game can’t be used yet: ${err.message}`);
  }
}

function wwmOpenEditor() {
  if (!wwmDraft) wwmDraft = wwmLoadDraft() || wwmStartingDraft();
  window.WwmApp.set({ editorOpen: true });
  wwmRenderEditor();
}

function wwmCloseEditor() {
  window.WwmApp.set({ editorOpen: false });
}

/** The draft a first-time editor opens: the game currently loaded. */
function wwmStartingDraft() {
  const app = window.WwmApp.state();
  if (app.game) return wwmDeepCopy(app.game);
  if (window.WWM_DEFAULT_GAME) return wwmDeepCopy(window.WWM_DEFAULT_GAME);
  return wwmBlankDraft();
}

/* ============ Wiring ============ */

function wwmWireEditor() {
  $("btn-editor").addEventListener("click", wwmOpenEditor);
  $("btn-editor-close").addEventListener("click", wwmCloseEditor);
  $("btn-editor-download").addEventListener("click", wwmEditorDownload);
  $("btn-editor-library").addEventListener("click", wwmEditorLibraryDownload);
  $("btn-editor-use").addEventListener("click", wwmEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    wwmDraft = wwmDeepCopy(window.WWM_DEFAULT_GAME || wwmBlankDraft());
    wwmTouchDraft();
  });
  $("btn-editor-blank").addEventListener("click", () => { wwmDraft = wwmBlankDraft(); wwmTouchDraft(); });
  $("btn-ed-add").addEventListener("click", () => {
    const counts = wwmLevelCounts();
    const thinnest = counts.reduce((a, b) => (b.count < a.count ? b : a), counts[0]);
    wwmDraft.questions.push(wwmBlankQuestion(thinnest ? thinnest.level : 1));
    wwmTouchDraft();
  });
  $("btn-ed-add-fff").addEventListener("click", () => {
    wwmDraft.fastestFinger.push({ q: "", options: ["", "", "", ""], order: [0, 1, 2, 3] });
    wwmTouchDraft();
  });
  $("wwm-ed-only-thin").addEventListener("change", (e) => { wwmOnlyThin = e.target.checked; wwmRenderRows(); });
  wwmWireSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wwmWireEditor);
  } else {
    wwmWireEditor();
  }
}

window.WwmEditor = {
  open: wwmOpenEditor,
  close: wwmCloseEditor,
  draft: () => wwmDraft,
  libraryFileName: wwmLibraryFileName,
  setDraft: (draft) => { wwmDraft = draft; wwmTouchDraft(); },
  DRAFT_KEY: WWM_DRAFT_KEY,
};

/* ============================================================
   1 vs 100 — in-page question editor
   Build or tweak a game, download it as questions.json, download
   it ready for the repo's question-set library (docs 19 §2), or
   load it straight into the session. The working draft auto-saves
   under its own key so a refresh never loses work. Everything is
   built with createElement/textContent — no HTML strings anywhere.
   ============================================================ */

"use strict";

// Same `?store=NAME` namespace as the saved game (ovh-app.js ovhStoreSuffix).
const OVH_DRAFT_KEY = `gsc-ovh-draft-v1${window.OvhApp.storeSuffix()}`;

let ovhDraft = null;
let ovhOnlyThin = false;

/* ============ Draft plumbing ============ */

function ovhDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function ovhBlankQuestion(level) {
  return { level, category: "", q: "", options: ["", "", ""], answer: 0 };
}

function ovhBlankDraft() {
  const questions = [];
  for (let level = 1; level <= window.OvhCore.LEVEL_MAX; level += 1) {
    for (let k = 0; k < 3; k += 1) questions.push(ovhBlankQuestion(level));
  }
  return {
    title: "My 1 vs 100",
    settings: {
      currency: "$",
      ladder: window.OvhCore.DEFAULT_LADDER.slice(),
      answerSeconds: 20,
      helps: Object.assign({}, window.OvhCore.DEFAULT_HELPS),
      bonusMultiplier: 2,
      mobSize: 20,
    },
    questions,
  };
}

function ovhSaveDraft() {
  try {
    localStorage.setItem(OVH_DRAFT_KEY, JSON.stringify(ovhDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    ovhEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function ovhLoadDraft() {
  try {
    const raw = localStorage.getItem(OVH_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.questions)) return null;
    if (!draft.settings || typeof draft.settings !== "object") draft.settings = ovhBlankDraft().settings;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function ovhEditorMessage(message) {
  const node = $("ovh-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** Every change goes through here: persist, then repaint. */
function ovhTouchDraft() {
  ovhSaveDraft();
  ovhRenderEditor();
}

/* ============ Settings pane ============ */

function ovhParseNumberList(text) {
  return String(text).split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
}

function ovhRenderSettings() {
  const s = ovhDraft.settings;
  const set = (id, value) => {
    const node = $(id);
    if (node && document.activeElement !== node) node.value = String(value);
  };
  set("ovh-ed-title", ovhDraft.title || "");
  set("ovh-ed-currency", s.currency || "$");
  set("ovh-ed-ladder", (s.ladder || []).join(", "));
  set("ovh-ed-secs", s.answerSeconds);
  set("ovh-ed-bonus", s.bonusMultiplier);
  set("ovh-ed-mobsize", s.mobSize);
  window.OvhCore.HELP_KEYS.forEach((key) => {
    const box = $(`ovh-ed-help-${key}`);
    if (box) box.checked = !!(s.helps && s.helps[key]);
  });
  const preview = $("ovh-ed-ladder-preview");
  if (!preview) return;
  preview.replaceChildren();
  (s.ladder || []).forEach((value, i) => {
    const li = el("li", "ladder-row");
    li.appendChild(el("span", "ladder-q", `Q${i + 1}`));
    li.appendChild(el("span", "ladder-v", `${s.currency || "$"}${Number(value).toLocaleString("en-US")} each`));
    preview.appendChild(li);
  });
  if ((s.ladder || []).length) {
    const li = el("li", "ladder-row ladder-row-note");
    li.appendChild(el("span", "ladder-q", `Q${s.ladder.length + 1}+`));
    li.appendChild(el("span", "ladder-v", "repeats the last value"));
    preview.appendChild(li);
  }
}

function ovhWireSettings() {
  const bind = (id, apply) => {
    const node = $(id);
    if (node) node.addEventListener("change", () => { apply(node.value); ovhTouchDraft(); });
  };
  bind("ovh-ed-title", (v) => { ovhDraft.title = v; });
  bind("ovh-ed-currency", (v) => { ovhDraft.settings.currency = v || "$"; });
  bind("ovh-ed-ladder", (v) => {
    const list = ovhParseNumberList(v);
    ovhDraft.settings.ladder = list.length ? list : window.OvhCore.DEFAULT_LADDER.slice();
  });
  bind("ovh-ed-secs", (v) => { ovhDraft.settings.answerSeconds = Math.max(0, Math.min(120, Math.round(Number(v) || 0))); });
  bind("ovh-ed-bonus", (v) => { ovhDraft.settings.bonusMultiplier = Math.max(1, Math.min(10, Math.round(Number(v) || 1))); });
  bind("ovh-ed-mobsize", (v) => { ovhDraft.settings.mobSize = Math.max(1, Math.min(100, Math.round(Number(v) || 1))); });
  window.OvhCore.HELP_KEYS.forEach((key) => {
    const box = $(`ovh-ed-help-${key}`);
    if (box) {
      box.addEventListener("change", () => {
        ovhDraft.settings.helps = Object.assign({}, ovhDraft.settings.helps);
        ovhDraft.settings.helps[key] = box.checked;
        ovhTouchDraft();
      });
    }
  });
}

/* ============ Question rows ============ */

function ovhLevelCounts() {
  const out = [];
  for (let level = 1; level <= window.OvhCore.LEVEL_MAX; level += 1) {
    out.push({ level, count: ovhDraft.questions.filter((q) => q.level === level).length });
  }
  return out;
}

function ovhRenderLevels() {
  const box = $("ovh-ed-levels");
  if (!box) return;
  box.replaceChildren();
  ovhLevelCounts().forEach((row) => {
    const chip = el("span", `gsc-chip level-chip ${row.count < 2 ? "is-thin" : ""}`.trim(),
      `L${row.level}: ${row.count}`);
    box.appendChild(chip);
  });
  setText("ovh-ed-count", `${ovhDraft.questions.length}`);
  const warnings = window.OvhCore.warningsFor(ovhSafeDraft());
  setText("ovh-editor-warn", warnings.join(" "));
}

/** The draft as the validator would see it, so a half-built set still counts. */
function ovhSafeDraft() {
  return ovhDraft;
}

function ovhRenderRows() {
  const box = $("ovh-ed-rows");
  if (!box) return;
  box.replaceChildren();
  const thin = new Set(ovhLevelCounts().filter((r) => r.count < 2).map((r) => r.level));
  ovhDraft.questions.forEach((row, index) => {
    if (ovhOnlyThin && !thin.has(row.level)) return;
    box.appendChild(ovhQuestionCard(row, index));
  });
  if (!box.childElementCount) {
    box.appendChild(el("p", "hint", ovhOnlyThin
      ? "Every level has at least two questions — nothing to fix."
      : "No questions yet. Press “+ Add a question”."));
  }
}

function ovhQuestionCard(row, index) {
  const card = el("div", "ed-row");
  const head = el("div", "ed-row-head");
  head.appendChild(el("span", "ed-row-n", `#${index + 1}`));
  head.appendChild(ovhLevelSelect(row));
  const cat = ovhTextField("Category", row.category || "", 30, (v) => { row.category = v; });
  cat.classList.add("ed-cat");
  head.appendChild(cat);
  const drop = el("button", "btn btn-ghost btn-small", "Remove");
  drop.type = "button";
  drop.addEventListener("click", () => {
    ovhDraft.questions.splice(index, 1);
    ovhTouchDraft();
  });
  head.appendChild(drop);
  card.appendChild(head);
  card.appendChild(ovhTextField("Question", row.q || "", 200, (v) => { row.q = v; }));
  const opts = el("div", "ed-options");
  // One radio group per question card, so exactly one option can be the answer.
  const group = `ovh-ans-${index}`;
  ["A", "B", "C"].forEach((letter, i) => opts.appendChild(ovhOptionRow(row, i, letter, group)));
  card.appendChild(opts);
  return card;
}

function ovhLevelSelect(row) {
  const label = el("label", "field field-inline");
  label.appendChild(el("span", "field-k", "Level"));
  const select = document.createElement("select");
  for (let level = 1; level <= window.OvhCore.LEVEL_MAX; level += 1) {
    const opt = document.createElement("option");
    opt.value = String(level);
    opt.textContent = String(level);
    if (row.level === level) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    row.level = Number(select.value);
    ovhTouchDraft();
  });
  label.appendChild(select);
  return label;
}

function ovhTextField(labelText, value, max, apply) {
  const label = el("label", "field");
  label.appendChild(el("span", "field-k", labelText));
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = max;
  input.value = value;
  input.autocomplete = "off";
  input.addEventListener("change", () => { apply(input.value); ovhSaveDraft(); ovhRenderLevels(); });
  label.appendChild(input);
  return label;
}

function ovhOptionRow(row, i, letter, group) {
  const wrap = el("div", "ed-option");
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = group;
  radio.checked = row.answer === i;
  radio.setAttribute("aria-label", `Option ${letter} is the correct answer`);
  radio.addEventListener("change", () => { row.answer = i; ovhTouchDraft(); });
  wrap.appendChild(radio);
  wrap.appendChild(el("span", "ed-letter", letter));
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 60;
  input.value = row.options[i] || "";
  input.autocomplete = "off";
  input.addEventListener("change", () => { row.options[i] = input.value; ovhSaveDraft(); });
  wrap.appendChild(input);
  return wrap;
}

/* ============ Rendering ============ */

function ovhRenderEditor() {
  if (!ovhDraft) return;
  ovhRenderSettings();
  ovhRenderLevels();
  ovhRenderRows();
}

/* ============ Downloading ============ */

function ovhDownload(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A safe bare `*.json` file name from the set's title. */
function ovhSlug(title) {
  const slug = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 55);
  // D11: "index" is the library manifest itself; never offer to overwrite it.
  const safe = !slug ? "my-set" : (slug === "index" ? "index-set" : slug);
  return `${safe}.json`;
}

function ovhValidateDraft() {
  window.OvhCore.validateGame(ovhDraft);
  return true;
}

function ovhEditorDownload() {
  try {
    ovhValidateDraft();
  } catch (err) {
    ovhEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  ovhDownload("questions.json", JSON.stringify(ovhDraft, null, 2));
  ovhEditorMessage("");
  show($("ovh-editor-library"), false);
}

/**
 * "Download for the library" (docs 19 §2). Static hosting cannot write files,
 * so the honest workflow is: download the set under a library file name, then
 * commit it and paste one line into sets/index.json. Both are spelled out.
 */
function ovhEditorLibraryDownload() {
  try {
    ovhValidateDraft();
  } catch (err) {
    ovhEditorMessage(`Fix this before adding it to the library: ${err.message}`);
    return;
  }
  const file = ovhSlug(ovhDraft.title);
  ovhDownload(file, JSON.stringify(ovhDraft, null, 2));
  ovhEditorMessage("");
  ovhShowRecipe(file);
}

function ovhShowRecipe(file) {
  const box = $("ovh-editor-library");
  const list = $("ovh-recipe");
  if (!box || !list) return;
  list.replaceChildren();
  [
    `Downloaded “${file}”. Put it in games/one-vs-100/sets/${file} in the repo.`,
    "Open games/one-vs-100/sets/index.json and add the line below to the list.",
    "Commit both files. The set then shows up in the library picker on the setup screen.",
  ].forEach((step) => list.appendChild(el("li", "recipe-step", step)));
  const entry = {
    file,
    name: (ovhDraft.title || "My set").slice(0, 60),
    description: `${ovhDraft.questions.length} three-option questions.`,
    by: "",
  };
  setText("ovh-manifest-line", `${JSON.stringify(entry, null, 2)},`);
  show(box, true);
}

function ovhEditorUse() {
  try {
    window.OvhApp.useGame(ovhDeepCopy(ovhDraft), "Custom questions (from the editor)", "editor");
    ovhCloseEditor();
  } catch (err) {
    ovhEditorMessage(`This game can’t be used yet: ${err.message}`);
  }
}

/* ============ Open / close ============ */

function ovhOpenEditor() {
  if (!ovhDraft) ovhDraft = ovhLoadDraft() || ovhStartingDraft();
  window.OvhApp.set({ editorOpen: true });
  ovhRenderEditor();
}

function ovhCloseEditor() {
  window.OvhApp.set({ editorOpen: false });
}

/** The draft a first-time editor opens: the game currently loaded. */
function ovhStartingDraft() {
  const app = window.OvhApp.state();
  if (app.game) return ovhDeepCopy(app.game);
  if (window.OVH_DEFAULT_GAME) return ovhDeepCopy(window.OVH_DEFAULT_GAME);
  return ovhBlankDraft();
}

/* ============ Wiring ============ */

function ovhWireEditor() {
  $("btn-editor").addEventListener("click", ovhOpenEditor);
  $("btn-editor-close").addEventListener("click", ovhCloseEditor);
  $("btn-editor-download").addEventListener("click", ovhEditorDownload);
  $("btn-editor-library").addEventListener("click", ovhEditorLibraryDownload);
  $("btn-editor-use").addEventListener("click", ovhEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    ovhDraft = ovhDeepCopy(window.OVH_DEFAULT_GAME || ovhBlankDraft());
    show($("ovh-editor-library"), false);     // D11: the old recipe no longer applies
    ovhTouchDraft();
  });
  $("btn-editor-blank").addEventListener("click", () => {
    ovhDraft = ovhBlankDraft();
    show($("ovh-editor-library"), false);
    ovhTouchDraft();
  });
  $("btn-ed-add").addEventListener("click", () => {
    const counts = ovhLevelCounts();
    const thinnest = counts.reduce((a, b) => (b.count < a.count ? b : a), counts[0]);
    ovhDraft.questions.push(ovhBlankQuestion(thinnest ? thinnest.level : 1));
    ovhTouchDraft();
  });
  $("ovh-ed-only-thin").addEventListener("change", (e) => { ovhOnlyThin = e.target.checked; ovhRenderRows(); });
  ovhWireSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ovhWireEditor);
  } else {
    ovhWireEditor();
  }
}

window.OvhEditor = {
  open: ovhOpenEditor,
  close: ovhCloseEditor,
  draft: () => ovhDraft,
  setDraft: (draft) => { ovhDraft = draft; ovhTouchDraft(); },
  slug: ovhSlug,
  DRAFT_KEY: OVH_DRAFT_KEY,
};

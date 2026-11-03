/* ============================================================
   Match Game — in-page prompt editor
   Build or tweak a prompt file, download it as prompts.json,
   download it ready for the repo's set library, or load it
   straight into the session. The working draft auto-saves under
   its own key so a refresh never loses work. Everything is built
   with createElement/textContent — no innerHTML anywhere.

   Both lists are one item per line: that is how a host actually
   has a list (pasted out of a notes app) and it is the only
   shape that stays usable at sixty prompts. A hint goes after a
   vertical bar:  Dizzy Daisy thought a ___ was edible. | food
   ============================================================ */

"use strict";

// Namespaced by ?store= the same way the saved game is (mg-app.js).
const MG_DRAFT_KEY = `gsc-mg-draft-v1${
  window.MgApp && window.MgApp.storeSuffix ? window.MgApp.storeSuffix() : ""}`;

let mgDraft = null;

/* ============ Draft plumbing ============ */

function mgDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function mgBlankDraft() {
  return {
    title: "My Match Game prompts",
    settings: Object.assign({}, window.MgCore.DEFAULT_SETTINGS, {
      audienceValues: window.MgCore.DEFAULT_SETTINGS.audienceValues.slice(),
      multipliers: window.MgCore.DEFAULT_SETTINGS.multipliers.slice(),
    }),
    prompts: [],
    audiencePrompts: [],
  };
}

function mgSaveDraft() {
  try {
    localStorage.setItem(MG_DRAFT_KEY, JSON.stringify(mgDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    mgEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function mgLoadDraft() {
  try {
    const raw = localStorage.getItem(MG_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.prompts)) return null;
    if (!Array.isArray(draft.audiencePrompts)) draft.audiencePrompts = [];
    if (!draft.settings || typeof draft.settings !== "object") {
      draft.settings = mgBlankDraft().settings;
    }
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function mgEditorMessage(message) {
  const node = $("mg-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** A text edit: persist and re-check, but never repaint (the caret lives there). */
function mgTouchDraft() {
  mgSaveDraft();
  mgRenderCounts();
  mgRenderWarnings();
}

/* ============ The two lists ============ */

/** "text | hint" per line; blank lines are skipped. */
function mgParseList(text) {
  return String(text).split("\n").map((line) => {
    const at = line.indexOf("|");
    const body = at < 0 ? line : line.slice(0, at);
    const hint = at < 0 ? "" : line.slice(at + 1);
    return { text: body.trim(), hint: hint.trim() };
  }).filter((row) => row.text);
}

function mgListText(list) {
  return list.map((row) => (row.hint ? `${row.text} | ${row.hint}` : row.text)).join("\n");
}

/**
 * Every line the validator would refuse, in the host's language. The core
 * throws on the FIRST problem; the editor is more useful when it lists them.
 */
function mgLineProblems(list, needBlank, label) {
  const out = [];
  const seen = new Map();
  const max = window.MgContent.PROMPT_MAX;
  list.forEach((row, i) => {
    const where = `${label} line ${i + 1}`;
    if (row.text.length > max) out.push(`${where} is longer than ${max} characters`);
    if (needBlank && row.text.indexOf(window.MgContent.BLANK) < 0) {
      out.push(`${where} has no ${window.MgContent.BLANK} blank`);
    }
    const key = row.text.toLowerCase();
    if (seen.has(key)) out.push(`${where} repeats line ${seen.get(key) + 1}`);
    else seen.set(key, i);
  });
  return out;
}

/* ============ Settings pane ============ */

const MG_ED_NUMBERS = [
  ["mg-ed-panel", "panelSize", 2, 6],
  ["mg-ed-rounds", "rounds", 1, 6],
  ["mg-ed-points", "pointsPerMatch", 1, 100],
];

function mgRenderSettings() {
  const s = mgDraft.settings;
  $("mg-ed-title").value = mgDraft.title || "";
  $("mg-ed-currency").value = s.currency || "$";
  MG_ED_NUMBERS.forEach(([id, key]) => { $(id).value = String(s[key]); });
  $("mg-ed-values").value = (s.audienceValues || []).join(", ");
  $("mg-ed-mult").value = (s.multipliers || []).join(", ");
  $("mg-ed-rule").checked = s.secondRoundRule === true;
}

function mgEdNumbers(text, count) {
  const list = String(text).split(",").map((n) => Math.round(Number(n.trim())))
    .filter((n) => Number.isInteger(n) && n >= 1);
  if (count && list.length !== count) return null;
  return list.length ? list.slice(0, 6) : null;
}

function mgWireSettings() {
  $("mg-ed-title").addEventListener("input", (e) => { mgDraft.title = e.target.value; mgTouchDraft(); });
  $("mg-ed-currency").addEventListener("input", (e) => {
    mgDraft.settings.currency = e.target.value.slice(0, 3);
    mgTouchDraft();
  });
  MG_ED_NUMBERS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) {
        e.target.value = String(mgDraft.settings[key]);
        mgEditorMessage(`That has to be a whole number between ${lo} and ${hi}.`);
        return;
      }
      mgDraft.settings[key] = value;
      mgTouchDraft();
    });
  });
  $("mg-ed-values").addEventListener("change", (e) => {
    const list = mgEdNumbers(e.target.value, 3);
    if (!list) {
      e.target.value = mgDraft.settings.audienceValues.join(", ");
      mgEditorMessage("The Audience Match needs exactly three values, like 500, 250, 100.");
      return;
    }
    mgDraft.settings.audienceValues = list;
    mgTouchDraft();
  });
  $("mg-ed-mult").addEventListener("change", (e) => {
    const list = mgEdNumbers(e.target.value, 0);
    if (!list) {
      e.target.value = mgDraft.settings.multipliers.join(", ");
      mgEditorMessage("The multipliers are a comma-separated list of whole numbers, like 10, 20, 30.");
      return;
    }
    mgDraft.settings.multipliers = list;
    mgTouchDraft();
  });
  $("mg-ed-rule").addEventListener("change", (e) => {
    mgDraft.settings.secondRoundRule = e.target.checked;
    mgTouchDraft();
  });
  $("mg-ed-prompts").addEventListener("input", (e) => {
    mgDraft.prompts = mgParseList(e.target.value);
    mgTouchDraft();
  });
  $("mg-ed-audience").addEventListener("input", (e) => {
    mgDraft.audiencePrompts = mgParseList(e.target.value);
    mgTouchDraft();
  });
}

/* ============ Counts, warnings, whole render ============ */

function mgRenderCounts() {
  setText("mg-ed-count", String(mgDraft.prompts.length));
  setText("mg-ed-aud-count", String(mgDraft.audiencePrompts.length));
  $("mg-ed-prompts").classList.toggle("ed-bad",
    mgDraft.prompts.length < window.MgContent.MIN_PROMPTS);
  $("mg-ed-audience").classList.toggle("ed-bad",
    mgDraft.audiencePrompts.length < window.MgContent.MIN_AUDIENCE);
}

function mgRenderWarnings() {
  const node = $("mg-editor-warn");
  const problems = mgLineProblems(mgDraft.prompts, true, "Prompt")
    .concat(mgLineProblems(mgDraft.audiencePrompts, false, "Audience prompt"));
  if (problems.length) {
    node.textContent = "";
    mgEditorMessage(`Fix these lines: ${problems.slice(0, 4).join("; ")}`
      + (problems.length > 4 ? ` (and ${problems.length - 4} more)` : ""));
    return;
  }
  try {
    window.MgCore.validateGame(mgDraft);
    const warnings = window.MgCore.warningsFor(mgDraft);
    node.textContent = warnings.length ? warnings.join(" ") : "This file is ready to play.";
    mgEditorMessage("");
  } catch (err) {
    node.textContent = "";
    mgEditorMessage(`Not playable yet: ${err.message}`);
  }
}

function mgRenderEditor() {
  if (!mgDraft) return;
  mgRenderSettings();
  $("mg-ed-prompts").value = mgListText(mgDraft.prompts);
  $("mg-ed-audience").value = mgListText(mgDraft.audiencePrompts);
  mgRenderCounts();
  mgRenderWarnings();
}

/* ============ Downloads ============ */

function mgDownloadJson(name) {
  const blob = new Blob([JSON.stringify(mgDraft, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mgCheckedDraft() {
  try {
    window.MgCore.validateGame(mgDraft);
    return true;
  } catch (err) {
    mgEditorMessage(`Fix this before downloading: ${err.message}`);
    return false;
  }
}

function mgEditorDownload() {
  if (!mgCheckedDraft()) return;
  mgDownloadJson("prompts.json");
  mgEditorMessage("");
}

/** A file name the manifest can use: lower case, hyphens, .json. */
function mgSlug(title) {
  const slug = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40);
  return `${slug || "my-set"}.json`;
}

/**
 * docs/19 §2: static hosting cannot write files, so the honest workflow is a
 * download plus the exact manifest line to paste. Both are shown on screen.
 */
function mgEditorLibrary() {
  if (!mgCheckedDraft()) return;
  const file = mgSlug(mgDraft.title);
  mgDownloadJson(file);
  const entry = {
    file,
    name: window.MgContent.cleanText(mgDraft.title, 60) || "My set",
    description: "Describe this set in a sentence.",
    by: "you",
    counts: { prompts: mgDraft.prompts.length, "audience prompts": mgDraft.audiencePrompts.length },
  };
  const node = $("mg-editor-manifest");
  node.textContent = [
    `1. Save the download as  games/match-game/sets/${file}`,
    "2. Add this line to the list in  games/match-game/sets/index.json :",
    "",
    `${JSON.stringify(entry, null, 2)}`,
    "",
    "3. Commit both files. The set then shows up in the picker on the setup screen.",
  ].join("\n");
  show(node, true);
  mgEditorMessage("");
}

/* ============ Actions ============ */

function mgEditorUse() {
  try {
    window.MgApp.useGame(mgDeepCopy(mgDraft), "Custom prompts (from the editor)", "editor", null);
    mgCloseEditor();
  } catch (err) {
    mgEditorMessage(`This file can’t be used yet: ${err.message}`);
  }
}

/** The draft a first-time editor opens: the file currently loaded. */
function mgStartingDraft() {
  const app = window.MgApp.state();
  if (app.game) return mgDeepCopy(app.game);
  if (globalThis.MG_DEFAULT_GAME) return mgDeepCopy(globalThis.MG_DEFAULT_GAME);
  return mgBlankDraft();
}

function mgOpenEditor() {
  if (!mgDraft) mgDraft = mgLoadDraft() || mgStartingDraft();
  window.MgApp.set({ editorOpen: true });
  mgRenderEditor();
}

function mgCloseEditor() {
  window.MgApp.set({ editorOpen: false });
}

/* ============ Wiring ============ */

function mgWireEditor() {
  $("btn-editor").addEventListener("click", mgOpenEditor);
  $("btn-editor-close").addEventListener("click", mgCloseEditor);
  $("btn-editor-download").addEventListener("click", mgEditorDownload);
  $("btn-editor-library").addEventListener("click", mgEditorLibrary);
  $("btn-editor-use").addEventListener("click", mgEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    mgDraft = mgDeepCopy(globalThis.MG_DEFAULT_GAME || mgBlankDraft());
    mgSaveDraft();
    mgRenderEditor();
  });
  $("btn-editor-blank").addEventListener("click", () => {
    mgDraft = mgBlankDraft();
    mgSaveDraft();
    mgRenderEditor();
  });
  mgWireSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mgWireEditor);
  } else {
    mgWireEditor();
  }
}

window.MgEditor = {
  open: mgOpenEditor,
  close: mgCloseEditor,
  draft: () => mgDraft,
  setDraft: (draft) => { mgDraft = draft; mgSaveDraft(); mgRenderEditor(); },
  parseList: mgParseList,
  slug: mgSlug,
  DRAFT_KEY: MG_DRAFT_KEY,
};

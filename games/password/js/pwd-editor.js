/* ============================================================
   Password — in-page word editor
   Build or tweak a word list, download it as words.json, or load
   it straight into the session. The working draft auto-saves
   under its own key so a refresh never loses work. Everything is
   built with createElement/textContent — no innerHTML anywhere.

   The list is one textarea, one password per line: that is how a
   host actually has a list (pasted from a notes app), and it is
   the only shape that stays usable at two hundred words. Typing
   never rebuilds the field — it re-counts and re-validates.
   ============================================================ */

"use strict";

const PWD_DRAFT_KEY = "gsc-pwd-draft-v1";

let pwdDraft = null;

/* ============ Draft plumbing ============ */

function pwdDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function pwdBlankDraft() {
  return {
    title: "My Password list",
    settings: Object.assign({}, window.PwdCore.DEFAULT_SETTINGS),
    words: [],
  };
}

function pwdSaveDraft() {
  try {
    localStorage.setItem(PWD_DRAFT_KEY, JSON.stringify(pwdDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    pwdEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function pwdLoadDraft() {
  try {
    const raw = localStorage.getItem(PWD_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.words)) return null;
    if (!draft.settings || typeof draft.settings !== "object") draft.settings = pwdBlankDraft().settings;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function pwdEditorMessage(message) {
  const node = $("pwd-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** A text edit: persist and re-check, but never repaint (the caret lives there). */
function pwdTouchDraft() {
  pwdSaveDraft();
  pwdRenderCounts();
  pwdRenderWarnings();
}

/* ============ The word list ============ */

/** One password per line; blank lines are simply skipped. */
function pwdParseWords(text) {
  return String(text).split("\n").map((line) => line.trim()).filter(Boolean);
}

function pwdWordsText() {
  return pwdDraft.words.join("\n");
}

/**
 * Every line the validator would refuse, in the host's language. The core
 * throws on the FIRST problem; the editor is more useful when it lists them.
 */
function pwdLineProblems(list) {
  const out = [];
  const seen = new Map();
  const Content = window.PwdContent;
  list.forEach((word, i) => {
    const where = `line ${i + 1} (“${word}”)`;
    if (word.length > Content.WORD_MAX) out.push(`${where} is longer than ${Content.WORD_MAX} characters`);
    else if (word.indexOf(" ") >= 0) out.push(`${where} has a space — one word only`);
    else if (!Content.WORD_SHAPE.test(word)) out.push(`${where} has a character that is not a letter`);
    const key = word.toLowerCase();
    if (seen.has(key)) out.push(`${where} repeats line ${seen.get(key) + 1}`);
    else seen.set(key, i);
  });
  return out;
}

/* ============ Settings pane ============ */

const PWD_ED_NUMBERS = [
  ["pwd-ed-target", "targetScore", 5, 100],
  ["pwd-ed-start", "startValue", 3, 20],
  ["pwd-ed-lsecs", "lightningSeconds", 15, 180],
  ["pwd-ed-lwords", "lightningWords", 1, 10],
  ["pwd-ed-lvalue", "lightningValue", 1, 1000000],
];

function pwdRenderSettings() {
  const s = pwdDraft.settings;
  $("pwd-ed-title").value = pwdDraft.title || "";
  $("pwd-ed-currency").value = s.currency || "$";
  PWD_ED_NUMBERS.forEach(([id, key]) => { $(id).value = String(s[key]); });
  $("pwd-ed-bonus").checked = s.allFiveBonus !== false;
  $("pwd-ed-swap").checked = s.swapRoles !== false;
}

function pwdWireSettings() {
  $("pwd-ed-title").addEventListener("input", (e) => { pwdDraft.title = e.target.value; pwdTouchDraft(); });
  $("pwd-ed-currency").addEventListener("input", (e) => {
    pwdDraft.settings.currency = e.target.value.slice(0, 3);
    pwdTouchDraft();
  });
  PWD_ED_NUMBERS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) {
        e.target.value = String(pwdDraft.settings[key]);
        pwdEditorMessage(`That has to be a whole number between ${lo} and ${hi}.`);
        return;
      }
      pwdDraft.settings[key] = value;
      pwdTouchDraft();
    });
  });
  $("pwd-ed-bonus").addEventListener("change", (e) => {
    pwdDraft.settings.allFiveBonus = e.target.checked;
    pwdTouchDraft();
  });
  $("pwd-ed-swap").addEventListener("change", (e) => {
    pwdDraft.settings.swapRoles = e.target.checked;
    pwdTouchDraft();
  });
  $("pwd-ed-words").addEventListener("input", (e) => {
    pwdDraft.words = pwdParseWords(e.target.value);
    pwdTouchDraft();
  });
}

/* ============ Counts, warnings, whole render ============ */

function pwdRenderCounts() {
  const count = pwdDraft.words.length;
  setText("pwd-ed-count", `${count}`);
  const field = $("pwd-ed-words");
  field.classList.toggle("ed-bad", count < window.PwdContent.MIN_WORDS);
}

function pwdRenderWarnings() {
  const node = $("pwd-editor-warn");
  const problems = pwdLineProblems(pwdDraft.words);
  if (problems.length) {
    node.textContent = "";
    pwdEditorMessage(`Fix these lines: ${problems.slice(0, 4).join("; ")}`
      + (problems.length > 4 ? ` (and ${problems.length - 4} more)` : ""));
    return;
  }
  try {
    window.PwdCore.validateGame(pwdDraft);
    const warnings = window.PwdCore.warningsFor(pwdDraft);
    node.textContent = warnings.length ? warnings.join(" ") : "This list is ready to play.";
    pwdEditorMessage("");
  } catch (err) {
    node.textContent = "";
    pwdEditorMessage(`Not playable yet: ${err.message}`);
  }
}

function pwdRenderEditor() {
  if (!pwdDraft) return;
  pwdRenderSettings();
  $("pwd-ed-words").value = pwdWordsText();
  pwdRenderCounts();
  pwdRenderWarnings();
}

/* ============ Actions ============ */

function pwdEditorDownload() {
  try {
    window.PwdCore.validateGame(pwdDraft);
  } catch (err) {
    pwdEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  const blob = new Blob([JSON.stringify(pwdDraft, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "words.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  pwdEditorMessage("");
}

function pwdEditorUse() {
  try {
    window.PwdApp.useGame(pwdDeepCopy(pwdDraft), "Custom words (from the editor)", "editor");
    pwdCloseEditor();
  } catch (err) {
    pwdEditorMessage(`This list can’t be used yet: ${err.message}`);
  }
}

/** The draft a first-time editor opens: the list currently loaded. */
function pwdStartingDraft() {
  const app = window.PwdApp.state();
  if (app.game) return pwdDeepCopy(app.game);
  if (globalThis.PWD_DEFAULT_GAME) return pwdDeepCopy(globalThis.PWD_DEFAULT_GAME);
  return pwdBlankDraft();
}

function pwdOpenEditor() {
  if (!pwdDraft) pwdDraft = pwdLoadDraft() || pwdStartingDraft();
  window.PwdApp.set({ editorOpen: true });
  pwdRenderEditor();
}

function pwdCloseEditor() {
  window.PwdApp.set({ editorOpen: false });
}

/* ============ Wiring ============ */

function pwdWireEditor() {
  $("btn-editor").addEventListener("click", pwdOpenEditor);
  $("btn-editor-close").addEventListener("click", pwdCloseEditor);
  $("btn-editor-download").addEventListener("click", pwdEditorDownload);
  $("btn-editor-use").addEventListener("click", pwdEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    pwdDraft = pwdDeepCopy(globalThis.PWD_DEFAULT_GAME || pwdBlankDraft());
    pwdSaveDraft();
    pwdRenderEditor();
  });
  $("btn-editor-blank").addEventListener("click", () => {
    pwdDraft = pwdBlankDraft();
    pwdSaveDraft();
    pwdRenderEditor();
  });
  pwdWireSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pwdWireEditor);
  } else {
    pwdWireEditor();
  }
}

window.PwdEditor = {
  open: pwdOpenEditor,
  close: pwdCloseEditor,
  draft: () => pwdDraft,
  setDraft: (draft) => { pwdDraft = draft; pwdSaveDraft(); pwdRenderEditor(); },
  DRAFT_KEY: PWD_DRAFT_KEY,
};

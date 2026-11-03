/* ============================================================
   The Chase — in-page question editor
   Build or tweak a question set, download it as questions.json,
   download it for the repo library (docs 19 §2), or load it
   straight into the session. The working draft auto-saves under
   its own key so a refresh never loses work. Everything is built
   with createElement/textContent — no innerHTML anywhere.

   Both lists are plain textareas, one question per line, because
   that is how a host actually has a list (pasted from a notes
   app) and it is the only shape that stays usable at two hundred
   questions. Typing never rebuilds the field — it re-counts and
   re-validates.
   ============================================================ */

"use strict";

// Namespaced by ?store= the same way the saved game is (chase-app.js).
const CHASE_DRAFT_KEY = `gsc-chase-draft-v1${
  window.ChaseApp && window.ChaseApp.storeSuffix ? window.ChaseApp.storeSuffix() : ""}`;

const CHASE_SEP = "|";
const CHASE_LETTERS = ["A", "B", "C"];

let chaseDraft = null;

/* ============ Draft plumbing ============ */

function chaseDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function chaseBlankDraft() {
  return {
    title: "My Chase questions",
    settings: Object.assign({}, window.ChaseCore.DEFAULT_SETTINGS),
    rapid: [],
    multi: [],
  };
}

function chaseSaveDraft() {
  try {
    localStorage.setItem(CHASE_DRAFT_KEY, JSON.stringify(chaseDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    chaseEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function chaseLoadDraft() {
  try {
    const raw = localStorage.getItem(CHASE_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.rapid) || !Array.isArray(draft.multi)) return null;
    if (!draft.settings || typeof draft.settings !== "object") draft.settings = chaseBlankDraft().settings;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function chaseEditorMessage(message) {
  const node = $("chase-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** A text edit: persist and re-check, but never repaint (the caret lives there). */
function chaseTouchDraft() {
  chaseSaveDraft();
  chaseRenderCounts();
  chaseRenderWarnings();
}

/* ============ The two lists ============ */

function chaseSplit(line) {
  return String(line).split(CHASE_SEP).map((part) => part.trim());
}

/** "Question? | Answer" per line; blank lines are simply skipped. */
function chaseParseRapid(text) {
  return String(text).split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = chaseSplit(line);
    return { q: parts[0] || "", a: parts.slice(1).join(` ${CHASE_SEP} `) || "" };
  });
}

/** "Question? | A | B | C | letter" per line. */
function chaseParseMulti(text) {
  return String(text).split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = chaseSplit(line);
    const letter = String(parts[4] || "").toUpperCase();
    const named = CHASE_LETTERS.indexOf(letter);
    const numbered = Number(parts[4]);
    return {
      q: parts[0] || "",
      options: [parts[1] || "", parts[2] || "", parts[3] || ""],
      answer: named >= 0 ? named : (Number.isInteger(numbered) ? numbered : -1),
    };
  });
}

function chaseRapidText() {
  return chaseDraft.rapid.map((r) => `${r.q} ${CHASE_SEP} ${r.a}`).join("\n");
}

function chaseMultiText() {
  return chaseDraft.multi.map((m) => [m.q].concat(m.options)
    .concat([CHASE_LETTERS[m.answer] || "?"]).join(` ${CHASE_SEP} `)).join("\n");
}

/**
 * Every line the validator would refuse, in the host's language. The core
 * throws on the FIRST problem; the editor is more useful when it lists them.
 */
function chaseLineProblems(draft) {
  const out = [];
  const seen = new Set();
  draft.rapid.forEach((r, i) => {
    if (!r.q) out.push(`rapid-fire line ${i + 1} has no question`);
    else if (!r.a) out.push(`rapid-fire line ${i + 1} has no answer after the bar`);
    if (r.q && seen.has(r.q.toLowerCase())) out.push(`rapid-fire line ${i + 1} repeats an earlier question`);
    if (r.q) seen.add(r.q.toLowerCase());
  });
  const seenMulti = new Set();
  draft.multi.forEach((m, i) => {
    const where = `head-to-head line ${i + 1}`;
    if (!m.q) out.push(`${where} has no question`);
    if (m.options.some((o) => !o)) out.push(`${where} needs all three options, separated by bars`);
    if (m.answer < 0 || m.answer > 2) out.push(`${where} must end in A, B or C`);
    if (m.q && seenMulti.has(m.q.toLowerCase())) out.push(`${where} repeats an earlier question`);
    if (m.q) seenMulti.add(m.q.toLowerCase());
  });
  return out;
}

/* ============ Settings pane ============ */

const CHASE_ED_NUMBERS = [
  ["chase-ed-steps", "steps", 3, 12],
  ["chase-ed-start", "startStep", 2, 10],
  ["chase-ed-cbvalue", "cashBuilderValue", 1, 1000000],
  ["chase-ed-cbsecs", "cashBuilderSeconds", 15, 300],
  ["chase-ed-higher", "higherMultiplier", 2, 100],
  ["chase-ed-lower", "lowerDivisor", 2, 10],
  ["chase-ed-final", "finalSeconds", 30, 600],
];

function chaseRenderSettings() {
  const s = chaseDraft.settings;
  $("chase-ed-title").value = chaseDraft.title || "";
  $("chase-ed-currency").value = s.currency || "$";
  $("chase-ed-chasername").value = s.chaserName || "The Chaser";
  CHASE_ED_NUMBERS.forEach(([id, key]) => { $(id).value = String(s[key]); });
}

function chaseWireSettings() {
  $("chase-ed-title").addEventListener("input", (e) => { chaseDraft.title = e.target.value; chaseTouchDraft(); });
  $("chase-ed-currency").addEventListener("input", (e) => {
    chaseDraft.settings.currency = e.target.value.slice(0, 3);
    chaseTouchDraft();
  });
  $("chase-ed-chasername").addEventListener("input", (e) => {
    chaseDraft.settings.chaserName = e.target.value.slice(0, 24);
    chaseTouchDraft();
  });
  CHASE_ED_NUMBERS.forEach(([id, key, lo, hi]) => {
    $(id).addEventListener("change", (e) => {
      const value = Math.round(Number(e.target.value));
      if (!Number.isFinite(value) || value < lo || value > hi) {
        e.target.value = String(chaseDraft.settings[key]);
        chaseEditorMessage(`That has to be a whole number between ${lo} and ${hi}.`);
        return;
      }
      chaseDraft.settings[key] = value;
      chaseTouchDraft();
    });
  });
  $("chase-ed-rapid").addEventListener("input", (e) => {
    chaseDraft.rapid = chaseParseRapid(e.target.value);
    chaseTouchDraft();
  });
  $("chase-ed-multi").addEventListener("input", (e) => {
    chaseDraft.multi = chaseParseMulti(e.target.value);
    chaseTouchDraft();
  });
}

/* ============ Counts, warnings, whole render ============ */

function chaseRenderCounts() {
  setText("chase-ed-rapid-count", `${chaseDraft.rapid.length}`);
  setText("chase-ed-multi-count", `${chaseDraft.multi.length}`);
  $("chase-ed-rapid").classList.toggle("ed-bad", chaseDraft.rapid.length < window.ChaseContent.MIN_RAPID);
  $("chase-ed-multi").classList.toggle("ed-bad", chaseDraft.multi.length < window.ChaseContent.MIN_MULTI);
}

function chaseRenderWarnings() {
  const node = $("chase-editor-warn");
  const problems = chaseLineProblems(chaseDraft);
  if (problems.length) {
    node.textContent = "";
    chaseEditorMessage(`Fix these lines: ${problems.slice(0, 4).join("; ")}`
      + (problems.length > 4 ? ` (and ${problems.length - 4} more)` : ""));
    return;
  }
  try {
    window.ChaseCore.validateGame(chaseDraft);
    const warnings = window.ChaseCore.warningsFor(chaseDraft);
    node.textContent = warnings.length ? warnings.join(" ") : "This set is ready to play.";
    chaseEditorMessage("");
  } catch (err) {
    node.textContent = "";
    chaseEditorMessage(`Not playable yet: ${err.message}`);
  }
}

function chaseRenderEditor() {
  if (!chaseDraft) return;
  chaseRenderSettings();
  $("chase-ed-rapid").value = chaseRapidText();
  $("chase-ed-multi").value = chaseMultiText();
  chaseRenderCounts();
  chaseRenderWarnings();
}

/* ============ Actions ============ */

function chaseDownload(name) {
  const blob = new Blob([JSON.stringify(chaseDraft, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function chaseEditorDownload() {
  try {
    window.ChaseCore.validateGame(chaseDraft);
  } catch (err) {
    chaseEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  chaseDownload("questions.json");
  show($("chase-editor-manifest"), false);
  chaseEditorMessage("");
}

/** A file name a manifest will accept: lower case, no spaces, no slashes. */
function chaseSlug(title) {
  const slug = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "").replace(/-+$/, "").slice(0, 40);
  return `${slug || "my-set"}.json`;
}

/**
 * Static hosting cannot write files, so "Download for the library" is honest
 * about the workflow: download the set, drop it in sets/, and paste one line
 * into the manifest. The line is built here so nobody has to count questions.
 */
function chaseEditorLibrary() {
  try {
    window.ChaseCore.validateGame(chaseDraft);
  } catch (err) {
    chaseEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  const file = chaseSlug(chaseDraft.title);
  chaseDownload(file);
  const entry = {
    file,
    name: (chaseDraft.title || "My set").slice(0, 60),
    description: `${chaseDraft.rapid.length} rapid-fire and ${chaseDraft.multi.length} head-to-head questions.`,
    by: "you",
    counts: { "rapid-fire": chaseDraft.rapid.length, "head-to-head": chaseDraft.multi.length },
  };
  setText("chase-manifest-path", `games/the-chase/sets/${file}`);
  setText("chase-manifest-line", `${JSON.stringify(entry)},`);
  show($("chase-editor-manifest"), true);
  chaseEditorMessage("");
}

function chaseEditorUse() {
  try {
    window.ChaseApp.useGame(chaseDeepCopy(chaseDraft), "Custom questions (from the editor)", "editor");
    chaseCloseEditor();
  } catch (err) {
    chaseEditorMessage(`This set can’t be used yet: ${err.message}`);
  }
}

/** The draft a first-time editor opens: the set currently loaded. */
function chaseStartingDraft() {
  const app = window.ChaseApp.state();
  if (app.game) return chaseDeepCopy(app.game);
  if (globalThis.CHASE_DEFAULT_GAME) return chaseDeepCopy(globalThis.CHASE_DEFAULT_GAME);
  return chaseBlankDraft();
}

function chaseOpenEditor() {
  if (!chaseDraft) chaseDraft = chaseLoadDraft() || chaseStartingDraft();
  window.ChaseApp.set({ editorOpen: true });
  chaseRenderEditor();
}

function chaseCloseEditor() {
  window.ChaseApp.set({ editorOpen: false });
}

/* ============ Wiring ============ */

function chaseWireEditor() {
  $("btn-editor").addEventListener("click", chaseOpenEditor);
  $("btn-editor-close").addEventListener("click", chaseCloseEditor);
  $("btn-editor-download").addEventListener("click", chaseEditorDownload);
  $("btn-editor-library").addEventListener("click", chaseEditorLibrary);
  $("btn-editor-use").addEventListener("click", chaseEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    chaseDraft = chaseDeepCopy(globalThis.CHASE_DEFAULT_GAME || chaseBlankDraft());
    chaseSaveDraft();
    chaseRenderEditor();
  });
  $("btn-editor-blank").addEventListener("click", () => {
    chaseDraft = chaseBlankDraft();
    chaseSaveDraft();
    chaseRenderEditor();
  });
  chaseWireSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", chaseWireEditor);
  } else {
    chaseWireEditor();
  }
}

window.ChaseEditor = {
  open: chaseOpenEditor,
  close: chaseCloseEditor,
  draft: () => chaseDraft,
  setDraft: (draft) => { chaseDraft = draft; chaseSaveDraft(); chaseRenderEditor(); },
  parseRapid: chaseParseRapid,
  parseMulti: chaseParseMulti,
  slug: chaseSlug,
  DRAFT_KEY: CHASE_DRAFT_KEY,
};

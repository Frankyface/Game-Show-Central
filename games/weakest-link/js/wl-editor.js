/* ============================================================
   Weakest Link — in-page question editor
   Build or tweak a game, paste a block of CSV/TSV questions,
   download it as questions.json, or load it straight into the
   session. The working draft auto-saves under its own key so a
   refresh never loses work. Everything is built with
   createElement/textContent — no innerHTML anywhere.
   ============================================================ */

"use strict";

const WL_DRAFT_KEY = "gsc-wl-draft-v1";

let wlDraft = null;

/* ============ Draft plumbing ============ */

function wlDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function wlBlankDraft() {
  return {
    title: "My Weakest Link",
    settings: {
      currency: "$",
      chain: window.WlCore.DEFAULT_CHAIN.slice(),
      roundSeconds: window.WlCore.DEFAULT_ROUND_SECONDS.slice(),
      finalPlayers: 2,
      finalQuestionsEach: 5,
      finalMultiplier: 3,
      topOfChainEndsRound: true,
    },
    questions: [{ q: "", a: "", category: "" }],
  };
}

function wlSaveDraft() {
  try {
    localStorage.setItem(WL_DRAFT_KEY, JSON.stringify(wlDraft));
    wlEditorMessage("");
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    wlEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function wlLoadDraft() {
  try {
    const raw = localStorage.getItem(WL_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.questions)) return null;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function wlEditorMessage(message) {
  const node = $("wl-editor-msg");
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Delimited import ============ */

/** One CSV line into fields, honouring "quoted, fields". */
function wlParseCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out;
}

/**
 * Parse pasted rows. A line containing a tab is treated as TSV (questions are
 * full of commas, so tabs win); anything else is parsed as CSV.
 * @returns {{rows:Array<{q:string,a:string,category:string}>, skipped:number}}
 */
function wlParseDelimited(text) {
  const rows = [];
  let skipped = 0;
  String(text).split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const fields = line.indexOf("\t") >= 0 ? line.split("\t") : wlParseCsvLine(line);
    const q = window.WlCore.cleanText(fields[0], 200);
    const a = window.WlCore.cleanText(fields[1], 80);
    const category = window.WlCore.cleanText(fields[2], 30);
    if (!q || !a) { skipped += 1; return; }
    rows.push({ q, a, category });
  });
  return { rows, skipped };
}

function wlImportPaste() {
  const box = $("wl-ed-paste");
  const { rows, skipped } = wlParseDelimited(box.value);
  if (!rows.length) {
    setText("wl-ed-import-msg", "Nothing to import — each line needs a question and an answer.");
    return;
  }
  // Drop a single trailing blank row so a fresh blank draft does not keep it.
  const existing = wlDraft.questions.filter((r) => r.q.trim() || r.a.trim());
  wlDraft.questions = existing.concat(rows);
  box.value = "";
  setText("wl-ed-import-msg",
    `Imported ${rows.length} question${rows.length === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} unusable line${skipped === 1 ? "" : "s"}` : ""}.`);
  wlSaveDraft();
  wlRenderEditor();
}

/* ============ Rendering ============ */

function wlEditorInput(value, max, onChange) {
  const input = el("input");
  input.type = "text";
  input.maxLength = max;
  input.autocomplete = "off";
  input.value = value || "";
  input.addEventListener("input", () => { onChange(input.value); wlSaveDraft(); wlRenderEditorCount(); });
  return input;
}

function wlRenderRows() {
  const body = $("wl-ed-rows");
  body.replaceChildren();
  wlDraft.questions.forEach((row, i) => {
    const tr = el("tr");
    tr.appendChild(el("td", "row-num", i + 1));
    const q = el("td");
    q.appendChild(wlEditorInput(row.q, 200, (v) => { row.q = v; }));
    tr.appendChild(q);
    const a = el("td");
    a.appendChild(wlEditorInput(row.a, 80, (v) => { row.a = v; }));
    tr.appendChild(a);
    const c = el("td");
    c.appendChild(wlEditorInput(row.category, 30, (v) => { row.category = v; }));
    tr.appendChild(c);
    const actions = el("td");
    const remove = el("button", "btn btn-ghost btn-small", "✕");
    remove.type = "button";
    remove.title = `Remove question ${i + 1}`;
    remove.addEventListener("click", () => {
      wlDraft.questions.splice(i, 1);
      if (!wlDraft.questions.length) wlDraft.questions.push({ q: "", a: "", category: "" });
      wlSaveDraft();
      wlRenderEditor();
    });
    actions.appendChild(remove);
    tr.appendChild(actions);
    body.appendChild(tr);
  });
}

function wlRenderEditorCount() {
  const count = wlDraft.questions.filter((r) => r.q.trim() && r.a.trim()).length;
  const badge = $("wl-ed-count");
  badge.textContent = String(count);
  badge.classList.toggle("warn", count < window.WlCore.WARN_QUESTIONS);
  const warnings = window.WlCore.warningsFor({ questions: wlDraft.questions.filter((r) => r.q.trim()) });
  setText("wl-editor-warn", warnings.join(" "));
}

function wlRenderEditorSettings() {
  const s = wlDraft.settings;
  $("wl-ed-title").value = wlDraft.title || "";
  $("wl-ed-currency").value = s.currency || "$";
  $("wl-ed-chain").value = (s.chain || []).join(", ");
  $("wl-ed-seconds").value = (s.roundSeconds || []).join(", ");
  $("wl-ed-final-q").value = s.finalQuestionsEach;
  $("wl-ed-multiplier").value = s.finalMultiplier;
  $("wl-ed-top-ends").checked = !!s.topOfChainEndsRound;
}

function wlRenderEditor() {
  wlRenderEditorSettings();
  wlRenderRows();
  wlRenderEditorCount();
}

/* ============ Settings binding ============ */

function wlNumberList(text) {
  return String(text).split(",").map((part) => Number(part.trim())).filter((n) => Number.isFinite(n));
}

function wlBindSettings() {
  const bind = (id, apply) => {
    $(id).addEventListener("change", () => { apply($(id)); wlSaveDraft(); wlRenderEditorCount(); });
  };
  bind("wl-ed-title", (node) => { wlDraft.title = node.value; });
  bind("wl-ed-currency", (node) => { wlDraft.settings.currency = node.value || "$"; });
  bind("wl-ed-chain", (node) => { wlDraft.settings.chain = wlNumberList(node.value); });
  bind("wl-ed-seconds", (node) => { wlDraft.settings.roundSeconds = wlNumberList(node.value); });
  bind("wl-ed-final-q", (node) => { wlDraft.settings.finalQuestionsEach = Number(node.value); });
  bind("wl-ed-multiplier", (node) => { wlDraft.settings.finalMultiplier = Number(node.value); });
  bind("wl-ed-top-ends", (node) => { wlDraft.settings.topOfChainEndsRound = node.checked; });
}

/* ============ Actions ============ */

/** The draft with blank rows dropped — what gets validated, used and saved. */
function wlCleanDraft() {
  const copy = wlDeepCopy(wlDraft);
  copy.questions = copy.questions.filter((r) => r.q.trim() && r.a.trim());
  copy.settings.finalPlayers = 2;
  return copy;
}

function wlEditorUse() {
  try {
    const game = wlCleanDraft();
    window.WlCore.validateGame(game);
    window.WlApp.useGame(game, "Questions from the editor", "editor");
    wlCloseEditor();
  } catch (err) {
    wlEditorMessage(err.message);
  }
}

function wlEditorDownload() {
  let game;
  try {
    game = wlCleanDraft();
    window.WlCore.validateGame(game);
  } catch (err) {
    wlEditorMessage(`${err.message} — fix that before downloading.`);
    return;
  }
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = "questions.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  wlEditorMessage("");
}

function wlOpenEditor() {
  if (!wlDraft) {
    const saved = wlLoadDraft();
    const current = window.WlApp.state().game;
    wlDraft = saved || (current ? wlDeepCopy(current) : wlBlankDraft());
    if (!Array.isArray(wlDraft.settings && wlDraft.settings.chain)) {
      wlDraft.settings = wlBlankDraft().settings;
    }
  }
  show($("screen-editor"), true);
  window.WlApp.render();   // wlRender() hides every game screen while this is open
  wlRenderEditor();
}

function wlCloseEditor() {
  show($("screen-editor"), false);
  window.WlApp.render();
}

function wlWireEditor() {
  $("btn-editor").addEventListener("click", wlOpenEditor);
  $("btn-editor-close").addEventListener("click", wlCloseEditor);
  $("btn-editor-use").addEventListener("click", wlEditorUse);
  $("btn-editor-download").addEventListener("click", wlEditorDownload);
  $("btn-editor-reset").addEventListener("click", () => {
    wlDraft = wlDeepCopy(window.WL_DEFAULT_GAME);
    wlSaveDraft();
    wlRenderEditor();
    wlEditorMessage("");
  });
  $("btn-editor-blank").addEventListener("click", () => {
    wlDraft = wlBlankDraft();
    wlSaveDraft();
    wlRenderEditor();
    wlEditorMessage("");
  });
  $("btn-ed-import").addEventListener("click", wlImportPaste);
  $("btn-ed-add").addEventListener("click", () => {
    wlDraft.questions.push({ q: "", a: "", category: "" });
    wlSaveDraft();
    wlRenderEditor();
  });
  wlBindSettings();
}

/** Exposed for tests/harness.html (K-I5). */
window.WlEditor = {
  open: wlOpenEditor,
  close: wlCloseEditor,
  parseDelimited: wlParseDelimited,
  draft: () => wlDraft,
  DRAFT_KEY: WL_DRAFT_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wlWireEditor);
} else {
  wlWireEditor();
}

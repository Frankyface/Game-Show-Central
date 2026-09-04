/* ============================================================
   Chain Reaction — in-page chain editor
   Build or tweak a set of chains, download it as chains.json, or
   load it straight into the session. Every word gets live
   validation as it is typed — length, letters, and whether it
   clashes with another word in the same chain — because a chain
   with one bad word is unplayable and the host should find out
   now, not at Start. The working draft auto-saves under its own
   key so a refresh never loses work. Everything is built with
   createElement/textContent — no innerHTML anywhere.
   ============================================================ */

"use strict";

const CR_DRAFT_KEY = "gsc-cr-draft-v1";

let crDraft = null;
let crEdTab = "chains";          // "chains" | "speedChains"

/* ============ Draft plumbing ============ */

function crDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function crBlankChain() {
  return ["", "", "", "", "", "", "", ""];
}

function crBlankDraft() {
  const s = window.CrCore.DEFAULT_SETTINGS;
  const chains = [];
  for (let i = 0; i < window.CrCore.MIN_CHAINS; i += 1) chains.push(crBlankChain());
  return {
    title: "My Chain Reaction",
    settings: {
      currency: s.currency,
      values: s.values.slice(),
      speedSeconds: s.speedSeconds,
      speedPerWord: s.speedPerWord,
      speedAllClear: s.speedAllClear,
      speedAllClearLabel: s.speedAllClearLabel,
      revealOnWrong: s.revealOnWrong,
    },
    chains,
    speedChains: [crBlankChain(), crBlankChain()],
  };
}

function crSaveDraft() {
  try {
    localStorage.setItem(CR_DRAFT_KEY, JSON.stringify(crDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    crEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function crLoadDraft() {
  try {
    const raw = localStorage.getItem(CR_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.chains)) return null;
    if (!Array.isArray(draft.speedChains)) draft.speedChains = [crBlankChain(), crBlankChain()];
    if (!draft.settings) draft.settings = crBlankDraft().settings;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function crEditorMessage(message) {
  const node = $("cr-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/** Every structural change goes through here: persist, then repaint. */
function crTouchDraft() {
  crSaveDraft();
  crRenderEditor();
}

/* ============ Settings pane ============ */

function crParseList(text) {
  return String(text).split(",")
    .map((part) => Math.round(Number(part.trim())))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, window.CrCore.DEFAULT_SETTINGS.values.length + 3);
}

function crRenderSettings() {
  const s = crDraft.settings;
  const put = (id, value) => { const node = $(id); if (node && document.activeElement !== node) node.value = String(value); };
  put("cr-ed-title", crDraft.title || "");
  put("cr-ed-currency", s.currency || "$");
  put("cr-ed-values", (s.values || []).join(", "));
  put("cr-ed-seconds", s.speedSeconds);
  put("cr-ed-per-word", s.speedPerWord);
  put("cr-ed-all-clear", s.speedAllClear);
  put("cr-ed-all-clear-label", s.speedAllClearLabel || "");
  $("cr-ed-reveal-wrong").checked = !!s.revealOnWrong;
}

function crWireSettings() {
  const on = (id, handler) => $(id).addEventListener("input", handler);
  on("cr-ed-title", (e) => { crDraft.title = e.target.value; crSaveDraft(); });
  on("cr-ed-currency", (e) => { crDraft.settings.currency = e.target.value.slice(0, 3); crSaveDraft(); });
  on("cr-ed-values", (e) => {
    const values = crParseList(e.target.value);
    if (values.length) crDraft.settings.values = values;
    crSaveDraft();
    crRenderWarnings();
  });
  const number = (id, key) => on(id, (e) => {
    const n = Math.round(Number(e.target.value));
    if (Number.isFinite(n) && n >= 0) crDraft.settings[key] = n;
    crSaveDraft();
    crRenderWarnings();
  });
  number("cr-ed-seconds", "speedSeconds");
  number("cr-ed-per-word", "speedPerWord");
  number("cr-ed-all-clear", "speedAllClear");
  on("cr-ed-all-clear-label", (e) => { crDraft.settings.speedAllClearLabel = e.target.value.slice(0, 16); crSaveDraft(); });
  $("cr-ed-reveal-wrong").addEventListener("change", (e) => {
    crDraft.settings.revealOnWrong = e.target.checked;
    crSaveDraft();
  });
}

/* ============ Chain cards ============ */

function crActiveList() {
  return crEdTab === "speedChains" ? crDraft.speedChains : crDraft.chains;
}

/**
 * One editable chain: eight stacked fields, each with its own live problem
 * line, plus the pair label that says which phrase the word has to make.
 */
function crChainCard(chain, index) {
  const card = el("div", "ed-chain");
  const head = el("div", "ed-chain-head");
  head.appendChild(el("span", "ed-chain-title", `${crEdTab === "speedChains" ? "Speed" : "Chain"} ${index + 1}`));
  const remove = el("button", "btn btn-ghost btn-small gsc-btn gsc-btn-ghost gsc-btn-sm", "✕");
  remove.type = "button";
  remove.title = `Remove chain ${index + 1}`;
  remove.addEventListener("click", () => { crActiveList().splice(index, 1); crTouchDraft(); });
  head.appendChild(remove);
  card.appendChild(head);

  const problems = [];
  const links = [];
  for (let i = 0; i < window.CrCore.CHAIN_LENGTH; i += 1) {
    const box = el("div", "ed-word");
    const field = el("input");
    field.type = "text";
    field.maxLength = window.CrCore.MAX_WORD_CHARS;
    field.value = chain[i] || "";
    field.autocomplete = "off";
    field.spellcheck = false;
    field.placeholder = `Word ${i + 1}`;
    field.setAttribute("aria-label", `Chain ${index + 1}, word ${i + 1}`);
    const problem = el("p", "ed-word-problem");
    problem.id = `cr-ed-p-${crEdTab}-${index}-${i}`;
    field.setAttribute("aria-describedby", problem.id);
    field.addEventListener("input", (e) => {
      chain[i] = e.target.value;
      crSaveDraft();
      crPaintCard(chain, problems, links, card);
      crRenderWarnings();
    });
    box.appendChild(field);
    box.appendChild(problem);
    card.appendChild(box);
    problems.push({ field, problem });
    if (i < window.CrCore.CHAIN_LENGTH - 1) {
      const link = el("p", "ed-word-link");
      card.appendChild(link);
      links.push(link);
    }
  }
  crPaintCard(chain, problems, links, card);
  return card;
}

/** Repaint one card's validation without rebuilding it (typing keeps focus). */
function crPaintCard(chain, problems, links, card) {
  let bad = false;
  problems.forEach((row, i) => {
    const message = window.CrCore.wordProblem(chain[i], chain, i);
    row.problem.textContent = message;
    row.field.classList.toggle("is-bad", !!message);
    row.field.setAttribute("aria-invalid", message ? "true" : "false");
    if (message) bad = true;
  });
  links.forEach((link, i) => {
    const a = window.CrCore.cleanWord(chain[i]);
    const b = window.CrCore.cleanWord(chain[i + 1]);
    link.textContent = a && b ? `↳ ${a} ${b}` : "↳ needs to make a phrase";
  });
  card.classList.toggle("is-bad", bad);
}

function crRenderRows() {
  const host = $("cr-ed-rows");
  host.replaceChildren();
  const list = crActiveList();
  list.forEach((chain, index) => host.appendChild(crChainCard(chain, index)));
  setText("cr-ed-count", `${list.length}`);
  $("btn-ed-tab-chains").setAttribute("aria-selected", String(crEdTab === "chains"));
  $("btn-ed-tab-speed").setAttribute("aria-selected", String(crEdTab === "speedChains"));
  $("btn-ed-add").textContent = crEdTab === "speedChains" ? "+ Add a speed chain" : "+ Add a chain";
}

/* ============ Whole-editor render ============ */

function crRenderEditor() {
  if (!crDraft) return;
  crRenderSettings();
  crRenderRows();
  crRenderWarnings();
}

function crRenderWarnings() {
  const node = $("cr-editor-warn");
  try {
    window.CrCore.validateGame(crDraft);
    const warnings = window.CrCore.warningsFor(crDraft);
    node.textContent = warnings.length ? warnings.join(" ") : "This file is ready to play.";
    crEditorMessage("");
  } catch (err) {
    node.textContent = "";
    crEditorMessage(`Not playable yet: ${err.message}`);
  }
}

/* ============ Actions ============ */

function crEditorDownload() {
  try {
    window.CrCore.validateGame(crDraft);
  } catch (err) {
    crEditorMessage(`Fix this before downloading: ${err.message}`);
    return;
  }
  const blob = new Blob([JSON.stringify(crDraft, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "chains.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  crEditorMessage("");
}

function crEditorUse() {
  try {
    window.CrApp.useGame(crDeepCopy(crDraft), "Custom chains (from the editor)", "editor");
    crCloseEditor();
  } catch (err) {
    crEditorMessage(`These chains can’t be used yet: ${err.message}`);
  }
}

/** The draft a first-time editor opens: the game currently loaded. */
function crStartingDraft() {
  const app = window.CrApp.state();
  if (app.game) return crDeepCopy(app.game);
  if (globalThis.CR_DEFAULT_GAME) return crDeepCopy(globalThis.CR_DEFAULT_GAME);
  return crBlankDraft();
}

function crOpenEditor() {
  if (!crDraft) crDraft = crLoadDraft() || crStartingDraft();
  window.CrApp.set({ editorOpen: true });
  crRenderEditor();
}

function crCloseEditor() {
  window.CrApp.set({ editorOpen: false });
}

/* ============ Wiring ============ */

function crWireEditor() {
  $("btn-editor").addEventListener("click", crOpenEditor);
  $("btn-editor-close").addEventListener("click", crCloseEditor);
  $("btn-editor-download").addEventListener("click", crEditorDownload);
  $("btn-editor-use").addEventListener("click", crEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    crDraft = crDeepCopy(globalThis.CR_DEFAULT_GAME || crBlankDraft());
    crTouchDraft();
  });
  $("btn-editor-blank").addEventListener("click", () => { crDraft = crBlankDraft(); crTouchDraft(); });
  $("btn-ed-add").addEventListener("click", () => { crActiveList().push(crBlankChain()); crTouchDraft(); });
  $("btn-ed-tab-chains").addEventListener("click", () => { crEdTab = "chains"; crRenderRows(); });
  $("btn-ed-tab-speed").addEventListener("click", () => { crEdTab = "speedChains"; crRenderRows(); });
  crWireSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", crWireEditor);
  } else {
    crWireEditor();
  }
}

window.CrEditor = {
  open: crOpenEditor,
  close: crCloseEditor,
  draft: () => crDraft,
  setDraft: (draft) => { crDraft = draft; crTouchDraft(); },
  tab: (name) => { crEdTab = name === "speedChains" ? "speedChains" : "chains"; crRenderRows(); },
  DRAFT_KEY: CR_DRAFT_KEY,
};

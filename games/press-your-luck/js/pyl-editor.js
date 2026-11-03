/* ============================================================
   Press Your Luck — in-page board editor
   Build or tweak a board and its questions, download it as
   board.json, or load it straight into the session. The board is
   edited as the board: eighteen cards laid out in the same
   rectangle the host screen paints, each one a type, an amount
   and (for a prize) a name, with the Whammy count checked live —
   a board with two Whammies is unplayable and the host should
   find out now, not at Start.

   "Download for the library" (cross-cutting 19 §2) downloads the
   file AND prints the exact manifest line to paste into
   sets/index.json, because static hosting cannot write files.

   Everything is built with createElement and textContent:
   never innerHTML, anywhere.
   ============================================================ */

"use strict";

// Same `?store=NAME` namespace as the saved game (pyl-app.js pylStoreSuffix).
const PYL_DRAFT_KEY = `gsc-pyl-draft-v1${window.PylApp.storeSuffix()}`;

let pylDraft = null;
let pylEdTab = "boards";
let pylEdBoard = 0;

/* ============ Draft plumbing ============ */

function pylDeepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function pylBlankBoard() {
  const board = [];
  for (let i = 0; i < window.PylCore.SQUARES; i += 1) {
    board.push(i % 5 === 2 && board.filter((s) => s.whammy).length < 3 ? { whammy: true } : { cash: 100 * (i + 1) });
  }
  return board;
}

function pylBlankQuestion(i) {
  return { q: "", options: ["", "", ""], answer: 0 };
}

function pylBlankDraft() {
  const s = window.PylCore.DEFAULT_SETTINGS;
  const questions = [];
  for (let i = 0; i < window.PylCore.MIN_QUESTIONS; i += 1) questions.push(pylBlankQuestion(i));
  return {
    title: "My Press Your Luck",
    settings: {
      currency: s.currency, questionsPerRound: s.questionsPerRound, buzzSpins: s.buzzSpins,
      pickSpins: s.pickSpins, whammyLimit: s.whammyLimit, rounds: s.rounds, rotate: s.rotate,
    },
    boards: [pylBlankBoard(), pylBlankBoard()],
    questions,
  };
}

function pylSaveDraft() {
  try {
    localStorage.setItem(PYL_DRAFT_KEY, JSON.stringify(pylDraft));
  } catch (err) {
    console.warn("Could not save the editor draft:", err);
    pylEditorMessage("This browser can’t auto-save the draft. Use Download JSON to keep your work.");
  }
}

function pylLoadDraft() {
  try {
    const raw = localStorage.getItem(PYL_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.boards) || !Array.isArray(draft.questions)) return null;
    if (!draft.settings) draft.settings = pylBlankDraft().settings;
    return draft;
  } catch (err) {
    console.warn("Ignoring a corrupt editor draft:", err);
    return null;
  }
}

function pylEditorMessage(message) {
  const node = $("pyl-editor-msg");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

function pylTouchDraft() {
  pylSaveDraft();
  pylRenderEditor();
}

/* ============ Squares ============ */

const PYL_SQUARE_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "spin", label: "Cash + one spin" },
  { value: "prize", label: "Prize" },
  { value: "whammy", label: "Whammy" },
];

function pylSquareType(square) {
  if (!square || square.whammy) return "whammy";
  if (typeof square.prize === "string" && square.prize) return "prize";
  return square.spin ? "spin" : "cash";
}

function pylSquareAmount(square) {
  if (!square || square.whammy) return "";
  return String(pylSquareType(square) === "prize" ? (square.value || "") : (square.cash || ""));
}

/** Rebuild a square around a new type, keeping whatever still makes sense. */
function pylRetypeSquare(square, type) {
  const amount = Number(pylSquareAmount(square)) || 500;
  if (type === "whammy") return { whammy: true };
  if (type === "prize") return { prize: (square && square.prize) || "A prize", value: amount };
  if (type === "spin") return { cash: amount, spin: true };
  return { cash: amount };
}

function pylSetSquare(index, patch) {
  const board = pylDraft.boards[pylEdBoard];
  if (!board) return;
  board[index] = patch;
  pylTouchDraft();
}

function pylSquareCard(square, index) {
  const card = el("div", "ed-square");
  const pos = window.PylView.tilePosition(index);
  card.style.gridRow = String(pos.row);
  card.style.gridColumn = String(pos.col);
  const type = pylSquareType(square);
  if (type === "whammy") card.classList.add("is-whammy");

  const select = el("select", "ed-type");
  select.setAttribute("aria-label", `Square ${index + 1} type`);
  PYL_SQUARE_TYPES.forEach((opt) => {
    const option = el("option", null, opt.label);
    option.value = opt.value;
    if (opt.value === type) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener("change", (e) => pylSetSquare(index, pylRetypeSquare(square, e.target.value)));
  card.appendChild(select);

  if (type === "prize") {
    const name = el("input", "ed-prize");
    name.type = "text";
    name.maxLength = window.PylCore.PRIZE_MAX || 40;
    name.value = square.prize || "";
    name.setAttribute("aria-label", `Square ${index + 1} prize name`);
    name.addEventListener("input", (e) => {
      pylDraft.boards[pylEdBoard][index] = Object.assign({}, pylDraft.boards[pylEdBoard][index], { prize: e.target.value });
      pylSaveDraft();
      pylPaintProblems();
    });
    card.appendChild(name);
  }

  if (type !== "whammy") {
    const amount = el("input", "ed-amount");
    amount.type = "number";
    amount.min = "1";
    amount.step = "1";
    amount.inputMode = "numeric";
    amount.value = pylSquareAmount(square);
    amount.setAttribute("aria-label", `Square ${index + 1} amount`);
    amount.addEventListener("input", (e) => {
      const n = Math.round(Number(e.target.value));
      const next = Object.assign({}, pylDraft.boards[pylEdBoard][index]); // the live square, not the render-time copy
      if (type === "prize") next.value = n; else next.cash = n;
      pylDraft.boards[pylEdBoard][index] = next;
      pylSaveDraft();
      pylPaintProblems();
    });
    card.appendChild(amount);
  }

  const problem = el("p", "ed-problem", window.PylCore.squareProblem(square));
  card.appendChild(problem);
  return card;
}

function pylRenderBoardTab(box) {
  const bar = el("div", "ed-board-bar");
  pylDraft.boards.forEach((board, i) => {
    const btn = el("button", `btn btn-ghost btn-small gsc-btn gsc-btn-sm ed-board-pick${i === pylEdBoard ? " is-on" : ""}`,
      `Board ${i + 1}`);
    btn.type = "button";
    btn.addEventListener("click", () => { pylEdBoard = i; pylRenderEditor(); });
    bar.appendChild(btn);
  });
  const add = el("button", "btn btn-ghost btn-small gsc-btn gsc-btn-ghost gsc-btn-sm", "+ Board");
  add.type = "button";
  add.addEventListener("click", () => {
    pylDraft.boards.push(pylBlankBoard());
    pylEdBoard = pylDraft.boards.length - 1;
    pylTouchDraft();
  });
  bar.appendChild(add);
  if (pylDraft.boards.length > 1) {
    const remove = el("button", "btn btn-ghost btn-small gsc-btn gsc-btn-ghost gsc-btn-sm", "Remove this board");
    remove.type = "button";
    remove.addEventListener("click", () => {
      pylDraft.boards.splice(pylEdBoard, 1);
      pylEdBoard = Math.max(0, pylEdBoard - 1);
      pylTouchDraft();
    });
    bar.appendChild(remove);
  }
  box.appendChild(bar);

  const grid = el("div", "ed-board");
  const board = pylDraft.boards[pylEdBoard] || [];
  for (let i = 0; i < window.PylCore.SQUARES; i += 1) {
    if (!board[i]) board[i] = { cash: 100 };
    grid.appendChild(pylSquareCard(board[i], i));
  }
  const middle = el("div", "ed-board-middle");
  middle.style.gridRow = `2 / ${window.PylView.ROWS}`;
  middle.style.gridColumn = `2 / ${window.PylView.COLS}`;
  middle.appendChild(el("p", "ed-board-count", pylBoardSummary(board)));
  grid.appendChild(middle);
  box.appendChild(grid);
}

function pylBoardSummary(board) {
  const whammies = board.filter((sq) => sq && sq.whammy).length;
  const spins = board.filter((sq) => sq && sq.spin).length;
  return `${board.length} squares · ${whammies} Whammies (3–6 needed) · ${spins} "+ one spin"`;
}

/* ============ Questions ============ */

function pylQuestionRow(question, index) {
  const row = el("div", "ed-question");
  const head = el("div", "ed-q-head");
  head.appendChild(el("span", "ed-q-no", `Q${index + 1}`));
  const remove = el("button", "btn btn-ghost btn-small gsc-btn gsc-btn-ghost gsc-btn-sm", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => { pylDraft.questions.splice(index, 1); pylTouchDraft(); });
  head.appendChild(remove);
  row.appendChild(head);

  const text = el("input", "ed-q-text");
  text.type = "text";
  text.maxLength = 200;
  text.value = question.q || "";
  text.placeholder = "The question";
  text.setAttribute("aria-label", `Question ${index + 1}`);
  text.addEventListener("input", (e) => { question.q = e.target.value; pylSaveDraft(); pylPaintProblems(); });
  row.appendChild(text);

  const options = el("div", "ed-q-options");
  for (let i = 0; i < window.PylCore.OPTIONS; i += 1) {
    const wrap = el("label", "ed-q-option");
    const radio = el("input");
    radio.type = "radio";
    radio.name = `pyl-answer-${index}`;
    radio.checked = question.answer === i;
    radio.setAttribute("aria-label", `Option ${window.PylCore.letterFor(i)} is the answer`);
    radio.addEventListener("change", () => { question.answer = i; pylTouchDraft(); });
    const field = el("input", "ed-q-opt-text");
    field.type = "text";
    field.maxLength = 60;
    field.value = (question.options && question.options[i]) || "";
    field.placeholder = `Option ${window.PylCore.letterFor(i)}`;
    field.setAttribute("aria-label", `Question ${index + 1} option ${window.PylCore.letterFor(i)}`);
    field.addEventListener("input", (e) => {
      if (!Array.isArray(question.options)) question.options = ["", "", ""];
      question.options[i] = e.target.value;
      pylSaveDraft();
      pylPaintProblems();
    });
    wrap.appendChild(radio);
    wrap.appendChild(field);
    options.appendChild(wrap);
  }
  row.appendChild(options);
  return row;
}

function pylRenderQuestionTab(box) {
  const list = el("div", "ed-questions");
  pylDraft.questions.forEach((question, i) => list.appendChild(pylQuestionRow(question, i)));
  box.appendChild(list);
}

/* ============ The editor screen ============ */

function pylPaintProblems() {
  const warn = $("pyl-editor-warn");
  if (!warn) return;
  const problems = [];
  try {
    window.PylCore.validateGame(pylDraft);
  } catch (err) {
    problems.push(err.message);
  }
  const notes = problems.length ? problems : window.PylCore.warningsFor(pylDraft);
  warn.textContent = notes.length ? notes.join("  ·  ") : "This file is ready to play.";
  warn.classList.toggle("is-bad", problems.length > 0);
}

function pylRenderEditor() {
  if (!pylDraft) return;
  const set = (id, value) => {
    const node = $(id);
    if (node && node.value !== String(value)) node.value = String(value);
  };
  set("pyl-ed-title", pylDraft.title || "");
  set("pyl-ed-currency", pylDraft.settings.currency);
  set("pyl-ed-qpr", pylDraft.settings.questionsPerRound);
  set("pyl-ed-rounds", pylDraft.settings.rounds);
  set("pyl-ed-buzz", pylDraft.settings.buzzSpins);
  set("pyl-ed-pick", pylDraft.settings.pickSpins);
  set("pyl-ed-limit", pylDraft.settings.whammyLimit);
  const rotate = $("pyl-ed-rotate");
  if (rotate) rotate.checked = !!pylDraft.settings.rotate;

  $("btn-ed-tab-board").setAttribute("aria-selected", String(pylEdTab === "boards"));
  $("btn-ed-tab-questions").setAttribute("aria-selected", String(pylEdTab === "questions"));
  $("btn-ed-tab-board").classList.toggle("is-on", pylEdTab === "boards");
  $("btn-ed-tab-questions").classList.toggle("is-on", pylEdTab === "questions");
  setText("pyl-ed-count", pylEdTab === "boards"
    ? `${pylDraft.boards.length} board(s)`
    : `${pylDraft.questions.length} question(s)`);
  const add = $("btn-ed-add");
  if (add) add.textContent = pylEdTab === "boards" ? "+ Add a board" : "+ Add a question";

  const box = $("pyl-ed-rows");
  box.replaceChildren();
  if (pylEdTab === "boards") pylRenderBoardTab(box);
  else pylRenderQuestionTab(box);
  pylPaintProblems();
}

/* ============ Actions ============ */

function pylDownload(name) {
  const blob = new Blob([JSON.stringify(pylDraft, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pylReadyToDownload() {
  try {
    window.PylCore.validateGame(pylDraft);
    return true;
  } catch (err) {
    pylEditorMessage(`Fix this before downloading: ${err.message}`);
    return false;
  }
}

function pylEditorDownload() {
  if (!pylReadyToDownload()) return;
  pylDownload("board.json");
  pylEditorMessage("");
}

/** A safe bare file name for the library folder. */
function pylSlug(title) {
  const slug = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "my-set"}.json`;
}

/**
 * Cross-cutting 19 §2: static hosting cannot write files, so the honest
 * workflow is "download it, commit it, paste this line".
 */
function pylEditorLibrary() {
  if (!pylReadyToDownload()) return;
  const file = pylSlug(pylDraft.title);
  pylDownload(file);
  const entry = {
    file,
    name: window.PylCore.cleanText(pylDraft.title, 60) || "My set",
    description: `${pylDraft.boards.length} board(s), ${pylDraft.questions.length} questions.`,
    by: "you",
  };
  setText("pyl-editor-share-path", `games/press-your-luck/sets/${file}`);
  const line = $("pyl-editor-share-line");
  if (line) line.textContent = `${JSON.stringify(entry, null, 2)},`;
  show($("pyl-editor-share"), true);
  pylEditorMessage("");
}

function pylEditorUse() {
  try {
    window.PylApp.useGame(pylDeepCopy(pylDraft), "Custom board (from the editor)", "editor");
    pylCloseEditor();
  } catch (err) {
    pylEditorMessage(`This board can’t be used yet: ${err.message}`);
  }
}

/** The draft a first-time editor opens: the game currently loaded. */
function pylStartingDraft() {
  const app = window.PylApp.state();
  if (app.game) return pylDeepCopy(app.game);
  if (globalThis.PYL_DEFAULT_GAME) return pylDeepCopy(globalThis.PYL_DEFAULT_GAME);
  return pylBlankDraft();
}

function pylOpenEditor() {
  if (!pylDraft) pylDraft = pylLoadDraft() || pylStartingDraft();
  pylEdBoard = Math.min(pylEdBoard, pylDraft.boards.length - 1);
  window.PylApp.set({ editorOpen: true });
  pylRenderEditor();
}

function pylCloseEditor() {
  window.PylApp.set({ editorOpen: false });
}

/* ============ Wiring ============ */

function pylWireEditorSettings() {
  const text = (id, key, max) => $(id).addEventListener("input", (e) => {
    pylDraft.settings[key] = e.target.value.slice(0, max);
    pylSaveDraft();
    pylPaintProblems();
  });
  $("pyl-ed-title").addEventListener("input", (e) => {
    pylDraft.title = e.target.value.slice(0, 80);
    pylSaveDraft();
  });
  text("pyl-ed-currency", "currency", 3);
  const number = (id, key, lo, hi) => $(id).addEventListener("input", (e) => {
    const n = Math.round(Number(e.target.value));
    if (!Number.isFinite(n) || n < lo || n > hi) return;
    pylDraft.settings[key] = n;
    pylSaveDraft();
    pylPaintProblems();
  });
  number("pyl-ed-qpr", "questionsPerRound", 1, 12);
  number("pyl-ed-rounds", "rounds", 1, 6);
  number("pyl-ed-buzz", "buzzSpins", 0, 10);
  number("pyl-ed-pick", "pickSpins", 0, 10);
  number("pyl-ed-limit", "whammyLimit", 1, 10);
  $("pyl-ed-rotate").addEventListener("change", (e) => {
    pylDraft.settings.rotate = e.target.checked;
    pylSaveDraft();
  });
}

function pylWireEditor() {
  $("btn-editor").addEventListener("click", pylOpenEditor);
  $("btn-editor-close").addEventListener("click", pylCloseEditor);
  $("btn-editor-download").addEventListener("click", pylEditorDownload);
  $("btn-editor-library").addEventListener("click", pylEditorLibrary);
  $("btn-editor-use").addEventListener("click", pylEditorUse);
  $("btn-editor-reset").addEventListener("click", () => {
    pylDraft = pylDeepCopy(globalThis.PYL_DEFAULT_GAME || pylBlankDraft());
    pylEdBoard = 0;
    pylTouchDraft();
  });
  $("btn-editor-blank").addEventListener("click", () => {
    pylDraft = pylBlankDraft();
    pylEdBoard = 0;
    pylTouchDraft();
  });
  $("btn-ed-add").addEventListener("click", () => {
    if (pylEdTab === "boards") {
      pylDraft.boards.push(pylBlankBoard());
      pylEdBoard = pylDraft.boards.length - 1;
    } else {
      pylDraft.questions.push(pylBlankQuestion(pylDraft.questions.length));
    }
    pylTouchDraft();
  });
  $("btn-ed-tab-board").addEventListener("click", () => { pylEdTab = "boards"; pylRenderEditor(); });
  $("btn-ed-tab-questions").addEventListener("click", () => { pylEdTab = "questions"; pylRenderEditor(); });
  pylWireEditorSettings();
}

if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pylWireEditor);
  } else {
    pylWireEditor();
  }
}

window.PylEditor = {
  open: pylOpenEditor,
  close: pylCloseEditor,
  draft: () => pylDraft,
  setDraft: (draft) => { pylDraft = draft; pylEdBoard = 0; pylTouchDraft(); },
  tab: (name) => { pylEdTab = name === "questions" ? "questions" : "boards"; pylRenderEditor(); },
  board: (index) => { pylEdBoard = index; pylRenderEditor(); },
  slug: pylSlug,
  DRAFT_KEY: PYL_DRAFT_KEY,
};

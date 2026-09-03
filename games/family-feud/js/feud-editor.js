/* ============================================================
   Family Feud — built-in question editor (spec 03 §6)
   Build or tweak a survey file in the browser, download it as
   questions.json, or load it straight into the current session.
   The working draft auto-saves to localStorage under its own key
   so a refresh never loses work. Everything goes through the same
   FeudCore.validateGame the loader uses, so what downloads is what
   the game will accept.
   ============================================================ */

"use strict";

const FeudEditor = (function () {
  const { $, el, button, show } = window.FeudApp.helpers;
  const EDITOR_KEY = "gsc-family-feud-draft-v1";
  const DEFAULT_ANSWERS = 4;

  let draft = null;

  const core = () => window.FeudCore;
  const deepCopy = (value) => JSON.parse(JSON.stringify(value));

  /* ============ Templates ============ */

  function blankQuestion() {
    const answers = [];
    for (let i = 0; i < DEFAULT_ANSWERS; i += 1) answers.push({ text: "", count: 10 });
    return { question: "", answers };
  }

  function blankDraft() {
    return {
      title: "My Family Feud Game",
      settings: {
        strikes: 3,
        multipliers: [1, 1, 2, 3],
        fastMoney: { enabled: false, target: 200, timer1: 20, timer2: 25 },
      },
      rounds: [blankQuestion()],
      fastMoney: [],
    };
  }

  /** Fill in any slice a hand-edited or older draft is missing. */
  function normalizeDraft(value) {
    const out = value && typeof value === "object" ? value : blankDraft();
    if (!Array.isArray(out.rounds) || !out.rounds.length) out.rounds = [blankQuestion()];
    if (!Array.isArray(out.fastMoney)) out.fastMoney = [];
    if (!out.settings || typeof out.settings !== "object") out.settings = blankDraft().settings;
    const fm = out.settings.fastMoney;
    if (!fm || typeof fm !== "object") {
      out.settings.fastMoney = { ...blankDraft().settings.fastMoney, enabled: out.fastMoney.length >= 5 };
    }
    return out;
  }

  /* ============ Draft persistence ============ */

  function saveDraft() {
    try {
      localStorage.setItem(EDITOR_KEY, JSON.stringify(draft));
      $("editor-save-warning").textContent = "";
    } catch (err) {
      console.warn("Could not save the editor draft:", err);
      $("editor-save-warning").textContent =
        "Draft too large to auto-save in this browser — use Download JSON to keep your work.";
    }
    renderWarnings();
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(EDITOR_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rounds) || !parsed.rounds.length) return null;
      return normalizeDraft(parsed);
    } catch (err) {
      console.warn("Ignoring a corrupt editor draft:", err);
      return null;
    }
  }

  /* ============ Open / close ============ */

  function open() {
    const state = window.FeudApp.getState();
    draft = loadDraft() || normalizeDraft(state && state.game ? deepCopy(state.game) : blankDraft());
    document.body.classList.add("editor-open");
    show($("screen-editor"), true);
    renderEditor();
    $("editor-title").focus();
  }

  function close() {
    saveDraft();
    document.body.classList.remove("editor-open");
    show($("screen-editor"), false);
  }

  function resetTo(next) {
    draft = normalizeDraft(next);
    saveDraft();
    setError("");
    renderEditor();
  }

  const setError = (msg) => { $("editor-error").textContent = msg || ""; };

  /* ============ Export ============ */

  /** A clean copy for validation/export: trimmed strings, numeric counts. */
  function cleanDraft() {
    const out = deepCopy(draft);
    out.title = String(out.title || "").trim();
    if (!out.title) delete out.title;
    const tidy = (q) => ({
      question: String(q.question || "").trim(),
      answers: q.answers.map((a) => ({
        text: String(a.text || "").trim(),
        count: Number.parseInt(a.count, 10),
      })),
    });
    out.rounds = out.rounds.map(tidy);
    out.fastMoney = out.fastMoney.map(tidy);
    if (!out.fastMoney.length) delete out.fastMoney;
    return out;
  }

  function validateDraft() {
    try {
      core().validateGame(cleanDraft());
      setError("");
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  function download() {
    if (!validateDraft()) return;
    const json = `${JSON.stringify(cleanDraft(), null, 2)}\n`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "questions.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function useInGame() {
    if (!validateDraft()) return;
    const state = window.FeudApp.getState();
    if (state && state.phase !== "setup" &&
        !window.confirm("Use these questions now? The game in progress will be reset (teams are kept).")) {
      return;
    }
    const next = window.FeudApp.stateForGame(cleanDraft(), {
      source: "question editor", sourceKind: "upload", sourceUrl: null,
    }, { teamNames: state.teams.map((t) => t.name), roster: state.roster });
    window.FeudApp.setState(next);
    close();
  }

  /* ============ Rendering ============ */

  function renderEditor() {
    $("editor-title").value = draft.title || "";
    $("editor-strikes").value = String(draft.settings.strikes);
    $("editor-multipliers").value = draft.settings.multipliers.join(", ");
    $("editor-fm-target").value = String(draft.settings.fastMoney.target);
    $("editor-fm-timer1").value = String(draft.settings.fastMoney.timer1);
    $("editor-fm-timer2").value = String(draft.settings.fastMoney.timer2);
    $("editor-fm-enabled").checked = !!draft.settings.fastMoney.enabled;
    renderList("rounds", $("editor-rounds"), "Round");
    renderList("fastMoney", $("editor-fastmoney"), "Fast Money");
    $("btn-add-round").disabled = draft.rounds.length >= core().MAX_ROUNDS;
    renderWarnings();
  }

  function renderWarnings() {
    const warnings = core().warningsFor(cleanDraft());
    $("editor-warnings").textContent = warnings.join(" ");
  }

  function renderList(key, host, label) {
    host.replaceChildren();
    draft[key].forEach((question, index) => {
      host.appendChild(questionBlock(key, question, index, label));
    });
    if (!draft[key].length) {
      host.appendChild(el("p", "setup-hint",
        "No Fast Money questions yet — add at least 5 to switch Fast Money on."));
    }
  }

  function questionBlock(key, question, index, label) {
    const block = el("div", "editor-q");
    block.appendChild(questionHead(key, question, index, label));
    const answers = el("div", "editor-answers");
    answers.appendChild(answerLabels());
    question.answers.forEach((answer, i) => {
      answers.appendChild(answerRow(key, question, answer, index, i));
    });
    block.appendChild(answers);
    const add = button("btn btn-ghost btn-small", "+ Add answer", () => {
      question.answers.push({ text: "", count: 5 });
      saveDraft();
      renderEditor();
    });
    add.disabled = question.answers.length >= core().MAX_ANSWERS;
    block.appendChild(add);
    return block;
  }

  function questionHead(key, question, index, label) {
    const head = el("div", "editor-q-head");
    const field = el("label", "editor-field", `${label} ${index + 1}`);
    const input = el("input");
    input.type = "text";
    input.maxLength = core().QUESTION_MAX;
    input.placeholder = "Name something…";
    input.autocomplete = "off";
    input.value = question.question;
    input.addEventListener("input", () => {
      question.question = input.value;
      saveDraft();
    });
    field.appendChild(input);
    head.appendChild(field);
    head.appendChild(sumBadge(question));
    head.appendChild(questionTools(key, index, label));
    return head;
  }

  function sumBadge(question) {
    const sum = question.answers.reduce((t, a) => t + (Number.parseInt(a.count, 10) || 0), 0);
    return el("span", `editor-sum${sum > 100 ? " over" : ""}`, `Sum ${sum}${sum > 100 ? " ⚠" : ""}`);
  }

  function questionTools(key, index, label) {
    const tools = el("div", "editor-q-tools");
    const list = draft[key];
    const move = (delta) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return;
      const [item] = list.splice(index, 1);
      list.splice(target, 0, item);
      saveDraft();
      renderEditor();
    };
    const up = button("btn btn-ghost btn-small", "↑", () => move(-1), { label: `Move ${label} ${index + 1} up` });
    up.disabled = index === 0;
    const down = button("btn btn-ghost btn-small", "↓", () => move(1), { label: `Move ${label} ${index + 1} down` });
    down.disabled = index === list.length - 1;
    const remove = button("btn btn-ghost btn-small", "Remove", () => {
      list.splice(index, 1);
      if (key === "rounds" && !list.length) list.push(blankQuestion());
      saveDraft();
      renderEditor();
    }, { label: `Remove ${label} ${index + 1}` });
    tools.appendChild(up);
    tools.appendChild(down);
    tools.appendChild(remove);
    return tools;
  }

  function answerLabels() {
    const row = el("div", "editor-answer-row editor-answer-labels");
    row.appendChild(el("span", null, "Answer"));
    row.appendChild(el("span", null, "Count"));
    row.appendChild(el("span", null, ""));
    return row;
  }

  function answerRow(key, question, answer, qIndex, index) {
    const row = el("div", "editor-answer-row");
    const text = el("input");
    text.type = "text";
    text.maxLength = core().ANSWER_TEXT_MAX;
    text.placeholder = `Answer ${index + 1}`;
    text.autocomplete = "off";
    text.value = answer.text;
    text.setAttribute("aria-label", `Answer ${index + 1} text`);
    text.addEventListener("input", () => {
      answer.text = text.value;
      saveDraft();
    });
    row.appendChild(text);

    const count = el("input");
    count.type = "number";
    count.min = "1";
    count.max = "100";
    count.step = "1";
    count.inputMode = "numeric";
    count.value = String(answer.count);
    count.setAttribute("aria-label", `Answer ${index + 1} count`);
    count.addEventListener("input", () => {
      answer.count = Number.parseInt(count.value, 10);
      saveDraft();
      refreshSum(row, question);
    });
    row.appendChild(count);

    const remove = button("remove-btn", "✕", () => {
      question.answers.splice(index, 1);
      saveDraft();
      renderEditor();
    }, { label: `Remove answer ${index + 1}` });
    remove.disabled = question.answers.length <= core().MIN_ANSWERS;
    row.appendChild(remove);
    return row;
  }

  /** Repaint just this question's sum badge, so typing keeps focus. */
  function refreshSum(row, question) {
    const block = row.closest(".editor-q");
    const badge = block && block.querySelector(".editor-sum");
    if (!badge) return;
    const fresh = sumBadge(question);
    badge.className = fresh.className;
    badge.textContent = fresh.textContent;
  }

  /* ============ Settings wiring ============ */

  function wireSettings() {
    $("editor-strikes").addEventListener("change", (event) => {
      draft.settings.strikes = Number.parseInt(event.target.value, 10);
      saveDraft();
    });
    $("editor-multipliers").addEventListener("change", (event) => {
      const parts = String(event.target.value).split(",")
        .map((part) => Number.parseFloat(part.trim()))
        .filter((n) => Number.isFinite(n));
      draft.settings.multipliers = parts.length ? parts : [1];
      event.target.value = draft.settings.multipliers.join(", ");
      saveDraft();
    });
    [["editor-fm-target", "target"], ["editor-fm-timer1", "timer1"], ["editor-fm-timer2", "timer2"]]
      .forEach(([id, key]) => {
        $(id).addEventListener("change", (event) => {
          draft.settings.fastMoney[key] = Number.parseInt(event.target.value, 10);
          saveDraft();
        });
      });
    $("editor-fm-enabled").addEventListener("change", (event) => {
      draft.settings.fastMoney.enabled = event.target.checked;
      saveDraft();
      validateDraft();
    });
  }

  function wire() {
    $("btn-editor").addEventListener("click", open);
    $("btn-editor-setup").addEventListener("click", open);
    $("btn-editor-close").addEventListener("click", close);
    $("btn-editor-download").addEventListener("click", download);
    $("btn-editor-use").addEventListener("click", useInGame);
    $("editor-title").addEventListener("input", (event) => {
      draft.title = event.target.value;
      saveDraft();
    });
    $("btn-add-round").addEventListener("click", () => {
      draft.rounds.push(blankQuestion());
      saveDraft();
      renderEditor();
    });
    $("btn-add-fm").addEventListener("click", () => {
      draft.fastMoney.push(blankQuestion());
      saveDraft();
      renderEditor();
    });
    $("btn-editor-reset").addEventListener("click", () => {
      const state = window.FeudApp.getState();
      if (!state || !state.game) return;
      if (window.confirm("Replace your draft with the currently loaded game?")) {
        resetTo(deepCopy(state.game));
      }
    });
    $("btn-editor-blank").addEventListener("click", () => {
      if (window.confirm("Discard your draft and start blank?")) resetTo(blankDraft());
    });
    wireSettings();
  }

  return { wire, open, close, download, useInGame, cleanDraft, getDraft: () => draft };
})();

window.FeudEditor = FeudEditor;

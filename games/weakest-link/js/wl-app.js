/* ============================================================
   Weakest Link — host glue
   Owns the app state (one serialisable object), persistence,
   screen rendering and the host's buttons/hotkeys. All game rules
   live in wl-core.js; this file only dispatches events into the
   reducer and paints the result. Every user string reaches the
   DOM through textContent — never innerHTML.
   ============================================================ */

"use strict";

const WL_STORAGE_KEY = "gsc-wl-state-v1";
const WL_GOODBYE_MS = 2000;
const WL_ANSWER_PEEK_MS = 2000;

/* ============ Tiny DOM helpers (shared with editor/room/phone) ============ */

function $(id) { return document.getElementById(id); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function show(node, on) {
  if (node) node.classList.toggle("hidden", !on);
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text === undefined || text === null ? "" : String(text);
}

/* ============ App state ============ */

/** @type {{core:object|null, game:object|null, setup:{players:Array<{pid:string,name:string,manual:boolean}>, shuffle:boolean},
 *          source:string, sourceKind:string, sourceUrl:string|null, keepAnswers:boolean}} */
let wlApp = freshApp();
let wlClock = null;
let wlGoodbyeFor = null;   // pid whose goodbye card is already showing
let wlAnswerTimer = null;
let wlPeeking = false;
const wlListeners = [];

function freshApp() {
  return {
    core: null,
    game: null,
    setup: { players: [], shuffle: false },
    source: "loading…",
    sourceKind: "default",
    sourceUrl: null,
    keepAnswers: false,
  };
}

function wlCore() { return wlApp.core; }

/** Replace part of the app state, persist, repaint. */
function wlSet(patch) {
  wlApp = Object.assign({}, wlApp, patch);
  wlSave();
  wlRender();
}

/** Send an event to the pure core. */
function wlDispatch(event) {
  const core = wlApp.core;
  if (!core) return;
  const next = window.WlCore.reduce(core, event, Date.now());
  if (next === core) return;
  wlSet({ core: next });
}

/* ============ Persistence ============ */

/** A saved clock is always paused: a reload resumes with the time that was left. */
function wlSerialise() {
  const core = wlApp.core;
  const shell = {
    core: null, game: wlApp.game, setup: wlApp.setup, source: wlApp.source,
    sourceKind: wlApp.sourceKind, sourceUrl: wlApp.sourceUrl, keepAnswers: wlApp.keepAnswers,
  };
  if (!core) return shell;
  const clock = core.clock.running && core.clock.deadline !== null
    ? { running: false, deadline: null, remainingMs: Math.max(0, core.clock.deadline - Date.now()) }
    : core.clock;
  return Object.assign(shell, { core: Object.assign({}, core, { clock }) });
}

function wlSave() {
  try {
    localStorage.setItem(WL_STORAGE_KEY, JSON.stringify(wlSerialise()));
    wlError("");
  } catch (err) {
    console.warn("Could not save the game:", err);
    wlError("This browser can’t save the game — the game still plays, but don’t reload this tab.");
  }
}

function wlLoadSaved() {
  try {
    const raw = localStorage.getItem(WL_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    if (saved.game) window.WlCore.validateGame(saved.game);
    if (saved.core && (!saved.core.phase || !saved.core.game)) return null;
    return saved;
  } catch (err) {
    console.warn("Ignoring a corrupt saved game:", err);
    return null;
  }
}

function wlError(message) {
  const node = $("wl-error");
  if (!node) return;
  node.textContent = message || "";
  show(node, !!message);
}

/* ============ Content loading ============ */

async function wlLoadContent() {
  const url = new URLSearchParams(location.search).get("game");
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      const game = await res.json();
      window.WlCore.validateGame(game);
      return { game, source: `Custom questions from ${url}`, kind: "fetch", url };
    } catch (err) {
      wlError(`Could not load questions from ${url}: ${err.message}. Using the built-in set instead.`);
    }
  }
  try {
    const res = await fetch("questions.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    const game = await res.json();
    window.WlCore.validateGame(game);
    return { game, source: "Built-in questions (questions.json)", kind: "default", url: null };
  } catch (err) {
    console.warn("Falling back to js/data.js:", err);
    return {
      game: window.WL_DEFAULT_GAME,
      source: "Built-in questions (offline copy)",
      kind: "default", url: null,
    };
  }
}

/** Adopt a validated game — from the editor, a file, or a URL. */
function wlUseGame(game, source, kind) {
  window.WlCore.validateGame(game);
  wlSet({ game, source: source || "Custom questions", sourceKind: kind || "upload", core: null });
  wlError("");
}

function wlOnFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const game = JSON.parse(String(reader.result));
      wlUseGame(game, `Custom questions from ${file.name}`, "upload");
    } catch (err) {
      wlError(`That file is not a usable Weakest Link game: ${err.message}`);
    }
  };
  reader.onerror = () => wlError("That file could not be read.");
  reader.readAsText(file);
  event.target.value = "";
}

/* ============ Setup screen ============ */

function wlAddPlayer(name, pid, manual) {
  const clean = window.WlCore.cleanText(name, 24);
  if (!clean) { wlError("Give the player a name first."); return false; }
  const players = wlApp.setup.players;
  if (players.length >= window.WlCore.MAX_PLAYERS) {
    wlError(`That is the maximum of ${window.WlCore.MAX_PLAYERS} players.`);
    return false;
  }
  if (players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    wlError(`${clean} is already on the team — pick another name.`);
    return false;
  }
  const id = pid || `m${Date.now().toString(36)}${players.length}`;
  wlSet({ setup: Object.assign({}, wlApp.setup, { players: players.concat([{ pid: id, name: clean, manual: manual !== false }]) }) });
  wlError("");
  return true;
}

function wlRemovePlayer(pid) {
  const players = wlApp.setup.players.filter((p) => p.pid !== pid);
  wlSet({ setup: Object.assign({}, wlApp.setup, { players }) });
}

function wlRenderSetup() {
  const list = $("wl-player-list");
  list.replaceChildren();
  wlApp.setup.players.forEach((p, i) => {
    const li = el("li");
    li.appendChild(el("span", "player-seat", i + 1));
    li.appendChild(el("span", "player-name", p.name));
    li.appendChild(el("span", "player-tag", p.manual ? "host" : "phone"));
    const remove = el("button", "btn btn-ghost btn-small", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => wlRemovePlayer(p.pid));
    li.appendChild(remove);
    list.appendChild(li);
  });
  const count = wlApp.setup.players.length;
  setText("wl-player-count", `${count}/${window.WlCore.MAX_PLAYERS}`);
  setText("wl-source", wlApp.source);
  const questions = wlApp.game ? wlApp.game.questions.length : 0;
  const warnings = wlApp.game ? window.WlCore.warningsFor(wlApp.game) : [];
  setText("wl-question-count", `${questions} questions loaded. ${warnings.join(" ")}`.trim());
  $("wl-shuffle").checked = !!wlApp.setup.shuffle;
  $("btn-start").disabled = count < 3 || !wlApp.game;
}

function wlStart() {
  try {
    const players = wlApp.setup.players.map((p) => ({ pid: p.pid, name: p.name }));
    if (players.length < 3) throw new Error("Weakest Link needs at least 3 players.");
    const core = window.WlCore.createState(wlApp.game, players, { shuffle: wlApp.setup.shuffle });
    wlSet({ core: window.WlCore.reduce(core, { type: "start" }) });
    if (wlClock) wlClock.reset();
    wlError("");
  } catch (err) {
    wlError(err.message);
  }
}

/* ============ Round screen ============ */

function wlRenderChain(core) {
  const WLc = window.WlCore;
  const rail = $("wl-chain");
  rail.replaceChildren();
  core.game.settings.chain.forEach((value, i) => {
    const li = el("li");
    if (i < core.chainIndex) li.classList.add("won");
    if (i === core.chainIndex) li.classList.add("current");
    li.appendChild(el("span", null, WLc.formatMoney(core, value)));
    li.appendChild(el("span", "chain-tick", i < core.chainIndex ? "✓" : ""));
    rail.appendChild(li);
  });
}

function wlRenderStats(core) {
  const body = $("wl-stats");
  body.replaceChildren();
  core.active.forEach((pid) => {
    const stat = core.roundStats[pid] || { correct: 0, wrong: 0, banked: 0 };
    const tr = el("tr");
    if (pid === core.turnPid) tr.classList.add("is-turn");
    tr.appendChild(el("td", null, window.WlCore.playerName(core, pid)));
    tr.appendChild(el("td", null, stat.correct));
    tr.appendChild(el("td", null, stat.wrong));
    tr.appendChild(el("td", null, window.WlCore.formatMoney(core, stat.banked)));
    body.appendChild(tr);
  });
}

function wlRenderRound(core) {
  const WLc = window.WlCore;
  const q = WLc.currentQuestion(core);
  setText("wl-round-label", `Round ${core.roundIndex + 1}`);
  setText("wl-turn-name", WLc.playerName(core, core.turnPid));
  setText("wl-q-cat", q ? q.category : "");
  setText("wl-q-text", q ? q.q : "No questions loaded.");
  setText("wl-answer", q ? q.a : "");
  setText("wl-bank", WLc.formatMoney(core, core.roundBank));
  setText("wl-total", WLc.formatMoney(core, core.total));
  setText("wl-notice", core.notice);
  wlRenderChain(core);
  wlRenderStats(core);
  show($("wl-answer"), wlApp.keepAnswers || wlPeeking);
  $("btn-clock").textContent = core.clock.running ? "Pause clock" : "Start clock";
  $("btn-bank").disabled = WLc.chainValue(core) <= 0;
  $("btn-undo").disabled = core.past.length === 0;
}

/** Reveal the answer for two seconds (or until the host judges). */
function wlPeekAnswer() {
  wlPeeking = true;
  show($("wl-answer"), true);
  if (wlAnswerTimer) clearTimeout(wlAnswerTimer);
  wlAnswerTimer = setTimeout(() => { wlPeeking = false; wlRender(); }, WL_ANSWER_PEEK_MS);
}

function wlHideAnswer() {
  wlPeeking = false;
  if (wlAnswerTimer) { clearTimeout(wlAnswerTimer); wlAnswerTimer = null; }
}

/* ============ Voting screen ============ */

function wlVoteRow(core, voter) {
  const WLc = window.WlCore;
  const li = el("li");
  const revealed = core.revealed.indexOf(voter) >= 0;
  if (revealed) li.classList.add("revealed");
  li.appendChild(el("span", "vote-voter", WLc.playerName(core, voter)));
  const target = core.votes[voter];
  if (revealed) {
    // Revealed: the name replaces both the dots and the host's dropdown, so
    // the stage shows one answer per row and nothing to misread.
    li.appendChild(el("span", "vote-target", WLc.playerName(core, target)));
  } else {
    const mask = el("span", `vote-mask${target ? " in" : ""}`, target ? "•••" : "—");
    mask.title = target ? "Vote received" : "No vote yet";
    li.appendChild(mask);
    li.appendChild(wlVoteSelect(core, voter));
  }
  return li;
}

/**
 * The host's per-player override dropdown. It sits on unrevealed rows only,
 * and it always shows the BLANK option even when a vote is already in: the
 * ballot is secret, and a dropdown sitting open on a screen-shared stage
 * would give it away. The dots beside it say a vote arrived.
 */
function wlVoteSelect(core, voter) {
  const name = window.WlCore.playerName(core, voter);
  const select = el("select");
  select.disabled = core.revealed.length > 0;
  select.setAttribute("aria-label", `Enter ${name}'s vote`);
  const blank = el("option", null, core.votes[voter] ? "change vote" : "not voted");
  blank.value = "";
  select.appendChild(blank);
  core.active.forEach((pid) => {
    if (pid === voter) return;
    const opt = el("option", null, window.WlCore.playerName(core, pid));
    opt.value = pid;
    select.appendChild(opt);
  });
  select.value = "";
  select.addEventListener("change", () => {
    if (select.value) wlDispatch({ type: "vote", voter, target: select.value });
  });
  return select;
}

function wlRenderVoting(core) {
  const WLc = window.WlCore;
  const list = $("wl-vote-list");
  list.replaceChildren();
  core.active.forEach((voter) => list.appendChild(wlVoteRow(core, voter)));

  const cast = Object.keys(core.votes).length;
  const voting = core.phase === "voting";
  const complete = cast >= core.active.length;
  const money = `Team total ${WLc.formatMoney(core, core.total)}`;
  // Once someone has left, "n/m" would count the departed voter — show the money.
  setText("wl-vote-count", voting ? `Votes in: ${cast}/${core.active.length}  ·  ${money}` : money);
  $("btn-reveal").disabled = !voting || !complete;
  $("btn-reveal-all").disabled = !voting || !complete;
  $("btn-vote-undo").disabled = core.past.length === 0;
  show($("btn-reveal"), voting);
  show($("btn-reveal-all"), voting);
  show($("btn-show-stats"), voting);

  show($("wl-tie-panel"), core.phase === "tiebreak");
  show($("wl-vote-result"), core.phase === "voteResult");
  show($("wl-goodbye-panel"), core.phase === "goodbye");
  if (core.phase === "tiebreak") wlRenderTie(core);
  if (core.phase === "voteResult") {
    const tally = WLc.voteTally(core);
    const name = WLc.playerName(core, core.eliminatedPid);
    setText("wl-vote-result-text", `${name} has ${tally[core.eliminatedPid]} votes.`);
  }
  if (core.phase !== "voting") show($("wl-stats-panel"), false);
}

function wlRenderTie(core) {
  const WLc = window.WlCore;
  const chooser = WLc.playerName(core, core.tiebreakPid);
  const names = (core.tied || []).map((pid) => WLc.playerName(core, pid)).join(" and ");
  setText("wl-tie-text", `It is a tie between ${names}. ${chooser} was the strongest link and decides.`);
  const row = $("wl-tie-choices");
  row.replaceChildren();
  (core.tied || []).forEach((pid) => {
    const btn = el("button", "btn btn-red btn-big", WLc.playerName(core, pid));
    btn.type = "button";
    btn.addEventListener("click", () => wlDispatch({ type: "breakTie", target: pid }));
    row.appendChild(btn);
  });
}

function wlRenderStatsPanel(core) {
  const WLc = window.WlCore;
  const round = core.roundHistory.length - 1;
  const strong = WLc.strongestLink(core, round, core.active);
  const weak = WLc.weakestLink(core, round, core.active);
  const stats = WLc.statsForRound(core, round);
  const detail = (pid) => {
    const s = stats[pid] || { correct: 0, wrong: 0, banked: 0 };
    return `${s.correct} right · ${s.wrong} wrong · ${WLc.formatMoney(core, s.banked)} banked`;
  };
  setText("wl-strongest", WLc.playerName(core, strong));
  setText("wl-strongest-detail", strong ? detail(strong) : "");
  setText("wl-weakest", WLc.playerName(core, weak));
  setText("wl-weakest-detail", weak ? detail(weak) : "");
}

/* ============ Final + result ============ */

function wlRenderFinal(core) {
  const WLc = window.WlCore;
  const intro = core.phase === "finalIntro";
  show($("wl-final-splash"), intro);
  show($("wl-final-play"), !intro);
  if (intro) { wlRenderFinalIntro(core); return; }

  const q = WLc.currentQuestion(core);
  setText("wl-final-phase", core.phase === "suddenDeath" ? "Sudden death" : "Head to head");
  setText("wl-final-turn", WLc.playerName(core, core.turnPid));
  setText("wl-final-cat", q ? q.category : "");
  setText("wl-final-q", q ? q.q : "");
  setText("wl-final-answer", q ? q.a : "");
  setText("wl-final-notice", core.notice);
  show($("wl-final-answer"), wlApp.keepAnswers || wlPeeking);
  $("btn-final-undo").disabled = core.past.length === 0;
  wlRenderTally(core);
}

function wlRenderFinalIntro(core) {
  const WLc = window.WlCore;
  setText("wl-final-bank", WLc.formatMoney(core, core.total));
  const strong = WLc.playerName(core, core.tiebreakPid);
  setText("wl-final-pick-text", `${strong} was the strongest link and chooses who answers first.`);
  const row = $("wl-final-pick");
  row.replaceChildren();
  core.final.pids.forEach((pid) => {
    const btn = el("button", "btn btn-blue btn-big", `${WLc.playerName(core, pid)} goes first`);
    btn.type = "button";
    btn.addEventListener("click", () => wlDispatch({ type: "finalFirst", pid }));
    row.appendChild(btn);
  });
}

function wlRenderTally(core) {
  const box = $("wl-final-tally");
  box.replaceChildren();
  window.WlCore.finalTally(core).forEach((row) => {
    const card = el("div", `tally-card${row.pid === core.turnPid ? " is-turn" : ""}`);
    card.appendChild(el("p", "tally-name", row.name));
    const dots = el("div", "tally-dots");
    for (let i = 0; i < row.asked; i += 1) {
      const state = row.answers[i];
      dots.appendChild(el("span", `tally-dot${state === true ? " hit" : state === false ? " miss" : ""}`));
    }
    card.appendChild(dots);
    card.appendChild(el("p", "tally-score", `${row.correct} correct`));
    box.appendChild(card);
  });
}

function wlRenderResult(core) {
  const WLc = window.WlCore;
  setText("wl-winner", WLc.playerName(core, core.winnerPid));
  setText("wl-winner-total", WLc.formatMoney(core, core.total));
  const list = $("wl-standings");
  list.replaceChildren();
  WLc.standings(core).forEach((row) => {
    const li = el("li", row.out ? "" : "in", row.out ? `${row.name} — voted off` : row.name);
    list.appendChild(li);
  });
}

/* ============ Goodbye sting ============ */

function wlMaybeGoodbye(core) {
  if (core.phase !== "goodbye" || !core.eliminatedPid) {
    if (core.phase !== "goodbye") wlGoodbyeFor = null;
    return;
  }
  if (wlGoodbyeFor === core.eliminatedPid) return;
  wlGoodbyeFor = core.eliminatedPid;
  setText("wl-goodbye-name", window.WlCore.playerName(core, core.eliminatedPid));
  show($("wl-goodbye"), true);
  window.WlSound.play("goodbye");
  setTimeout(() => show($("wl-goodbye"), false), WL_GOODBYE_MS);
}

/* ============ Render ============ */

const WL_SCREEN_FOR_PHASE = {
  setup: "screen-setup",
  round: "screen-round",
  voting: "screen-voting",
  voteResult: "screen-voting",
  tiebreak: "screen-voting",
  goodbye: "screen-voting",
  finalIntro: "screen-final",
  final: "screen-final",
  suddenDeath: "screen-final",
  result: "screen-result",
};

function wlRender() {
  const core = wlApp.core;
  const phase = core ? core.phase : "setup";
  const wanted = WL_SCREEN_FOR_PHASE[phase] || "screen-setup";
  const editorOpen = !$("screen-editor").classList.contains("hidden");
  ["screen-setup", "screen-round", "screen-voting", "screen-final", "screen-result"].forEach((id) => {
    show($(id), !editorOpen && id === wanted);
  });
  if (!core) { wlRenderSetup(); wlNotify(null); return; }
  if (phase === "round") wlRenderRound(core);
  else if (wanted === "screen-voting") wlRenderVoting(core);
  else if (wanted === "screen-final") wlRenderFinal(core);
  else if (phase === "result") wlRenderResult(core);
  wlMaybeGoodbye(core);
  if (wlClock) wlClock.refresh();
  wlNotify(core);
}

/** Let wl-room.js push fresh phone views after every state change. */
function wlNotify(core) {
  wlListeners.forEach((fn) => {
    try { fn(core); } catch (err) { console.warn("A render listener failed:", err); }
  });
}

/* ============ Sound-aware dispatch wrappers ============ */

function wlJudge(correct) {
  const core = wlApp.core;
  if (!core) return;
  const inFinal = core.phase === "final" || core.phase === "suddenDeath";
  if (!inFinal && core.phase !== "round") return;
  wlHideAnswer();
  window.WlSound.play(correct ? "correct" : "wrong");
  const before = core.phase;
  wlDispatch(inFinal ? { type: "finalAnswer", correct } : { type: correct ? "correct" : "wrong" });
  const after = wlApp.core;
  if (before === "round" && after.phase !== "round") window.WlSound.play("roundEnd");
  if (after.phase === "result") window.WlSound.play("win");
}

function wlBank() {
  const core = wlApp.core;
  if (!core || core.phase !== "round" || window.WlCore.chainValue(core) <= 0) return;
  window.WlSound.play("bank");
  wlDispatch({ type: "bank" });
  $("wl-chain").classList.add("banked");
  setTimeout(() => $("wl-chain").classList.remove("banked"), 800);
}

function wlToggleClock() {
  const core = wlApp.core;
  if (!core || core.phase !== "round") return;
  if (wlClock) wlClock.reset();
  wlDispatch({ type: core.clock.running ? "clockPause" : "clockStart" });
}

/* ============ Hotkeys ============ */

function wlIsTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

function wlOnKey(event) {
  if (wlIsTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  // A focused button already handles Space itself — never fire the action twice.
  if (event.target && event.target.tagName === "BUTTON") return;
  if (!$("screen-editor").classList.contains("hidden")) return;
  const core = wlApp.core;
  if (!core) return;
  const key = event.key;
  const playing = core.phase === "round" || core.phase === "final" || core.phase === "suddenDeath";
  if (!playing) return;
  // `code` is checked too: some automation and keyboard layouts report "Space".
  const isSpace = key === " " || key === "Spacebar" || event.code === "Space";
  if (isSpace) { event.preventDefault(); wlJudge(true); }
  else if (key === "x" || key === "X") { event.preventDefault(); wlJudge(false); }
  else if ((key === "b" || key === "B") && core.phase === "round") { event.preventDefault(); wlBank(); }
}

/* ============ Wiring ============ */

function wlWireSetup() {
  $("wl-add-player").addEventListener("submit", (e) => {
    e.preventDefault();
    if (wlAddPlayer($("wl-player-name").value)) $("wl-player-name").value = "";
  });
  $("wl-shuffle").addEventListener("change", (e) => {
    wlSet({ setup: Object.assign({}, wlApp.setup, { shuffle: e.target.checked }) });
  });
  $("btn-load-json").addEventListener("click", () => $("wl-file").click());
  $("wl-file").addEventListener("change", wlOnFile);
  $("btn-start").addEventListener("click", wlStart);
}

/** Secondary controls hand focus back to the page so Space means "Correct" again. */
function wlWireSecondary(id, handler) {
  $(id).addEventListener("click", (event) => { handler(); event.currentTarget.blur(); });
}

function wlWireRound() {
  $("btn-correct").addEventListener("click", () => wlJudge(true));
  $("btn-wrong").addEventListener("click", () => wlJudge(false));
  $("btn-bank").addEventListener("click", wlBank);
  wlWireSecondary("btn-undo", () => wlDispatch({ type: "undo" }));
  wlWireSecondary("btn-end-round", () => {
    window.WlSound.play("roundEnd");
    wlDispatch({ type: "endRound" });
  });
  wlWireSecondary("btn-clock", wlToggleClock);
  wlWireSecondary("btn-show-answer", wlPeekAnswer);
  wlWireSecondary("btn-final-show-answer", wlPeekAnswer);
  $("wl-keep-answers").addEventListener("change", (e) => wlSet({ keepAnswers: e.target.checked }));
}

function wlWireVoting() {
  $("btn-reveal").addEventListener("click", () => wlDispatch({ type: "revealVote" }));
  $("btn-reveal-all").addEventListener("click", () => wlDispatch({ type: "revealAll" }));
  wlWireSecondary("btn-vote-undo", () => wlDispatch({ type: "undo" }));
  $("btn-show-stats").addEventListener("click", () => {
    const panel = $("wl-stats-panel");
    const opening = panel.classList.contains("hidden");
    if (opening && wlApp.core) wlRenderStatsPanel(wlApp.core);
    show(panel, opening);
  });
  $("btn-eliminate").addEventListener("click", () => wlDispatch({ type: "eliminate" }));
  $("btn-next-round").addEventListener("click", () => wlDispatch({ type: "nextRound" }));
  $("btn-final-correct").addEventListener("click", () => wlJudge(true));
  $("btn-final-wrong").addEventListener("click", () => wlJudge(false));
  wlWireSecondary("btn-final-undo", () => wlDispatch({ type: "undo" }));
  $("btn-play-again").addEventListener("click", () => {
    wlSet({ core: null });
    wlGoodbyeFor = null;
  });
}

function wlWireChrome() {
  const sound = $("btn-sound");
  const paint = () => {
    sound.textContent = window.WlSound.enabled ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(window.WlSound.enabled));
  };
  sound.addEventListener("click", () => { window.WlSound.toggle(); paint(); });
  paint();
  document.addEventListener("keydown", wlOnKey);
  window.addEventListener("beforeunload", wlSave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) wlSave(); });
}

/* ============ Boot ============ */

function wlStartClock() {
  wlClock = window.WlClock.create({
    el: $("wl-clock"),
    getClock: () => (wlApp.core ? wlApp.core.clock : null),
    onExpire: () => {
      const core = wlApp.core;
      if (!core || core.phase !== "round" || core.expired) return;
      wlDispatch({ type: "clockExpired" });
    },
    onTick: () => window.WlSound.play("tick"),
  });
  wlClock.start();
}

/** Saved roster first, then any phone the shell added while we were loading. */
function wlMergeRoster(savedSetup, current) {
  const players = (savedSetup.players || []).slice();
  current.forEach((p) => { if (!players.some((x) => x.pid === p.pid)) players.push(p); });
  return Object.assign({}, savedSetup, { players });
}

async function wlBoot() {
  const mode = (window.GSC && window.GSC.mode) || "standalone-host";
  document.body.classList.toggle("player-mode", mode.endsWith("-player"));
  document.body.classList.toggle("gsc-embedded", mode.startsWith("embed-"));
  if (mode.endsWith("-player")) return;   // wl-phone.js owns the phone page

  // Read the saved game BEFORE the first await: wl-room.js seeds the roster as
  // soon as the shell sends `init`, and that write would otherwise clobber the
  // state we are about to restore.
  const saved = wlLoadSaved();

  wlWireSetup();
  wlWireRound();
  wlWireVoting();
  wlWireChrome();

  const loaded = await wlLoadContent();
  const patch = {
    game: (saved && saved.game) || loaded.game,
    source: (saved && saved.source) || loaded.source,
    sourceKind: (saved && saved.sourceKind) || loaded.kind,
    sourceUrl: (saved && saved.sourceUrl) || loaded.url,
  };
  if (saved && saved.setup) patch.setup = wlMergeRoster(saved.setup, wlApp.setup.players);
  if (saved && saved.core) patch.core = saved.core;
  if (saved && typeof saved.keepAnswers === "boolean") patch.keepAnswers = saved.keepAnswers;
  $("wl-keep-answers").checked = !!patch.keepAnswers;
  wlSet(patch);
  wlStartClock();
}

/** The public surface wl-editor.js / wl-room.js / tests build on. */
window.WlApp = {
  state: () => wlApp,
  core: wlCore,
  dispatch: wlDispatch,
  set: wlSet,
  render: wlRender,
  useGame: wlUseGame,
  addPlayer: wlAddPlayer,
  removePlayer: wlRemovePlayer,
  error: wlError,
  subscribe: (fn) => { if (typeof fn === "function") wlListeners.push(fn); },
  judge: wlJudge,
  bank: wlBank,
  STORAGE_KEY: WL_STORAGE_KEY,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { wlBoot().catch((err) => wlError(err.message)); });
} else {
  wlBoot().catch((err) => wlError(err.message));
}

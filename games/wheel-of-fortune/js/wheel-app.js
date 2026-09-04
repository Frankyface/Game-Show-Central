/* ============================================================
   Wheel of Fortune — host glue (spec 04 §3)
   Owns the single serialisable state object (WheelCore), its
   localStorage persistence, content loading, and every host
   button. Rules live in WheelCore; tiles/podiums/keyboard are
   painted by WheelView; the wheel by WheelDraw. Nothing here
   decides a spin — the core does, then the animation catches up.
   Timer/animation handles are ephemeral module state and are
   never written into the game state.
   Exported as window.WheelApp for wheel-room.js and the harness.
   ============================================================ */

"use strict";

const WheelApp = (function () {
  const STORAGE_KEY = "gsc-wheel-state-v1";
  const TOSSUP_MS = 1200; // one letter every ~1.2 s (spec §1)
  const SPLASH_MS = 1200; // the game-switch title card (design system v2 §3)
  const MAX_PLAYERS = 6;

  const $ = (id) => document.getElementById(id);
  const show = (node, visible) => { if (node) node.classList.toggle("hidden", !visible); };
  const core = () => window.WheelCore;
  const view = () => window.WheelView;
  const sound = () => window.WheelSound;

  /** @type {object|null} the one game state; everything else is ephemeral. */
  let state = null;
  let source = { text: "loading…", kind: "default", url: null };
  let phonePids = new Set(); // pids that came from the roster (transport-owned)
  let takenOverPid = null;   // the one phone player the host is acting for (W-D8)
  let roomCode = null;       // the room this saved game belongs to (W-D9)
  let listeners = [];
  let spinning = false;
  let cancelSpin = null;
  let tossupTimer = 0;
  let bonusPicks = [];
  let playerSeq = 0;
  let booted = false;
  // Resolves once init() has restored (or fetched) a game, so wheel-room.js can
  // bind the room code without racing the restore (W-D9).
  let markReady = null;
  const ready = new Promise((resolve) => { markReady = resolve; });

  /* ============ State plumbing ============ */

  function setState(next) {
    if (!next || next === state) return;
    state = next;
    save();
    render();
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.warn("state listener failed:", err); }
    });
  }

  function save() {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        state, source, roomCode, phonePids: [...phonePids],
      }));
      warn("");
    } catch (err) {
      console.warn("Could not save the game:", err);
      warn("This browser can’t save the game (storage is full or blocked). Play continues, "
        + "but do NOT refresh — the board would revert to an earlier point.");
    }
  }

  function warn(message) {
    const node = $("save-warning");
    if (!node) return;
    node.textContent = message || "";
    show(node, !!message);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !saved.state || !saved.state.game || !saved.state.phase) return null;
      core().validateGame(saved.state.game);
      return saved;
    } catch (err) {
      console.warn("Ignoring a corrupt saved game:", err);
      return null;
    }
  }

  /**
   * Bind the restored game to the room it is actually in (W-D9).
   *
   * Shell pids are handed out per room (`p1`, `p2`, ...), so a saved game from
   * an EARLIER room already holds a `p1` and the next room's first phone would
   * silently land on that stranger's podium and grand total. When the code
   * changes, every player that reached the board through a phone is dropped;
   * players the host typed in by hand keep their name and money.
   */
  function adoptRoom(code) {
    if (typeof code !== "string" || !code) return;
    if (roomCode === code) return;
    const previous = roomCode;
    roomCode = code;
    if (!previous || !state) { save(); render(); return; }
    const stale = new Set(phonePids);
    phonePids = new Set();
    takenOverPid = null;
    const keep = state.players.filter((p) => !stale.has(p.pid));
    if (keep.length === state.players.length) { save(); render(); return; }
    if (!keep.length) {
      // Nobody typed in by hand: start the room clean rather than half a game.
      setState(core().createState(state.game, [], { sound: sound() ? sound().isOn() : true }));
      return;
    }
    setState({
      ...state,
      players: keep,
      turn: Math.min(state.turn, keep.length - 1),
      banner: `New room ${code} — the previous room's phone players were cleared.`,
    });
  }

  /* ============ Content loading ============ */

  async function fetchContent() {
    const params = new URLSearchParams(window.location.search);
    const custom = params.get("game");
    const url = custom || "puzzles.json";
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      core().validateGame(data);
      return { game: data, text: custom ? `custom URL (${custom})` : "puzzles.json", kind: "fetch", url: custom };
    } catch (err) {
      console.warn(`Could not load ${url}; using the built-in puzzles.`, err);
      return {
        game: window.DEFAULT_PUZZLES,
        text: `built-in puzzles (${url} could not be loaded: ${err.message})`,
        kind: "default", url: null,
      };
    }
  }

  /** Swap in new content, keeping the current players. Setup phase only. */
  function useGame(game, info) {
    const players = state ? state.players.map((p) => ({ pid: p.pid, name: p.name })) : [];
    source = { text: info.text, kind: info.kind, url: info.url || null };
    setState(core().createState(game, players, { sound: sound() ? sound().isOn() : true }));
  }

  /* ============ Actions ============ */

  function dispatch(event) {
    if (!state) return false;
    const next = core().reduce(state, event, Math.random);
    if (next === state) return false;
    reactTo(state, next, event);
    setState(next);
    return true;
  }

  /** Sound + animation reactions to a state change. Never changes state. */
  function reactTo(before, after, event) {
    const s = sound();
    if (!s) return;
    if (event.type === "callLetter") {
      const gained = after.players.reduce((n, p, i) => n + (p.round - before.players[i].round), 0);
      if (gained > 0) { s.ding(); s.cash(); } else if (after.turn !== before.turn) s.buzz();
      else s.ding();
    } else if (event.type === "solveJudged") {
      if (event.correct) s.fanfare(); else s.buzz();
    } else if (event.type === "tossupBuzz") {
      s.buzzIn();
    } else if (event.type === "tossupJudged") {
      if (event.correct) s.fanfare(); else s.buzz();
    } else if (event.type === "bonusJudged") {
      if (event.correct) s.fanfare(); else s.timesUp();
    } else if (event.type === "bonusPick") {
      s.ding();
    }
  }

  /**
   * Spin: the core picks the wedge FIRST (rng injected), then the wheel
   * animates to it and the outcome sound plays when it stops (spec §3).
   */
  function doSpin() {
    if (!state || spinning) return;
    const next = core().reduce(state, { type: "spin" }, Math.random);
    if (next === state) return;
    spinning = true;
    setState(next);
    const wedge = next.wedge;
    const count = next.round.wedges.length;
    cancelSpin = window.WheelDraw.spin({
      svg: $("wheel"), index: wedge.index, count,
      onTick: () => { if (sound()) sound().tick(); },
      onDone: () => {
        spinning = false;
        cancelSpin = null;
        const s = sound();
        if (s) {
          if (wedge.value === core().BANKRUPT) s.bankrupt();
          else if (wedge.value === core().LOSE_TURN) s.loseTurn();
          else s.cash();
        }
        render();
      },
    });
    render();
  }

  function addPlayer(name, pid) {
    if (!state || state.phase !== "idle") return null;
    if (state.players.length >= MAX_PLAYERS) return null;
    const clean = core().sanitizeName(name);
    if (!clean) return null;
    playerSeq += 1;
    const id = pid || `local${playerSeq}`;
    if (state.players.some((p) => p.pid === id)) return id;
    setState({ ...state, players: [...state.players, { pid: id, name: clean, round: 0, total: 0 }] });
    return id;
  }

  function removePlayer(pid) {
    if (!state || state.phase !== "idle") return;
    setState({ ...state, players: state.players.filter((p) => p.pid !== pid) });
  }

  function renamePlayer(pid, name) {
    if (!state) return;
    const clean = core().sanitizeName(name);
    if (!clean) return;
    setState({ ...state, players: state.players.map((p) => (p.pid === pid ? { ...p, name: clean } : p)) });
  }

  function newGame() {
    stopTossup();
    setState(core().createState(state.game, state.players.map((p) => ({ pid: p.pid, name: p.name })),
      { sound: sound() ? sound().isOn() : true }));
  }

  /* ============ Toss-up reveal loop (ephemeral timer) ============ */

  function syncTossupLoop() {
    const running = !!(state && state.phase === "tossup" && state.tossup && state.tossup.running);
    if (running && !tossupTimer) {
      tossupTimer = window.setInterval(() => dispatch({ type: "tossupRevealNext" }), TOSSUP_MS);
    } else if (!running && tossupTimer) {
      stopTossup();
    }
  }

  function stopTossup() {
    if (tossupTimer) window.clearInterval(tossupTimer);
    tossupTimer = 0;
  }

  /* ============ Render ============ */

  function render() {
    if (!state || !booted) return;
    const setup = state.phase === "idle";
    const final = state.phase === "final";
    show($("screen-setup"), setup && !isEditorOpen());
    show($("screen-game"), !setup && !final && !isEditorOpen());
    show($("screen-final"), final && !isEditorOpen());
    show($("btn-new-game"), !setup);
    $("setup-title").textContent = state.game.title;
    const n = state.game.rounds.length;
    $("source-note").textContent = `Puzzles: ${source.text} — ${n} round${n === 1 ? "" : "s"}.`;
    view().renderPlayerList($("player-list"), state.players, phonePids, removePlayer);
    $("btn-start").disabled = state.players.length === 0;
    if (setup) return;
    if (final) {
      view().renderStandings($("final-list"), core().standingsView(state));
      return;
    }
    renderGame();
    syncTossupLoop();
  }

  /**
   * Paint the game screen. Longer than 50 lines because it is one pass over
   * every panel of a single screen; splitting it would just scatter the same
   * sequence across helpers that all need the same selector results.
   */
  function renderGame() {
    const board = core().boardView(state);
    const actions = core().legalActions(state);
    const isRound = state.phase === "round";
    view().renderBoard($("board"), board, `${state.roundIndex}:${state.round.puzzle}`);
    $("category").textContent = board.category;
    $("banner").textContent = spinning ? "Spinning…" : state.banner;
    view().renderUsed($("used-letters"), state.used);
    view().renderPodiums($("podiums"), core().podiumView(state), phonePids, onPodiumClick);
    renderWheel();

    const bonusMode = state.phase === "bonus" && state.bonus && !state.bonus.picked;
    const keys = bonusMode ? bonusKeyboardLetters() : actions.letters;
    show($("keyboard-wrap"), keys.length > 0 && !spinning);
    $("keyboard-hint").textContent = keyboardHint(bonusMode, actions);
    view().renderKeyboard($("keyboard"), spinning ? [] : keys, bonusMode ? onBonusKey : onLetterKey);

    show($("btn-spin"), isRound);
    show($("btn-vowel"), isRound);
    show($("btn-solve"), isRound);
    show($("btn-next-player"), isRound);
    $("btn-spin").disabled = !actions.spin || spinning;
    $("btn-vowel").disabled = !actions.buyVowel || spinning;
    // W-D2: while a phone solve is pending (state.solving) the Solve button is the only way to judge it.
    $("btn-solve").disabled = (!actions.solve && !state.solving) || spinning;
    // pendingVowel blocks the skip (W-D11) — disable it rather than no-op silently.
    $("btn-next-player").disabled = !isRound || state.roundDone || spinning
      || state.pendingVowel || state.players.length < 2;
    $("btn-undo").disabled = state.history.length === 0 || spinning;
    $("btn-reveal").disabled = state.roundDone || spinning;
    show($("btn-next-round"), state.roundDone);

    renderTossup();
    renderBonus();
    renderPhoneTurn();
  }

  function keyboardHint(bonusMode, actions) {
    if (bonusMode) return `Pick 3 consonants and a vowel: ${bonusPicks.join(" ") || "—"}`;
    if (state.pendingSpin) return `${core().formatMoney(state.wedge.value)} — call a consonant.`;
    if (state.pendingVowel) return "Pick a vowel — it is already paid for.";
    return actions.letters.length ? "Call a letter." : "";
  }

  function renderWheel() {
    const svg = $("wheel");
    const wedges = state.round.wedges;
    const key = wedges.join("|");
    if (svg.dataset.wedgeKey !== key) {
      window.WheelDraw.build(svg, wedges);
      svg.dataset.wedgeKey = key;
      if (state.wedge) window.WheelDraw.showIndex(svg, state.wedge.index, wedges.length);
    }
    svg.classList.toggle("wheel-idle", state.phase !== "round");
    svg.classList.toggle("wheel-spinning", spinning); // styling hook only
    const readout = $("wedge-readout");
    if (spinning) readout.textContent = "…";
    else if (state.wedge && state.phase === "round") {
      readout.textContent = typeof state.wedge.value === "number"
        ? core().formatMoney(state.wedge.value) : state.wedge.value;
      readout.classList.toggle("readout-bad",
        state.wedge.value === core().BANKRUPT || state.wedge.value === core().LOSE_TURN);
    } else {
      readout.textContent = "";
      readout.classList.remove("readout-bad");
    }
  }

  function renderTossup() {
    const on = state.phase === "tossup";
    show($("tossup-bar"), on);
    if (!on) return;
    const t = state.tossup;
    $("btn-tossup-start").disabled = t.running || t.done || !!t.buzzed;
    $("btn-tossup-start").textContent = t.next > 0 ? "Resume reveal" : "Start reveal";
    const who = t.buzzed ? state.players.find((p) => p.pid === t.buzzed) : null;
    $("tossup-buzz").textContent = who ? `\u{1F514} ${who.name}` : "";
    show($("tossup-judge"), !!who);
    show($("btn-next-round"), state.roundDone);
  }

  function bonusKeyboardLetters() {
    const used = new Set([...state.used, ...bonusPicks]);
    const needVowel = bonusPicks.length === 3;
    return core().ALPHABET.split("").filter((L) => {
      if (used.has(L)) return false;
      if (bonusPicks.length >= 4) return false;
      return needVowel ? core().isVowel(L) : !core().isVowel(L);
    });
  }

  function renderBonus() {
    const on = state.phase === "bonus";
    show($("bonus-panel"), on);
    if (!on) return;
    const b = state.bonus;
    const who = state.players.find((p) => p.pid === b.leaderPid);
    $("bonus-who").textContent = who ? `${who.name} plays for ${state.game.settings.bonusPrize}` : "";
    $("bonus-picks").textContent = (b.picked ? b.picks : bonusPicks).join("  ") || "R S T L N E are free";
    show($("btn-bonus-reveal"), !b.picked);
    show($("btn-bonus-clear"), !b.picked);
    $("btn-bonus-reveal").disabled = !core().validateBonusPicks(bonusPicks, state.used);
    show($("bonus-judge"), b.picked && !b.result);
    $("bonus-result").textContent = b.result === "win" ? `\u{1F389} ${state.game.settings.bonusPrize}!`
      : b.result === "lose" ? `The answer was "${state.round.puzzle}".` : "";
    if (window.WheelTimer) {
      // Seconds LEFT (from bonus.deadline) plus the original length, so a
      // reload mid-bonus resumes the bar instead of granting a fresh one.
      window.WheelTimer.sync("bonus", b.picked && !b.result ? `${state.roundIndex}:picked` : null,
        core().bonusSecondsLeft(state), state.game.settings.bonusSeconds);
    }
    show($("btn-next-round"), state.roundDone);
  }

  function renderPhoneTurn() {
    const active = state.players[state.turn];
    // Taking over is a one-turn escape hatch, so it lapses as soon as the turn
    // moves on, and it never touches anyone else's phone marker (W-D8).
    if (takenOverPid && (!active || active.pid !== takenOverPid)) takenOverPid = null;
    const waiting = state.phase === "round" && !state.roundDone && !spinning
      && active && phonePids.has(active.pid) && takenOverPid !== active.pid;
    show($("phone-turn"), !!waiting);
    if (waiting) $("phone-turn-text").textContent = `Waiting for ${active.name}’s phone…`;
  }

  const isEditorOpen = () => !$("screen-editor").classList.contains("hidden");

  /**
   * The 1.2 s game-switch title card (design system v2 §3) — a copy of
   * showSplash() in js/hub-host.js. Presentation only: the node is
   * pointer-events:none, nothing waits on it, and it is skipped entirely
   * under prefers-reduced-motion.
   */
  function showSplash() {
    const node = $("gsc-splash");
    if (!node) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.classList.remove("hidden");
    window.setTimeout(() => node.classList.add("hidden"), SPLASH_MS);
  }

  /* ============ Button wiring ============ */

  function onLetterKey(letter) { dispatch({ type: "callLetter", letter }); }

  function onBonusKey(letter) {
    if (bonusPicks.length >= 4 || bonusPicks.includes(letter)) return;
    bonusPicks = [...bonusPicks, letter];
    if (sound()) sound().tick();
    render();
  }

  function onPodiumClick(pid) {
    if (!state) return;
    if (state.phase === "tossup" && state.tossup.running) {
      dispatch({ type: "tossupBuzz", pid });
      return;
    }
    // Handing the turn to someone else would pocket a bought vowel too (W-D11).
    if (state.phase === "round" && !state.roundDone && !state.pendingVowel) {
      const index = state.players.findIndex((p) => p.pid === pid);
      if (index >= 0 && index !== state.turn) {
        setState({ ...state, turn: index, pendingSpin: false, pendingVowel: false, wedge: null,
          banner: `${state.players[index].name}: spin, buy a vowel, or solve.`,
          history: [...state.history, { ...state, history: undefined }].slice(-60) });
      }
    }
  }

  function openSolve() {
    if (!state) return;
    const who = state.players[state.turn];
    $("solve-who").textContent = who ? `${who.name} is solving.` : "";
    $("solve-input").value = state.solveText || "";
    show($("solve-dialog"), true);
    $("solve-input").focus();
  }

  function judgeSolve(correct) {
    show($("solve-dialog"), false);
    if (!state.solving) dispatch({ type: "solveAttempt", text: $("solve-input").value });
    dispatch({ type: "solveJudged", correct });
    $("solve-input").value = "";
  }

  function wire() {
    $("add-player-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("player-name-input");
      if (addPlayer(input.value)) input.value = "";
      input.focus();
    });
    $("btn-start").addEventListener("click", () => {
      if (sound()) sound().unlock();
      dispatch({ type: "start" });
    });
    $("btn-new-game").addEventListener("click", newGame);
    $("btn-play-again").addEventListener("click", newGame);
    $("btn-spin").addEventListener("click", doSpin);
    $("btn-vowel").addEventListener("click", () => dispatch({ type: "buyVowel" }));
    $("btn-solve").addEventListener("click", openSolve);
    $("btn-solve-right").addEventListener("click", () => judgeSolve(true));
    $("btn-solve-wrong").addEventListener("click", () => judgeSolve(false));
    $("btn-solve-cancel").addEventListener("click", () => show($("solve-dialog"), false));
    $("btn-next-player").addEventListener("click", () => dispatch({ type: "nextPlayer" }));
    $("btn-undo").addEventListener("click", () => { bonusPicks = []; dispatch({ type: "undo" }); });
    $("btn-reveal").addEventListener("click", () => dispatch({ type: "revealAll" }));
    $("btn-next-round").addEventListener("click", () => { bonusPicks = []; dispatch({ type: "nextRound" }); });
    $("btn-tossup-start").addEventListener("click", () => dispatch({ type: "tossupStart" }));
    $("btn-tossup-right").addEventListener("click", () => dispatch({ type: "tossupJudged", correct: true }));
    $("btn-tossup-wrong").addEventListener("click", () => dispatch({ type: "tossupJudged", correct: false }));
    $("btn-bonus-clear").addEventListener("click", () => { bonusPicks = []; render(); });
    $("btn-bonus-reveal").addEventListener("click", () => {
      // Date.now() is injected, never read inside the reducer (W-D6).
      if (dispatch({ type: "bonusPick", letters: bonusPicks, now: Date.now() })) bonusPicks = [];
    });
    $("btn-bonus-right").addEventListener("click", () => dispatch({ type: "bonusJudged", correct: true }));
    $("btn-bonus-wrong").addEventListener("click", () => dispatch({ type: "bonusJudged", correct: false }));
    $("btn-take-over").addEventListener("click", () => {
      const active = state && state.players[state.turn];
      takenOverPid = active ? active.pid : null;
      render();
    });
    $("btn-sound").addEventListener("click", onSoundToggle);
    $("btn-reload").addEventListener("click", reloadContent);
    $("file-input").addEventListener("change", onUpload);
    document.addEventListener("keydown", onKeydown);
    if (window.WheelTimer) {
      window.WheelTimer.onExpire(() => { if (sound()) sound().timesUp(); });
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape") show($("solve-dialog"), false);
    if (!state || state.phase !== "round" || spinning) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const letter = String(e.key || "").toUpperCase();
    if (letter.length === 1 && core().legalActions(state).letters.includes(letter)) {
      dispatch({ type: "callLetter", letter });
    }
  }

  function onSoundToggle() {
    if (!sound()) return;
    const on = sound().toggle();
    sound().unlock();
    $("btn-sound").textContent = on ? "\u{1F50A} Sound" : "\u{1F507} Muted";
    $("btn-sound").setAttribute("aria-pressed", String(on));
    if (state) setState({ ...state, sound: on });
  }

  async function reloadContent() {
    $("load-error").textContent = "";
    const info = await fetchContent();
    useGame(info.game, info);
  }

  function onUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        core().validateGame(data);
        useGame(data, { text: `uploaded file (${file.name})`, kind: "upload", url: null });
        $("load-error").textContent = "";
      } catch (err) {
        $("load-error").textContent = `That file can’t be used: ${err.message}`;
      }
    };
    reader.onerror = () => { $("load-error").textContent = "That file could not be read."; };
    reader.readAsText(file);
    e.target.value = "";
  }

  /* ============ Boot ============ */

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const mode = window.GSC ? window.GSC.mode : (params.get("embed") === "player" ? "embed-player"
      : params.get("room") ? "standalone-player" : "standalone-host");
    if (mode.endsWith("-player")) {
      document.body.classList.add("player-mode");
      if (mode === "embed-player") document.body.classList.add("gsc-embedded");
      return; // wheel-phone.js drives this page; the host game must not boot.
    }
    if (mode === "embed-host") document.body.classList.add("gsc-embedded");
    booted = true;
    showSplash();
    wire();
    if (sound()) {
      $("btn-sound").textContent = sound().isOn() ? "\u{1F50A} Sound" : "\u{1F507} Muted";
      $("btn-sound").setAttribute("aria-pressed", String(sound().isOn()));
    }

    const gameParam = params.get("game");
    const saved = load();
    const savedMatches = !!saved && (!gameParam || saved.source.url === gameParam);
    if (saved && savedMatches && saved.state.phase !== "idle") {
      source = saved.source;
      roomCode = saved.roomCode || null;
      phonePids = new Set(Array.isArray(saved.phonePids) ? saved.phonePids : []);
      setState(saved.state);
      return; // a game in progress wins over a re-fetch (reload-resume)
    }
    if (saved && savedMatches) {
      source = saved.source;
      roomCode = saved.roomCode || null;
      phonePids = new Set(Array.isArray(saved.phonePids) ? saved.phonePids : []);
      state = saved.state;
      playerSeq = saved.state.players.length;
    }
    render();
    const info = await fetchContent();
    if (!state || state.phase === "idle") useGame(info.game, info);
  }

  /* ============ Public surface (wheel-room.js, harness) ============ */

  const api = {
    getState: () => state,
    dispatch,
    doSpin,
    setState,
    subscribe(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; },
    addPlayer,
    removePlayer,
    renamePlayer,
    setPhonePids(pids) { phonePids = new Set(pids); render(); },
    phonePids: () => new Set(phonePids),
    adoptRoom,
    ready,
    roomCode: () => roomCode,
    takenOverPid: () => takenOverPid,
    isSpinning: () => spinning,
    render,
    useGame,
    newGame,
    sourceInfo: () => ({ ...source }),
    STORAGE_KEY,
  };

  function boot() {
    init()
      .catch((err) => { console.warn("Wheel of Fortune could not start:", err); })
      .finally(() => markReady());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  return api;
})();

window.WheelApp = WheelApp;

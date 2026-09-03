/* ============================================================
   Family Feud — phone controller (spec 03 §5)
   A thin client: it renders whatever `phoneView` the host sends
   and posts back intents ({t:"team"}, {t:"buzz"}, {t:"fm-answer"}).
   It never scores, never advances and never assumes what happens
   next — the host is authoritative. Built for 320 px portrait.
   ============================================================ */

"use strict";

const FeudPhone = (function () {
  const { $, el, show } = window.FeudApp.helpers;

  /** @type {object|null} the SDK player handle */
  let me = null;
  /** @type {object|null} the last view the host sent */
  let view = null;
  /** Which Fast Money question this phone is looking at. */
  let fmIndex = 0;
  let connected = true;

  /* ============ Set-up ============ */

  async function init() {
    document.body.classList.add("player-mode");
    const GSC = window.GSC;
    if (GSC && GSC.mode === "embed-player") document.body.classList.add("gsc-embedded");
    // The section ships hidden so a host page never flashes it; `.hidden` uses
    // !important, so the class has to come off rather than be overridden in CSS.
    show($("screen-player"), true);
    wire();
    paint();
    if (!GSC || typeof GSC.player !== "function") {
      setError("This controller needs the shared room code (shared/bridge.js), which isn’t loaded.");
      return;
    }
    try {
      me = await GSC.player({
        onMessage: onHostMessage,
        onStatus: (isConnected) => { connected = isConnected; paint(); },
      });
    } catch (err) {
      console.warn("Could not join the room:", err);
      setError(`Could not join the room: ${err.message}`);
      return;
    }
    setError("");
    paint();
  }

  function onHostMessage(msg) {
    if (!msg || typeof msg !== "object" || msg.t !== "view") return;
    const previous = view;
    view = msg;
    if (!previous || previous.screen !== msg.screen) fmIndex = 0;
    if (msg.screen === "faceoff" && msg.armed && (!previous || !previous.armed)) {
      window.FeudSound?.play("buzzIn");
    }
    paint();
  }

  const send = (payload) => { if (me) me.send(payload); };

  /* ============ Render ============ */

  function paint() {
    const screen = view ? view.screen : "wait";
    show($("player-head"), !!view);
    show($("player-team-pick"), screen === "team-pick");
    show($("player-faceoff"), screen === "faceoff");
    show($("player-fm"), screen === "fm-answer");
    show($("player-message"), screen === "wait" || screen === "fm-wait" || screen === "result");
    if (!view) {
      setMessage("Connecting…", "Hold tight — the host screen has everything.");
      return;
    }
    paintHead();
    if (screen === "team-pick") paintTeamPick();
    else if (screen === "faceoff") paintFaceoff();
    else if (screen === "fm-answer") paintFastMoney();
    else paintMessage(screen);
  }

  function paintHead() {
    const badge = $("player-head-team");
    const label = view.teamLabel;
    badge.className = `player-head-team ${label === "B" ? "team-b" : label === "A" ? "team-a" : "team-none"}`;
    badge.textContent = label ? `Team ${label}` : "No team";
    $("player-head-name").textContent = (me && me.name) || (view.teamName || "");
  }

  function paintTeamPick() {
    [["player-team-a", "A", 0], ["player-team-b", "B", 1]].forEach(([id, label, index]) => {
      const btn = $(id);
      btn.textContent = view.scores[index] ? view.scores[index].name : `Team ${label}`;
      btn.setAttribute("aria-pressed", String(view.teamLabel === label));
    });
  }

  function paintFaceoff() {
    $("player-faceoff-q").textContent = view.question || "";
    const btn = $("player-buzz");
    const mine = view.teamLabel;
    if (view.buzzed !== null && view.buzzed !== undefined) {
      const won = (view.buzzed === 0 ? "A" : "B") === mine;
      btn.className = `player-buzz-btn ${won ? "mode-won" : "mode-lost"}`;
      btn.textContent = won ? "You buzzed!" : "Too late";
      btn.disabled = true;
      $("player-buzz-note").textContent = won ? "Give your answer out loud." : "The other podium got there first.";
      return;
    }
    btn.className = `player-buzz-btn ${view.armed ? "mode-armed" : "mode-idle"}`;
    btn.textContent = view.armed ? "BUZZ" : "Wait…";
    btn.disabled = !view.armed || !connected;
    $("player-buzz-note").textContent = view.armed
      ? "First one in gets the question."
      : "The host is reading the question.";
  }

  function paintFastMoney() {
    const fm = view.fm;
    const total = fm.questions.length;
    fmIndex = Math.min(Math.max(fmIndex, 0), total - 1);
    $("player-fm-step").textContent = `Question ${fmIndex + 1} of ${total}`;
    $("player-fm-q").textContent = fm.questions[fmIndex];
    const input = $("player-fm-input");
    if (document.activeElement !== input) input.value = fm.rows[fmIndex].text || "";
    $("player-fm-prev").disabled = fmIndex === 0;
    $("player-fm-next").textContent = fmIndex === total - 1 ? "Done" : "Submit →";
    $("player-fm-note").textContent = answeredNote(fm);
    syncPhoneTimer(fm);
  }

  function answeredNote(fm) {
    const answered = fm.rows.filter((row) => row.text).length;
    return `${answered} of ${fm.rows.length} answered. Pass is fine — say it out loud too.`;
  }

  function syncPhoneTimer(fm) {
    const timer = fm.timer;
    const running = timer && timer.running;
    const key = running ? `fm-${timer.slot}-${timer.startedAt}` : null;
    const elapsed = running ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0;
    window.FeudTimer?.sync("phone", key, Math.max(timer.seconds - elapsed, 0), timer.seconds);
  }

  function paintMessage(screen) {
    if (screen === "fm-wait") {
      setMessage("Cover your ears!", "Mute the call or step away until the host calls you back.");
    } else if (screen === "result") {
      setMessage(view.phaseText || "Round over", view.message || "");
    } else {
      setMessage(view.phaseText || "Watch the host screen", view.message || "");
    }
    paintScores();
  }

  function setMessage(title, sub) {
    $("player-message-title").textContent = title;
    $("player-message-sub").textContent = connected ? sub : "Reconnecting…";
  }

  function paintScores() {
    const host = $("player-scores");
    host.replaceChildren();
    if (!view || !Array.isArray(view.scores)) return;
    view.scores.forEach((team) => {
      const row = el("div", "player-score-row");
      row.appendChild(el("span", null, team.name));
      row.appendChild(el("span", null, String(team.score)));
      host.appendChild(row);
    });
  }

  const setError = (msg) => { $("player-error").textContent = msg || ""; };

  /* ============ Wiring ============ */

  function wire() {
    $("player-team-a").addEventListener("click", () => send({ t: "team", team: "A" }));
    $("player-team-b").addEventListener("click", () => send({ t: "team", team: "B" }));
    $("player-buzz").addEventListener("click", () => send({ t: "buzz" }));
    $("player-fm-prev").addEventListener("click", () => { submitFm(); step(-1); });
    $("player-fm-next").addEventListener("click", () => { submitFm(); step(1); });
    $("player-fm-input").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submitFm();
      step(1);
    });
    $("player-leave").addEventListener("click", () => { if (me) me.leave(); });
  }

  function submitFm() {
    if (!view || view.screen !== "fm-answer") return;
    send({ t: "fm-answer", slot: view.fm.slot, q: fmIndex, text: $("player-fm-input").value });
  }

  function step(delta) {
    if (!view || view.screen !== "fm-answer") return;
    const total = view.fm.questions.length;
    fmIndex = Math.min(Math.max(fmIndex + delta, 0), total - 1);
    paint();
  }

  return { init, getView: () => view };
})();

window.FeudPhone = FeudPhone;

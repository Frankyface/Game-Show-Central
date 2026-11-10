/* ============================================================
   Password — answers-private mode on the shared screen (docs/22 §5.4)
   While a host phone is assigned (connected or not), the password
   never reaches the shared screen before its public reveal (a word
   ending, a Lightning Round ending). The remembered reveal switches
   — "Show password to me", study, "Show words to me" — are ignored
   and the nodes are not created at all. In their place:

   - "Answer is on your host phone" while one is connected;
   - "Host phone disconnected" and ONE button, "Show answer on this
     screen", which reveals the current item only and clears itself
     on the next one.

   The exception (review F6): the giver panel exists so a giver
   WITHOUT a phone can learn the password. While a current giver
   (either team's in a word; the Lightning giver in the Lightning
   Round) has no connected phone, the panel and study stay exactly
   as they were, behind their own click and warning.

   pwd-view.js asks this file three questions and lets it paint the
   two private-mode surfaces; with no host phone every answer here
   is "behave as before". Pure DOM glue; textContent only.
   ============================================================ */

"use strict";

(function () {
  const on = (app) => !!(app && app.answersPrivate && app.core);

  /** The contestants who are entitled to read the word right now. */
  function giverPids(state) {
    if (!state) return [];
    if (state.phase === "lightning" && state.lightning) return [state.lightning.giverPid];
    if (state.phase === "word" && state.round) return window.PwdCore.giverPids(state);
    return [];
  }

  /** Is the giver panel (and study) available? Always, unless a host phone has taken over. */
  function allowsGiverPanel(app) {
    if (!on(app)) return true;
    const live = new Set(app.livePhones || []);
    return giverPids(app.core).some((pid) => !live.has(pid));
  }

  /** True when the password must stay off this screen and the host phone carries it. */
  function hidden(app) {
    return on(app) && !allowsGiverPanel(app);
  }

  /** One key per item: a word, or one Lightning word. The fallback clears when it changes. */
  function keyFor(state) {
    if (!state) return "";
    if (state.phase === "lightning" && state.lightning) {
      return `L:${state.gameNo}:${state.cursor}:${state.lightning.cursor}`;
    }
    if (state.phase === "word" && state.round) return `W:${state.gameNo}:${state.cursor}`;
    return "";
  }

  function fallbackOn(app) {
    return hidden(app) && !!app.fallbackKey && app.fallbackKey === keyFor(app.core);
  }

  /** The line that replaces the reveal hint. */
  function note(app) {
    if (fallbackOn(app)) return "The answer is on this screen until the next one.";
    return app.hostPhoneLive ? "Answer is on your host phone" : "Host phone disconnected";
  }

  /**
   * Paint the private-mode panel: the current answer if the host pressed the
   * fallback for this item, else the fallback button while no host phone is
   * connected, else nothing at all.
   */
  function fillPanel(panel, app, answer, buttonId) {
    panel.replaceChildren();
    panel.classList.toggle("is-open", false);
    if (fallbackOn(app)) {
      panel.classList.add("is-open");
      panel.appendChild(el("p", "word-warn", "Shared screen — the receivers must not be looking."));
      panel.appendChild(el("p", "word-now", answer || ""));
      return;
    }
    if (app.hostPhoneLive) return;
    const btn = el("button", "btn btn-ghost", "Show answer on this screen");
    btn.type = "button";
    btn.id = buttonId;
    btn.addEventListener("click", () => {
      window.PwdApp.set({ fallbackKey: keyFor(window.PwdApp.core()) });
      btn.blur();
    });
    panel.appendChild(btn);
  }

  window.PwdPrivate = { on, allowsGiverPanel, hidden, keyFor, fallbackOn, note, fillPanel, giverPids };
})();

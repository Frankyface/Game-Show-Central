/* ============================================================
   Game Show Central — small host UI helpers
   The confirm/input dialog and the join beep, split out of
   js/hub-host.js to keep that file under the 800-line house rule.
   No state of its own beyond the open dialog's closer and the audio
   context; no HTML strings (createElement + textContent only).
   ============================================================ */

"use strict";

const HubUI = (function () {
  "use strict";

  const BEEP_HZ = 660;
  const BEEP_MS = 120;
  let dialogCloser = null;
  let audioCtx = null;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(cls, text, onClick) {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  /**
   * A role="dialog" box in #dialog-root.
   * @param {{title:string, body?:string, input?:string, inputValue?:string,
   *          confirmText?:string, onConfirm:Function}} opts
   *        `input` (an aria-label) adds a name field; the confirm button then
   *        refuses an empty name with "Enter a name.".
   */
  function openDialog(opts) {
    closeDialog();
    const RP = globalThis.RoomProtocol;
    const root = document.getElementById("dialog-root");
    const back = el("div", "dialog-backdrop");
    const box = el("div", "dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", opts.title);
    box.appendChild(el("h2", "dialog-title", opts.title));
    if (opts.body) box.appendChild(el("p", "dialog-body", opts.body));
    let input = null;
    if (opts.input) {
      input = el("input", "field-input");
      input.type = "text";
      input.maxLength = RP.NAME_MAX;
      input.value = opts.inputValue || "";
      input.setAttribute("aria-label", opts.input);
      box.appendChild(input);
    }
    const err = el("p", "error-msg");
    box.appendChild(err);
    const row = el("div", "dialog-row");
    row.appendChild(button("btn btn-ghost", "Cancel", closeDialog));
    row.appendChild(button("btn btn-gold", opts.confirmText || "OK", () => {
      const value = input ? input.value : null;
      if (input && !RP.sanitizeName(value)) { err.textContent = "Enter a name."; return; }
      closeDialog();
      opts.onConfirm(value);
    }));
    box.appendChild(row);
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") row.lastChild.click(); });
    back.appendChild(box);
    root.appendChild(back);
    (input || row.lastChild).focus();
    const onKey = (e) => { if (e.key === "Escape") closeDialog(); };
    document.addEventListener("keydown", onKey);
    dialogCloser = () => { document.removeEventListener("keydown", onKey); root.replaceChildren(); };
  }

  function closeDialog() {
    if (dialogCloser) dialogCloser();
    dialogCloser = null;
  }

  /** A short WebAudio tick when a new phone joins. The caller checks the sound setting. */
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = BEEP_HZ;
      const t = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + BEEP_MS / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + BEEP_MS / 1000 + 0.02);
    } catch (err) { console.warn("Hub: beep failed", err); }
  }

  return { openDialog, closeDialog, beep };
})();

if (typeof globalThis !== "undefined") globalThis.HubUI = HubUI;

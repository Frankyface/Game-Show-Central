/* ============================================================
   Press Your Luck — did the scripts load?
   Loaded last. If a script failed to load (a bad deploy, a
   blocked file, a typo in a path) the page would otherwise sit on
   "Loading the board…" for ever. This says so in plain English.
   Deliberately uses no helper from the other files: they are the
   thing that may be missing.
   ============================================================ */

"use strict";

window.addEventListener("load", () => {
  const missing = ["PylContent", "PylCore", "PylBoard", "PylView", "PylApp"]
    .filter((name) => !window[name]);
  if (!missing.length) return;
  console.warn("Press Your Luck scripts missing:", missing.join(", "));
  const text = "Part of the game didn’t load, so it can’t start. Reload the page; "
    + "if it keeps happening, the site is missing a file.";
  const source = document.getElementById("pyl-source");
  if (source) source.textContent = text;
  const error = document.getElementById("pyl-error");
  if (error) { error.textContent = text; error.classList.remove("hidden"); }
  const phone = document.getElementById("pyl-phone-headline");
  if (phone) phone.textContent = "The game didn’t load — reload the page.";
});

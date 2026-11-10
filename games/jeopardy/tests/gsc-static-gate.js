/* ============================================================
   Jeopardy — J-2 static gate for the gsc-* files (verification J-2)
   Loaded by tests/gsc-embed-harness.html. Fetches every file this
   component owns and reports any file of 800+ lines or any use of a
   banned DOM / eval / logging API (comments are stripped first, since
   prose may name one). The patterns are assembled from fragments so
   this file never trips the hub-wide gate that scans tests/.
   ============================================================ */

"use strict";

window.GscStaticGate = (function () {
  const GATED = [
    "../js/gsc-embed.js", "../js/gsc-extras.js", "../js/gsc-hostview.js",
    "../css/gsc-embed.css", "../css/gsc-extras.css", "../css/gsc-look.css",
  ];
  const BANNED = [
    ["inner", "HTML"], ["insertAdjacent", "HTML"], ["outer", "HTML\\s*="],
    ["document\\.", "write"], ["\\bev", "al\\("], ["new\\s+Fun", "ction"],
    ["console\\.", "log"],
  ].map((parts) => new RegExp(parts.join("")));

  function codeOnly(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  }

  /** @returns {Promise<{problems:string[], sizes:string[]}>} */
  async function run() {
    const problems = [];
    const sizes = [];
    for (const path of GATED) {
      let text = "";
      try {
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) { problems.push(`${path} HTTP ${res.status}`); continue; }
        text = await res.text();
      } catch (err) { problems.push(`${path} unreadable`); continue; }
      const lines = text.split("\n").length;
      sizes.push(`${path.split("/").pop()}=${lines}`);
      if (lines >= 800) problems.push(`${path} has ${lines} lines`);
      const code = codeOnly(text);
      for (const re of BANNED) if (re.test(code)) problems.push(`${path} matches ${re.source}`);
    }
    return { problems, sizes };
  }

  return { run, GATED };
})();

/* ============================================================
   Game Show Central — the shared icon set (design system v3)
   docs/21-ui-cleanup-brief.md §2.5: no emoji on host screens; where an
   icon helps, use one of these. One consistent set: a 24-unit grid,
   1.5 px stroke at 24 px (scaled with the icon), round caps and joins,
   no fills, `currentColor`, so an icon always takes its button's ink.

     const svg = GSCIcons.make("sound");            // 18 px
     const svg = GSCIcons.make("undo", { size: 16 });
     button.prepend(svg);  // then keep a TEXT label beside it

   The returned <svg> is aria-hidden: the button's text label carries the
   meaning. Built with createElementNS from data below — no HTML strings.
   Unknown names return null (and warn) rather than throwing.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GSCIcons = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const DEFAULT_SIZE = 18;
  const MIN_SIZE = 12;
  const MAX_SIZE = 32;

  /* Each icon is a list of [tag, attributes]. Paths only use the 24×24 box. */
  const ICONS = {
    sound: [
      ["path", { d: "M4 9.5h3.5L12 6v12l-4.5-3.5H4z" }],
      ["path", { d: "M15.5 9a4 4 0 0 1 0 6" }],
      ["path", { d: "M18 6.5a7.5 7.5 0 0 1 0 11" }],
    ],
    "sound-off": [
      ["path", { d: "M4 9.5h3.5L12 6v12l-4.5-3.5H4z" }],
      ["path", { d: "M16 9.5l5 5M21 9.5l-5 5" }],
    ],
    settings: [
      ["circle", { cx: "12", cy: "12", r: "3" }],
      ["path", { d: "M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" }],
    ],
    back: [
      ["path", { d: "M15 5l-7 7 7 7" }],
    ],
    undo: [
      ["path", { d: "M9 7L4.5 11.5 9 16" }],
      ["path", { d: "M4.5 11.5H14a5 5 0 0 1 0 10h-2" }],
    ],
    lobby: [
      ["path", { d: "M3.5 11L12 4l8.5 7" }],
      ["path", { d: "M6 9.5V20h12V9.5" }],
      ["path", { d: "M10 20v-5h4v5" }],
    ],
    edit: [
      ["path", { d: "M14.5 5.5l4 4L9 19H5v-4z" }],
      ["path", { d: "M12.5 7.5l4 4" }],
    ],
    phone: [
      ["rect", { x: "7", y: "3", width: "10", height: "18", rx: "2" }],
      ["path", { d: "M11 18h2" }],
    ],
    check: [
      ["path", { d: "M5 12.5l4.5 4.5L19 7.5" }],
    ],
    cross: [
      ["path", { d: "M6 6l12 12M18 6L6 18" }],
    ],
    play: [
      ["path", { d: "M8 5.5v13l10.5-6.5z" }],
    ],
    pause: [
      ["path", { d: "M9 5.5v13M15 5.5v13" }],
    ],
    "chevron-down": [
      ["path", { d: "M6 9.5l6 6 6-6" }],
    ],
    copy: [
      ["rect", { x: "8.5", y: "8.5", width: "11", height: "11", rx: "1.5" }],
      ["path", { d: "M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" }],
    ],
    lock: [
      ["rect", { x: "5", y: "10.5", width: "14", height: "10", rx: "1.5" }],
      ["path", { d: "M8 10.5V7.5a4 4 0 0 1 8 0v3" }],
    ],
  };

  /** @returns {string[]} every registered icon name. */
  function names() {
    return Object.keys(ICONS);
  }

  /** @returns {boolean} */
  function has(name) {
    return Object.prototype.hasOwnProperty.call(ICONS, name);
  }

  function clampSize(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_SIZE;
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
  }

  /**
   * Build one icon.
   * @param {string} name   one of names()
   * @param {{size?:number, label?:string, doc?:Document}} [opts]
   *        size: px (default 18, clamped 12–32). label: makes the icon
   *        meaningful on its own (role="img" + aria-label) — only for an
   *        icon with no visible text beside it. doc: for tests.
   * @returns {SVGSVGElement|null}
   */
  function make(name, opts) {
    const o = opts || {};
    const doc = o.doc || (typeof document !== "undefined" ? document : null);
    if (!doc || !has(name)) {
      if (!has(name) && typeof console !== "undefined") console.warn("GSCIcons: unknown icon", name);
      return null;
    }
    const size = String(clampSize(o.size));
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("class", "gsc-icon gsc-icon-" + name);
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("focusable", "false");
    if (typeof o.label === "string" && o.label) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", o.label);
    } else {
      svg.setAttribute("aria-hidden", "true");
    }
    for (const [tag, attrs] of ICONS[name]) {
      const node = doc.createElementNS(NS, tag);
      for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
      svg.appendChild(node);
    }
    return svg;
  }

  /**
   * Put an icon at the front of an element (a button), keeping its text.
   * Replaces an icon a previous call added, so re-rendering is safe.
   * @returns {SVGSVGElement|null}
   */
  function prepend(el, name, opts) {
    if (!el) return null;
    const old = el.querySelector ? el.querySelector(":scope > .gsc-icon") : null;
    if (old) old.remove();
    const svg = make(name, opts);
    if (svg) el.insertBefore(svg, el.firstChild);
    return svg;
  }

  return { make, prepend, names, has, DEFAULT_SIZE };
});

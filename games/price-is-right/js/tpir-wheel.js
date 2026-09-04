/* ============================================================
   The Price Is Right — the big wheel, drawn as a vertical drum
   DOM only. It NEVER decides anything: the landing segment comes
   from TpirCore.reduce (rng injected) before spin() is called and
   this file only visualises that decision — the same discipline
   as games/wheel-of-fortune/js/wheel-draw.js (spec 10 §3).

   The drum is the wheel seen edge-on: each of the 20 segments sits
   at an angle on a cylinder, so its band is tall in the middle of
   the face and squashed towards the top and bottom rims. The
   pointer sits at the middle of the face (theta = 90 degrees).
   Every node is built with createElementNS, never from markup text.
   Browser only; exported as window.TpirWheel.
   ============================================================ */

"use strict";

const TpirWheel = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const W = 300;
  const H = 420;
  const CX = W / 2;
  const CY = H / 2;
  const R = 168;                 // half the drum's visible height
  const FACE = 90;               // the angle under the pointer
  const MIN_SPIN_MS = 3200;      // the wheel eases out for at least 3 s
  const TICK_MIN_MS = 40;

  // A carnival ribbon: six saturated bands so neighbours always differ across
  // 20 segments (20 and 6 share only the factor 2, so 19 and 0 differ too).
  const PALETTE = ["#b3242f", "#1d6fdc", "#2dc653", "#ffd23f", "#9d4edd", "#ff8c1a"];
  const INK = ["#fff6e8", "#ffffff", "#08240f", "#2a1a00", "#ffffff", "#20120a"];

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  };

  const rad = (deg) => (deg * Math.PI) / 180;

  /** 0-360 with negatives folded back in. */
  const norm = (deg) => ((deg % 360) + 360) % 360;

  const label = (value) => (Number(value) >= 100 ? "$1.00" : `${Number(value) || 0}¢`);

  /** The y of the rim point at `theta` on a drum of radius R. */
  const yAt = (theta) => CY - R * Math.cos(rad(theta));

  /**
   * (Re)build the drum inside `svg` for `values`. One `<g>` per segment,
   * repositioned every frame by `setRotation`. Returns the segment group list.
   */
  function build(svg, values) {
    if (!svg) return null;
    svg.replaceChildren();
    const list = Array.isArray(values) && values.length ? values : [];
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("aria-label", `The big wheel: ${list.length} segments from 5 cents to a dollar`);

    svg.appendChild(defs());
    svg.appendChild(el("rect", {
      x: 26, y: 18, width: W - 52, height: H - 36, rx: 44,
      fill: "#1a0d05", stroke: "#ffd23f", "stroke-width": 5,
    }));

    const bands = el("g", { class: "drum-bands" });
    list.forEach((value, i) => bands.appendChild(buildBand(value, i)));
    svg.appendChild(bands);

    // The cylinder shading and the pointer never move.
    svg.appendChild(el("rect", {
      x: 30, y: 22, width: W - 60, height: H - 44, rx: 40,
      fill: "url(#drum-shade)", "pointer-events": "none",
    }));
    svg.appendChild(buildPointer());
    setRotation(svg, FACE, list.length);
    return bands;
  }

  function defs() {
    const d = el("defs", {});
    const shade = el("linearGradient", { id: "drum-shade", x1: "0", y1: "0", x2: "1", y2: "0" });
    [[0, 0.55], [0.18, 0.12], [0.5, 0], [0.82, 0.16], [1, 0.6]].forEach(([offset, alpha]) => {
      shade.appendChild(el("stop", { offset, "stop-color": "#000", "stop-opacity": alpha }));
    });
    d.appendChild(shade);
    return d;
  }

  /** One segment: a full-width band with its value centred on it. */
  function buildBand(value, index) {
    const g = el("g", { class: "drum-band", "data-index": index });
    g.appendChild(el("rect", {
      x: 32, width: W - 64, y: 0, height: 1, rx: 4,
      fill: PALETTE[index % PALETTE.length],
      stroke: "rgba(0,0,0,0.45)", "stroke-width": 1,
    }));
    const text = el("text", {
      x: CX, y: 0, "text-anchor": "middle", "dominant-baseline": "central",
      fill: INK[index % INK.length], class: "drum-text",
    });
    text.textContent = label(value);
    g.appendChild(text);
    return g;
  }

  /** The chunky flap at the middle of the face; it never moves. */
  function buildPointer() {
    const g = el("g", { class: "drum-pointer", "aria-hidden": "true" });
    g.appendChild(el("path", {
      d: `M 18 ${CY} L 62 ${CY - 24} L 62 ${CY + 24} Z`,
      fill: "#ffd23f", stroke: "#1a0d05", "stroke-width": 4, "stroke-linejoin": "round",
    }));
    g.appendChild(el("path", {
      d: `M ${W - 18} ${CY} L ${W - 62} ${CY - 24} L ${W - 62} ${CY + 24} Z`,
      fill: "#ffd23f", stroke: "#1a0d05", "stroke-width": 4, "stroke-linejoin": "round",
    }));
    return g;
  }

  /* ============ Rotation ============ */

  const bandsOf = (svg) => (svg ? svg.querySelector(".drum-bands") : null);

  const rotationOf = (svg) => {
    const bands = bandsOf(svg);
    const raw = bands && bands.dataset ? Number(bands.dataset.rotation) : FACE;
    return Number.isFinite(raw) ? raw : FACE;
  };

  /**
   * Place every band for `rotation`. A band whose angle is on the back of the
   * drum is hidden; the rest are sized by how much of the face they occupy,
   * which is what gives the drum its perspective.
   */
  function setRotation(svg, rotation, count) {
    const bands = bandsOf(svg);
    if (!bands) return;
    bands.dataset.rotation = String(rotation);
    const n = count || bands.childNodes.length;
    const step = n ? 360 / n : 360;
    for (let i = 0; i < bands.childNodes.length; i += 1) {
      placeBand(bands.childNodes[i], norm(rotation + i * step), step);
    }
  }

  function placeBand(band, theta, step) {
    const top = theta - step / 2;
    const bottom = theta + step / 2;
    // Front of the drum only: 0 degrees is the top rim, 180 the bottom rim.
    const visible = theta >= 0 && theta <= 180;
    band.setAttribute("opacity", visible ? String(0.35 + 0.65 * Math.sin(rad(theta))) : "0");
    if (!visible) { band.setAttribute("transform", "translate(0,-999)"); return; }
    band.removeAttribute("transform");
    const y1 = yAt(Math.max(0, top));
    const y2 = yAt(Math.min(180, bottom));
    const height = Math.max(1, y2 - y1);
    const rect = band.childNodes[0];
    const text = band.childNodes[1];
    rect.setAttribute("y", y1.toFixed(2));
    rect.setAttribute("height", height.toFixed(2));
    text.setAttribute("y", (y1 + height / 2).toFixed(2));
    text.setAttribute("font-size", Math.max(6, Math.min(40, height * 0.62)).toFixed(1));
    text.setAttribute("opacity", height > 13 ? "1" : "0");
  }

  /** Which segment sits under the pointer at `rotation`. */
  function segmentAtPointer(rotation, count) {
    if (!count) return 0;
    const step = 360 / count;
    const i = Math.round(norm(FACE - rotation) / step);
    return ((i % count) + count) % count;
  }

  /** The rotation that puts `index` under the pointer. */
  const rotationForIndex = (index, count) => FACE - index * (360 / count);

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const prefersReducedMotion = () =>
    typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Roll to the segment the core already picked.
   * @param {object} opts {svg, index, count, turns, duration, onTick, onDone, reduced}
   * @returns {function} cancel
   */
  function spin(opts) {
    const svg = opts.svg;
    if (!bandsOf(svg)) { if (opts.onDone) opts.onDone(); return () => {}; }
    const count = opts.count || 1;
    const from = rotationOf(svg);
    let target = rotationForIndex(opts.index, count);
    const turns = typeof opts.turns === "number" ? opts.turns : 3;
    while (target > from - turns * 360) target -= 360;   // the drum rolls downwards

    const reduced = opts.reduced === undefined ? prefersReducedMotion() : opts.reduced;
    if (reduced) {
      setRotation(svg, target, count);
      if (opts.onDone) opts.onDone(target);
      return () => {};
    }
    return animate(svg, { from, target, count, opts });
  }

  /** The rAF loop, with the same background-tab guard the wheel game uses. */
  function animate(svg, cfg) {
    const { from, target, count, opts } = cfg;
    const duration = Math.max(opts.duration || MIN_SPIN_MS, MIN_SPIN_MS);
    const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let frame = 0;
    let guard = 0;
    let last = segmentAtPointer(from, count);
    let lastTickAt = 0;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(guard);
      setRotation(svg, target, count);
      if (opts.onDone) opts.onDone(target);
    }

    function step(now) {
      if (done) return;
      const elapsed = (now || Date.now()) - start;
      const t = Math.min(elapsed / duration, 1);
      if (t >= 1) { finish(); return; }
      const deg = from + (target - from) * easeOutCubic(t);
      setRotation(svg, deg, count);
      const at = segmentAtPointer(deg, count);
      if (at !== last) {
        last = at;
        if (opts.onTick && elapsed - lastTickAt >= TICK_MIN_MS) { lastTickAt = elapsed; opts.onTick(); }
      }
      frame = window.requestAnimationFrame(step);
    }

    frame = window.requestAnimationFrame(step);
    // A hidden/backgrounded tab stops firing rAF; without this the spin would
    // never end and the host would be locked out of their own show.
    guard = window.setTimeout(finish, duration + 900);
    return () => {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(guard);
    };
  }

  /** Snap to a segment with no animation (used on reload/restore). */
  function showIndex(svg, index, count) {
    setRotation(svg, rotationForIndex(index, count), count);
  }

  return {
    build, spin, showIndex, setRotation, rotationOf, segmentAtPointer,
    rotationForIndex, prefersReducedMotion, label, MIN_SPIN_MS, FACE, PALETTE,
  };
})();

window.TpirWheel = TpirWheel;

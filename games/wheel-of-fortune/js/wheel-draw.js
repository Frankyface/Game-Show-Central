/* ============================================================
   Wheel of Fortune — the wheel: SVG builder + spin animation
   DOM only. It NEVER decides anything: the landing wedge comes
   from WheelCore.reduce (rng injected) before spin() is called,
   and this file only visualises that decision (spec 04 §3).
   Every node is built with createElementNS, never from markup text.
   Browser only; exported as window.WheelDraw.
   ============================================================ */

"use strict";

const WheelDraw = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const SIZE = 400;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R_OUTER = 192;
  const R_INNER = 62; // hub
  const R_LABEL = 132;
  // Styling only: the viewBox is inset so the rim lights and the pointer flap
  // have room outside the wedge ring. Wedge geometry, the rotor transform and
  // wedgeAtPointer()/rotationForIndex() are all unchanged by this.
  const PAD = 26;
  const R_RIM = R_OUTER + 13; // the bulb ring
  const RIM_LIGHTS = 24;

  // Saturated TV-wheel colours. 6 entries divide 24 evenly, so wedge 23 and
  // wedge 0 still differ where the ring closes.
  const PALETTE = ["#e0245e", "#f5a623", "#12b3a6", "#7b3ff2", "#2e9bff", "#7ac70c"];
  const BANKRUPT_FILL = "#0a0a10";
  const LOSE_FILL = "#f2f2f5";

  const MIN_SPIN_MS = 3200; // spec: ease-out for at least 3 s
  const TICK_MIN_MS = 45; // WebAudio tick throttle

  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  };

  const rad = (deg) => (deg * Math.PI) / 180;

  /** Point on a circle; 0deg is 12 o'clock and angles grow clockwise. */
  function point(cx, cy, r, deg) {
    const a = rad(deg - 90);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  /** Annular wedge path from `from`deg to `to`deg (clockwise from 12 o'clock). */
  function wedgePath(from, to) {
    const [x1, y1] = point(CX, CY, R_OUTER, from);
    const [x2, y2] = point(CX, CY, R_OUTER, to);
    const [x3, y3] = point(CX, CY, R_INNER, to);
    const [x4, y4] = point(CX, CY, R_INNER, from);
    const large = to - from > 180 ? 1 : 0;
    return [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
      `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
      "Z",
    ].join(" ");
  }

  function wedgeFill(value, index) {
    if (value === "BANKRUPT") return BANKRUPT_FILL;
    if (value === "LOSE A TURN") return LOSE_FILL;
    return PALETTE[index % PALETTE.length];
  }

  function wedgeInk(value) {
    if (value === "BANKRUPT") return "#ffffff";
    if (value === "LOSE A TURN") return "#12122a";
    return "#ffffff";
  }

  function labelText(value) {
    if (value === "BANKRUPT") return "BANKRUPT";
    if (value === "LOSE A TURN") return "LOSE A TURN";
    return `$${value}`;
  }

  /** One wedge label, set radially so it reads from the hub outwards. */
  function buildLabel(value, mid) {
    const [lx, ly] = point(CX, CY, R_LABEL, mid);
    const words = labelText(value).split(" ");
    const node = el("text", {
      x: lx.toFixed(2), y: ly.toFixed(2),
      transform: `rotate(${(mid + 180).toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})`,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      fill: wedgeInk(value),
      class: value === "BANKRUPT" || value === "LOSE A TURN" ? "wedge-label wedge-label-word" : "wedge-label",
    });
    words.forEach((word, i) => {
      const line = el("tspan", { x: lx.toFixed(2), dy: i === 0 ? (words.length > 1 ? "-0.45em" : "0") : "1em" });
      line.textContent = word;
      node.appendChild(line);
    });
    return node;
  }

  /** Decorative bulb ring around the rim. Purely visual; nothing reads it. */
  function buildRim() {
    const group = el("g", { class: "wheel-rim", "aria-hidden": "true" });
    for (let i = 0; i < RIM_LIGHTS; i += 1) {
      const [x, y] = point(CX, CY, R_RIM, (360 / RIM_LIGHTS) * i + 180 / RIM_LIGHTS);
      const halo = el("circle", { cx: x.toFixed(2), cy: y.toFixed(2), r: 8.5, fill: "rgba(255,214,120,0.16)" });
      const bulb = el("circle", {
        cx: x.toFixed(2), cy: y.toFixed(2), r: 4.2,
        fill: "#fff3cf", stroke: "rgba(120,70,10,0.55)", "stroke-width": 1,
        class: i % 2 === 0 ? "wheel-bulb wheel-bulb-a" : "wheel-bulb wheel-bulb-b",
      });
      group.appendChild(halo);
      group.appendChild(bulb);
    }
    return group;
  }

  /** The chunky pointer flap over 12 o'clock. Purely visual. */
  function buildPointer() {
    const group = el("g", { class: "wheel-pointer", "aria-hidden": "true" });
    const tipY = CY - R_OUTER + 30;
    const topY = CY - R_OUTER - 20;
    group.appendChild(el("path", {
      d: `M ${CX} ${tipY} L ${CX - 21} ${topY} L ${CX + 21} ${topY} Z`,
      fill: "#f0c24b", stroke: "#1b0838", "stroke-width": 4, "stroke-linejoin": "round",
    }));
    group.appendChild(el("path", {
      d: `M ${CX} ${tipY - 9} L ${CX - 11} ${topY + 7} L ${CX} ${topY + 7} Z`,
      fill: "rgba(255,255,255,0.55)",
    }));
    group.appendChild(el("rect", {
      x: CX - 25, y: topY - 11, width: 50, height: 13, rx: 6,
      fill: "#1b0838", stroke: "#f0c24b", "stroke-width": 3,
    }));
    return group;
  }

  /**
   * (Re)build the wheel inside `svg` for `wedges`. Returns the rotating group.
   * Longer than 50 lines because it lays out one self-contained SVG scene
   * (rim, wedges, labels, hub, pointer) that would only get harder to follow
   * split across helpers that each need the same geometry constants.
   */
  function build(svg, wedges) {
    if (!svg) return null;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`);
    svg.setAttribute("role", "img");
    const list = Array.isArray(wedges) && wedges.length ? wedges : [];
    svg.setAttribute("aria-label", `Wheel with ${list.length} wedges`);

    const rotor = el("g", { class: "wheel-rotor", "transform-origin": `${CX} ${CY}` });
    rotor.style.transformOrigin = `${CX}px ${CY}px`;
    const step = list.length ? 360 / list.length : 360;

    for (let i = 0; i < list.length; i += 1) {
      const from = i * step;
      const to = from + step;
      const wedge = el("path", {
        d: wedgePath(from, to),
        fill: wedgeFill(list[i], i),
        stroke: "rgba(0,0,0,0.45)",
        "stroke-width": 1.5,
        class: "wheel-wedge",
      });
      rotor.appendChild(wedge);
      rotor.appendChild(buildLabel(list[i], from + step / 2));
    }

    // Hub over the wedge tips.
    rotor.appendChild(el("circle", { cx: CX, cy: CY, r: R_INNER, fill: "#1b0838", stroke: "#f0c24b", "stroke-width": 4 }));
    rotor.appendChild(el("circle", { cx: CX, cy: CY, r: R_INNER - 14, fill: "#2a0a4a", stroke: "rgba(255,255,255,0.18)", "stroke-width": 2 }));

    // Bezel behind the wedges: a dark ring carrying the rim lights.
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: R_OUTER + PAD - 4, fill: "#170533", stroke: "rgba(0,0,0,0.55)", "stroke-width": 2, class: "wheel-bezel" }));
    svg.appendChild(buildRim());
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: R_OUTER + 4, fill: "none", stroke: "#f0c24b", "stroke-width": 4, class: "wheel-ring" }));
    svg.appendChild(rotor);

    // Pointer flap at 12 o'clock; it never rotates. Chunkier than the wedge
    // ring so it reads from the back of the room.
    svg.appendChild(buildPointer());

    setRotation(rotor, 0);
    return rotor;
  }

  const rotorOf = (svg) => (svg ? svg.querySelector(".wheel-rotor") : null);

  function setRotation(rotor, deg) {
    if (!rotor) return;
    rotor.dataset.rotation = String(deg);
    rotor.style.transform = `rotate(${deg}deg)`;
  }

  const rotationOf = (rotor) => {
    const raw = rotor && rotor.dataset ? Number(rotor.dataset.rotation) : 0;
    return Number.isFinite(raw) ? raw : 0;
  };

  /**
   * Which wedge sits under the pointer at `rotationDeg`. The harness uses this
   * to prove the animation stopped on the wedge the core chose (W-I1).
   */
  function wedgeAtPointer(rotationDeg, count) {
    if (!count) return 0;
    const step = 360 / count;
    const norm = ((-rotationDeg % 360) + 360) % 360;
    return Math.min(Math.floor(norm / step), count - 1);
  }

  /** The rotation that puts the middle of wedge `index` under the pointer. */
  const rotationForIndex = (index, count) => -(index + 0.5) * (360 / count);

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const prefersReducedMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Animate to the wedge the core already picked.
   * @param {object} opts {svg, index, count, turns, duration, onTick, onDone, reduced}
   * @returns {function} cancel
   */
  function spin(opts) {
    const svg = opts.svg;
    const rotor = rotorOf(svg);
    if (!rotor) { if (opts.onDone) opts.onDone(); return () => {}; }
    const count = opts.count || 1;
    const from = rotationOf(rotor);
    let target = rotationForIndex(opts.index, count);
    const turns = typeof opts.turns === "number" ? opts.turns : 4;
    while (target < from + turns * 360) target += 360;

    const reduced = opts.reduced === undefined ? prefersReducedMotion() : opts.reduced;
    if (reduced) {
      // No motion: land on the result and let CSS fade it in.
      setRotation(rotor, target);
      svg.classList.remove("wheel-faded");
      // Force a reflow so the class re-triggers the fade on repeated spins.
      void svg.getBoundingClientRect().width;
      svg.classList.add("wheel-faded");
      if (opts.onDone) opts.onDone(target);
      return () => {};
    }

    const duration = Math.max(opts.duration || MIN_SPIN_MS, MIN_SPIN_MS);
    const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let frame = 0;
    let guard = 0;
    let lastWedge = wedgeAtPointer(from, count);
    let lastTickAt = 0;
    let done = false;

    /**
     * Land on the target and hand control back. Idempotent, because two things
     * can call it: the last animation frame, and the wall-clock guard below.
     */
    function finish() {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(guard);
      setRotation(rotor, target);
      if (opts.onDone) opts.onDone(target);
    }

    function step(now) {
      if (done) return;
      const elapsed = (now || Date.now()) - start;
      const t = Math.min(elapsed / duration, 1);
      if (t >= 1) { finish(); return; }
      const deg = from + (target - from) * easeOutCubic(t);
      setRotation(rotor, deg);
      const wedge = wedgeAtPointer(deg, count);
      if (wedge !== lastWedge) {
        lastWedge = wedge;
        if (opts.onTick && elapsed - lastTickAt >= TICK_MIN_MS) {
          lastTickAt = elapsed;
          opts.onTick();
        }
      }
      frame = window.requestAnimationFrame(step);
    }

    frame = window.requestAnimationFrame(step);
    // A hidden/backgrounded tab stops firing rAF. Without this the spin would
    // never end and the host would be locked out of their own game.
    guard = window.setTimeout(finish, duration + 900);
    return () => {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(guard);
    };
  }

  /** Snap the wheel to a wedge with no animation (used on reload/restore). */
  function showIndex(svg, index, count) {
    const rotor = rotorOf(svg);
    if (!rotor) return;
    setRotation(rotor, rotationForIndex(index, count));
  }

  return {
    build, spin, showIndex, wedgeAtPointer, rotationForIndex, rotationOf,
    rotorOf, prefersReducedMotion, MIN_SPIN_MS, PALETTE,
  };
})();

window.WheelDraw = WheelDraw;

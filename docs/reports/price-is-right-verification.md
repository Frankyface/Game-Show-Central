# price-is-right — verification report

Component: **The Price Is Right** (`games/price-is-right/**`)
Spec: `docs/10-price-is-right-spec.md` · Plan: `docs/06-verification-plan.md` §5
Tester: independent tester agent (did not write this code) · 2026-09-04

---

## 1. Environment

| | |
| --- | --- |
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 (`node --test`, zero deps) |
| Browser | Chromium via the in-app browser pane |
| Server | `python -m http.server 8696 --bind 127.0.0.1` from the repo root |
| Date | 2026-09-04 |
| Under test | `games/price-is-right/**` at `main` |
| Broker | The real PeerJS broker **was reachable** — room `5TUN` opened, two phones joined over WebRTC. No BLOCKED-ENV. |

What I added: `tests/tpir-adversarial.test.mjs` (A1–A6) and
`tests/tpir-adversarial-show.test.mjs` (A7–A10) with
`tests/adversarial-helpers.mjs` — 60 new tests written against the spec, not
against the implementation. Split into two files only to stay under the
800-line house limit (V2).

Totals: **106 unit tests, 0 failures** (46 implementer + 60 tester).
**Harness 57/57.** Root `node --test`: **754 tests, 0 failures** (no regression).

---

## 2. Results

### T1 — unit (`cd games/price-is-right && node --test`, exit 0)

| ID | Result | Evidence |
| --- | --- | --- |
| **P-U1** validator table | PASS | 31 broken files each rejected by name; `prizes.json` ≡ `js/data.js`; showcase totals 8600 / 6180 / 11550 / 8140 |
| **P-U2** One Bid | PASS | closest-without-over, exact bonus, all-over → rebid, tie → earliest bid |
| **P-U3** Cliff Hangers | PASS | step maths, fall, three exact prices |
| **P-U4** Plinko | PASS | chip earning, 13-step bounce path, core-chosen slot |
| **P-U5** Lucky Seven | PASS | cost, $1 wins, $0 loses |
| **P-U6** Showdown | PASS | bust, exact dollar, spin-off |
| **P-U7** Showcase | PASS | margin, wins-both, double overbid, one player winning both showdowns |
| **P-U8** plan 1–12 players | PASS | |
| **P-U9** undo / illegal / immutability | PASS | |
| **P-U10** phone messages + view leaks | PASS | |
| **A1** row edges (tester) | PASS | tie → earliest **bid** in both arrival orders and after a correction (`row.order ["p2","p4"]`); exact bid paid once (a second `revealBids` is a no-op); all-over → `winnings {}` and `nextSegment` refused; a silent seat is skipped (`["p1","p3"]` unplaced); a 5th player takes the winner's seat (`["p1","p5","p3","p4"]`, queue `["p2"]`) |
| **A2** Cliff Hangers 25 vs 26 | PASS | 25 steps → `done true, won true`; 26 → `done true, won false`, later guesses ignored; 0-error → `steps 0, left 25, award 5000`; guesses 0/-1/100/12.5/"40"/NaN ignored |
| **A3** Plinko | PASS | first chip free (`chips 1`); each of the four answers earns one (`higher, correct, lower, correct` → 2,3,4,5); `maxChips 2` caps at 2; four wrong answers leave 1; `plinkoPath` from every slot with rng 0 and 0.999: 13 entries, all in 0…8, half-step parity kept, never drifts the wrong way; drop pays the **core's** slot; a drop before the answers are done, from slot −1/9/1.5/"4", or with no chips left is refused |
| **A4** Lucky Seven | PASS | first digit given (`revealedDigits [2]`, `index 1`, no guesses); spend 6 → wallet 1 → **won**; spend 7 → wallet 0 → **lost** and the car money not paid; going broke stops the game before the remaining digits (2 guesses, not 4) |
| **A5** wheel | PASS | exact $1.00 pays the 1000 bonus and ends the turn (no "decide"); 80 + 35 = 115 busts, hands on, pays nothing; stay keeps the total; only two spins each; out-of-turn / other-player spins ignored; **three-way tie → spin-off**: `spinoff true, round 2, totals {0,0,0}, current 0`, one spin each |
| **A6** showcase | PASS | one player winning both showdowns (`showdownWinners ["p1","p1"]`) still yields **two different finalists** and two different showcases; pass swaps, take keeps, the choice is made once; **margin exactly 250 wins both**, 251 wins one only; both over → `doubleOver`, `winner null`, `winnings` unchanged; a non-bidder is treated as over |
| **A7** plan 1/3/4/7/12 | PASS | `seats = min(4, n)`, 6 games, 2 showdowns, 15 segments, showdown at index 6, and the segment list is byte-identical for all five roster sizes; thin file (4 One Bid) still reaches the showcase; `gamesPerShowdown` 1 and 4; a single player runs the whole episode to `standings` |
| **A8** validator fuzz | PASS | 3 One Bid items, Cliff Hangers price 100, Plinko `shown` 0, Lucky Seven 4-digit price, 19- and 21-segment wheels, 8-slot Plinko board, `settings` as a string/array, `pricingGames` as a string, wheel holding `"50"` / `0`, `maxChips` 10, `gamesPerShowdown` 9, a note as a number, `oneBid` as an object, items as `null`/strings — all rejected with a message naming the field; 13 primitive junk values throw rather than crash; `normalizeGame` never mutates its input |
| **A9** phone fuzz + leaks | PASS | 9 legal frames survive as **narrow copies** (`{t,amount}` only — a smuggled `pid`/`type` is dropped); 35 hostile frames → `null`; with four distinct marker bids each phone sees only its own and never `"price"` or the item price; a spectator's view has no controls and no numbers; a Plinko phone never sees `actual`, `path` or `landing`; Lucky Seven shows only `known:[2]`; a showcase phone sees neither the other bid nor either total |
| **A10** immutability / undo | PASS | every one of 18 event types applied to a **deep-frozen** state across six phases leaves it byte-identical; 13 malformed/hostile events return the same object; **undo unwinds a 23-event episode one step at a time**, `deepEqual` against the pre-event snapshot at every step, through row, pricing game, showdown and showcase, and finally back to `setup`; undo restores money, chips and the wheel; history capped at 60 and still exact at the cap; `finish` from any segment, and undoable |

### T2 — loopback harness (`tests/harness.html`, served)

| ID | Result | Evidence |
| --- | --- | --- |
| **P-I1 … P-I6** | PASS | `#summary.ok` — "**All 57 checks passed.**" (three consecutive runs after the fixes below) |
| P-I1 masked bids | PASS (assertion strengthened) | `••• \| ••• \| ••• \| — · fields [,,,]` — I added a check that the host's mirror `<input>` values are empty as well, because `body.textContent` does not include input values and the original check therefore missed defect **D1**. |
| Harness stability | **FAIL then PASS → fixed (D3)** | First run: `1 of 57 checks FAILED — P-I4 … steps 0, won true`. The check hard-coded `winnings.p2 > 4000` while the Cliff Hangers set (prize 4000 **or 2600**) and the One Bid item (145–930) are drawn with an unseeded `Math.random`. Re-run passed. Now asserts against `core().game.prize.price`; the very next run hit the 2600 set and reported `banked 3510 on a 2600 prize` and passed. |

### T4 — standalone, a full episode host-only with 4 manual players (1280×720)

Driven by clicking the real controls at `http://127.0.0.1:8696/games/price-is-right/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Full episode | PASS | 6 rows, 6 pricing games (Plinko ×2, Cliff Hangers ×2, Lucky Seven ×2), 2 showdowns, showcase, standings — `1 Ada $71,189 · 2 Cleo $21,750 · 3 Ben $2,449 · 4 Dev $1,799` |
| Masked bids | PASS | podiums `Ada••• Bid placed …` on every row, `document.body.textContent` never contains the price |
| Reveal | PASS | `Ada $140 Comes on down! / Ben $99 Under` + `Actual retail price: $145` |
| Showcase margin | PASS | bid `actual − 250` → `both true, diff 250`, payout `51499 + 8140 + 11550 = 71189` |
| **Plinko chip = core slot** | PASS ×10 | e.g. `from 3 → coreLanding 4, restingCx 230.0 vs expected 230.0`; `from 5 → 7, 379.3 vs 379.3`; ten drops, zero mismatches |
| **Wheel = core segment** | PASS ×8 | `segmentAtPointer(rotationOf(svg), 20)` equalled `lastSpin.index` on every spin (13, 18, 5, 18, 11, 6, 12, 8) and `#tpir-sd-value` matched `TpirWheel.label(value)` |
| Reload at every segment | PASS | row (bids + item restored), **mid-Plinko-drop** (`busy` cleared, chip resting at `cx 230` = core slot 4, slot buttons usable), **mid-spin** (drum snapped to core index 18, `90¢`, spin button usable), showdown, showcase (`seg 14`, winnings identical, `Total hidden`), standings |
| Undo repeatedly | PASS | 5 undos in a row at the showdown: history 60 → 55, screen and phase intact, no error banner |
| Editor Download + Use | PASS | tabs `Settings / One Bid / Cliff Hangers / Plinko / Lucky Seven / Showcases`; setting a price to 0 shows *"One Bid item 1 needs a whole-dollar price from 1 to 1000000."* and disables **both** Use and Download; `+ Add a One Bid item` works; the exact bytes Download would write (6,470 B) re-validate through `validateGame`; **Use in game** adopts the draft (13 items) and clears the show; the draft survives under `gsc-tpir-draft-v1` |
| `?game=URL` vs a save | PASS | with an editor save present, `?game=tests/fixtures/harness-prizes.json` **won** (`sourceKind fetch`, `sourceUrl` set, "Harness prizes") — the cross-cutting rule from the triage report holds |
| Bad JSON | PASS (with a wording defect, **D5**) | `?game=README.md` → *"Could not load prizes from README.md: Unexpected token '#', "# The Pric"... is not valid JSON.. Using the built-in set instead."*; a valid-JSON-but-wrong-game (`../family-feud/questions.json`) → *"… “oneBid” needs at least 4 items — one for every Contestants' Row.. Using the built-in set instead."*. Never throws, always recoverable. |
| 1280×720, no scroll in play | PASS | `documentElement.scrollHeight === innerHeight === 720` on setup, row, Cliff Hangers, Plinko, Lucky Seven, showdown, showcase and standings. (Embedded in the hub the frame is 676 px tall and the showdown overflows by 6 px — **D7**.) |
| Offline fallback | PASS | `js/data.js` sets `globalThis.TPIR_DEFAULT_GAME`, it validates, and `tpirLoadContent` falls back to it (verified in Node; the browser pane renders `file://` as a static snapshot with no scripts, so the disk case was not exercised live) |

### T3 — real network, through the HUB, host + two phone tabs

Room `5TUN` on the real PeerJS broker; phones at `?room=5TUN` (320×640).

| Check | Result | Evidence |
| --- | --- | --- |
| Two phones join | PASS | host roster `Ada 🟢 / Ben 🟢`, "2 phones connected"; game frame `…?embed=host&room=5TUN`, phone frames `…?embed=player&room=5TUN&pid=p1&name=Ada` |
| **Masked bids from both phones** | **FAIL → fixed (D1)** | Phone Ada bid `$140` on the real pad. Podium showed `•••` and `body.textContent` had no `140`, **but the host's mirror `<input data-pid="p1">` carried `value="140"`, visible on the shared screen** (`offsetParent` non-null, opacity 0.45). After the fix: `fields [{p1:""},{p2:""}]`, `is-placed` still green, `podiums Ada••• Bid placed Ben••• Bid placed`; on reveal the fields fill in (`140`, `99`) with `Actual retail price: $145` |
| One phone never sees the other's bid | PASS | phone Ben's whole document contains no `140`; `phoneView` carries only `myBid` |
| Plinko slot pick | PASS | phone view carried no `actual`; phone answered four small prices, earned 2 chips, picked slot 5 → core `lastDrop {slot 4, landing 1, value 500}`, resting chip `cx 80.7` = `colX(1)`, winnings `645` |
| Wheel spin | PASS | phone pressed **SPIN** (267×130 px) → core `lastSpin.index 12`, drum `segmentAtPointer 12`, `30¢` shown, `busy` cleared; three more spins all matched (11, 18, 8) |
| Showcase bid | PASS | phone typed `$7,800` on the pad; view carried the prize names but neither total; the other finalist's view carried no `7800`; reveal → *"Ben is within the margin and wins BOTH showcases!"*, `diff 250, both true` |
| Take over | PASS | during Plinko the phone's slot buttons were replaced by *"The host has taken the controls for this one."*, a raw `{t:"plinko",slot:0}` sent from the phone was **ignored** (`drops.length` stayed 2, the host's slot 2 landed), and the host's own buttons unlocked; `nextSegment` handed the controls back (`takeover []`) |
| Phone reload mid-segment | PASS | phone 2 reloaded during the row, re-linked as `pid=p2` and was pushed the bid screen with the full pad — no "Waiting…" |
| ⌂ Lobby and back | PASS | confirm dialog *"Leave The Price Is Right?" → Back to lobby*; the game frame unmounted, phones stayed connected; re-entering resumed at `standings` with the same winnings |
| Late joiner | PASS (documented behaviour) | a phone joining mid-show gets `pid=p3`, a **spectator** view with no controls and no numbers; the host shows *"Cara joined — they can play from the next show."* TPIR seats `min(4, roster)` so there is never an empty seat to fill — see §4 |
| Night scoreboard | PASS | back in the lobby, `#night-list` reads `Ben 46385 · Ada 9550` (matching the game's standings) |
| Embedded chrome | PASS | body wears `gsc-embedded`, the standalone room controls and status are `display:none`, the game's own code chip is `.hidden`, "Back to lobby" is shown, the game's own splash is skipped |

### T5 — static gates

| Gate | Result | Evidence |
| --- | --- | --- |
| **V1** `node --test` exits 0 | PASS | 106 tests, 0 failures, exit code 0 |
| **V2** files < 800 lines, functions < ~50 | PASS | largest: `tests/harness.html` 789, `js/tpir-core.js` 744, `js/tpir-app.js` 581. A brace-depth scan of every file in `js/` finds no function over 52 lines. (My first draft of the adversarial suite was 1090 lines — split into two files plus `adversarial-helpers.mjs` to comply.) |
| **V3** no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function` | PASS | the only matches across the component (tests included) are the prose comment in `tpir-view.js` and the harness's own BANNED regex |
| **V4** no `console.log` | PASS | zero matches in `js/`, `css/`, `tests/`, `index.html` (`console.warn` used for diagnostics) |
| **V5** no Peer / connection / DOM / timer handle in state | PASS | code read: `tpirSerialise` persists only `core`, `content`, `setup`, `source`, `sourceKind`, `sourceUrl`, `roomCode`, `takeover` — all JSON. `room` is module-local in `tpir-room.js`; rAF ids are locals in `tpir-wheel.js` / `tpir-games.js`; the splash timer is module-local; `busy`, `phones` and `editorOpen` are dropped |
| **V6** external URLs | PASS | only `fonts.googleapis.com` / `fonts.gstatic.com`. The SVG namespace URI is not a fetch. PeerJS is loaded lazily by the shared stack, not by this component. |
| **V7** `data-gsc-game`, `#gsc-join`, body classes | PASS | `<body data-gsc-game="price-is-right">`; `#gsc-join` inside `#screen-phone`; live: `player-mode` on a phone frame, `gsc-embedded` on the embedded host frame |
| **V8** `?game=URL` and upload validate through `validateGame` | PASS | `tpirFetchContent` and `tpirUseContent` both call it; verified live for a good URL, a non-JSON URL and a valid-JSON-wrong-game URL |

### Design and accessibility

| Check | Result | Evidence |
| --- | --- | --- |
| 1280×720 readability, no scroll in play | PASS | see T4; every play screen exactly 720 px standalone |
| Phone 320×640, targets ≥ 56 px | PASS | all nine phone screens rendered and measured: min button height 56 px (Plinko higher/lower), 60 px (bid pad, Cliff Hangers pad, Lucky Seven digits, Plinko slots, showcase pad), 128 px (SPIN); min width 68 px. `scrollWidth === 320` on every screen — **no horizontal scroll**. (The showcase-bid screen scrolls 18 px vertically, which is normal on a phone.) |
| `prefers-reduced-motion` (CSSOM walk) | PASS | walking every rule of `theme-components.css` (via `@import`), `theme.css`, `tpir.css`, `tpir-games.css`, `tpir-phone.css`: **11 `@keyframes` and 13 `animation:` declarations, all inside `@media (prefers-reduced-motion: no-preference)`; zero unguarded** |
| Reduced motion — chip and wheel still resolve | PASS | with `matchMedia("(prefers-reduced-motion: reduce)")` forced true in the game frame: the Plinko drop resolved in **6 ms** with `busy` cleared and the chip resting on the core's slot (`cx 230` = slot 4), and the wheel spin resolved in **6 ms** landing on the core's segment (core 8 = DOM 8, `55¢`) |
| Contrast, both gradient stops | PASS | computed exactly for every opaque gradient under text: gold button `#ffd23f`/`#f0a500` on `#2a1a00` → **11.67 / 8.09**; blue button `#1d6fdc`/`#12508f` on `#ffffff` → **4.82 / 8.17**; price tag (same gold pair) 11.67 / 8.09; the six wheel bands against their inks → **6.11, 4.82, 7.34, 11.67, 4.60, 7.83**. All ≥ 4.5. |
| Nothing hard-codes white on the accent | PASS | the component contains exactly one `#ffffff` literal (`css/tpir.css:127`, `.btn-blue` on the blue gradient, 4.82 / 8.17). No rule in the component paints text on `var(--accent)`; the shared kit uses `var(--accent-ink)`. White on the theme's `#e63946` would be **4.17:1**, which is why `--accent-ink` is near-black — confirmed. |
| Colour is never the only signal | PASS | over-bidder's podium says "**Over**", the winner's "**Comes on down!**", an unrevealed bid "Bid placed", a busted spinner "**Over a dollar**", Plinko value chips carry their slot number, Cliff Hangers items carry "*N* steps" |
| Accent block agreement (shell bar / splash vs game) | **FAIL — D4** | measured live in the hub: `#shell-bar --accent #e63946`, game iframe `body --accent #ffd23f`. See D4. |

### Content review

12 One Bid items, 3 Cliff Hangers sets (9 small items), 3 Plinko sets
(12 small prices), 3 Lucky Seven cars, 4 showcases — read in full.
**Nothing absurd.** Spot checks: espresso machine $249, air fryer oven $179,
robot vacuum $389, stand mixer $429, gas grill $649, leather recliner $739,
mountain bike $820 — all plausible USD retail. Cliff Hangers small items
$14–$46 (all within the required 1–99). Plinko small prices $2–$9 (all within
1–9, and the shown/actual pairs give a clean mix of higher / lower / correct).
Lucky Seven $21,485 / $27,340 / $34,625 — plausible new-car prices, all
five-digit. Showcase totals $8,600 / $6,180 / $11,550 / $8,140 — sensible
spread, and the $250 margin is TV-accurate against those totals.

---

## 3. Defects

### D1 — a phone's masked bid was printed on the host's shared screen · **major** · FIXED

`games/price-is-right/js/tpir-view.js:266` (`paintBidField`).

**Repro.** Hub room, a phone in a Contestants' Row seat. The phone bids `$140`.
On the host screen the podium correctly reads `•••` and
`document.body.textContent` does not contain `140` — but the host's mirror
`<input class="bid-input" data-pid="p1">` is set to `value="140"` and is on
screen (disabled, `opacity: 0.45`, `offsetParent` non-null). Everyone watching
the screen share can read the "hidden" bid before **Reveal the bids**. The same
line drives the Showcase bid fields, so a showcase bid leaked the same way.

This is the whole point of the masking in spec §3 ("bids appear masked until
Reveal bids") and success state **P-I1**. The harness missed it because it
asserted on `document.body.textContent`, which never contains input values.

**Fix (applied, 3 lines).**

```diff
-    if (placed && document.activeElement !== input) input.value = String(bids[pid]);
+    // A phone's bid is masked on the HOST screen too (the podium shows dots),
+    // so the mirror field must stay blank until the reveal.
+    if (placed && document.activeElement !== input) {
+      input.value = phone && !revealed ? "" : String(bids[pid]);
+    }
```

The `is-placed` green border and the "Bid placed" podium note still tell the
host a bid landed; **Take over** still fills the field for the host to edit;
the numbers appear on reveal as before. A manual (host-typed) player's field
keeps its value, because the host typed it out loud in the first place.

**Regression guard (applied, harness, 3 lines).**
`games/price-is-right/tests/harness.html:258` now also asserts every
`#tpir-bid-form .bid-input` is empty before the reveal:

```diff
+      const fieldValues = [...HD().querySelectorAll("#tpir-bid-form .bid-input")].map((n) => n.value);
       check("P-I1 the host screen masks every bid until the reveal",
-        podiums.filter((t) => t === "•••").length === 3 && HD().body.textContent.indexOf("$300") < 0,
-        podiums.join(" | "));
+        podiums.filter((t) => t === "•••").length === 3 && HD().body.textContent.indexOf("$300") < 0
+        && fieldValues.every((v) => v === ""),
+        `${podiums.join(" | ")} · fields [${fieldValues.join(",")}]`);
```

Verified live afterwards through the hub (fields blank, podiums dotted) and in
the harness (`fields [,,,]`, 57/57).

### D2 — an event named after an `Object.prototype` member corrupted or crashed the reducer · **minor** · FIXED

`games/price-is-right/js/tpir-core.js:273` (`reduce`).

**Repro (Node).**

```js
Core.reduce(state, { type: "toString" }, () => 0)
// → { '0': '[', '1': 'o', '2': 'b', … , history: [ … ] }   state destroyed
Core.reduce(state, { type: "valueOf" }, () => 0)
// → TypeError: Cannot convert undefined or null to object   (thrown)
```

`HANDLERS[event.type]` was a bare property lookup, so `toString`, `valueOf`,
`constructor`, `hasOwnProperty`, … resolved to inherited functions and were
called as reducers. Violates **P-U9** ("unknown/illegal/`null` events return the
identical object") and the house rule that the core never throws on junk.

**Not reachable from a phone**: `validatePhoneMsg` only ever yields
`t ∈ {bid, guess, plinko, spin}`, and `tpir-room.js` builds events with literal
`type` strings, so this is defence-in-depth rather than an exploit. Severity
minor for that reason.

**Fix (applied, 3 lines).**

```diff
-    const handler = HANDLERS[event.type];
+    // hasOwnProperty, not a bare lookup: "toString"/"valueOf"/"constructor" are
+    // on Object.prototype and would otherwise be called as if they were handlers.
+    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, event.type)
+      ? HANDLERS[event.type] : null;
```

Covered by A10 ("unknown, malformed and hostile events return the very same
object"), which now includes `constructor`, `toString`, `__proto__`,
`hasOwnProperty`.

### D3 — the loopback harness was flaky (1-in-2 failure) · **minor** · FIXED

`games/price-is-right/tests/harness.html:331`.

**Repro.** Load `tests/harness.html` repeatedly. My first run reported
`1 of 57 checks FAILED — P-I4 three exact prices keep the climber on the
mountain and win the prize · steps 0, won true`; the next run passed.

The check asserted `core().winnings.p2 > 4000`, but the fixture holds **two**
Cliff Hangers sets (prizes 4000 and 2600) and six One Bid items ($145–$930),
and the page draws both with an unseeded `Math.random`. When the 2600 set came
up, `winnings.p2` could be as low as 2745 and the check failed even though the
game was correct. Because the implementer reported 57/57, this would have
surfaced as a mystery red run for the next person.

**Fix (applied, 2 lines).**

```diff
-        core().game.done && core().game.won && core().winnings.p2 > 4000,
-        `steps ${core().game.steps}, won ${core().game.won}`);
+        core().game.done && core().game.won && core().winnings.p2 > core().game.prize.price,
+        `steps ${core().game.steps}, won ${core().game.won}, banked ${core().winnings.p2} on a ${core().game.prize.price} prize`);
```

The very next run drew the 2600 set and reported
`banked 3510 on a 2600 prize` — PASS. Four consecutive runs since: 57/57.

### D4 — the game and the hub shell disagree about the accent · **minor** · NOT fixed (orchestrator decision)

`shared/theme.css:129` vs `games/price-is-right/css/tpir.css:31`.

| | `--accent` | `--accent-2` | `--accent-ink` | `--stage-glow` |
| --- | --- | --- | --- | --- |
| `shared/theme.css` (and `docs/design-system.md` §1.3 table) | `#e63946` red | `#ffd23f` | `#1a0206` | `#123a86` |
| `games/price-is-right/css/tpir.css` (`body[data-gsc-game=…]`, higher specificity, loads later) | `#ffd23f` yellow | `#e63946` | `#2a1a00` | `#8a3d12` |

**Repro (live in the hub).** Start the game from the lobby, then read the
computed values: `#shell-bar --accent → #e63946`, game iframe
`body --accent → #ffd23f`. The shell bar and the hub's game-switch splash wear
red while the page inside wears yellow. The same split exists inside the
standalone page: `tpirShowSplash` sets `dataset.gscGame` on `#gsc-splash`, which
then matches the `shared/theme.css` rule directly and glows red over a
yellow-accented page.

Both pairings clear contrast (`#2a1a00` on `#ffd23f` = 11.67:1, `#1a0206` on
`#e63946` = 4.77:1) and nothing hard-codes white on either accent, so this is
purely a consistency problem — but `docs/design-system.md` §1.3 says explicitly
to set accents in `shared/theme.css` and **not** in the game's own sheet, and
the implementer flagged the same thing in their report §6 deviation 6 before the
shared block existed. Now that it exists, one of the two must go.

**Proposed fix (one of, orchestrator's call — it changes how the page looks, so
I did not make it):**

- delete the six-line `body[data-gsc-game="price-is-right"]` block from
  `css/tpir.css` (the game then wears the design system's red accent), **or**
- change `shared/theme.css:129–133` to the yellow pairing the game actually
  uses, and update the `docs/design-system.md` table row.

### D5 — the "could not load prizes" message names the wrong fallback · **minor** · NOT fixed

`games/price-is-right/js/tpir-app.js:207` (message) + `:277`
(`tpirChooseContent`, which decides what actually happens).

**Repro.** Play once (so a save exists), then open
`…/games/price-is-right/?game=README.md`. The banner reads *"Could not load
prizes from README.md: Unexpected token '#', "# The Pric"... is not valid
JSON**..** Using the built-in set instead."* — but the setup card still shows the
**saved** file, not the built-in set (correct behaviour: the host does not lose
their prizes). Two small problems: the sentence is wrong about what happened,
and `err.message` already ends in a period, so the banner shows `..`.

**Proposed fix.** Word it after the decision rather than before it, e.g.
`Could not load prizes from ${url}: ${err.message} Keeping the prizes already
loaded.` (drop the extra period, and let `tpirChooseContent` overwrite the
message when it really does fall back to the built-in set).

### D6 — host entry has silent failure paths · **minor** · NOT fixed

`games/price-is-right/js/tpir-app.js:350` (`tpirSubmitGuess`) and `:342`
(`tpirSubmitBid`).

**Repro.** Cliff Hangers, host has the controls, leave the price box empty and
press **Lock the price**. `Number("") === 0`, which is finite, so the guard
passes; `chGuess {amount: 0}` is dispatched; the reducer correctly ignores it;
`tpirDispatch` returns early because `next === state`; **nothing at all happens
and no message appears**. Same for a Cliff Hangers price of `150`, a Lucky Seven
digit outside 0–9, and a bid above `MAX_BID` (999999) — all silently swallowed.
House rule: *"Every failure path surfaces a plain-English message in the UI."*

**Proposed fix.** Range-check in `tpirSubmitGuess` / `tpirSubmitBid` before
dispatching and call `tpirError` with the allowed range (the Cliff Hangers
field already carries `min`/`max`, so it can read them), or have `tpirDispatch`
surface a generic "That isn't a legal move right now." when `next === state`
for a host-initiated event.

### D7 — the showdown screen overflows the hub frame by 6 px · **minor** · NOT fixed

`games/price-is-right/css/tpir.css` (the drum is capped at `min(27rem, 57vh)`).

**Repro.** In the hub at 1280×720 the game iframe is 1280×**676** (the shell bar
takes the rest). On `#screen-showdown`, `documentElement.scrollHeight` is 682
against `clientHeight` 676. Every other screen is exactly 676, and standalone at
1280×720 every screen including the showdown is exactly 720. So the cap is tuned
for the standalone height and just misses inside the frame.

**Proposed fix.** Lower the drum cap a little (e.g. `min(27rem, 54vh)`) or give
`.sd-grid` a `min-height: 0`, then re-check both standalone and embedded.

---

## 4. Notes for the orchestrator (not defects)

- **A late joiner can never be seated in a running show.** TPIR seats
  `min(4, roster)`, so with two players the row has two podiums and there is no
  empty seat for a mid-show arrival. The host gets *"Cara joined — they can play
  from the next show."* and the phone gets a clean spectator view. That matches
  spec §1 ("empty seats are skipped"), but it is worth a line in the README's
  **Known limits** so a host is not surprised.
- **The hub shell bar keeps `data-gsc-game="price-is-right"` after ⌂ Lobby**
  (`js/hub-host.js:618` only resets it when `state.activeGame` clears). Outside
  this component; mentioned because I saw it while testing TPIR.
- **The harness shares `gsc-tpir-state-v1` with the real page** (same origin), so
  running `tests/harness.html` leaves harness prizes and a half-played show in
  the host's save. Inherent to the storage-key design, harmless for players, but
  it surprised me while testing and will surprise the next tester.
- **The implementer's deviations are all sound.** The three-file pure core, the
  two-file unit suite, the separate `tpir-view.js`, `showcasePass{pass}`, the
  optional third `plan(…, limits)` argument, the drawn showcase pair and
  segment-scoped **Take over** all match the accepted pattern in the triage
  report or are strictly better than the literal spec. The `plan` `limits`
  argument in particular is what lets a 4-item file still reach a showcase
  (verified in A7). Deviation 6 (the local accent block) is the one that has
  since become defect **D4**.
- **Files I touched**, all inside `games/price-is-right/` and `docs/reports/`:
  `js/tpir-view.js` (D1), `js/tpir-core.js` (D2), `tests/harness.html`
  (D1 guard + D3), `tests/tpir-adversarial.test.mjs` (new),
  `tests/tpir-adversarial-show.test.mjs` (new),
  `tests/adversarial-helpers.mjs` (new), `README.md` (layout table: two stale
  line counts and the three new test files), and this report. No `git`
  commands were run.

---

## 5. Verdict

**Fix-then-ship.** The rules engine is the strongest I have tested in this
repo: 60 adversarial tests aimed squarely at the boundaries — a tie decided by
arrival order rather than seat order, exactly 25 versus 26 steps, the first chip
free, exactly $1 left versus $0, exactly $1.00 on the wheel, a $250 versus $251
showcase margin, a three-way spin-off, the same contestant winning both
showdowns — found **no rule wrong**, and undo unwound a whole 23-event episode
step by step with byte-identical states. The Plinko chip landed on the core's
slot in all ten drops and the drum stopped on the core's segment in all eight
spins, standalone and over the real broker; reloads at every segment, including
mid-drop and mid-spin, restored cleanly with `busy` cleared. One real defect
mattered: **D1**, the phone's "masked" bid printed in plain sight on the
screen-shared host page — a one-line fix that the existing harness could not
see, now fixed with a guard that would have caught it. **D2** and **D3** are
fixed too. What is left for the owners is small: **D4** is a one-line decision
about which accent wins (the shell bar and the game currently disagree), and
**D5–D7** are a wrong sentence, three silent failure paths and 6 px of overflow
inside the hub frame. None of them blocks play. Land D4's decision plus D5–D7
and this ships.

# Password

A `Password` style game for Game Show Central. Two teams of two: one partner
**gives** one-word clues, the other **guesses**. The word is worth ten points on
the first clue and a point less on every clue after it. First team to **25**
wins the game and plays the **Lightning Round** for the money.

Static, no build, no dependencies. Runs inside the hub lobby or on its own, and
plays end to end with **no phones at all**.

- Host: `games/password/index.html`
- Phone: the same page with `?room=CODE` (standalone) or inside the hub
- Content: `words.json` (+ `js/data.js`, the offline copy)

---

## 1. The rules as this build plays them

**A word.** Both givers are shown the same password. The teams alternate: one
giver says **one word**, then that team's receiver gets **one guess**.

| Host button | Key | What it does |
| --- | --- | --- |
| **Clue given** | `C` | the clue is out — the counter moves, the ladder drops |
| **Correct** | `Space` | the receiver had it: their team scores whatever the ladder says |
| **Wrong** | `W` | control passes to the other team |
| **Illegal clue** | `X` | more than one word, any form of the password, a hyphenated compound, spelling, gestures: the clue is forfeit, control passes **and the value drops** as if a clue had been given |
| Skip this word | — | throw the password out; nobody scores |
| *Other team opens* | — | before the first clue, hand the opening clue to the other team |
| Undo | `U` | steps back through every clue and every judgement |
| Next word | `N` | deal the next password |
| End the night | — | leave the game where it is and go to the standings |

The ladder runs **10, 9, 8 … 1**. The first clue is worth ten; the tenth is
worth one. After ten clues with no correct guess the word is **dead** and
nobody scores.

**Who opens.** The team that did *not* win the previous word gives the first
clue; if nobody won it, the opener simply alternates. The first word of a game
is Team A's unless the host says otherwise (setup screen, or *Other team opens*
before the first clue).

**Roles swap** between words — giver becomes receiver — unless you turn that
off. **First to 25** (configurable) wins the game.

**Lightning Round.** The winning team's receiver has **60 seconds** to guess
**5 passwords** from single-word clues by their giver. Each is worth **$100**,
and taking all five **doubles** the total. Passing is allowed and a passed word
comes back round while there is time. Every one of those numbers is
configurable, and the host may hand the clues to either partner.

The clock does **not** cut off the word in flight: when time runs out the host
still judges that word, and that last mark closes the round.

Money goes to **both** members of the winning team and is what the hub's night
scoreboard receives. Game points are shown but never banked — a new game starts
0–0 and the money carries on.

| Lightning button | Key |
| --- | --- |
| Start / Pause / Resume the clock | `Enter` |
| **Got it** | `Space` |
| **Pass** | `P` |
| Undo | `U` |
| Show the result | `N` |

## 2. The secret-password problem, and the two ways round it

The host screen is being screen-shared and the receivers are looking at it. So
**the password never reaches the host screen** unless the host asks for it.
There is no hidden element holding it: the nodes are not built at all.

**Phone mode (preferred).** Everyone joins on their phone.

| Who | What their phone shows |
| --- | --- |
| Either giver | the password, huge, plus **Clue given**, what the word is worth and how many clues have gone. The button is live only for the giver whose turn it is |
| Either receiver | what the word is worth, how many clues have gone, and whose clue it is — no password, ever |
| Lightning giver | the current word, the clock, and **Got it** / **Pass** |
| Lightning receiver | the clock and the count |
| Everybody else | the scores and who is playing |

The host screen shows the ten-rung ladder lit at the current value, whose clue
it is, `4 / 10` clues, both scores and a log of every clue and judgement — none
of which names a word. Once the word is over the password **is** shown, with
the clue count, so the room can see what it was.

A giver's tap is a convenience, not authority: the host's **Clue given** works
too, and **Correct / Wrong / Illegal clue** are host-only — no phone message can
express a judgement.

**Host-as-giver mode (no phones).** Common with a small group: the host gives
the clues for both teams.

- **Show password to me** puts the password on the host screen with a standing
  "shared screen" warning. Press it again and the nodes are removed.
- **Study (5 s)** shows it for five seconds with a countdown, so the host can
  read it privately to both givers and let it disappear.

Pick the mode on the setup screen; it only changes the wording of the on-screen
notices, so you can switch mid-night.

## 3. The JSON schema (`words.json`)

```json
{
  "title": "Password — Game Night",
  "settings": { "currency": "$", "targetScore": 25, "startValue": 10,
    "lightningSeconds": 60, "lightningWords": 5, "lightningValue": 100,
    "allFiveBonus": true, "swapRoles": true },
  "words": ["Umbrella", "Whisper", "Mountain", "Ticket", "Jealous"]
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `title` | no | text, ≤ 80 characters |
| `words` | **yes** | at least **60** passwords. Each is a **single word** — letters, apostrophes and hyphens, no spaces — of at most 20 characters, and unique case-insensitively. The editor warns below 120 |
| `settings.currency` | no | ≤ 3 characters, default `$` |
| `settings.targetScore` | no | 5–100, default 25 |
| `settings.startValue` | no | 3–20, default 10 — the top of the ladder |
| `settings.lightningSeconds` | no | 15–180, default 60 |
| `settings.lightningWords` | no | 1–10, default 5 |
| `settings.lightningValue` | no | 1–1,000,000, default 100 |
| `settings.allFiveBonus` | no | true/false, default true — taking every word doubles the money |
| `settings.swapRoles` | no | true/false, default true |

Anything the file gets wrong is refused with a plain-English message naming the
password and what is wrong with it. The shipped file has **200** original,
common, family-friendly passwords across parts of speech and difficulty.

**Loading your own words**

- `?game=https://example.com/mywords.json` on the page URL. An explicit URL
  always beats a saved game unless the save came from that same URL.
- **Load words (.json)** on the setup screen (a local file).
- The **Word editor**: one password per line, live count and per-line
  complaints, then **Download JSON** or **Use in game**. The draft auto-saves
  under `gsc-pwd-draft-v1`.

Words are dealt in **file order** unless you press **Shuffle the list** on the
setup screen. Running past the end wraps round and the host is told the list is
repeating.

## 4. Running it

```bash
python -m http.server 8620          # from the repo root
```

- Host: <http://localhost:8620/games/password/>
- Phones: open the room from the setup screen and give people the join link, or
  run the game inside the hub (`index.html`) where the shell owns the room.
- Everything is saved to `localStorage` under `gsc-pwd-state-v1` and restored on
  reload. A reload mid-Lightning comes back **paused** with the time that was
  left; press Resume when the room is ready. A saved game is tied to the room it
  was played in, so a new room never inherits the old room's seats.

## 5. Tests

```bash
cd games/password && node --test    # 54 unit tests, PW-U1 … PW-U10
```

Browser loopback harness (PW-I1 … PW-I6), served from the repo root:
<http://localhost:8620/games/password/tests/harness.html> — it is the shell for
a real embedded host plus four real embedded phones and asserts, among other
things, that while a password is in play **both** givers' phones carry it and
the host document's text does not contain it anywhere.

## 6. Files

| File | What |
| --- | --- |
| `index.html` | host screens + phone screens, one page |
| `js/pwd-content.js` | PURE: the JSON contract, validation, the word order |
| `js/pwd-core.js` | PURE: the reducer, the selectors, `phoneView` |
| `js/pwd-view.js` | host rendering (and the four DOM helpers) |
| `js/pwd-app.js` | host state, persistence, buttons, hotkeys |
| `js/pwd-clock.js` | the Lightning Round clock renderer |
| `js/pwd-sound.js` | WebAudio cues behind the shared 🔊 preference |
| `js/pwd-editor.js` | the word editor |
| `js/pwd-room.js` | `GSC.host` glue: roster, masked views out, intents in |
| `js/pwd-phone.js` | `GSC.player` glue: render a view, send one intent |
| `js/data.js` | offline mirror of `words.json` |
| `css/pwd.css`, `css/pwd-phone.css` | host and phone styles |
| `tests/` | `pwd-core.test.mjs`, `pwd-fixtures.mjs`, `harness.html` |

`js/pwd-view.js` is a split out of `pwd-app.js` (the spec's file list names one
`pwd-app.js`); both files would otherwise be over the 800-line house cap, the
same deviation Feud, Wheel and Weakest Link took with their cores.

## 7. Known limits

- One Lightning Round per game. Play another game for another one.
- The Lightning clock can be paused (`Enter`); the main game has no clock at
  all, which is the show's rule — a word ends on its tenth clue, not on time.
- Undo steps through decisions only: starting, pausing and expiring the clock
  are not decisions and leave no undo step.

# 07 — Future games (backlog, not in this build)

Each fits the hub with no shell changes: add a `GAME_REGISTRY` entry and a
`games/<id>/` page built on the SDK. Ordered by how well they suit voice chat
plus phones.

| Game | Why it fits | Phone features | Content JSON | Notes |
|---|---|---|---|---|
| **Who Wants to Be a Millionaire** | one player at a time, huge tension, trivial to host | **Ask the Audience** (live phone poll with a bar chart), Phone-a-Friend timer, 50:50 | 15-rung money tree, questions with 4 options + correct index, per-rung difficulty | Lifelines + "final answer" lock; walk-away safe havens at 1,000 / 32,000. |
| **The Price Is Right — Contestants' Row + Showcase** | bidding is perfect for phones | secret bids, closest-without-going-over | items with prices and images (reuse Jeopardy's media gate for photos) | Games: Contestants' Row, Cliffhangers (pure), Showcase Showdown wheel (reuse `wheel-draw.js`). |
| **$100,000 Pyramid** | fast, funny on voice | phones show the word list to the clue-giver only (hide from the screen share) | categories with 7 words | The clue-giver's phone is the key feature: the shared screen shows only the timer and score. |
| **Cash Cab / Trivia lightning round** | simplest possible | buzzers | question bank (reuse Weakest Link's) | Could be a mode of Weakest Link. |
| **Name That Tune** | great on Meet | buzzers, typed guesses | YouTube/URL list or local audio not possible on Pages without assets — host plays audio from their own machine | Only the buzz/judge shell is needed. |
| **Deal or No Deal** | drama, one player | the "banker" offer reveal; phones pick cases for the player | case values | Pure reducer with the well-known offer formula. |
| **Password / Taboo-style** | word games with a hidden word | hidden-word delivery to phones | word lists | Same "phone-only secret" pattern as Pyramid. |

Shell features worth adding later: QR code for the join link (needs a tiny
pure QR encoder ≈ 300 lines — no library), spectator link (a read-only phone
view of the host screen state), team mode at the lobby level (shared team
assignment across games), per-night export of the scoreboard as JSON.

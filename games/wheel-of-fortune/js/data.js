/* ============================================================
   Wheel of Fortune — offline fallback content
   Used when puzzles.json cannot be fetched (e.g. index.html
   opened straight from disk). Keep this manually in sync with
   puzzles.json — the two files are the same object.
   ============================================================ */

"use strict";

const DEFAULT_PUZZLES = {
  "title": "Wheel of Fortune — Game Night",
  "settings": {
    "vowelCost": 250,
    "roundMinimum": 1000,
    "bonusSeconds": 10,
    "bonusPrize": "$25,000",
    "tossUpValues": [1000, 2000, 3000],
    "autoOrder": false,
    "wedges": [
      800, "BANKRUPT", 650, 500, 900, 700, 600, 650, 500, 700, "LOSE A TURN", 800,
      500, 650, 600, 700, 900, "BANKRUPT", 500, 600, 550, 700, 2500, 650
    ]
  },
  "rounds": [
    { "type": "tossup",  "category": "Around the House",   "puzzle": "THE JUNK DRAWER" },
    { "type": "regular", "category": "Thing",              "puzzle": "GAME SHOW CENTRAL" },
    { "type": "regular", "category": "Food & Drink",       "puzzle": "HOT CHOCOLATE WITH MARSHMALLOWS" },
    { "type": "regular", "category": "Place",              "puzzle": "THE CORNER COFFEE SHOP" },
    { "type": "tossup",  "category": "Phrase",             "puzzle": "EASIER SAID THAN DONE" },
    { "type": "regular", "category": "Person",             "puzzle": "THE NEIGHBORHOOD DOG WALKER" },
    { "type": "regular", "category": "Before & After",     "puzzle": "BOARD GAME NIGHT LIGHT" },
    { "type": "regular", "category": "Fun & Games",        "puzzle": "SHUFFLE THE DECK TWICE" },
    { "type": "regular", "category": "What Are You Doing?", "puzzle": "PASSING THE MICROPHONE AROUND" },
    { "type": "bonus",   "category": "Place",              "puzzle": "THE WINNER'S CIRCLE" }
  ]
};

// W-D1: classic-script `const` is not a window property; expose it explicitly for the offline fallback.
if (typeof globalThis !== "undefined") globalThis.DEFAULT_PUZZLES = DEFAULT_PUZZLES;
if (typeof module === "object" && module.exports) module.exports = DEFAULT_PUZZLES;

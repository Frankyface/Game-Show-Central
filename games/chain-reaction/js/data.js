/* ============================================================
   Chain Reaction — offline fallback content.
   Used when chains.json cannot be fetched (e.g. the page is
   opened straight from disk, or GitHub Pages is unreachable).
   Generated from chains.json — tests/cr-core.test.mjs asserts the
   two files hold identical games, so regenerate both together.
   ============================================================ */

"use strict";

const CR_DEFAULT_GAME = {
  "title": "Chain Reaction — Game Night",
  "settings": {
    "currency": "$",
    "values": [
      100,
      200,
      300
    ],
    "speedSeconds": 60,
    "speedPerWord": 100,
    "speedAllClear": 1000,
    "speedAllClearLabel": "$1,000",
    "revealOnWrong": false
  },
  "chains": [
    [
      "SPACE",
      "SHIP",
      "SHAPE",
      "UP",
      "TOWN",
      "HALL",
      "WAY",
      "OUT"
    ],
    [
      "FIRE",
      "WORKS",
      "SHOP",
      "FRONT",
      "DOOR",
      "BELL",
      "BOY",
      "BAND"
    ],
    [
      "SUN",
      "FLOWER",
      "POT",
      "HOLE",
      "PUNCH",
      "LINE",
      "UP",
      "GRADE"
    ],
    [
      "BUTTER",
      "FLY",
      "PAPER",
      "BACK",
      "PACK",
      "RAT",
      "RACE",
      "TRACK"
    ],
    [
      "HORSE",
      "SHOE",
      "LACE",
      "CURTAIN",
      "CALL",
      "BACK",
      "FIRE",
      "PLACE"
    ],
    [
      "MOON",
      "LIGHT",
      "HOUSE",
      "HOLD",
      "UP",
      "RIGHT",
      "HAND",
      "BAG"
    ],
    [
      "RAIN",
      "BOW",
      "TIE",
      "BREAK",
      "FAST",
      "FOOD",
      "CHAIN",
      "SAW"
    ],
    [
      "SNOW",
      "BALL",
      "PARK",
      "BENCH",
      "MARK",
      "DOWN",
      "TOWN",
      "HOUSE"
    ],
    [
      "CAR",
      "POOL",
      "TABLE",
      "TOP",
      "HAT",
      "BOX",
      "OFFICE",
      "PARTY"
    ],
    [
      "BLACK",
      "BOARD",
      "WALK",
      "OVER",
      "TIME",
      "TABLE",
      "TENNIS",
      "BALL"
    ],
    [
      "GOLD",
      "MINE",
      "FIELD",
      "DAY",
      "DREAM",
      "TEAM",
      "WORK",
      "OUT"
    ],
    [
      "BIRD",
      "HOUSE",
      "BOAT",
      "RACE",
      "HORSE",
      "POWER",
      "PLANT",
      "LIFE"
    ],
    [
      "HAND",
      "SHAKE",
      "DOWN",
      "GRADE",
      "SCHOOL",
      "BOOK",
      "CASE",
      "STUDY"
    ],
    [
      "SEA",
      "SHELL",
      "SHOCK",
      "WAVE",
      "POOL",
      "PARTY",
      "ANIMAL",
      "KINGDOM"
    ],
    [
      "FOOT",
      "BALL",
      "ROOM",
      "SERVICE",
      "STATION",
      "WAGON",
      "WHEEL",
      "CHAIR"
    ],
    [
      "SUN",
      "SET",
      "SAIL",
      "BOAT",
      "HOUSE",
      "PLANT",
      "FOOD",
      "POISONING"
    ],
    [
      "KEY",
      "BOARD",
      "GAME",
      "NIGHT",
      "LIFE",
      "GUARD",
      "DOG",
      "HOUSE"
    ],
    [
      "STOP",
      "WATCH",
      "DOG",
      "TAG",
      "TEAM",
      "SPIRIT",
      "ANIMAL",
      "CRACKER"
    ]
  ],
  "speedChains": [
    [
      "CHAIN",
      "REACTION",
      "TIME",
      "OUT",
      "SIDE",
      "STEP",
      "FATHER",
      "LAND"
    ],
    [
      "HIGH",
      "SCHOOL",
      "BUS",
      "STOP",
      "LIGHT",
      "WEIGHT",
      "ROOM",
      "MATE"
    ],
    [
      "GREEN",
      "HOUSE",
      "WORK",
      "SHEET",
      "MUSIC",
      "BOX",
      "SPRING",
      "BREAK"
    ],
    [
      "COW",
      "BOY",
      "SCOUT",
      "MASTER",
      "PIECE",
      "WORK",
      "BENCH",
      "PRESS"
    ]
  ]
};

if (typeof module === "object" && module.exports) module.exports = CR_DEFAULT_GAME;
if (typeof globalThis !== "undefined") globalThis.CR_DEFAULT_GAME = CR_DEFAULT_GAME;

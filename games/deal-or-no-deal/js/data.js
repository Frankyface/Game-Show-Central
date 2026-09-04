/* ============================================================
   Deal or No Deal - offline fallback content.
   Used when board.json cannot be fetched (e.g. the page is
   opened straight from disk, or GitHub Pages is unreachable).
   Generated from board.json - tests/dond-core.test.mjs asserts
   the two files hold identical boards, so regenerate both
   together.
   ============================================================ */

"use strict";

const DOND_DEFAULT_BOARD = {
  "title": "Deal or No Deal — Game Night",
  "settings": {
    "currency": "$",
    "amounts": [
      0.01,
      1,
      5,
      10,
      25,
      50,
      75,
      100,
      200,
      300,
      400,
      500,
      750,
      1000,
      5000,
      10000,
      25000,
      50000,
      75000,
      100000,
      200000,
      300000,
      400000,
      500000,
      750000,
      1000000
    ],
    "rounds": [
      6,
      5,
      4,
      3,
      2,
      1,
      1,
      1,
      1
    ],
    "offerFactors": [
      0.12,
      0.2,
      0.3,
      0.4,
      0.5,
      0.65,
      0.8,
      0.9,
      1.0
    ],
    "jitter": 0.05,
    "allowSwap": true,
    "audienceAdvice": true
  }
};

if (typeof module === "object" && module.exports) module.exports = DOND_DEFAULT_BOARD;
if (typeof globalThis !== "undefined") globalThis.DOND_DEFAULT_BOARD = DOND_DEFAULT_BOARD;

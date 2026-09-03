/* ============================================================
   Family Feud — offline fallback content
   A byte-for-byte mirror of questions.json so the page still
   plays when opened straight from disk (file://) or when the
   fetch fails. Regenerate with the snippet in README.md.
   ============================================================ */

"use strict";

const DEFAULT_FEUD_GAME = {
    "title": "Family Feud — Game Night",
    "settings": {
      "strikes": 3,
      "multipliers": [
        1,
        1,
        2,
        3
      ],
      "fastMoney": {
        "enabled": true,
        "target": 200,
        "timer1": 20,
        "timer2": 25
      }
    },
    "rounds": [
      {
        "question": "Name something people do while waiting in a long line.",
        "answers": [
          {
            "text": "Check their phone",
            "count": 48
          },
          {
            "text": "Chat with someone",
            "count": 17
          },
          {
            "text": "Sigh loudly",
            "count": 12
          },
          {
            "text": "Read the signs",
            "count": 9
          },
          {
            "text": "Snack",
            "count": 7
          }
        ]
      },
      {
        "question": "Name a room in the house that is always messy.",
        "answers": [
          {
            "text": "Kids' bedroom",
            "count": 34
          },
          {
            "text": "Kitchen",
            "count": 24
          },
          {
            "text": "Garage",
            "count": 18
          },
          {
            "text": "Living room",
            "count": 13
          },
          {
            "text": "Bathroom",
            "count": 8
          }
        ]
      },
      {
        "question": "Name something you would find in a school backpack.",
        "answers": [
          {
            "text": "Books",
            "count": 31
          },
          {
            "text": "Pencils",
            "count": 22
          },
          {
            "text": "Lunch",
            "count": 17
          },
          {
            "text": "Water bottle",
            "count": 12
          },
          {
            "text": "Homework",
            "count": 9
          },
          {
            "text": "Headphones",
            "count": 5
          }
        ]
      },
      {
        "question": "Name a food people happily eat with their hands.",
        "answers": [
          {
            "text": "Pizza",
            "count": 30
          },
          {
            "text": "Burger",
            "count": 21
          },
          {
            "text": "Fries",
            "count": 16
          },
          {
            "text": "Sandwich",
            "count": 12
          },
          {
            "text": "Chicken wings",
            "count": 10
          },
          {
            "text": "Tacos",
            "count": 6
          }
        ]
      },
      {
        "question": "Name something people pack for a camping trip.",
        "answers": [
          {
            "text": "Tent",
            "count": 33
          },
          {
            "text": "Sleeping bag",
            "count": 24
          },
          {
            "text": "Flashlight",
            "count": 15
          },
          {
            "text": "Marshmallows",
            "count": 11
          },
          {
            "text": "Bug spray",
            "count": 9
          }
        ]
      },
      {
        "question": "Name an excuse people give for showing up late.",
        "answers": [
          {
            "text": "Traffic",
            "count": 41
          },
          {
            "text": "Overslept",
            "count": 23
          },
          {
            "text": "Lost my keys",
            "count": 13
          },
          {
            "text": "Bad weather",
            "count": 10
          },
          {
            "text": "Phone died",
            "count": 6
          }
        ]
      }
    ],
    "fastMoney": [
      {
        "question": "Name a fruit that is red.",
        "answers": [
          {
            "text": "Apple",
            "count": 52
          },
          {
            "text": "Strawberry",
            "count": 24
          },
          {
            "text": "Cherry",
            "count": 13
          },
          {
            "text": "Watermelon",
            "count": 6
          }
        ]
      },
      {
        "question": "Name something people put on toast.",
        "answers": [
          {
            "text": "Butter",
            "count": 44
          },
          {
            "text": "Jam",
            "count": 26
          },
          {
            "text": "Peanut butter",
            "count": 17
          },
          {
            "text": "Honey",
            "count": 8
          }
        ]
      },
      {
        "question": "Name a place you would take someone on a first date.",
        "answers": [
          {
            "text": "Restaurant",
            "count": 47
          },
          {
            "text": "The movies",
            "count": 22
          },
          {
            "text": "Coffee shop",
            "count": 15
          },
          {
            "text": "The park",
            "count": 10
          }
        ]
      },
      {
        "question": "Name an animal you expect to see at the zoo.",
        "answers": [
          {
            "text": "Lion",
            "count": 33
          },
          {
            "text": "Elephant",
            "count": 27
          },
          {
            "text": "Monkey",
            "count": 19
          },
          {
            "text": "Giraffe",
            "count": 12
          },
          {
            "text": "Penguin",
            "count": 5
          }
        ]
      },
      {
        "question": "Name something people do to help themselves fall asleep.",
        "answers": [
          {
            "text": "Read a book",
            "count": 29
          },
          {
            "text": "Count sheep",
            "count": 24
          },
          {
            "text": "Listen to music",
            "count": 20
          },
          {
            "text": "Watch TV",
            "count": 15
          },
          {
            "text": "Drink tea",
            "count": 6
          }
        ]
      },
      {
        "question": "Name a month couples like to get married in.",
        "answers": [
          {
            "text": "June",
            "count": 38
          },
          {
            "text": "May",
            "count": 20
          },
          {
            "text": "September",
            "count": 18
          },
          {
            "text": "August",
            "count": 12
          },
          {
            "text": "October",
            "count": 7
          }
        ]
      },
      {
        "question": "Name something almost everyone keeps in the fridge.",
        "answers": [
          {
            "text": "Milk",
            "count": 40
          },
          {
            "text": "Eggs",
            "count": 22
          },
          {
            "text": "Leftovers",
            "count": 16
          },
          {
            "text": "Vegetables",
            "count": 11
          },
          {
            "text": "Cheese",
            "count": 6
          }
        ]
      },
      {
        "question": "Name a sport played with a ball.",
        "answers": [
          {
            "text": "Soccer",
            "count": 34
          },
          {
            "text": "Basketball",
            "count": 26
          },
          {
            "text": "Baseball",
            "count": 19
          },
          {
            "text": "Football",
            "count": 12
          },
          {
            "text": "Tennis",
            "count": 5
          }
        ]
      }
    ]
  };

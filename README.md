# Learning App

An interactive practice and assessment app for workbook questions. Prototype 0.1.

## What it does

- **Practice mode:** instant feedback, a three-step hint ladder, and a timer the child can switch on or off.
- **Test mode:** timer always shown, no hints, results at the end.
- **Silent timing:** every question records reading time (question shown to first tap) and working time (first tap to answer), plus hints used and answer changes.
- **Profiles:** pick who is playing. Each player has their own results and settings.
- **Parent area (PIN):** results by topic and session, what the timing split suggests, player settings, question bank import, backup and restore.
- **Custom keypad** for numbers, fractions, money, times, dates and text; option buttons for multiple choice and for choosing +, −, × or ÷.

## Question bank format

A question bank is a JSON list. Each question looks like this:

```json
{
  "id": "S-13",
  "text": "A pack of 6 pencils costs 90p. How much does one pencil cost?",
  "type": "numeric",
  "unit": "p",
  "answer": "15",
  "topic": "money",
  "hints": ["simpler wording", "smaller steps", "a worked example or timeline"]
}
```

Supported `type` values: `numeric`, `decimal`, `money`, `fraction`, `remainder` (`"9 r 1"`), `multi` (`"a=15, b=60"` or `"1 l 710 ml"`), `time` (`"4:15 p.m."`), `operators` (`"● = −, ▲ = ÷"`), `choice` (add `options` for tap-to-choose), `list` (any order), `text`.
A date question adds `"accept": {"type": "date", "day": 14, "month": 6, "year": 2018, "orders": ["dmy", "mdy"]}`.
Questions with no usable answer (`"?"`) are skipped on import.

`data/sample-bank.json` holds a small set of original questions so the app always has something to run. **Do not commit questions copied from published workbooks to this public repository.** Import those in the parent area instead; they stay on that device.

## Checks

```
npm test                                   # marking, bank conversion and reporting tests
node tools/selfcheck.mjs path/to/bank.json # every answer in a bank must mark itself correct
```

Every push to `main` runs the tests and the sample-bank check, then deploys to GitHub Pages only if they pass.

## Data

For this prototype, progress and imported banks are stored in the browser (localStorage) on each device. Use **Parent area → Data → Export** to back up. A synced database is the next phase.

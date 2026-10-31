# Utsav demo — the full event lifecycle in ~15 minutes

A repeatable demonstration using realistic, clearly-labelled sample data. Every step
uses a functioning workflow — nothing is mocked or pre-staged. An evaluator can follow
this top-to-bottom on the deployed app or a local build (`npm run build && npm run
preview`), or locally with `npm run dev`. The browser journeys in `e2e/specs/` exercise
the same flows automatically (mapping in `PHASE3_TEST_REPORT.md` §3).

Sample family: **Asha & Dev**, a wedding for **150 guests** in Pune, budget **₹8 lakh**
(INR), date ~4 months out. Start from a fresh profile (or "Reset" → "Delete every saved
event" on a dev machine).

| #   | Step                         | What to do                                                                                                                                       | What you should see                                                                                                                                                          |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Describe the event           | Setup tab, type in the box: `Shaadi in Pune, 150 guests, 8 lakh budget` → "Fill form from description"                                           | The form fills: occasion Wedding, guests 150, budget 800000 (₹8,00,000); the description had no date, so you type one                                                        |
| 2   | Create                       | "Create the plan"                                                                                                                                | Budget tab opens; readiness bar appears; allocations are pre-split by occasion template (venue 30%, catering 30%, …)                                                         |
| 3   | Distribute the budget        | Budget → "Move money" (e.g. 10,000 Decor → Music), or edit an allocation and "Set"                                                               | Totals stay exact: planned always sums to budget; unallocated shown as ₹0                                                                                                    |
| 4   | Capture quotations           | Vendors → "Capture a quotation", paste a quote with `₹3,20,000 total, ₹3,200/plate, 100 plates minimum, advance 25%` → review and correct → save | Extracted fields shown with anything unstated as "not stated"; quotation saved with status shortlist/review                                                                  |
| 5   | Compare and accept           | Paste a second, pricier quote; use the comparison; accept the better one with confirmation                                                       | A vendor appears **booked** with the agreed price; the quotation can never be accepted twice                                                                                 |
| 6   | Schedule payments            | Vendors → the vendor's schedule: add Advance ₹1,50,000 due in 3 weeks                                                                            | Payments calendar (top of Vendors / Payments tab) groups it by due month                                                                                                     |
| 7   | Record a payment             | In the schedule row: "Amount paid now" ₹1,50,000 → Record payment                                                                                | Row shows "Paid in full"; budget "paid" rises by ₹1,50,000 — committed vs paid never drift                                                                                   |
| 8   | Link an expense              | Expenses: add "Catering advance" ₹1,50,000 linked to that instalment (or it was created by step 7)                                               | The instalment is settled; no double counting — paid is the sum of expenses                                                                                                  |
| 9   | Guests and dietary           | Guests: add Meera (+2, vegan), Rahul, Priya (gluten-free); set RSVPs                                                                             | Catering requirement updates: headcount from confirmed RSVPs + plus-ones; allergy alert names the needs in words                                                             |
| 10  | AI suggestions               | Assistant → ideas (set formality Traditional, must-haves "dhol players")                                                                         | Suggestions tuned to occasion/guests/preferences; **no prices anywhere**                                                                                                     |
| 11  | AI change with approval      | Assistant → "What would you like to change?" → `Add a haldi task the day before` → review → Apply → Undo → Redo                                  | Dry-run table shows before/after per category; nothing applies without your click; Undo restores exactly                                                                     |
| 12  | Run sheet                    | Run sheet: add `Baraat assembly 09:00–09:30, owner = Sharma Caterers` and an overlapping activity                                                | Conflict flagged; fix the time; print icon → print preview shows ONLY the run sheet                                                                                          |
| 13  | Scenarios                    | Budget → stress test (guests +20%, vendors +10%, budget −15%) → compare → Apply → Undo                                                           | Verdict (survives/breaks) with exact figures; applying is one undo step; paid records untouched                                                                              |
| 14  | Final overview + persistence | Header → "Event summary" → open the .txt; then reload the page                                                                                   | Summary file contains budget overview, vendor payment states, dietary aggregates, run sheet, warnings — no guest names or contacts; after reload every change is still there |

## Honesty notes

- AI steps need a configured provider key. Without one, every AI surface says so plainly
  and the built-in fallbacks answer from the plan's own numbers — the demo still works
  end to end (this is exactly what Journey 10 tests).
- Quotation file upload is intentionally not implemented (pasted text only) — disclosed
  in `SPEC.md`/worklog, not hidden.

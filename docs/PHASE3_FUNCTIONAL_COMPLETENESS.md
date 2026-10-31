# Phase 3 — Functional completeness

Status per workflow and per cross-module integration check. "Pass" means the behaviour
was exercised by a running test (unit, UI integration or browser journey) at the commit
this report was generated at — not that a CRUD method merely exists.

Legend: Pass · Partial · Fail · N/A · Not tested

## Workflow matrix

| Workflow             | Create                                          | Read                          | Update                                          | Delete                                     | Validation                                                                     | Persistence                | Integration                                                                    | E2E result                                |
| -------------------- | ----------------------------------------------- | ----------------------------- | ----------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| Events               | Pass                                            | Pass                          | Pass                                            | Pass                                       | Pass                                                                           | Pass                       | Pass                                                                           | Pass (J1, J9, J16)                        |
| Budget & allocations | Pass                                            | Pass                          | Pass                                            | N/A¹                                       | Pass (over-allocation visible, engine refuses budget-breaking moves)           | Pass                       | Pass (committed/paid derived from vendors/expenses)                            | Pass (J2, J13, negative: over-allocation) |
| Vendors              | Pass                                            | Pass (search + status filter) | Pass                                            | Pass²                                      | Pass (delete refused while referenced; category change refused after payments) | Pass                       | Pass (commits feed budget; schedule feeds cashflow)                            | Pass (J3, J16)                            |
| Payment schedules    | Pass                                            | Pass (calendar + per-vendor)  | Pass (record payment, edit remaining)           | Pass (paid instalments protected)          | Pass (schedule > commitment warned; overpayment warned)                        | Pass                       | Pass (expenses settle instalments; cashflow groups by month)                   | Pass (J3)                                 |
| Expenses             | Pass                                            | Pass (filters + search)       | Pass (re-link validated)                        | Pass                                       | Pass (instalment must belong to the same vendor)                               | Pass                       | Pass (single source of "paid"; no double counting)                             | Pass (J11)                                |
| Quotations           | Pass                                            | Pass                          | Pass (correction before save, status lifecycle) | Pass                                       | Pass (duplicate acceptance refused, survives reload)                           | Pass (v2 schema)           | Pass (acceptance books the vendor and creates the schedule through the engine) | Pass (J12)                                |
| Guests               | Pass                                            | Pass (search + RSVP filter)   | Pass                                            | Pass                                       | Pass (RSVP enum, plus-one caps, dietary enum)                                  | Pass                       | Pass (party size feeds catering; allergy alert)                                | Pass (J5, negative: RSVP step-through)    |
| Tasks & timeline     | Pass                                            | Pass                          | Pass                                            | Pass (dependants detached, engine reports) | Pass (dates, cycles)                                                           | Pass                       | Pass (readiness bar, .ics)                                                     | Pass (J4)                                 |
| Run sheet            | Pass                                            | Pass                          | Pass (times, owner, reorder, done)              | Pass                                       | Pass (overlap + same-vendor conflicts detected)                                | Pass                       | Pass (owner vendors validated to exist)                                        | Pass (J14 incl. print emulation)          |
| Scenarios            | Pass (fixed pressures + custom)                 | Pass (preview table)          | Pass (edit assumptions)                         | Pass (reject/reset)                        | Pass (locks respected; freed budget redistributes)                             | Pass                       | Pass (apply = one undo step; paid records untouched)                           | Pass (J15)                                |
| AI features          | Pass (intake, ideas, review, ask, quote, patch) | Pass                          | N/A (AI proposes, user applies)                 | N/A                                        | Pass (strict schemas server+client; malformed refused)                         | Pass (preferences sidecar) | Pass (grounded in planFacts; patch through engine dry-run)                     | Pass (J8, J10, negative: malformed AI)    |
| Preferences          | Pass                                            | Pass                          | Pass                                            | Pass (with event delete)                   | Pass (validated sidecar)                                                       | Pass                       | Pass (feeds suggest-ideas context)                                             | Pass (J9/assistant walk)                  |

¹ Deleting an allocation is not a concept; budget moves are the operation, and the
unallocated remainder is always shown.
² Vendor deletion is refused while expenses or instalments reference it; cancel is the
supported flow (SPEC decision table).

## Cross-module integration checks (§7.3)

| #   | Check                                                          | Result | Evidence                                                                                                                                                              |
| --- | -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Accepting a quotation updates vendor commitments correctly     | Pass   | Journey 12 asserts the vendor appears booked with the agreed amount after acceptance; `tests/ui/quotation.test.tsx`                                                   |
| 2   | Vendor payment records update outstanding balances             | Pass   | Journey 3: after recording ₹30,000, the schedule shows "Paid in full" and survives reload; `tests/engine/cashflow.test.ts`                                            |
| 3   | Expenses do not double-count vendor payments                   | Pass   | "Paid" is the sum of expenses; an instalment settled by an expense is not counted twice — `tests/engine/expense-links.test.ts`, `budget.test.ts` reconciliation cases |
| 4   | Vendor changes leave no invalid instalment associations        | Pass   | Engine refuses vendor deletion with expenses; instalment deletion keeps expenses vendor-linked — `tests/engine/phase2-branches.test.ts`                               |
| 5   | Guest updates correctly affect attendance and catering         | Pass   | Negative E2E: Meera → Coming + 2 plus-ones, Rahul → Not coming; catering headcount becomes exactly 3                                                                  |
| 6   | Budget changes do not erase financial transactions             | Pass   | Engine refuses budget-breaking moves (`tradeoff.test.ts` shortfall cases); expenses are never touched by allocation edits                                             |
| 7   | Scenario application preserves paid payments                   | Pass   | `tests/engine/scenario.test.ts`: scenarios only touch planned amounts; expenses/instalments unchanged; apply is one undo step                                         |
| 8   | Run sheet changes persist and validate                         | Pass   | Journey 14 reloads after fixing the conflict; deep validator checks run-sheet entries (`tests/ui/deep-validation.test.ts`)                                            |
| 9   | AI proposals use the correct active event                      | Pass   | The patch panel receives the active plan's facts and dry-runs against the same plan (`AiPatchPanel.tsx`); event switch autosaves the leaving plan first (Journey 9)   |
| 10  | Event switching never leaks or overwrites another event's data | Pass   | `tests/ui/multievent.test.tsx` (isolated state per plan id); Journey 9 creates two events, switches, deletes one, asserts the survivor intact                         |

## Empty, loading and failure states

- First run: setup view with the "Load a demo event" affordance (E2E: keyboard journey
  starts from it; demo journey). No broken placeholders.
- No search results: guests/expenses/vendors filters show an explicit empty row/message
  (`tests/ui/gaps.test.tsx`).
- AI failure: honest "offline / service unavailable" notices, built-in fallbacks keep the
  features useful (Journey 8, Journey 10, negative malformed-response test).
- Persistence failure: autosave stops with a spoken warning + "export JSON" guidance
  (`tests/ui/persistence.test.ts`, Journey 4).
- Corrupt/outdated storage: recovery card with "start fresh" + "download raw copy";
  per-event deep validation drops an invalid event alone with a notice (Journey 6).

## Destructive action protection

| Action                      | Protection                                                                                  | Evidence                          |
| --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| Delete event                | Two-step confirm in the events library                                                      | Journey 16                        |
| Reset everything            | Header "Reset" → "Delete every saved event" confirm ("Keep my events" cancels)              | Keyboard E2E journey, tablet walk |
| Delete vendor with expenses | Refused with a specific reason; cancel instead                                              | `phase2-branches.test.ts`         |
| Delete paid instalment      | Refused; paid history is immutable                                                          | `phase2-branches.test.ts`         |
| Delete task with dependants | Allowed only with explicit detach report                                                    | `tasks.test.ts`                   |
| Accept quotation twice      | Refused; status persists across reload                                                      | Journey 12                        |
| Scenario apply              | Preview before apply; single undo step reverses it                                          | Journey 15                        |
| AI patch                    | Dry-run impact table; approval required; undo available; paid records untouchable by schema | Journey 8, `patch.test.ts`        |

## UX audit result (first-time organiser walk)

Acting as a first-time organiser (and via the tablet/mobile walks): the entry point is
the intake box on the setup view with a concrete example; after creation the Budget tab
opens with the readiness bar; unpaid obligations are visible in three places (budget
columns, payments calendar with overdue first, vendor rows); quotations show extracted
fields with explicit "not stated" nulls; outstanding RSVPs are counted in the guests
header; the AI patch shows a before/after table with a one-click Undo. Terminology is
consistent ("committed" always means vendor agreements, "paid" always means recorded
expenses), enforced by the engine's own definitions in `docs/SPEC.md`.

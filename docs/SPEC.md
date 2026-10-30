# utsav AI: specification

Single source of truth for scope, decisions and acceptance. Status is updated as work lands. "Done" means implemented and covered by a test that runs in CI.

## Scope decisions

- Stack: Vite + React + TypeScript (strict), Vercel serverless functions, Gemini (server-side key only), zod. The repo was empty, so this is a choice, not a migration.
- Layers: `config` (leaf constants) <- `engine` (pure, no clock, no I/O, `today` injected) <- `schemas` <- `api` <- `components`. Enforced by dependency-cruiser.
- Money: integer minor units only. Category splits are template constants in basis points; only the resulting amounts are stored.
- Every plan change, manual or AI-proposed, is a `PlanAction` handled by one reducer.

## Money model (P3)

For each category:

- planned: what you set aside.
- committed: for each vendor, `max(agreed price if booked, amount already paid)`, plus direct spending with no vendor.
- paid: sum of expenses. Expenses are the single source of truth for "paid".
- remaining = planned − committed; cash still to pay = committed − paid (never negative).

Quoted, contacted and cancelled vendors commit nothing. A scheduled payment (instalment) is settled by an expense that references it; there is no separate "paid" flag to drift out of sync.

## Decisions on ambiguous points

| Question                             | Decision                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Same-day event                       | Allowed. Every step is due today and the plan says it was compressed.                                        |
| Past event date                      | Rejected with a specific message.                                                                            |
| Deleting a task others depend on     | Allowed; dependants are detached (the engine reports which).                                                 |
| Deleting a vendor or category in use | Rejected; cancel the vendor instead.                                                                         |
| Changing currency                    | Only between currencies with the same decimal places; otherwise create a new event.                          |
| Changing the event date              | Does not move tasks; the user delays tasks explicitly and sees the ripple.                                   |
| Overpaying a vendor                  | Counted as committed, and a warning is raised.                                                               |
| Patch that breaks the plan           | Dry run reports it; acceptance is refused when it adds an error-level warning.                               |
| AI patch scope                       | Only: add task, update task, delay task, move budget, add category. No deletes, vendors, expenses or guests. |

## Acceptance status

| Item                                                                   | Status                                      | Evidence                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| P1 connected plan (pure recalculation)                                 | Engine done                                 | `summarize`, `tests/engine/*.test.ts`                                   |
| P3 money, expenses, payment schedule, warnings                         | Engine done                                 | `budget.ts`, `reducers/budget.ts`, `reducers/vendors.ts`, `warnings.ts` |
| P4 timeline, task CRUD, cycle prevention, compression, `.ics`          | Engine done                                 | `tasks.ts`, `milestones.ts`, `timeline.ts`, `ics.ts`                    |
| P5 guests, RSVP, plus-ones, dietary, catering                          | Engine done                                 | `guests.ts`, `reducers/guests.ts`                                       |
| P6 vendor records                                                      | Engine done; quote analysis not started     | `reducers/vendors.ts`                                                   |
| P7 scenarios                                                           | Comparison done; UI not started             | `scenario.ts`                                                           |
| P8 patch dry-run, apply, undo                                          | Engine done; Gemini integration not started | `patch.ts`, `history.ts`                                                |
| P2 events, P9 persistence and export                                   | Not started                                 |                                                                         |
| API handlers, schemas, security headers, UI, a11y, e2e, CI, deployment | Not started                                 |                                                                         |

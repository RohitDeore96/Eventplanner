# Utsav: specification

Single source of truth for scope, decisions and acceptance. Status is updated as work lands. "Done" means implemented and covered by a test that runs in CI.

## Scope decisions

- Stack: Vite + React + TypeScript (strict), Vercel serverless functions, a hosted LLM behind same-origin routes (server-side key
  only, provider-agnostic), zod. The repo was empty, so this is a choice, not a migration.
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

| Item                                                                   | Status                                                                                                                                     | Evidence                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| P1 connected plan (pure recalculation)                                 | Engine done                                                                                                                                | `summarize`, `tests/engine/*.test.ts`                                   |
| P3 money, expenses, payment schedule, warnings                         | Engine done                                                                                                                                | `budget.ts`, `reducers/budget.ts`, `reducers/vendors.ts`, `warnings.ts` |
| P4 timeline, task CRUD, cycle prevention, compression, `.ics`          | Engine done                                                                                                                                | `tasks.ts`, `milestones.ts`, `timeline.ts`, `ics.ts`                    |
| P5 guests, RSVP, plus-ones, dietary, catering                          | Engine done                                                                                                                                | `guests.ts`, `reducers/guests.ts`                                       |
| P6 vendor records                                                      | Done end-to-end incl. AI quote extraction                                                                                                  | `reducers/vendors.ts`, `api/extract-quote.ts`, Vendors view             |
| P7 scenarios                                                           | Comparison done; UI not started                                                                                                            | `scenario.ts`                                                           |
| P8 patch dry-run, apply, undo                                          | Done end-to-end (AI patch → dry-run → apply → undo)                                                                                        | `patch.ts`, `history.ts`, `api/propose-patch.ts`                        |
| P2 events, P9 persistence and export                                   | P9 done: localStorage + `schemaVersion` migration, JSON/CSV export. Multi-event list not built                                             | `state/persistence.ts`, export actions                                  |
| API handlers, schemas, security headers, UI, a11y, e2e, CI, deployment | Shipped: 6 guarded routes, header set in `vercel.json`, views + axe tests, CI workflow, live Vercel deployment. Real-browser e2e not built | `api/`, `vercel.json`, `src/ui/`, `.github/workflows/`                  |

## Requirement classification (v6)

P0 = must work for a judge. P1 = needed for a top score. P2 = differentiator. Status updated as work lands.

### A. Challenge requirements

| ID  | Requirement                                                                        | Pri | Status                                                             |
| --- | ---------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------ |
| R1  | Create / edit wedding, birthday, community events with validation                  | P0  | Done end-to-end (Setup + Intake, engine-validated)                 |
| R2  | Budget: allocate, expenses, remaining, over-allocation                             | P0  | Done end-to-end (Budget view; D1/D4 fixed with tests)              |
| R3  | Timeline: milestones, short-notice, overdue, task CRUD                             | P0  | Done end-to-end (Timeline view + .ics export)                      |
| R4  | Vendor checklist per occasion with booking / payment status                        | P0  | Done end-to-end (checklist, statuses, payment schedules)           |
| R5  | Personalised ideas driven by event inputs                                          | P0  | Done end-to-end (`api/suggest-ideas.ts`, occasion-tuned)           |
| R6  | GenAI planning: intake, review, ask-the-planner, quote extraction, patch proposals | P0  | Done: 6 guarded endpoints, mocked-model tests, built-in fallbacks  |
| R7  | Guests with RSVP feeding catering                                                  | P1  | Done end-to-end (Guests view: RSVP, plus-ones, dietary)            |
| R8  | Persistence, multiple events, export with real data                                | P0  | Partly: persistence + JSON/CSV export shipped; multi-event pending |
| R9  | Live on Vercel                                                                     | P0  | Live: https://eventplanner-mocha.vercel.app/ (verified 2026-10-30) |
| R10 | Repo under 10 MB                                                                   | P0  | ~0.11 MB with CI size gate                                         |

### B. Scoring criteria

Q1 code quality gates (enforced), Q2 generated metrics (pending), S1 route guards (M3), S2 injection handling (M3), S3 strict CSP (M1), S4 daily AI cap (M3), S5 secret scan + audit (M1), E1 engine-does-maths + AI hygiene (M3), E2 bundle budget (M5), T1 test pyramid (ongoing), T2 AI eval suite (M3), A1 WCAG 2.1 AA + token contrast (M1/M5), A2 keyboard-only journey (M5).

### C. Differentiators

X1 AI patch -> engine dry-run -> user approve -> undo (engine part done: `dryRunPatch` blocks plan-breaking patches) · X2 what-if scenarios (engine done, UI pending) · X3 demo event · X4 expense log + payment schedule + cash-to-pay (engine done) · X5 README evidence table · X6 stress test (+20% guests, -15% budget, +10% vendor prices) · X7 plan health score · X8 cash-flow calendar · X9 activity log from undo history · X10 optional Hindi/Marathi labels.

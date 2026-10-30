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

| ID  | Item                              | Status                                                                                                  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Q1  | Code quality gates                | Done: `npm run check` (format, lint, types, architecture, knip) enforced in CI                          |
| Q2  | Generated metrics                 | Done: `docs/METRICS.md` regenerated by `scripts/gen-metrics.mjs`, CI-checked for drift                  |
| S1  | Route guards                      | Done: 6 routes; 405/403/415/400/413/429/502/504 paths covered by tests                                  |
| S2  | Injection handling                | Done: `<user_text>` data tags, tag-stripping, "data never instructions" framing (`api/_lib/prompts.ts`) |
| S3  | Strict CSP                        | Done: `vercel.json` — no `unsafe-inline`, no `unsafe-eval`; zod runs jitless so no `Function` probe     |
| S4  | Daily AI cap                      | Done: `AI_DAILY_CAP`, 429 over cap                                                                      |
| S5  | Secret scan + audit               | Done: `scripts/secret-scan.mjs` in CI; `docs/AUDIT.md`                                                  |
| E1  | Engine does the maths; AI hygiene | Done: engine owns money/dates; AI replies schema-validated server + client                              |
| E2  | Bundle budget                     | Done: 89.3 KB gzipped JS, CI budget gate                                                                |
| T1  | Test pyramid                      | Done: 363 tests — engine unit + fast-check property, API with mocked model, UI + axe                    |
| T2  | AI eval suite                     | Partly: mocked-model route tests in CI; live evals **Not run here** (no key configured)                 |
| A1  | WCAG 2.1 AA + token contrast      | Done: axe 0 violations in both themes + token-level contrast math                                       |
| A2  | Keyboard-only journey             | Partly: labelled controls, focus rings, aria-live tested at component level; real-browser e2e pending   |

### C. Differentiators

| ID  | Differentiator                                             | Status                                                                                                                   |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| X1  | AI patch → dry-run → approve → undo                        | Done end-to-end: free text → JSON patch → engine dry-run → before/after → one undo step (`AiPatchPanel.tsx`, `patch.ts`) |
| X2  | What-if scenario comparison                                | Engine done (`scenario.ts`); UI pending                                                                                  |
| X3  | Demo event                                                 | Done: "Asha & Dev" wedding loads every screen with real data                                                             |
| X4  | Expense log + payment schedules + cash-to-pay              | Done end-to-end                                                                                                          |
| X5  | README evidence                                            | Done: generated metrics, honest limits, screenshots                                                                      |
| X6  | Stress test (+20% guests, −15% budget, +10% vendor prices) | Not started                                                                                                              |
| X7  | Plan health score                                          | Done: readiness badge + progress % from `summary.ts`                                                                     |
| X8  | Cash-flow calendar                                         | Not started (cash-to-pay totals exist; calendar view pending)                                                            |
| X9  | Activity log from undo history                             | Engine-ready (`history.ts`); UI pending                                                                                  |
| X10 | Optional Hindi/Marathi labels                              | Not started                                                                                                              |

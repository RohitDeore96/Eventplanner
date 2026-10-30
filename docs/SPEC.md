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

| Question                             | Decision                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same-day event                       | Allowed. Every step is due today and the plan says it was compressed.                                                                                                              |
| Past event date                      | Rejected with a specific message.                                                                                                                                                  |
| Deleting a task others depend on     | Allowed; dependants are detached (the engine reports which).                                                                                                                       |
| Deleting a vendor or category in use | Rejected; cancel the vendor instead.                                                                                                                                               |
| Changing currency                    | Locked once vendor agreements or payments exist; otherwise only between currencies with the same decimal places AND with the budget re-entered fresh. Amounts are never converted. |
| Changing the event date              | Does not move tasks; the user delays tasks explicitly and sees the ripple.                                                                                                         |
| Overpaying a vendor                  | Counted as committed, and a warning is raised.                                                                                                                                     |
| Patch that breaks the plan           | Dry run reports it; acceptance is refused when it adds an error-level warning.                                                                                                     |
| AI patch scope                       | Only: add task, update task, delay task, move budget, add category. No deletes, vendors, expenses or guests.                                                                       |

## Acceptance status

| Item                                                                   | Status                                                                                                                                                                                             | Evidence                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P1 connected plan (pure recalculation)                                 | Engine done                                                                                                                                                                                        | `summarize`, `tests/engine/*.test.ts`                                   |
| P3 money, expenses, payment schedule, warnings                         | Engine done                                                                                                                                                                                        | `budget.ts`, `reducers/budget.ts`, `reducers/vendors.ts`, `warnings.ts` |
| P4 timeline, task CRUD, cycle prevention, compression, `.ics`          | Engine done                                                                                                                                                                                        | `tasks.ts`, `milestones.ts`, `timeline.ts`, `ics.ts`                    |
| P5 guests, RSVP, plus-ones, dietary, catering                          | Engine done                                                                                                                                                                                        | `guests.ts`, `reducers/guests.ts`                                       |
| P6 vendor records                                                      | Done end-to-end incl. AI quote extraction                                                                                                                                                          | `reducers/vendors.ts`, `api/extract-quote.ts`, Vendors view             |
| P7 scenarios                                                           | Comparison done; UI not started                                                                                                                                                                    | `scenario.ts`                                                           |
| P8 patch dry-run, apply, undo                                          | Done end-to-end (AI patch → dry-run → apply → undo)                                                                                                                                                | `patch.ts`, `history.ts`, `api/propose-patch.ts`                        |
| P2 events, P9 persistence and export                                   | Done end-to-end: multi-event workspace (storage v2, safe v1/v0 migration, per-event validation), JSON/CSV export, .ics                                                                             | `state/persistence.ts`, `EventsView`, export actions                    |
| API handlers, schemas, security headers, UI, a11y, e2e, CI, deployment | Shipped: 6 guarded routes, header set in `vercel.json`, views + axe tests, CI workflow with a Playwright job, live Vercel deployment, 42 real-browser journey runs (21 journeys, desktop + mobile) | `api/`, `vercel.json`, `src/ui/`, `tests/e2e/`, `.github/workflows/`    |

## Requirement classification (v6)

P0 = must work for a judge. P1 = needed for a top score. P2 = differentiator. Status updated as work lands.

### A. Challenge requirements

| ID  | Requirement                                                                        | Pri | Status                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Create / edit wedding, birthday, community events with validation                  | P0  | Done end-to-end (Setup + Intake, engine-validated)                                                                                                                                                 |
| R2  | Budget: allocate, expenses, remaining, over-allocation                             | P0  | Done end-to-end (Budget view; D1/D4 fixed with tests)                                                                                                                                              |
| R3  | Timeline: milestones, short-notice, overdue, task CRUD                             | P0  | Done end-to-end (Timeline view + .ics export)                                                                                                                                                      |
| R4  | Vendor checklist per occasion with booking / payment status                        | P0  | Done end-to-end (checklist, statuses, payment schedules)                                                                                                                                           |
| R5  | Personalised ideas driven by event inputs                                          | P0  | Done end-to-end (`api/suggest-ideas.ts`, occasion-tuned)                                                                                                                                           |
| R6  | GenAI planning: intake, review, ask-the-planner, quote extraction, patch proposals | P0  | Done: 6 guarded endpoints, mocked-model tests, built-in fallbacks, opt-in live smoke (`npm run smoke:ai`)                                                                                          |
| R7  | Guests with RSVP feeding catering                                                  | P1  | Done end-to-end (Guests view: RSVP, plus-ones, dietary)                                                                                                                                            |
| R8  | Persistence, multiple events, export with real data                                | P0  | Done end-to-end: multi-event workspace (storage v2, safe migration, per-event validation), All-events manager with switch/create/two-step delete, active event persisted and restored, e2e journey |
| R9  | Live on Vercel                                                                     | P0  | Live: https://eventplanner-mocha.vercel.app/ (verified 2026-10-30)                                                                                                                                 |
| R10 | Repo under 10 MB                                                                   | P0  | ~0.11 MB with CI size gate                                                                                                                                                                         |

### B. Scoring criteria

| ID  | Item                              | Status                                                                                                                                                                                                                                                   |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Code quality gates                | Done: `npm run check` (format, lint, types, architecture, knip) enforced in CI                                                                                                                                                                           |
| Q2  | Generated metrics                 | Done: `docs/METRICS.md` regenerated by `scripts/gen-metrics.mjs`, CI-checked for drift                                                                                                                                                                   |
| S1  | Route guards                      | Done: 6 routes; 405/403/415/400/413/429/502/504 paths covered by tests                                                                                                                                                                                   |
| S2  | Injection handling                | Done: `<user_text>` data tags, tag-stripping, "data never instructions" framing (`api/_lib/prompts.ts`)                                                                                                                                                  |
| S3  | Strict CSP                        | Done: `vercel.json` — no `unsafe-inline`, no `unsafe-eval`; zod runs jitless so no `Function` probe                                                                                                                                                      |
| S4  | Daily AI cap                      | Done: `AI_DAILY_CAP`, 429 over cap                                                                                                                                                                                                                       |
| S5  | Secret scan + audit               | Done: `scripts/secret-scan.mjs` in CI; `docs/AUDIT.md`                                                                                                                                                                                                   |
| E1  | Engine does the maths; AI hygiene | Done: engine owns money/dates; AI replies schema-validated server + client                                                                                                                                                                               |
| E2  | Bundle budget                     | Done: CI budget gate; the current figure lives in `docs/METRICS.md` (generated)                                                                                                                                                                          |
| T1  | Test pyramid                      | Done: current counts are generated — see `docs/METRICS.md` (engine unit + fast-check property, API with mocked model, UI + axe, Playwright)                                                                                                              |
| T2  | AI eval suite                     | Partly: mocked-model route tests in CI; live smoke procedure exists (`npm run smoke:ai`) but live evals **Not run here** (no key configured)                                                                                                             |
| A1  | WCAG 2.1 AA + token contrast      | Done: axe 0 violations in both themes + token-level contrast math                                                                                                                                                                                        |
| A2  | Keyboard-only journey             | Partly: 42 real-browser journey runs; the differentiators journey drives the stress test with focus + Enter on the mobile profile, and labels/focus order/aria-live are covered at component level. A dedicated keyboard-only walk is still not scripted |

### Phase 1 (correctness) status

| ID    | Requirement             | Status | Evidence                                                                                                        |
| ----- | ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| P1-01 | Repository reinspection | PASS   | audited checkout `6cbf2e0` (branch `utsav-mission`); `git status` clean; defect register below                  |
| P1-02 | Money unit contract     | PASS   | `*Minor` = smallest unit everywhere; model-facing `*Major` decimal strings converted once (`parseMajorAmount`)  |
| P1-03 | INR budget intake       | PASS   | `8 lakh` → 80,000,000 pinned in `tests/api/intake-money.test.ts` + route tests                                  |
| P1-04 | Indian amount parsing   | PASS   | lakh/lac/crore/k, `8,00,000`, `₹` symbols — unit tests + browser journeys 2                                     |
| P1-05 | International currency  | PASS   | USD/EUR/GBP/AED/JPY/KWD supported; KWD 3-decimal tests + journey 3                                              |
| P1-06 | Currency exponent       | PASS   | `currencyExponent()` is the only source; no hardcoded `/100` in money paths (grep + tests)                      |
| P1-07 | Currency safety         | PASS   | `currencyChangeError()` lock; journey 5; reducer + form share the policy                                        |
| P1-08 | Occasion prefill        | PASS   | milestone guard fixed; prefill drives the real form (unit tests + journey 1)                                    |
| P1-09 | Autosave lifecycle      | PASS   | autosave follows the active plan (unit + journey 4)                                                             |
| P1-10 | Restoration             | PASS   | journey 4 reload assertions                                                                                     |
| P1-11 | Undo/redo persistence   | PASS   | journey 4 (undo survives reload); jsdom autosave test                                                           |
| P1-12 | Deep validation         | PASS   | every nested record + dup ids, currency, calendar dates, cross-vendor instalments                               |
| P1-13 | Migration               | PASS   | version-0 record migrated + saved forward (unit + journey 7)                                                    |
| P1-14 | Corrupt storage         | PASS   | recovery notice + exportable copy + start fresh (unit + journey 6)                                              |
| P1-15 | Financial invariants    | PASS   | fast-check stateful invariants + direct properties (move conserves, payments aggregate, paid records protected) |
| P1-16 | AI patch schema         | PASS   | actual request payload asserted (anyOf union, major-unit fields only) in route tests                            |
| P1-17 | AI failure safety       | PASS   | 503/502/504 paths; honest offline journey 8; `smoke:ai` SKIPs without a key                                     |
| P1-18 | Browser E2E             | PASS   | 42 journey runs (21 journeys, desktop + mobile) pass on the production build                                    |
| P1-19 | CI                      | PASS   | `e2e` job with Chromium + trace upload in `.github/workflows/ci.yml`                                            |
| P1-20 | Security                | PASS   | CSP unchanged (no unsafe-eval/inline), secret scan clean, audit clean, key absent from client                   |
| P1-21 | Vercel compatibility    | PASS   | `npm run build` → `dist`, SPA rewrite excludes `/api`, headers set; deployment unchanged                        |
| P1-22 | Documentation           | PASS   | README/ARCHITECTURE/SECURITY/SPEC claims corrected; METRICS regenerated                                         |

Defect register (Phase 1 execution):

| ID  | Defect                                                                                                       | Severity | Fix                                                                                    | Regression test                                               |
| --- | ------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| D1  | extract-quote asked the model to compute minor units ("rupees x 100")                                        | P0       | model states major-unit decimal strings; route converts once with the request currency | route tests: INR 2,50,000 → 25,000,000; KWD 100.125 → 100,125 |
| D2  | propose-patch asked the model for `amountMinor`/`plannedMinor`                                               | P1       | `amountMajor`/`plannedMajor` converted once; unconvertible decimals → 502              | route tests: 20,000 → 2,000,000; 502 path                     |
| D3  | `asOccasion` dropped the fourth occasion                                                                     | P1       | guard includes `milestone`                                                             | intake UI test                                                |
| D4  | KWD missing from currencies                                                                                  | P1       | added to request enum + setup picker                                                   | money tests + journey 3                                       |
| D5  | deep validation missed duplicate ids, unsupported currency, non-calendar dates, cross-vendor instalment refs | P1       | `referencesHold` hardened                                                              | persistence tests                                             |
| D6  | corrupt storage silently discarded (no notice, no copy)                                                      | P1       | `loadSavedState()` + recovery notice with exportable copy                              | persistence + UI tests + journey 6                            |
| D7  | `utsav.activeId.v1` written but never read                                                                   | P2       | scrubbed on save/clear                                                                 | persistence tests                                             |
| D8  | typed form rejected Indian comma grouping                                                                    | P1       | canonical `parseMajorAmount` accepts digit-bounded commas                              | money tests + journey 2                                       |
| D9  | no live-AI verification procedure                                                                            | P2       | `scripts/live-ai-smoke.mjs` (env-gated, honest SKIP)                                   | SKIP path run                                                 |

## C. Differentiators

| ID  | Differentiator                                             | Status                                                                                                                                                |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | AI patch → dry-run → approve → undo                        | Done end-to-end: free text → JSON patch → engine dry-run → before/after → one undo step (`AiPatchPanel.tsx`, `patch.ts`)                              |
| X2  | What-if scenario comparison                                | Done end-to-end: Budget → What-if scenarios on a plan copy with one-step apply                                                                        |
| X3  | Demo event                                                 | Done: "Asha & Dev" wedding loads every screen with real data                                                                                          |
| X4  | Expense log + payment schedules + cash-to-pay              | Done end-to-end                                                                                                                                       |
| X5  | README evidence                                            | Done: generated metrics, honest limits, screenshots                                                                                                   |
| X6  | Stress test (+20% guests, −15% budget, +10% vendor prices) | Done end-to-end: all three shocks at once in Budget, survives/breaks verdict from engine `stressTest()`; one undo step on apply                       |
| X7  | Plan health score                                          | Done: readiness badge + progress % from `summary.ts`                                                                                                  |
| X8  | Cash-flow calendar                                         | Done end-to-end: Payments tab — instalments grouped by due month, paid/still-to-pay, overdue alert; engine `cashflow.ts`                              |
| X9  | Activity log from undo history                             | Done end-to-end: Activity tab — one labelled line per undo step, batches and AI patches named, Undo/Redo flip entries (session-scoped like the stack) |
| X10 | Optional Hindi/Marathi labels                              | Done (chrome scope): persisted EN/हिन्दी/मराठी picker, exhaustive dictionaries with English fallback, `<html lang>` follows                           |

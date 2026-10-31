# Phase 3 — Problem alignment

How Utsav maps to what the challenge actually asks for, with implementation and evidence
for every requirement. Companion documents: `PHASE3_FUNCTIONAL_COMPLETENESS.md`,
`PHASE3_FINAL_AUDIT.md`, `PHASE3_EVIDENCE_INDEX.md`.

## Source of the requirements

The original challenge problem statement was **not available as a standalone document**
in this repository or environment. What exists is:

1. The three engineering-phase briefs supplied for this project, which enumerate the
   required product capabilities in detail (event creation with validation, budget with
   allocation/over-allocation handling, timeline with milestones and dependencies, vendor
   checklist with booking/payment status, personalised AI ideas, guests with RSVP feeding
   catering, persistence with multiple events and export, live deployment, repository
   size limit).
2. The repository's own requirement classification (`docs/SPEC.md`, "Requirement
   classification"), which distils those into R1–R10 and has been the working contract
   since Phase 1.

Per the phase rules, this limitation is disclosed instead of inventing official criteria.
Every requirement below therefore comes from the briefs' own enumerations, not from
guesswork about scoring weights.

## Requirement traceability matrix

| #   | Challenge requirement                                                                            | What it means                                                                                    | Utsav feature                                                                                                                                      | Implementation location                                                                                                           | Test or evidence                                                                                                                                         | Status                           |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| R1  | Create/edit wedding, birthday, community (and milestone) events with validation                  | An organiser can set up any occasion; bad input is refused with specific messages                | Setup form + natural-language intake that fills the form; engine-validated creation                                                                | `src/ui/views/SetupView.tsx`, `src/ui/views/IntakeBox.tsx`, `src/engine/create.ts`, `api/parse-intake.ts`                         | `tests/engine/create.test.ts`, `tests/api/intake-money.test.ts`, E2E Journey 1                                                                           | Verified                         |
| R2  | Budget: allocate across categories, track expenses, show remaining, handle over-allocation       | Money planning with correct arithmetic and visible over-spending                                 | Category allocations, expenses as the single "paid" source, planned/committed/paid/remaining columns, over-allocation shown and warned             | `src/ui/views/BudgetView.tsx`, `src/engine/budget.ts`, `src/engine/reducers/budget.ts`, `src/engine/warnings.ts`                  | `tests/engine/budget.test.ts` + `money.test.ts`, E2E Journeys 2/13, negative E2E "over-allocating a category is allowed but never silent"                | Verified                         |
| R3  | Timeline: milestones, short-notice and overdue detection, task CRUD with dependencies            | What has to happen when, what is late, what depends on what                                      | Task CRUD, dependency graph with cycle prevention, compression notice, overdue warnings, .ics export                                               | `src/engine/tasks.ts`, `src/engine/milestones.ts`, `src/engine/timeline.ts`, `src/engine/ics.ts`, `src/ui/views/TimelineView.tsx` | `tests/engine/tasks.test.ts` (23), `timeline.test.ts`, `milestones.test.ts`                                                                              | Verified                         |
| R4  | Vendor checklist per occasion with booking and payment status                                    | Who is contacted/quoted/booked, who has been paid                                                | Vendor records with statuses, agreed price, instalment schedules, paid state derived from settled expenses, payments calendar                      | `src/engine/reducers/vendors.ts`, `src/engine/cashflow.ts`, `src/ui/views/VendorsView.tsx`, `src/ui/views/CashflowView.tsx`       | `tests/engine/cashflow.test.ts`, `phase2-branches.test.ts`, E2E Journey 3                                                                                | Verified                         |
| R5  | Personalised ideas driven by the event's own inputs                                              | Suggestions reflect occasion, guest count and the family's stated preferences                    | suggest-ideas endpoint carrying formality, budget tier, must-haves, remaining budget, booked vendors; per-event preferences sidecar                | `api/suggest-ideas.ts`, `src/state/prefs.ts`, `src/ui/views/AssistantView.tsx`                                                    | `tests/api/routes.test.ts`, `tests/ui/phase2.test.tsx`, AI eval scenarios `ideas-reflect-preferences`, `ideas-empty-preferences-still-valid`             | Verified                         |
| R6  | GenAI planning: intake parsing, plan review, ask-the-planner, quote extraction, change proposals | AI features are contextual, schema-validated, and never silently mutate the plan                 | 6 guarded same-origin endpoints, strict output schemas, built-in fallbacks, patch dry-run → user approval → apply → undo                           | `api/*.ts`, `api/_lib/*`, `src/schemas/ai.ts`, `src/engine/patch.ts`, `src/ui/views/AiPatchPanel.tsx`                             | `tests/api/*.test.ts` (mocked model), `tests/engine/patch.test.ts`, E2E Journeys 8/10, AI evaluation suite (`tests/ai/evaluation.test.ts`, 24 scenarios) | Verified                         |
| R7  | Guests with RSVP, plus-ones and dietary needs feeding catering                                   | Headcount and catering follow the real RSVPs                                                     | Guest CRUD, RSVP states, plus-ones in party size, dietary tags with allergy alert, catering requirement view                                       | `src/engine/guests.ts`, `src/engine/reducers/guests.ts`, `src/ui/views/GuestsView.tsx`                                            | `tests/engine/guests.test.ts`, `tests/ui/dietary.test.tsx`, negative E2E "guest RSVP, plus-ones and the catering summary stay in step"                   | Verified                         |
| R8  | Persistence, multiple events with isolation, export with real data                               | Nothing is lost on reload; events never leak into each other; exports reflect the selected event | Multi-event workspace (storage v3, safe migration), duplicate/archive/restore/delete, JSON/CSV/event-summary/.ics exports built from engine output | `src/state/persistence.ts`, `src/engine/duplicate.ts`, `src/ui/views/EventsView.tsx`, `src/lib/export.ts`                         | `tests/ui/multievent.test.tsx`, `persistence.test.ts`, E2E Journeys 4/6/7/9/16                                                                           | Verified                         |
| R9  | Live on Vercel                                                                                   | The app is deployed and reachable                                                                | Vercel deployment with strict CSP/HSTS headers and serverless API                                                                                  | `vercel.json`, `api/_lib/http.ts`                                                                                                 | Deployment verified 2026-10-30 (see `docs/SPEC.md` R9); production re-verification is listed as a remaining risk in the final audit                      | Verified (last check 2026-10-30) |
| R10 | Repository under the size limit                                                                  | Submission stays small                                                                           | Text-only repo, generated evidence curated, CI size gate                                                                                           | `scripts/check-repo-size.mjs`                                                                                                     | Pack size 1.58 MB against the 10 MB gate (2026-10-31)                                                                                                    | Verified                         |

## The real problem, in the organiser's own questions

| Question an organiser asks                         | Where Utsav answers it                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| What needs to be planned?                          | Setup + occasion-tuned vendor checklist; Timeline tasks                                                 |
| How much can be spent, and how should it be split? | Budget view: allocations by category, unallocated remainder                                             |
| Which vendors do I contact, and who is booked?     | Vendors view with statuses and contact fields                                                           |
| Which quotations should I take?                    | Quotation capture, correction, side-by-side comparison, acceptance                                      |
| How and when do vendors get paid?                  | Instalment schedules, payments calendar, overdue alerts                                                 |
| How many guests, and what do they eat?             | RSVP/plus-one tracking → catering headcount and dietary aggregates                                      |
| What is still unpaid?                              | Budget columns (committed vs paid), per-vendor schedule states, AI assistant grounded in the same facts |
| What happens on the day?                           | Run sheet with times, owners, conflict detection, print layout                                          |
| What changes if the budget or guest count changes? | Trade-off planner (lock-aware), scenario engine (pressures + custom assumptions), stress test verdict   |

## Problem-solution alignment audit (screens)

Every major screen was walked with the eight questions from the phase brief (what real
problem it solves, what it needs, what the user gets, workflow completeness, connection
to the rest, saved result, verifiability). Result:

- Every screen feeds the same engine state; there are no disconnected features. The two
  AI-only surfaces (ideas, assistant) are grounded in `planFacts()` built from engine
  output, and the patch flow ends in the same reducer as manual edits.
- One capability was deliberately **not** built: quotation _file_ upload (Phase 2
  disclosure). Pasted text is processed; adding file parsing would add an attack surface
  the product does not need. This is a documented limitation, not a hidden gap.
- The event summary export (`buildSummaryText`) was added in Phase 3 because the audit
  found no single human-readable artefact an organiser could hand to the family or the
  caterer; it is built from the same engine output as the UI.

## End-to-end demonstration

The repeatable demonstration scenario with realistic data lives in `docs/DEMO.md`. It
covers all fourteen steps the phase brief lists (create → distribute budget → quotations →
vendor selection → payment schedule → expenses → guests/dietary → AI suggestions →
approved AI change → run sheet → scenario comparison → final summary → reload
persistence) using only functioning workflows, and every step is also exercised by a
browser journey in `e2e/specs/` — see the mapping table in `PHASE3_TEST_REPORT.md`.

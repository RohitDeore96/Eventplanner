# AI usefulness evaluation — Utsav

What the AI features promise, how that is measured, and what the measurements say.
Everything here distinguishes **mocked** evaluation (deterministic, offline, runs in CI)
from **live** evaluation (needs a provider key; not run in this environment).

## What the AI does (responsibilities)

| Capability              | Endpoint               | Grounding contract                                                                                                                                                                                                                |
| ----------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Natural-language intake | `api/parse-intake.ts`  | Extracts occasion/guests/budget/date; Indian notation (`8 lakh`) read by deterministic parsing; unknowns stay null; the model never emits minor units — amounts are decimal major-unit strings converted exactly once server-side |
| Personalised ideas      | `api/suggest-ideas.ts` | Carries occasion, guests, vibe, formality, budget tier, must-haves, remaining budget, booked vendors; never states prices                                                                                                         |
| Plan review             | `api/review-plan.ts`   | Summary + ≤3 next steps from `planFacts()`                                                                                                                                                                                        |
| Ask-the-planner         | `api/ask-planner.ts`   | Answers only from the plan facts sent with the question; otherwise points to where in the app to look                                                                                                                             |
| Quotation extraction    | `api/extract-quote.ts` | Fills fields with nulls for anything not stated; injection-wrapped input                                                                                                                                                          |
| Change proposals        | `api/propose-patch.ts` | Only add/update/delay task, move budget, add category; dry-run impact; explicit user approval; one-click undo                                                                                                                     |

## Context engineering (§5.2)

`src/lib/facts.ts` renders the plan as compact facts from `summarize()` only: budget
totals, per-category planned/committed/over, catering headcount + **aggregate dietary
counts and RSVP totals** (added in Phase 3 so the assistant can answer "what should I
share with the caterer?"), tasks readiness, warnings, vendor names/status/agreed.
Guest names, contacts and private notes are **never** included — asserted by the
`context-no-pii-leak` evaluation scenario.

## Response validation (§5.3)

One schema source (`src/schemas/ai.ts`) used by server routes and the client: strict
zod objects, amounts as regex-validated decimal strings (`^\d{1,15}(\.\d{1,6})?$`),
enums whitelisted, unknown fields stripped, every conversion through
`parseMajorAmount()` (currency-exponent aware; negative/overflow → null). Malformed
bodies raise typed errors the client catches into honest notices; timeouts, rate limits
and provider errors fall back to deterministic built-ins marked `source: 'built-in'`.

## The evaluation set (§5.5)

`tests/ai/evaluation.test.ts` — **24 scenarios, 73 checks, all passing**, across the
eight required categories. Every scenario uses recorded fixtures: a well-behaved model's
response is asserted to be schema-valid, correctly converted and grounded; a
malicious/malformed response is asserted to be refused.

| Category                       | Scenarios                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Natural-language intake        | 5 (`intake-indian-full`, `-precise-date`, `-kwd-exponent`, `-no-budget-stated`, `-injection-resists`) |
| Invalid/malformed model output | 4 (truncated JSON, unknown fields, out-of-range amounts, wrong types)                                 |
| Budget planning                | 3 (unpaid amounts grounded, exact move conversion + engine dry-run, plan-breaking move blocked)       |
| Assistant questions            | 3 (grounded answer, unanswerable → declines, offline fallback honest)                                 |
| Vendor quotations              | 3 (clean extraction, decoy numbers, injection)                                                        |
| Personalised recommendations   | 3 (must-haves + formality reflected, empty preferences, offline fallback)                             |
| Timeline assistance            | 2 (task-add dry-run, out-of-scope actions refused)                                                    |
| Context engineering            | 1 (no PII in facts, aggregates present)                                                               |

## Scorecard (§5.6)

Machine-generated: `docs/evidence/ai/ai-eval-results.json` (written by the test run).
Scores are computed from the pass ratio of the checks mapped to each dimension —
**5/5 on all eight dimensions** (safety, groundedness, correctness, context awareness,
actionability, personalization, relevance, clarity). This measures Utsav's validation,
conversion and grounding layer — deliberately _not_ a live model's fluency. No scenario
failed; there are no failure categories to report.

## Live-model evaluation (separate, honestly reported)

- The opt-in smoke `npm run smoke:ai` verifies the real provider accepts every response
  schema. **It was not run in this environment** — no `GEMINI_API_KEY` is configured;
  it reports SKIP honestly when the key is absent.
- Mocked route tests (`tests/api/routes.test.ts`) cover model-chain fallbacks with a
  scripted model; they are not live calls and are never described as such.
- Production AI behaviour therefore remains **unverified** here; this is listed in the
  final audit's limitations rather than hidden.

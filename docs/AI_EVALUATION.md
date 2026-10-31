# AI usefulness evaluation — Utsav

What the AI features promise, how that is measured, and what the measurements say.
Everything here distinguishes **mocked** evaluation (deterministic, offline, runs in CI)
from **live** evaluation (needs a provider key; recorded for 2026-10-31 in
[live-smoke-2026-10-31.txt](evidence/ai/live-smoke-2026-10-31.txt)).

## Evaluation at a glance

| Item                    | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Evaluation type         | **Deterministic mocked fixtures.** Offline, runs in CI. **Not** a live-model run                                                                                                                                                                                                                                                                                                                                                                                                           |
| Scenarios               | 24 across 8 categories                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Checks                  | 74 (authoritative source: `docs/evidence/ai/ai-eval-results.json`, `totals.checks`)                                                                                                                                                                                                                                                                                                                                                                                                        |
| Failed                  | 0 scenarios, 0 checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Scorecard               | 5/5 on all eight dimensions, measuring the validation, safety, grounding and context contracts                                                                                                                                                                                                                                                                                                                                                                                             |
| Live-model verification | **PASSED 2026-10-31 — live run from the deployment owner's machine in a supported region (answered by `gemini-3.5-flash-lite` after live chain failover)**: record at [live-smoke-2026-10-31.txt](evidence/ai/live-smoke-2026-10-31.txt); a same-day sandbox attempt FAILED on the provider's location restriction — both recorded verbatim; the deployed production site answered the same four routes from the live provider the same day ([LIVE_VERIFICATION.md](LIVE_VERIFICATION.md)) |

The 5/5 scorecard is a statement about Utsav's own validation layer under recorded fixtures.
It is not a rating of a live model's fluency, accuracy or tone.

## The AI layers, and what each one is responsible for

| Layer                    | Responsibility                                                                                         | Where                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Model interaction        | One thin `fetch` call to the provider's JSON-mode endpoint, with a model chain and failover            | `api/_lib/gemini.ts`, `api/_lib/models.ts` |
| Context construction     | The plan rendered as compact facts from `summarize()`; no guest names, contacts or private notes       | `src/lib/facts.ts`                         |
| Output schema validation | Strict zod schemas on the server and again on the client; raw model text never reaches the UI          | `src/schemas/ai.ts`                        |
| Deterministic conversion | The model states plain decimal major units; the route converts exactly once with the currency exponent | `parseMajorAmount()`                       |
| Engine validation        | A proposed patch is dry-run on a copy of the plan; anything that would add an error is blocked         | `src/engine/patch.ts`                      |
| User approval            | Apply is one undo step; Reject changes nothing                                                         | `src/ui/views/AiPatchPanel.tsx`            |
| Fallback behaviour       | With no key, a timeout or a provider error, the built-in planner answers and labels itself "built-in"  | `src/lib/aiClient.ts`, `api/*.ts`          |

## What the AI does (responsibilities)

| Capability              | Endpoint               | Grounding contract                                                                                                                                                                                                                |
| ----------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Natural-language intake | `api/parse-intake.ts`  | Extracts occasion/guests/budget/date; Indian notation (`8 lakh`) read by deterministic parsing; unknowns stay null; the model never emits minor units — amounts are decimal major-unit strings converted exactly once server-side |
| Personalised ideas      | `api/suggest-ideas.ts` | Carries occasion, guests, vibe, formality, budget tier, must-haves, remaining budget, booked vendors; never states prices                                                                                                         |
| Plan review             | `api/review-plan.ts`   | Summary + ≤3 next steps from `planFacts()`                                                                                                                                                                                        |
| Ask-the-planner         | `api/ask-planner.ts`   | Answers only from the plan facts sent with the question; otherwise points to where in the app to look                                                                                                                             |
| Quotation extraction    | `api/extract-quote.ts` | Fills fields with nulls for anything not stated; injection-wrapped input                                                                                                                                                          |
| Change proposals        | `api/propose-patch.ts` | Only add/update/delay task, move budget, add category; dry-run impact; explicit user approval; one-click undo                                                                                                                     |

### What this means for a user

| User question or task     | AI capability      | What Utsav does                                                         |
| ------------------------- | ------------------ | ----------------------------------------------------------------------- |
| Describe my event         | Intake             | Extracts structured details into the setup form for review              |
| What should I consider?   | Personalised ideas | Uses the event's saved preferences, remaining budget and booked vendors |
| What needs attention?     | Plan review        | Summarises the plan's own facts and suggests at most three next steps   |
| How much remains unpaid?  | Ask-the-planner    | Answers from the actual plan facts, or says where in the app to look    |
| What does this quote say? | Quote extraction   | Fills the stated fields and flags the gaps instead of guessing          |
| Change my schedule        | Proposed patch     | Validates the change on a copy and waits for the user's approval        |

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

`tests/ai/evaluation.test.ts` — **24 scenarios, 74 checks, all passing**, across the
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

## Live-model evaluation (recorded, honestly scoped)

- The opt-in smoke `npm run smoke:ai` verifies the real provider accepts every response
  schema. **It PASSED on 2026-10-31** in a live run from the deployment owner's machine
  in a supported region: all four routes answered 200 from the live model — after a
  genuinely observed chain failover (gemini-3.6-flash → 429, gemini-3.8-flash → 503,
  gemini-3.5-flash-lite answered every case) — and every money check held. The verbatim
  output is committed at [live-smoke-2026-10-31.txt](evidence/ai/live-smoke-2026-10-31.txt),
  together with the same-day sandbox attempt that FAILED on the provider's location
  restriction; nothing was faked.
- Deployed production check (same day): the four routes on
  https://eventplanner-mocha.vercel.app answered from the live provider — raw,
  source-labelled responses and screenshots are committed under [evidence/](evidence)
  with the transcript in [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md). One extract-quote
  attempt first returned the built-in fallback and propose-patch had returned 504 twice
  earlier before passing; both are recorded as they happened. `review-plan` (plan
  review) was **not** exercised live.
- Mocked route tests (`tests/api/routes.test.ts`) cover model-chain fallbacks with a
  scripted model; they remain mocked and are never described as live. The recorded run
  above now additionally demonstrates that failover against the real provider.
- The live run was executed by the deployment owner, not an independent party; the
  output is committed verbatim and unedited. The earlier unlogged manual check is
  superseded by this record.
- Production runtime can still differ (quota, region, model availability); in those
  cases the route behaves as tested: graceful built-in fallback or typed 504/502,
  never a wrong answer.

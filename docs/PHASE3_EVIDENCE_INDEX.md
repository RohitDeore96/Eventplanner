# Utsav evidence index

One page that says where every important claim about Utsav is proved, how to check it, and
what is not proved. Machine-generated files and hand-written analysis are labelled
separately. Nothing here is edited to look better than the underlying data.

Figures quoted in this index are from the recorded run of 2026-10-31. They are historical
results of that run, not live status.

## Recommended reading order

1. [README](../README.md): understand the product in under a minute.
2. [DEMO](DEMO.md): try the product (the README's evaluator quick start is the 3-minute version).
3. [Problem alignment](PHASE3_PROBLEM_ALIGNMENT.md): verify relevance to the challenge.
4. [Functional completeness](PHASE3_FUNCTIONAL_COMPLETENESS.md): inspect workflow coverage.
5. [AI evaluation](AI_EVALUATION.md): inspect AI design, evaluation type and limits.
6. [Accessibility report](ACCESSIBILITY_REPORT.md): inspect accessibility proof and its limits.
7. [Test report](PHASE3_TEST_REPORT.md): inspect reliability evidence.
8. [Final audit](PHASE3_FINAL_AUDIT.md): review remaining limitations and the verdict.
9. [Documentation audit](FINAL_DOCUMENTATION_AUDIT.md): which documentation claims were checked, and which could not be.

**How to read the "Type" column below:** _Generated_ means a command or test run wrote the
file. _Authored_ means a person (or an assistant) wrote the analysis and it cites the
generated evidence. _Source_ means the implementation itself.

## A. Start here

| Evidence         | Type     | Purpose                                       | Location                                                                | How to verify                                                                                                                                              |
| ---------------- | -------- | --------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| README           | Authored | Product overview, quick start, proof summary  | [README.md](../README.md)                                               | Read it; every figure links to a source below                                                                                                              |
| Live application | External | Try the product                               | [eventplanner-mocha.vercel.app](https://eventplanner-mocha.vercel.app/) | Open it. The owner reports it working (2026-10-31); this documentation pass could not reach it from its environment, so it is not independently re-checked |
| Demo script      | Authored | Repeatable 14-step walk through the lifecycle | [DEMO.md](DEMO.md)                                                      | Follow it on the live app or a local build                                                                                                                 |

## B. Problem alignment

| Evidence                            | Type     | Purpose                                        | Location                                                                             | How to verify                                                                                                                                                                                              |
| ----------------------------------- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem-alignment matrix (R1–R10)   | Authored | Map each requirement to feature, code and test | [PHASE3_PROBLEM_ALIGNMENT.md](PHASE3_PROBLEM_ALIGNMENT.md)                           | Open a row, then open the cited file or test                                                                                                                                                               |
| Source of the requirements          | Authored | State what the matrix is based on              | [Source of the requirements](PHASE3_PROBLEM_ALIGNMENT.md#source-of-the-requirements) | The original challenge statement was not available in the repository or the recorded environment; the matrix rests on the project's recorded briefs and `SPEC.md`. No official scoring weights are claimed |
| Specification and acceptance tables | Authored | The working contract (R1–R10 and extras)       | [SPEC.md](SPEC.md)                                                                   | Read the classification and the phase status tables                                                                                                                                                        |

## C. Product implementation

| Evidence                       | Type     | Purpose                                               | Location                                                                                                           | How to verify                                                               |
| ------------------------------ | -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Functional completeness matrix | Authored | Workflow-by-workflow coverage with named tests        | [PHASE3_FUNCTIONAL_COMPLETENESS.md](PHASE3_FUNCTIONAL_COMPLETENESS.md)                                             | Open a named test and run it                                                |
| Architecture documentation     | Authored | Current architecture first, historical notes labelled | [ARCHITECTURE.md](ARCHITECTURE.md)                                                                                 | Compare with `src/`                                                         |
| Financial engine               | Source   | Integer minor units, currency exponents, ledger       | [money.ts](../src/engine/money.ts), [budget.ts](../src/engine/budget.ts), [cashflow.ts](../src/engine/cashflow.ts) | `npx vitest run tests/engine/money.test.ts tests/engine/invariants.test.ts` |
| Multi-event storage (v3)       | Source   | Workspace record, migration, per-event validation     | [persistence.ts](../src/state/persistence.ts)                                                                      | `npx vitest run tests/ui/persistence.test.ts tests/ui/multievent.test.ts`   |
| AI safety architecture         | Source   | Patch dry-run gate and guarded routes                 | [patch.ts](../src/engine/patch.ts), [api/](../api/)                                                                | `npx vitest run tests/engine/patch.test.ts tests/api/routes.test.ts`        |

## D. AI usefulness

| Evidence                  | Type       | Purpose                                                 | Location                                                      | How to verify                                                                                                                                                                              |
| ------------------------- | ---------- | ------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AI evaluation methodology | Authored   | What is measured, and what is not                       | [AI_EVALUATION.md](AI_EVALUATION.md)                          | Read the evaluation type and live-status sections                                                                                                                                          |
| 24-scenario dataset       | Source     | Recorded-fixture scenarios in eight categories          | [tests/ai/evaluation.test.ts](../tests/ai/evaluation.test.ts) | `npx vitest run tests/ai/evaluation.test.ts`                                                                                                                                               |
| Evaluation results        | Generated  | 24 scenarios, 74 checks, 0 failed; mocked fixtures only | [ai-eval-results.json](evidence/ai/ai-eval-results.json)      | Written by the test run above; the file's own `evaluationKind` and `liveModelRun` fields say it is not a live run                                                                          |
| Live-model status         | Limitation | Whether the real provider accepts every schema          | [live-ai-smoke.mjs](../scripts/live-ai-smoke.mjs)             | `GEMINI_API_KEY=… npm run smoke:ai`. No smoke-test output is committed. The owner reports a manual live check on 2026-10-31 that has no recorded log, so it is not independently evidenced |

## E. Accessibility

| Evidence                       | Type       | Purpose                                              | Location                                                                                                                                  | How to verify                                                            |
| ------------------------------ | ---------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Accessibility report           | Authored   | Scope, results, defects fixed, limitations           | [ACCESSIBILITY_REPORT.md](ACCESSIBILITY_REPORT.md)                                                                                        | Read it alongside the files below                                        |
| axe results per view and theme | Generated  | 20 JSON files, one per view/theme state              | [e2e/evidence/accessibility/](../e2e/evidence/accessibility/)                                                                             | `npm run test:e2e` regenerates them; open any file and read `violations` |
| Keyboard-only evidence         | Source     | Skip link, form completion, arrow-key tabs, no traps | [accessibility.spec.ts](../e2e/specs/accessibility.spec.ts)                                                                               | `npm run test:e2e`                                                       |
| Responsive reflow evidence     | Generated  | 320 px reflow and a tablet walk                      | [responsive.spec.ts](../e2e/specs/responsive.spec.ts), [reflow-320px-vendors.png](../e2e/evidence/accessibility/reflow-320px-vendors.png) | `npm run test:e2e`                                                       |
| Screen-reader limitation       | Limitation | No NVDA/VoiceOver testing was performed              | [Screen-reader results](ACCESSIBILITY_REPORT.md#5-screen-reader-results)                                                                  | Stated, not resolved                                                     |

## F. Testing

| Evidence                     | Type      | Purpose                                              | Location                                                                                                                          | How to verify                                                                            |
| ---------------------------- | --------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Test report                  | Authored  | Layers, exact commands, defects found and fixed      | [PHASE3_TEST_REPORT.md](PHASE3_TEST_REPORT.md)                                                                                    | Run the commands in its section 2                                                        |
| Machine-readable E2E results | Generated | 77 passed, 1 skipped by design, 0 failed             | [e2e-results.json](../e2e/evidence/e2e-results.json)                                                                              | `npx playwright test --reporter=json`; read `stats`                                      |
| Coverage and quality metrics | Generated | Tests, coverage, bundle, repo size, audit            | [METRICS.md](METRICS.md)                                                                                                          | `node scripts/gen-metrics.mjs`                                                           |
| CI configuration             | Source    | The gates run on every push to `main`                | [ci.yml](../.github/workflows/ci.yml)                                                                                             | Open the repository's Actions tab. This documentation pass could not read live CI status |
| Build and bundle budgets     | Source    | Bundle and repository size limits                    | [check-size.mjs](../scripts/check-size.mjs), [check-repo-size.mjs](../scripts/check-repo-size.mjs)                                | `npm run build && node scripts/check-size.mjs`                                           |
| Security checks              | Mixed     | Threat model, secret scan, headers, dependency audit | [SECURITY.md](../SECURITY.md), [AUDIT.md](AUDIT.md), [secret-scan.mjs](../scripts/secret-scan.mjs), [vercel.json](../vercel.json) | `node scripts/secret-scan.mjs`; `npm audit --omit=dev --audit-level=high`                |

## G. Final independent audit

| Evidence             | Type     | Purpose                                                              | Location                                                             | How to verify                               |
| -------------------- | -------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| Final audit          | Authored | Five-dimension scorecard (internal targets), limitations and verdict | [PHASE3_FINAL_AUDIT.md](PHASE3_FINAL_AUDIT.md)                       | Check each score against its cited evidence |
| Remaining risks      | Authored | Limitations, each with its impact                                    | [Final limitations](PHASE3_FINAL_AUDIT.md#i-final-limitations)       | Compare with the README limitations table   |
| Submission readiness | Authored | Recommendation                                                       | [Final recommendation](PHASE3_FINAL_AUDIT.md#j-final-recommendation) | Read it                                     |
| Documentation audit  | Authored | Claim-verification table and documentation corrections               | [FINAL_DOCUMENTATION_AUDIT.md](FINAL_DOCUMENTATION_AUDIT.md)         | Each row names its source and a status      |

## Other records

| Evidence                | Location                          | Note                                                              |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------- |
| Design decisions        | [DECISIONS.md](DECISIONS.md)      | One-line justification for every dependency                       |
| Earlier audit           | [AUDIT.md](AUDIT.md)              | Defects found and fixed before Phase 3                            |
| Work log (Phases 1–3)   | [worklog.md](../worklog.md)       | Historical record; counts in it are as of the phase they describe |
| Browser-evidence folder | [e2e/README.md](../e2e/README.md) | How the E2E specs and evidence folders are organised              |

# Final documentation audit

A documentation-only audit and clean-up of Utsav's evaluator-facing material, done on
2026-10-31. No application code, tests, configuration or dependencies were changed. Nothing
in this audit improves the application's engineering quality; it improves how easily that
quality can be found, checked and understood.

## A. Baseline

| Item              | Value                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Starting commit   | `552c1fc27ceb3d6195174426d21d70e5052a29bd` on `main` (the same commit as the previously reviewed snapshot)                             |
| Working tree      | Clean at the start (dependencies installed into the git-ignored `node_modules/` only)                                                  |
| Format gate       | `npm run format` (Prettier check, which includes Markdown) passed on the unmodified tree                                               |
| Relative links    | 44 checked, 3 flagged (the README's percent-encoded emoji heading anchors, which the checker could not match; GitHub may resolve them) |
| Nonexistent paths | 2 documentation citations pointed to test files that do not exist (see section E)                                                      |

Main inconsistencies found in the starting documentation:

1. AI evaluation checks were reported as 73 in three documents; the machine-readable result reports 74.
2. The README feature table said "WCAG 2.1 AA" while its accessibility section and the accessibility report said 2.2 AA.
3. The README said "21 journeys × desktop and mobile"; the recorded run is 39 tests × 2 profiles = 78 results (77 passed, 1 skipped).
4. The accessibility report said the accessibility spec has "12 tests"; it has 6 tests that run on two profiles.
5. The architecture document still said "one active plan" in one bullet and introduced the multi-event workspace as v2, although the current schema is v3.
6. The README's test, coverage, accessibility and bundle badges were static images, not tied to evidence or a date.
7. The problem-alignment matrix gave R6 (GenAI) and R9 (live deployment) a plain "Verified" although live-model behaviour and the later production state were not independently verified.
8. The README labelled the live app "verified" with no date or source.

## B. README improvements

| Change                                                                                          | Why it helps an evaluator                                                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First screen: logo, name, one-sentence description, tagline, live link, quick-start link, stack | The product is understood before any scrolling                                               |
| Static badges replaced by a dated "Recorded verification" note linking to the evidence          | Numbers are tied to a run date and a source, and are not presented as live status            |
| New "How to verify Utsav" table                                                                 | One place to jump to each kind of proof                                                      |
| New "Evaluator quick start" (9 steps, about 3 minutes)                                          | A repeatable path that does not need an API key; says which AI panels need a key             |
| Three differentiators in one short section                                                      | Replaces five overlapping sections that repeated the same points                             |
| Problem → feature → value table                                                                 | Explains user outcomes, not button lists                                                     |
| Eight screenshots, each with a caption                                                          | Ordered like the quick start; each is a real capture                                         |
| One architecture diagram with the AI/engine/approval boundary                                   | Shows the data flow without repeating the architecture document                              |
| AI section: six-capability table and three kinds of AI evidence                                 | Keeps the fallback, mocked testing and live model interaction clearly separate               |
| Quality table with sources                                                                      | Every figure links to the file that produced it                                              |
| Accessibility section reworded                                                                  | WCAG 2.2 AA as a target, automated results scoped to tested states, screen reader not tested |
| Limitations as a table with impact and current behaviour                                        | Easier to scan than prose                                                                    |

## C. Documentation organisation

- **Retained:** the existing folder structure, every file name and every machine-evidence path. No file was moved or deleted.
- **Navigation:** the evidence index now opens with a reading order and has sections A to G, each row naming the evidence, its type (generated, authored, source or limitation), its location and how to verify it.
- **Cross-references:** README, evidence index, problem alignment, AI evaluation, accessibility report, final audit and DEMO now point to each other and to this audit.
- **Not moved:** `SECURITY.md` stays at the repository root; the evidence index links to it there.

## D. Evidence synchronisation

| Metric                     | Value                                                                      | Authoritative source                                                                    | Documents checked                                |
| -------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Unit/integration tests     | 650 across 56 files                                                        | `docs/METRICS.md` (generated 2026-10-31)                                                | README, test report, final audit, evidence index |
| Coverage                   | 95.99 / 94.1 / 96.47 / 83.63 (lines / statements / functions / branches)   | `docs/METRICS.md`; gates in `vitest.config.ts` (95 / 94 / 94 / 83)                      | README, test report, final audit                 |
| Browser tests              | 77 passed, 1 skipped, 0 failed (78 results; 39 tests × desktop and mobile) | `e2e/evidence/e2e-results.json` (`stats`, recounted from the results)                   | README, test report, final audit, evidence index |
| Bundle and repository size | 115.0 KB gzipped; 1.58 MB                                                  | `docs/METRICS.md`                                                                       | README, test report, evidence index              |
| AI evaluation              | 24 scenarios, 74 checks, 0 failed                                          | `docs/evidence/ai/ai-eval-results.json` (`totals`; per-scenario checks recounted to 74) | README, AI evaluation, final audit               |
| Accessibility scans        | 20 view/theme files, 0 violations in each                                  | `e2e/evidence/accessibility/*.json` (recounted)                                         | README, accessibility report                     |

The 73 → 74 correction was made in `docs/AI_EVALUATION.md` and `docs/PHASE3_FINAL_AUDIT.md`. The JSON file was not touched.

The figures are verified against the committed generated files. The test suite, the build and the browser tests were **not re-run** for this documentation pass.

## E. Honesty and claim corrections

**Claims corrected**

- 73 → 74 AI evaluation checks (two documents).
- "21 journeys × desktop and mobile" → 39 tests × 2 profiles, 77 passed and 1 skipped by design.
- "12 tests" → 6 tests × 2 profiles in the accessibility report.
- "WCAG 2.1 AA" in the README feature table → the WCAG 2.2 AA engineering target.
- Two citations to nonexistent test files: `tests/engine/budget.test.ts` (problem alignment R2, now `invariants.test.ts`, `warnings.test.ts` and `money.test.ts`) and `tests/ui/persistence.test.tsx` (functional completeness, now `persistence.test.ts`).
- Architecture: the "one active plan" bullet and the v2 introduction were rewritten; the current v3 model comes first and the older shapes are collected in a labelled "Storage history (historical)" table.
- R6 and R9 statuses now say what is and is not verified.

**Unsupported or ambiguous claims removed or reworded**

- Static test, coverage, accessibility and bundle badges (replaced by a dated, sourced note).
- "Live app — verified" (now "Open the live app", with the verification status given in the evidence index).
- The README's "Proof over promises" paragraph with the stale journey count.

**Limitations preserved or made more visible**

- No screen-reader testing; automated results do not prove WCAG conformance.
- AI evaluation is mocked fixtures only; the 5/5 scorecard measures validation, safety, grounding and context contracts, not live model quality.
- The original challenge statement was not available; no official scoring weights are claimed.
- No quotation file upload, no cloud sync or share links, print verified by emulation only, per-instance rate limits, Hindi and Marathi for the chrome only.

**Claim verification**

| Claim                                  | Source implementation                                  | Evidence                                                                           | Status                                                  |
| -------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Multi-event persistence (schema v3)    | `src/state/persistence.ts` (`SCHEMA_VERSION = 3`)      | `tests/ui/persistence.test.ts`, `tests/ui/multievent.test.tsx`, E2E journeys       | Verified (code read; recorded passes, not re-run)       |
| AI patch approval flow                 | `src/engine/patch.ts`, `src/ui/views/AiPatchPanel.tsx` | `tests/engine/patch.test.ts`, route tests, E2E reject/apply/undo                   | Verified with a mocked model                            |
| WCAG-oriented accessibility audit      | `e2e/specs/accessibility.spec.ts`                      | 20 axe result files with 0 violations; keyboard, reflow and reduced-motion tests   | Verified for the tested states; not a conformance claim |
| Screen-reader behaviour                | n/a                                                    | None                                                                               | Not verified (not performed)                            |
| Financial reconciliation               | `src/engine/money.ts`, `budget.ts`, `cashflow.ts`      | `tests/engine/invariants.test.ts`, `money.test.ts`, E2E money journeys             | Verified (recorded passes, not re-run)                  |
| AI evaluation: 24 scenarios, 74 checks | `tests/ai/evaluation.test.ts`                          | `docs/evidence/ai/ai-eval-results.json`, recounted                                 | Verified, for mocked fixtures only                      |
| Browser results: 77 passed, 1 skipped  | `e2e/specs/*.spec.ts`                                  | `e2e/evidence/e2e-results.json`, recounted                                         | Verified (recorded run)                                 |
| Live AI functionality                  | `api/_lib/gemini.ts`, `scripts/live-ai-smoke.mjs`      | No committed smoke output. Owner reports a manual live check on 2026-10-31         | Not independently verified                              |
| Live deployment reachable              | `vercel.json`                                          | Owner reports it working on 2026-10-31; not reachable from this documentation pass | Not independently verified                              |
| CI currently passing                   | `.github/workflows/ci.yml`                             | Live CI status was not read                                                        | Not checked                                             |
| Screenshots match the current UI       | `scripts/capture-screenshots.mjs`                      | Eight screenshots inspected visually; they show real application screens           | Partial (not re-captured from a running build)          |

## F. Evaluator journey

Recommended reading order: README → DEMO (or the README quick start) → problem alignment → functional completeness → AI evaluation → accessibility report → test report → final audit. The same order is at the top of [PHASE3_EVIDENCE_INDEX.md](PHASE3_EVIDENCE_INDEX.md).

Recommended demonstration order: Load demo event → Budget → Vendors and Payments → Quotations → Guests → Assistant → Run sheet → Scenarios → All events.

## G. Validation

| Check                         | Result                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broken relative links, before | 3 flagged of 44 (percent-encoded emoji anchors in the old README)                                                                                                                                  |
| Broken relative links, after  | 0 of 124 checked (files and heading anchors across README, `docs/`, `SECURITY.md`, `e2e/README.md`, `worklog.md`)                                                                                  |
| Missing images                | 0 (every screenshot path referenced exists)                                                                                                                                                        |
| Backticked repository paths   | The 2 nonexistent test paths were fixed. Two references remain by design: `e2e/artifacts/` (a git-ignored output folder that is generated by test runs) and `tests/e2e` in the historical work log |
| Markdown format               | `npx prettier --check` passes on every edited file, the same check CI runs                                                                                                                         |
| Metric synchronisation        | See section D                                                                                                                                                                                      |
| Protected-path diff           | Only documentation paths changed (see below)                                                                                                                                                       |

Files changed: `README.md`, `docs/PHASE3_EVIDENCE_INDEX.md`, `docs/PHASE3_PROBLEM_ALIGNMENT.md`, `docs/AI_EVALUATION.md`, `docs/ARCHITECTURE.md`, `docs/ACCESSIBILITY_REPORT.md`, `docs/PHASE3_FINAL_AUDIT.md`, `docs/PHASE3_FUNCTIONAL_COMPLETENESS.md`, `docs/DEMO.md`, and this new file. `src/`, `api/`, `tests/`, `e2e/`, `scripts/`, `.github/`, `package.json`, `package-lock.json`, `vercel.json` and all configuration are untouched.

## H. Remaining documentation limitations

- `docs/SPEC.md` still says "WCAG 2.1 AA" in acceptance row A1 (as originally specified) and keeps Phase 1 and Phase 2 snapshot counts (42 journey runs, 632 tests, 54 runs) that are not labelled as snapshots. The current figures are in `docs/METRICS.md`. Not changed in this pass.
- `worklog.md` line 258 still says 73 AI evaluation checks. It is a historical log, and the authoritative count is 74. Not changed in this pass.
- Live AI behaviour, the live deployment and live CI status could not be independently verified from this environment.
- The screenshots were inspected but not re-captured.
- Test, build and browser runs were not repeated; figures come from the committed generated files.
- Screen-reader testing remains open work.

## I. Conclusion

**Documentation ready with disclosed limitations.** The evidence is easier to find and the contradictions found are resolved, except the two historical-record items in section H.

To close the largest open item, run `GEMINI_API_KEY=... npm run smoke:ai` and record the pass or fail output (never the key) and the date in `docs/AI_EVALUATION.md`.

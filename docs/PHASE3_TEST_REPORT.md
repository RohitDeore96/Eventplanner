# Phase 3 — Test report

> **Phase 3 snapshot, 2026-10-31.** The counts below are the recorded Phase 3 run
> (650 tests across 56 files, 115.0 KB gz, coverage 95.99/94.1/96.47/83.63) and are kept
> as history. Current generated values live in [docs/METRICS.md](METRICS.md) and the README.

All numbers below come from real runs on 2026-10-31 in this environment
(Linux x64, Node v24.22.1, vitest 5.0.5, Playwright 1.64.1, Chromium headless shell 156),
at commit `537cb89` (working tree of the Phase 3 documentation commit), then re-verified
after the P3-9 fix below landed. Raw machine-readable evidence:
`e2e/evidence/e2e-results.json` (Playwright JSON report of a full run: 77 expected,
0 unexpected, 1 skipped-by-design).

## 1. Scope and layers

| Layer                  | Where                         | What it covers                                                                                                                                              |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine unit + property | `tests/engine/*.test.ts`      | Money, budget, vendors, instalments, expenses/links, guests, tasks/timeline, run sheet, scenarios, trade-offs, patch safety, warnings, duplicates, cashflow |
| API (mocked model)     | `tests/api/*.test.ts`         | Route guards (405/403/413/415/429/timeout), schema validation, model-chain fallbacks, intake money contract                                                 |
| UI integration         | `tests/ui/*.test.tsx`         | Views through the real store: persistence, autosave, deep validation, multi-event, quotations, dietary, i18n, tokens contrast, AI views                     |
| AI evaluation          | `tests/ai/evaluation.test.ts` | 24 deterministic scenarios — see `AI_EVALUATION.md`                                                                                                         |
| Browser E2E            | `e2e/specs/`                  | Production build via `vite preview`: journeys + accessibility + negative + responsive                                                                       |
| Security               | CI steps                      | `npm audit --omit=dev` (0 vulnerabilities), secret scan (clean), CSP/HSTS headers in `vercel.json`                                                          |

## 2. Commands and results (exact)

| Command                                                                                    | Result                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (format, lint --max-warnings 0, tsc, dep-cruiser, knip, vitest --coverage) | 56 files, **650 tests passed**, 0 failed, 0 skipped                                                                                                                                                      |
| Coverage (same run, all thresholds met)                                                    | statements 94.1%, branches 83.63%, functions 96.47%, lines 95.99%                                                                                                                                        |
| `npm run test:e2e`                                                                         | **77 passed**, 0 failed, 1 skipped (tablet spec under the mobile project by design), ~78 s                                                                                                               |
| `npm run build` + `node scripts/check-size.mjs`                                            | Bundle **115.0 KB gz / 250 KB budget**                                                                                                                                                                   |
| `node scripts/check-repo-size.mjs`                                                         | **1.58 MB / 10 MB limit**                                                                                                                                                                                |
| `npm audit --omit=dev --audit-level=high`                                                  | **0 vulnerabilities** (a moderate advisory affects the dev-only eslint/minimatch toolchain; it ships nothing to production and the only automated fix is a breaking toolchain downgrade — tracked in §7) |
| `node scripts/secret-scan.mjs`                                                             | **clean**                                                                                                                                                                                                |
| `npm run smoke:ai`                                                                         | Honest SKIP — no `GEMINI_API_KEY` in this environment (see limitations)                                                                                                                                  |

## 3. Browser journeys vs the phase-brief's mandatory set (§8.3)

| Brief test                  | Utsav journeys                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A First-time event setup    | Journey 1 (intake fills form, persists), Journey 4 (reload persistence)                                                          |
| B Complete vendor lifecycle | Journey 3 (vendor → schedule → payment → edit-free summary → reload)                                                             |
| C Quotation workflow        | Journey 12 (extract → correct → save → compare → accept; duplicate guard)                                                        |
| D Expense reconciliation    | Journey 11 (link, reassign, invalid prevented, honest totals)                                                                    |
| E Guest and catering        | Journey 5 + negative "RSVP, plus-ones and catering stay in step" (filter/search incl.)                                           |
| F AI usefulness             | Journey 8 (reject → apply → undo with impact), Journey 8-no-key, Journey 10 (offline fallback), negative malformed-response test |
| G Budget and scenarios      | Journey 13 (locks + trade-offs), Journey 15 (scenario reject → apply → undo), negative over-allocation                           |
| H Run sheet                 | Journey 14 (conflict detection, correction, print-media emulation)                                                               |
| I Multi-event isolation     | Journey 9, Journey 16 (duplicate/archive/restore/delete)                                                                         |
| J Responsive                | Desktop + mobile projects on the whole suite; dedicated tablet walk (768×1024) with reflow assertion                             |

## 4. Negative testing (§8.4) — where each item is covered

- Invalid budgets / huge amounts / invalid dates / missing info: `create.test.ts`,
  `money.test.ts`, `intake-money.test.ts`, route 400/413 tests, AI eval out-of-range.
- Duplicate records / duplicate quotation acceptance: `duplicate.test.ts`, Journey 12.
- Invalid event/vendor references, wrong-vendor instalments: `expense-links.test.ts`,
  `phase2-branches.test.ts`, deep validation tests.
- Malformed AI responses: AI eval (4 scenarios) + browser negative test.
- API timeouts / rate limits: `routes.test.ts` (429, 504 paths).
- Corrupted saved events / failed persistence / stale state: Journey 6, `persistence.test.tsx`,
  `deep-validation.test.ts`.
- Multiple rapid user actions: negative "rapid successive actions all land".
- Navigation away during pending changes: negative "navigation away" test + Journey 4.

## 5. Defects discovered during Phase 3 (all fixed)

| ID   | Defect                                                                                                                                                                                                                            | Found by                                | Fix                                                                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 | CI trigger `branches: ain]` — pushes to `main` never started CI                                                                                                                                                                   | config inspection                       | `branches: [main]`                                                                                                                                                                                                                                                                                    |
| P3-2 | Language label at 1.3:1 contrast on the maroon header                                                                                                                                                                             | axe scan (serious)                      | `.masthead .muted` uses `--on-maroon`                                                                                                                                                                                                                                                                 |
| P3-3 | `.visually-hidden` captions/labels widened the page by their static offsets inside wide tables (page-level horizontal scroll at 320 px)                                                                                           | reflow scan                             | `position: fixed` for visually-hidden utility                                                                                                                                                                                                                                                         |
| P3-4 | Scrollable tables not keyboard-focusable (WCAG 2.1.1)                                                                                                                                                                             | axe scan (serious)                      | `tabIndex={0}` on all 13 data tables                                                                                                                                                                                                                                                                  |
| P3-5 | No `<h1>`                                                                                                                                                                                                                         | axe                                     | brand name is the page h1                                                                                                                                                                                                                                                                             |
| P3-6 | Tabs not arrow-key operable (APG)                                                                                                                                                                                                 | manual keyboard audit                   | arrow/Home/End activation                                                                                                                                                                                                                                                                             |
| P3-7 | Skip link did not move real focus                                                                                                                                                                                                 | keyboard journey                        | `<main tabIndex={-1}>`                                                                                                                                                                                                                                                                                |
| P3-8 | `planFacts()` omitted dietary aggregates — the assistant could not answer the caterer question from facts                                                                                                                         | AI evaluation scenario                  | dietary + RSVP totals added to the facts (aggregates only)                                                                                                                                                                                                                                            |
| P3-9 | Coverage drift: the recorded Phase 3 run reported 93.69% statements / 82.88% branches — below the project's own 94%/83% gates — without flagging it; CI (freshly re-enabled for `main` by the P3-1 fix) would have failed on push | independent re-verification before push | 11 meaningful tests added (duplicate-id refusal, full-relationship duplication remaps, workspace cap/newer-version hardening, aiClient error/timeout/abort contract, idea-context payload rules, CSV expense rows, summary/raw downloads, locked-category scenario scaling); no threshold was lowered |

## 6. Continuous integration

`.github/workflows/ci.yml` runs: format, lint (0 warnings), types, architecture rules,
unused-code, unit+coverage, build, bundle budget, dependency audit, secret scan, repo
size — then a separate job with Playwright (chromium installed via
`--with-deps`), uploading traces from `e2e/artifacts/` on failure. No check is bypassed
or allowed to fail with an ignored exit code. The trigger was broken for `main` pushes
(defect P3-1, fixed in this phase). Credential-dependent validation (live AI smoke) is
kept out of CI and documented as an opt-in local step.

## 7. Remaining risks / not tested here

- Live provider AI behaviour — mocked paths fully covered; the opt-in live smoke was
  attempted on 2026-10-31 with a real key and the provider refused every call from this
  environment (location restriction): see `docs/evidence/ai/live-smoke-2026-10-31.txt`.
- Screen-reader interaction (no SR available) — see `ACCESSIBILITY_REPORT.md` §5.
- Print on physical paper — verified via Playwright print-media emulation only.
- Production deployment re-verification (last checked 2026-10-30; no deploy from here
  without authorization).
- One moderate npm advisory (`minimatch` < 11.0.1) sits in the dev-only eslint toolchain.
  Runtime dependencies audit clean at every severity. `npm audit fix --force` would pin
  typescript-eslint to a breaking older version, so this is disclosed rather than
  force-fixed; it ships nothing to the production bundle.

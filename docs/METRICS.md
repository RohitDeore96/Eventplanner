# Metrics

Recorded by hand from real runs on 2026-10-30 (Node 22, single-core sandbox). A script that generates this file and a CI drift check are not built yet, so treat this as a dated record, not a live number.

| Check        | Result                                                                                |
| ------------ | ------------------------------------------------------------------------------------- |
| Tests        | 237 passed, 11 files (`npm test`)                                                     |
| Coverage     | 99.32% statements, 94.94% branches, 100% functions, 99.85% lines (`npm run test:cov`) |
| Typecheck    | clean, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`             |
| Lint         | 0 errors, 0 warnings, typescript-eslint strict-type-checked                           |
| Format       | `prettier --check` clean                                                              |
| Architecture | no violations, 25 modules, 92 dependencies (`npm run arch`)                           |
| Dead code    | knip clean (`KNIP_DISABLE_RAW_TRANSFER=1 npm run unused` in memory-limited sandboxes) |
| `npm audit`  | 0 vulnerabilities (a dev-only `qs` override was needed; see `package.json`)           |
| Secret scan  | grep for common key patterns found nothing. gitleaks was not run.                     |

## Mutation testing (Stryker), per file

Only these files have been mutated. About 3 seconds per mutant on this machine, so the other engine files are not yet covered. Scores exclude mutants that fail type-checking.

| File            | Score  |
| --------------- | ------ |
| `dates.ts`      | 100%   |
| `budget.ts`     | 100%   |
| `milestones.ts` | 98.91% |
| `money.ts`      | 94.74% |
| `tasks.ts`      | 94.37% |

Not mutation-tested yet: reducers, `patch.ts`, `history.ts`, `warnings.ts`, `scenario.ts`, `summary.ts`, `guests.ts`, `timeline.ts`, `ics.ts`, `create.ts`, `validate.ts`.

## Engine benchmark (`npm run bench`, median of 30)

Realistic = 60 tasks, 150 guests, 40 expenses, 8 vendors. Extreme = 500 tasks, 5,000 guests, 5,000 expenses, 200 vendors x 12 instalments.

| Operation                 | Realistic ms | Extreme ms |
| ------------------------- | -----------: | ---------: |
| summarize                 |         0.40 |       7.48 |
| budgetTotals              |         0.01 |       1.07 |
| buildTimeline             |         0.15 |       5.16 |
| buildIcs                  |         0.58 |      77.96 |
| delay first task (ripple) |         0.32 |      11.49 |
| reducePlan: expense/add   |        0.004 |       0.10 |

Before two fixes found by this benchmark, `summarize` took 126 ms and `buildIcs` 409 ms at the extreme size.

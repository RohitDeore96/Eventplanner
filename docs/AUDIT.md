# Baseline audit (Phase 0)

Taken before any change, from a fresh clone of `RohitDeore96/Eventplanner` on 2026-10-30.

| Item                                                   | Finding                                            |
| ------------------------------------------------------ | -------------------------------------------------- |
| Commits                                                | 1 (`Initial commit`)                               |
| Tracked files                                          | 1: `README.md` (12 bytes, the text `# challenge5`) |
| Framework, language, package manager                   | None present, so none to preserve                  |
| Manifests, lockfile, TS/lint config, CI, `vercel.json` | None                                               |
| API routes, AI integration, schemas, persistence       | None                                               |
| Repo size (`git count-objects -vH`)                    | `size-pack: 1.98 KiB`                              |
| Uncommitted work to protect                            | None                                               |

## Baseline check results

| Check                    | Result                             |
| ------------------------ | ---------------------------------- |
| Install                  | Not configured (no `package.json`) |
| Lint                     | Not configured                     |
| Typecheck                | Not configured                     |
| Unit / integration / e2e | Not configured                     |
| Build                    | Not configured                     |
| Audit                    | Not configured                     |
| Accessibility            | Not configured                     |

Consequence: there was nothing to repair. This is a greenfield build, and every claim in later docs must come from a command run after this point (see `docs/METRICS.md` once generated).

## Phase 1 baseline (2026-10-30, after the engine landed)

Ran on a fresh clone of `RohitDeore96/Eventplanner`, before any M0 change.

| Check                 | Command                                              | Raw result                                                              |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Install               | `npm ci`                                             | OK (npm warn: esbuild postinstall script not approved)                  |
| Unit / property tests | `npx vitest run`                                     | 237 passed (11 files), 2.31 s                                           |
| Typecheck             | `npx tsc --noEmit`                                   | 0 errors                                                                |
| Lint                  | `npx eslint . --max-warnings 0`                      | 0 findings                                                              |
| Architecture          | `npx depcruise src --config .dependency-cruiser.cjs` | no violations (25 modules, 92 deps)                                     |
| Unused code           | `npx knip`                                           | crashes without `KNIP_DISABLE_RAW_TRANSFER=1` (see D16); with it: clean |
| Mutation              | `npx stryker run`                                    | Not run in this pass (slow, ~3 s per mutant; scheduled job only)        |
| CI, build, deploy     | —                                                    | Not configured at this point                                            |

## Defect fixes verified in M0 (all with failing tests written first)

| Defect                       | Fix                                                                                                                                       | Proving test                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D1 action leakage            | `task/add`, `vendor/add`, `expense/add`, `guest/add` build records from named fields                                                      | `tests/engine/defects.test.ts` — exact key-set assertions on all four record types |
| D2 throws on malformed input | `reducePlan` entry guard (`Object.hasOwn`, `UNKNOWN_ACTION`); all validators accept `unknown`; enums checked at runtime; arrays validated | 14 malformed-action cases + fast-check fuzz: arbitrary JSON never throws           |
| D3 patch gate bypass         | `dryRunPatch` blocks patches that enlarge an error footprint (rupee overage + error count + new error ids)                                | grow-block / unchanged-allow cases on an over-allocated plan                       |
| D4 one-paisa settlement      | Instalments settle only when summed payments reach the amount; partial and multiple payments allowed; `INSTALMENT_OVERPAID` warning added | partial-then-final settlement, 1-minor-unit case, overpay warning                  |

## Phase 2 audit (2026-10-30, M0-M4 complete)

Ran after M4, before the M5 docs pass. Commands and raw outcomes:

| Check                                                          | Result                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` (format, lint, types, arch, unused, tests+cov) | green; coverage thresholds enforced (95 stmts/lines/funcs, 85 branches)                                                   |
| Tests                                                          | 341 passing (engine 237-era suite extended with defect regressions, API routes, UI components, demo, persistence, tokens) |
| `npm run build`                                                | production build OK, ~89 KB gz JavaScript                                                                                 |
| `node scripts/check-size.mjs`                                  | under 250 KB budget                                                                                                       |
| `node scripts/check-repo-size.mjs`                             | ~0.2 MB of 10 MB                                                                                                          |
| `node scripts/secret-scan.mjs`                                 | clean                                                                                                                     |
| `npm audit --omit=dev --audit-level=high`                      | clean                                                                                                                     |
| knip                                                           | clean (one documented env workaround: `KNIP_DISABLE_RAW_TRANSFER=1`)                                                      |
| Vercel deploy                                                  | Not verified from this environment (no account access); config is in place                                                |
| Stryker mutation run                                           | Not run this pass (scheduled job; ~3 s per mutant)                                                                        |
| Playwright real-browser e2e                                    | Not run in this environment (no browser download); axe runs in jsdom instead                                              |

## Mission audit (2026-10-30, commit 682fc14)

Fresh inspection before the mission work. Every claimed defect was verified in code first.

| ID   | Severity | Defect (verified evidence)                                                                                                                                                                                                    | Fix commit  |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| M-01 | Critical | Intake budget unit mismatch: fallback stored major rupees in `budgetMinor` (8 lakh → 800000) and the UI divided by 100, so ₹8,00,000 became ₹8,000; the AI prompt never mentioned units; a route test encoded the wrong value | 7213c32     |
| M-02 | Critical | Autosave gated on the original `plan` prop, so plans created from empty storage never saved later changes, undo or redo                                                                                                       | 7213c32     |
| M-03 | Critical | Currency change silently reinterpreted amounts (same-exponent switch bypassed the reducer via the setup form; no records-exist guard)                                                                                         | 7213c32     |
| M-04 | Critical | Intake detected an occasion but never applied it to the form (prefill object omitted it)                                                                                                                                      | 7213c32     |
| M-05 | High     | Persistence validated only the plan's top level; nested vendor/expense/task/guest records and referential integrity were unchecked                                                                                            | 7213c32     |
| M-06 | High     | No dietary management in the UI (guests always created with `dietary: []`)                                                                                                                                                    | 6c0ed90     |
| M-07 | High     | Ideas hardcoded the vibe "warm and festive" — no personalization inputs                                                                                                                                                       | 6c0ed90     |
| M-08 | High     | Vendor payment schedules existed only in the engine; the UI admitted they were "next (M2 close-out)"                                                                                                                          | 6c0ed90     |
| M-09 | High     | Quotations were extract-and-display only: no save, no comparison, no acceptance                                                                                                                                               | 6c0ed90     |
| M-10 | Medium   | Scenario comparison existed in the engine with no UI                                                                                                                                                                          | 010a479     |
| M-11 | Medium   | Only three occasion types; the mission requires four with meaningful differences                                                                                                                                              | 071412d     |
| M-12 | Medium   | No real-browser E2E while the competitor runs one                                                                                                                                                                             | this commit |
| M-13 | Low      | `setSchedule` never validated the instalment `kind` field from untrusted input                                                                                                                                                | 6c0ed90     |
| M-14 | Low      | CI `branches` filter YAML was malformed                                                                                                                                                                                       | this commit |

## Mission additions (2026-10-30)

- One monetary-unit contract: readers state MAJOR units; the server converts to minor units
  exactly once with the request currency (`majorToMinor`); the UI converts minor → major for
  display with `currencyExponent` (JPY needs none). Regression suite: `tests/api/intake-money.test.ts`.
- Deep storage validation: strict nested record schemas + referential integrity + dependency
  cycle check; corrupt data starts the app fresh instead of crashing.
- Vendor payment schedules end-to-end; quotation library (validated, per plan), side-by-side
  comparison, honest inquiry drafts, acceptance through the reducer.
- What-if scenarios with preview-on-copy and one-step apply (`applyAll`), plus the full
  stress test (all three shocks at once, survives/breaks verdict) — one undo step per batch.
- Multi-event workspace (storage v2, safe migration), All-events manager, cash-flow
  calendar by month, session activity log, and EN/हिन्दी/मराठी chrome labels.
- Fourth occasion type (milestone) with distinct splits, tasks and fallback ideas.
- Playwright real-browser suite (desktop + mobile) running the production build via
  `vite preview`; mocked AI endpoints for determinism.

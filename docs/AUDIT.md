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

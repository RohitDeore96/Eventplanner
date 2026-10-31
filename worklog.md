# Utsav — Phase 1 worklog

**Phase 1: Critical Defect Elimination, Financial Integrity & Production Reliability.**

This is the running record of Phase 1 execution. Every claim below was re-verified on
**2026-10-31** against a fresh clone of `main` (at `fd4f7ae`) by running the real commands —
nothing is marked done because code exists. The acceptance table it maps to lives in
[`docs/SPEC.md`](docs/SPEC.md) ("Phase 1 (correctness) status").

---

## 2026-10-31 — full re-verification run (fresh clone of `main`)

### A. Initial audit

- Branch `main`, HEAD `fd4f7ae` ("fix(api): explicit .js extensions on every engine import…").
- Working tree clean before this run's edits (only `docs/METRICS.md` regenerated mid-run).
- All critical modules re-read: `money.ts`, `fallbacks.ts`, `parse-intake.ts`, `ai.ts`,
  `persistence.ts`, `App.tsx`, `SetupView.tsx`, `IntakeBox.tsx`, `http.ts`, `vercel.json`,
  `ci.yml`, `SECURITY.md`, the test tree (`tests/engine`, `tests/api`, `tests/ui`, `tests/e2e`).

### B. Commands executed today (actual results)

| Command                                                                        | Result                                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                       | 426 packages, clean                                                                                                   |
| `npm run check` (format + lint + typecheck + arch + unused + tests + coverage) | exit 0 — **517 tests / 42 files passed**; coverage 94.56% statements, 95.81% lines, 96.37% functions, 84.67% branches |
| `npm run build`                                                                | exit 0 — `dist/` built, 164 modules                                                                                   |
| `node scripts/check-size.mjs`                                                  | Bundle: **102.5 KB gz**, under the 250 KB budget                                                                      |
| `npx playwright test` (production build via `vite preview`, desktop + mobile)  | **42/42 passed** (21 journeys × 2 profiles) in 28.6 s                                                                 |
| `node scripts/secret-scan.mjs`                                                 | clean                                                                                                                 |
| `node scripts/check-repo-size.mjs`                                             | 1.58 MB after today's fix (see defect F1/D10)                                                                         |
| `npm run smoke:ai` (no key set)                                                | honest `SKIP: GEMINI_API_KEY is not set… live provider was NOT exercised`                                             |
| money-table script (below)                                                     | ALL MONEY CHECKS PASS                                                                                                 |

Note: the first Playwright attempt failed with `Executable doesn't exist … chromium_headless_shell-1248`
— the sandbox browser cache was stale, not the suite. `npx playwright install chromium` fixed it;
CI already does `npx playwright install --with-deps chromium`, so CI is unaffected.

### C. Financial correctness (executed against the real code, not re-typed)

| Input    | Currency | Expected minor value |    Actual result |
| -------- | -------- | -------------------: | ---------------: |
| 8 lakh   | INR      |           80,000,000 |    80,000,000 ✅ |
| 8.5 lakh | INR      |           85,000,000 |    85,000,000 ✅ |
| 8,00,000 | INR      |           80,000,000 |    80,000,000 ✅ |
| ₹800000  | INR      |           80,000,000 |    80,000,000 ✅ |
| 2 crore  | INR      |        2,000,000,000 | 2,000,000,000 ✅ |
| ₹50,000  | INR      |            5,000,000 |     5,000,000 ✅ |
| 10,000   | JPY      |               10,000 |        10,000 ✅ |
| 100.125  | KWD      |              100,125 |       100,125 ✅ |
| 10,000   | USD      |            1,000,000 |     1,000,000 ✅ |

- Rejections verified: `-500`, 16-digit overflow, `8.555` (3 decimals on INR), `abc`, empty → all `null`.
- Intake sentence "Wedding with 200 guests in February, budget 8 lakh" → occasion `wedding`,
  guests 200, budgetMinor 80,000,000; the guest count and month are never read as money.
- Exponents from `currencyExponent()`: INR 2, JPY 0, KWD 3, USD 2; KWD displays as `KWD 100.125`.
- **Spec erratum recorded:** the assignment's own table lists "2 crore → 200,000,000 minor",
  but 200,000,000 is the _major_ value (₹2 crore = 2,00,00,000 rupees × 100 paise = 2,000,000,000
  minor). The engine follows the assignment's §5 rule ("minor = smallest supported unit"), which
  the table row contradicts; `tests/api/intake-money.test.ts` pins the rule-following value.

### D. Persistence (re-read today)

- Autosave depends on the **active plan state** (`current`, `hasPlan`, `events`, `activeId`) —
  never the seed prop; every change/undo/redo/event-switch writes the workspace; a failed write
  raises a visible save notice instead of claiming success. Covered by `tests/ui/autosave.test.tsx`
  - E2E Journey 4 (both passed today).
- Deep validation: strict zod schemas for every nested record (event, category, vendor,
  instalment, expense, task, guest) + referential integrity (ids unique, categories/vendors/tasks
  exist, instalment belongs to the expense's own vendor, dependency cycles rejected), supported
  currency, real calendar dates, byte cap. Invalid events are dropped **individually** with a
  spoken notice; unreadable/too-large/newer storage triggers the recovery card with an
  exportable copy and "Start fresh". Journeys 6 and 7 passed today.
- Migration: v0/v1 single-plan records migrate into the v2 workspace; E2E Journey 7 seeds a
  version-0 record and verifies it saves forward and survives a reload.

### E. Defects found and fixed in THIS run

| ID                           | Defect                                                                                                                                              | Severity | Root cause                                          | Fix                                                                      | Regression evidence                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| F1 (= D10 in `docs/SPEC.md`) | repo-size gate parsed humanized `git count-objects -vH`; newer git prints `1.58 MiB`, the `\d+` regex read it as 1 KiB, METRICS printed **0.00 MB** | P2       | humanized output format differs across git versions | `scripts/check-repo-size.mjs` now reads raw `-v` output (KiB everywhere) | script run prints 1.58 MB; METRICS regenerated                  |
| F2                           | `docs/SPEC.md` P1-01 evidence cited commit `6cbf2e0` / branch `utsav-mission`, unreachable from `main`                                              | P2       | row written against an earlier working branch       | refreshed with today's inspection (`fd4f7ae`, `main`)                    | `git cat-file -t 6cbf2e0` fails; row now cites the audited HEAD |

Nothing else failed re-verification. All 22 P1 acceptance criteria hold **PASS** with the
evidence above; nothing is marked PASS on the strength of code alone.

### F. Security re-checks today

- `vercel.json`: CSP has no `unsafe-inline`/`unsafe-eval`, HSTS + nosniff + DENY + COOP present;
  SPA rewrite excludes `/api/`.
- `api/_lib/http.ts`: POST-only (405), same-origin (403), per-IP rate limit (429), 8 KB body cap
  (413), timeouts, safe errors.
- Secret scan clean; `.env.example` documents `GEMINI_API_KEY` without any real key; the key is
  read only inside `api/` functions.
- No model names and no competitor names in README; the only competition reference is the
  event's own name ("PromptWars Virtual, Challenge 5").

### G. Phase 1 completion statement

**All 22 P1 criteria: PASS** (evidence in `docs/SPEC.md` + this worklog). The only knowingly
not-exercised item is the **live AI provider smoke** (`npm run smoke:ai`), which honestly SKIPs
until `GEMINI_API_KEY` is configured in the deployment environment — mocked route tests and the
offline-honesty journey cover the failure paths.

### H. Handoff notes

- Phase 2 workflows (vendor payments UI depth, quotation persistence/comparison, dietary
  editing, personalization, budget trade-offs, run sheet, scenario UI, multi-event) were
  subsequently shipped as R/X differentiators — see `docs/SPEC.md` sections B/C for their status.
- To enable live AI: set `GEMINI_API_KEY` (server-side env var in the Vercel project settings),
  optionally `GEMINI_MODEL`, then redeploy; `npm run smoke:ai` will then exercise the real
  provider and stop SKIPping.

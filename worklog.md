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

---

## 2026-10-31 — Phase 2: complete product workflows

Full record of the Phase 2 execution (the assignment's implementation map, milestones,
acceptance checklist and adversarial audit). The acceptance table itself lives in
`docs/SPEC.md` ("Phase 2 (product workflows) status") — every row cites implementation
plus tests.

### Starting point

- `main` at `f6920bc` (the Phase 1 re-verification commit); working tree clean.
- Phase 1 gate re-verified before any Phase 2 work: all 22 P1 criteria PASS, check suite
  green, 42/42 browser journeys.

### Implementation map (Milestone 0, condensed)

The inspection found substantial engine support already present (vendor schedules,
quotation extraction/comparison, guest CRUD, scenario engine, multi-event workspace) with
specific workflow gaps: vendor contact fields and detail depth, expense linking in the UI,
quotation lifecycle persistence, unsaved preferences, no locks/trade-offs, no run sheet,
fixed scenario assumptions, no duplicate/archive. Phase 2 closed exactly those gaps.

### What was built (per milestone)

- **M1 Vendors**: contact person/phone/email (optional, validated), editable details,
  search + status filter, instalment removal (paid instalments stay protected by the
  engine), money summary from the engine's own aggregates, payment history per vendor.
- **M2 Expenses**: add/edit forms with a vendor → instalment cascade (switching vendors
  clears the instalment; the expense category follows the vendor), reassignment validated
  by the SAME engine rule as creation, filters by category/vendor/linkage, search.
- **M3 Quotations**: library v2 with a review → shortlist → accepted/rejected lifecycle,
  validity date + note, manual correction of every extracted field before saving, and a
  hard duplicate-acceptance guard that survives reloads. Acceptance still goes through the
  engine (`acceptActions`), so undo and committed totals behave like every other change.
- **M4 Guests**: optional contact + note fields, everything else already passed Phase 1
  and the earlier workflow work.
- **M5 Personalization**: per-event preferences persisted in a sidecar (`utsav.prefs.v1`,
  validated, isolated by plan id); the ideas request now carries formality, budget tier,
  must-haves, remaining budget and booked vendors — the response schema and the no-price
  rule are unchanged.
- **M6 Budget**: allocation editor with per-category locks (engine-enforced for moves,
  allocation edits and scenarios), unallocated/over-allocated display, and a trade-off
  planner that funds a category from unallocated money and unlocked slack — and refuses to
  emit any action when a shortfall would break the budget.
- **M7 Run sheet**: new event-day schedule (entries with times, owner vendor, place,
  notes, done), overlap + same-vendor conflict detection shown for deliberate correction,
  reorder, and a print stylesheet that puts ONLY the run sheet on paper with an event
  header.
- **M8 Scenarios**: fixed pressures keep working (now lock-aware: locked categories stay
  untouched), plus custom assumptions (guest count and/or budget) with preview → apply as
  one undo step → undo.
- **M9 Multi-event**: workspace schema v3 (archive list); duplicate with a fully remapped
  id set (vendors → copied categories, expenses → copied vendors/instalments, run sheet →
  copied vendors), archive/restore, delete also clears the event's quotes and preferences.
- **M10 Product**: Run sheet tab in the navigation (EN/हिन्दी/मराठी), sticky header so
  header actions stay reachable on phones, wide tables scroll within their own box on
  small screens.

### Storage and migration

- Plans: schemaVersion 3. v0/v1/v2 migrate forward; archive list defaults to empty; the
  deep validator now also checks run-sheet entries (calendar dates, owners exist, sane
  time ranges) and drops an invalid event individually.
- Quotations: schemaVersion 2 (status/validity/note default on migrate).
- Preferences: new sidecar, one record per event, corrupt data degrades to defaults.

### Tests (Milestone 11)

- Engine: `runsheet.test.ts`, `tradeoff.test.ts` (incl. locks + shortfall),
  `duplicate.test.ts`, `expense-links.test.ts`, `phase2-branches.test.ts`, and new cases
  in `scenario`/`persistence`/`state-stores` for the v2/v3 migrations and guards.
- UI integration: `phase2.test.tsx`, `phase2-integration.test.tsx`,
  `phase2-surface.test.tsx`, `phase2-final.test.tsx`, `deep-validation.test.ts` through
  the real store (`tests/ui/harness.tsx`).
- Browser: six new Playwright journeys — expenses linking (B), quotations (C), budget
  trade-offs (E), run sheet incl. print emulation (F), scenario reject/apply (G), the full
  event-library lifecycle (H). 54 journey runs in total, desktop + mobile.
- Totals at the end of Phase 2: **626 unit/integration tests + 54 E2E runs**, all green;
  format, lint, typecheck, architecture, unused-code, bundle budget (113.6/250 KB gz),
  secret scan and coverage gates all pass.

### Defects found and fixed while building

| ID  | Defect                                                                                                                             | Severity | Fix                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| E1  | Trade-off planner emitted budget-breaking actions when a shortfall existed                                                         | P1       | `tradeOffActions` returns nothing unless the plan fully fits; the UI shows the shortfall instead of Apply       |
| E2  | Guest `contact` allowed 500 chars in the engine but storage caps it at 120 — a valid save would fail reload validation             | P1       | caps aligned (120), test pins it                                                                                |
| E3  | Scenario maths bypassed nothing — after locks existed, a locked category made the stress test FAIL (simulation, not a transaction) | P1       | scenarios respect locks: locked allocations stay untouched; freed budget redistributes over unlocked categories |
| E4  | Autosave wiped one-off notices (e.g. "Created copy…") immediately                                                                  | P2       | action notices live in their own state that autosave does not clear                                             |
| E5  | Print stylesheet hid the whole app (the SPA mounts into `#root`, so `body > *:not(.layout)` matched everything)                    | P1       | cards hidden individually; print output is exactly the run sheet                                                |
| E6  | Wide tables pushed action buttons past the phone viewport — clicks unreachable on mobile                                           | P1       | tables scroll within their own box under 720 px; header made sticky                                             |
| E7  | `getByLabelText` and friends in tests revealed strict-mode ambiguities (duplicate labels)                                          | P2       | labels renamed where genuinely ambiguous ("Filter by status"), tests scoped                                     |

### Adversarial audit results (§18)

Every listed attack was exercised (unit, integration or browser journey as noted):
editing a vendor after a payment (reducer keeps history; category change refused),
deleting a vendor with expenses (refused with reason), accepting the same quotation twice
(refused, status persists), changing a linked expense's vendor (revalidated; cross-vendor
instalment impossible), editing amounts with instalments (settlement arithmetic stays in
the engine), multiple dietary tags (counts correct), plus-one changes (headcount follows),
over-allocating the budget (visible, never silent), applying financial scenarios (one undo
step, paid records untouched), switching events during edits (autosave writes the leaving
plan first), duplicating linked events (all references remapped), restoring archives
(verbatim), refreshing after every operation (journeys reload throughout), malformed/
outdated saved data (Phase 1 recovery paths re-verified), and every workflow on the mobile
profile (54 journey runs include the Pixel 7 profile).

### Known limitations (honest list)

- Live AI provider behaviour remains unverified here: no `GEMINI_API_KEY` in this
  environment. `npm run smoke:ai` SKIPs honestly; mocked route tests and the offline
  journey cover the failure paths.
- Quotation file upload (§7.1) is not implemented: the architecture processes pasted text
  only, and adding file upload would mean a new attack surface this phase does not need.
- Archived events are excluded from the working tabs but still count towards the 12-event
  storage cap (deliberate: archiving is not deletion).
- The run sheet print layout is verified via Playwright print-media emulation, not on
  physical paper.

---

## 2026-10-31 — Phase 3: competition readiness, accessibility evidence, AI usefulness, testing

Prerequisite gate first: the full check suite (then 632 tests) and all 54 browser journeys
were re-run green at `d117c0f` before any Phase 3 work, and every Phase 2 feature area was
audited against the phase brief's prerequisite list (`docs/PHASE3_FUNCTIONAL_COMPLETENESS.md`).

### What was built

- **e2e working folder** (user request + brief): `e2e/specs/` (journeys + accessibility +
  negative + responsive), `e2e/artifacts/` (machine output, gitignored, HTML report
  sibling-safe), `e2e/evidence/` (committed, machine-generated evidence). `e2e/README.md`
  documents the policy.
- **CI trigger defect (P3-1)**: `branches: ain]` meant pushes to `main` never started CI.
  Fixed; trace upload path moved to the new folder.
- **Accessibility (M2)**: axe-core scans of every view in light and dark (wcag2a/2aa/21a/
  21aa/22aa tags) — 0 serious/critical after fixes; dedicated keyboard-only journey; 320 px
  reflow scan; reduced-motion check. Six real defects found and fixed: 1.3:1 header label
  contrast, visually-hidden elements widening the page at 320 px, tables not keyboard-
  focusable, missing `<h1>`, tabs without arrow keys, skip link not moving real focus.
- **AI usefulness (M1)**: 24-scenario deterministic evaluation across the eight required
  categories (73 checks, all passing; machine results in `docs/evidence/ai/ai-eval-results.json`);
  `planFacts()` now carries aggregate dietary counts and RSVP totals (no PII) so the
  assistant can answer the caterer question; mocked and live evaluation kept strictly
  separate.
- **Testing (M4)**: negative/adversarial journeys (over-allocation visibility, malformed AI
  refused, rapid actions, navigation-away, RSVP/catering step-through), tablet walk with
  reflow assertion; machine-readable full-run evidence (`e2e/evidence/e2e-results.json`,
  77 expected / 0 unexpected).
- **Competitive (M5)**: one-file event summary export — budget overview, category
  planned/committed/paid/remaining, vendor schedules with PAID/partly/OVERDUE derived from
  settled expenses, dietary aggregates (never individual guests), top tasks, run sheet,
  warnings; header button in EN/HI/MR; built purely from `summarize()`.
- **Docs (M0/M8/PART K)**: problem-alignment matrix, functional-completeness matrix,
  accessibility report, AI evaluation report, test report, demo script, evidence index,
  final audit; README badges/sections refreshed; SPEC Phase 3 table added.

### Defects found and fixed while building

| ID   | Defect                                                                  | Severity | Fix                                      |
| ---- | ----------------------------------------------------------------------- | -------- | ---------------------------------------- |
| P3-1 | CI `branches: ain]` — main pushes skipped CI                            | P1       | `branches: [main]`                       |
| P3-2 | Language label 1.3:1 on maroon (axe serious)                            | P1       | `.masthead .muted` uses `--on-maroon`    |
| P3-3 | `.visually-hidden` absolute offsets widened the page at 320 px (reflow) | P1       | `position: fixed`                        |
| P3-4 | Scrollable tables not keyboard-focusable                                | P1       | `tabIndex={0}` on all 13 data tables     |
| P3-5 | No `<h1>`                                                               | P2       | brand name is the page h1                |
| P3-6 | Tabs not arrow-key operable                                             | P2       | APG arrow/Home/End activation            |
| P3-7 | Skip link did not move real focus                                       | P2       | `<main tabIndex={-1}>`                   |
| P3-8 | Assistant facts lacked dietary/RSVP aggregates                          | P2       | added to `planFacts()` (aggregates only) |

### Verification at the end of Phase 3

- `npm run check`: 55 files, **635 tests passed**; coverage 93.69% statements /
  82.88% branches / 95.82% functions / 95.55% lines.
- `npm run test:e2e`: **77 passed**, 1 by-design skip (tablet spec under the mobile
  project), ~78 s — machine evidence in `e2e/evidence/e2e-results.json`.
- Bundle **115.0/250 KB gz**; repo **1.58/10 MB**; `npm audit` 0; secret scan clean.
- Live AI smoke: honest SKIP (no key in this environment) — disclosed everywhere it matters.

### Known limitations (honest)

- Production AI behaviour, screen-reader interaction, physical-paper print and a fresh
  production-deployment check remain unverified here (no key, no SR, no deploy without
  authorization) — full list in `docs/PHASE3_FINAL_AUDIT.md` §I.

## Phase 3 re-verification before push (2026-10-31, commit 38a9449 tree)

An independent end-to-end re-check of the whole tree before pushing, per the user's
"continue to check everything is correct and push successfully".

### Defect P3-9 found and fixed: coverage-gate drift

The Phase 3 verification above recorded `npm run check` as green while its own coverage
summary (93.69% statements / 82.88% branches) was **below the project's enforced gates**
(94% / 83%). Vitest does print `ERROR: Coverage ... does not meet global threshold` and
exits non-zero — CI, re-enabled for `main` by the P3-1 fix, would have failed on the very
first push. The gates were **not** touched; meaningful tests were added instead:

- `tests/engine/runsheet.test.ts` — duplicate activity id refused (`DUPLICATE_ID`), and
  the refused add leaves the original entry untouched.
- `tests/engine/duplicate.test.ts` — duplication of the optional-reference shapes: a cash
  expense (no vendor/instalment) stays vendor-free, task dependencies remap to the
  duplicate's own task ids, an ownerless run-sheet entry stays ownerless with a fresh id.
- `tests/ui/persistence.test.ts` — workspace hardening: a record written by a newer schema
  is refused as `newer_version` (workspace path), and a store holding more than
  `MAX_EVENTS` loads only the 12 most recent, reports the drop, and falls back to the
  first survivor when the stored active id was dropped.
- `tests/lib/aiClient.test.ts` (new) — client contract for the `/api` routes: honest
  `source` (and `unknown` when absent), server error bodies surfaced, non-JSON errors
  become `REQUEST_FAILED_<status>`, stale-call abort, the 16-second timeout actually
  aborts, and idea-context keys are omitted when absent / empty free-text is dropped.
- `tests/ui/summary-export.test.ts` — CSV carries every expense row including the
  no-note fallback; run-sheet entries sort by date (two entries); summary and raw-text
  downloads produce files locally without network calls.
- `tests/engine/scenario.test.ts` — locked categories keep their allocation when a
  budget scenario scales (M10 lock invariant through scenarios).

### Results after the fix (all real runs, same environment)

- `npm run check`: 56 files, **650 tests passed**, 0 failed; coverage **94.1% statements /
  83.63% branches / 96.47% functions / 95.99% lines** — every threshold met.
- `npm run test:e2e`: **77 passed**, 1 by-design skip — unchanged, re-run on the new build.
- Bundle **115.0/250 KB gz**; repo **1.58/10 MB**; secret scan clean;
  `npm audit --omit=dev` **0 vulnerabilities**. One moderate advisory (`minimatch`
  < 11.0.1) sits in the dev-only eslint toolchain; runtime deps audit clean at every
  severity, and the automated "fix" would be a breaking toolchain downgrade, so it is
  disclosed in `docs/PHASE3_TEST_REPORT.md` §7 rather than force-applied.
- `docs/METRICS.md` regenerated by `node scripts/gen-metrics.mjs`; README badge, evidence
  index, test report (defect P3-9 row) and final audit updated to the new counts.

## Documentation: evaluator-readiness pass (2026-10-31)

Applied the `docs: evaluator-readiness pass` change set (10 files: README restructure,
evidence-index rebuild with a reading order, metrics synced to the machine-readable
74-check AI evaluation, stale claims and test paths fixed, and the new
`docs/FINAL_DOCUMENTATION_AUDIT.md` documenting the audit's baseline and fixes). No
application code, tests, configuration or dependencies changed. Verification before push,
all real runs:

- `npm run format` (Prettier, includes Markdown): pass on the full tree.
- Two rule-compliance edits to the change set's README before commit: the stack line's
  provider name was replaced with "AI", and the live-AI row now says "a server-side
  provider key" — the README names no specific model or provider; the precise
  `GEMINI_API_KEY` variable remains documented in `docs/AI_EVALUATION.md`.
- 95/95 relative links across the ten changed files resolve; every quoted figure was
  cross-checked against its source: `docs/METRICS.md` (650 tests across 56 files,
  coverage 95.99/94.1/96.47/83.63, bundle 115.0 KB gz, repo 1.58 MB),
  `e2e/evidence/e2e-results.json` (77 passed, 0 failed, 1 by-design skip) and
  `docs/evidence/ai/ai-eval-results.json` (24 scenarios, 74 checks, 0 failed).
- Gates re-run: secret scan clean; repo 1.58/10 MB; bundle 115.0/250 KB gz.

## Final technical optimization pass (2026-10-31, baseline d296dc7)

Scope-limited to Code Quality / Security / Efficiency per the optimization prompt.
Full report: `docs/FINAL_TECHNICAL_OPTIMIZATION_AUDIT.md`. Three fix commits:

- `4b7205c` fix(quotes): no silent drop at the 24-quote cap (honest refusal); Undo/Redo
  now revert/re-apply an accepted quotation's sidecar status together with the plan
  (quote reference folded onto the batch activity entry); the dropdown can no longer
  set 'accepted' without a booking nor unlock an accepted quote; oversized foreign
  libraries load instead of being destroyed at parse; updateQuote reports unknown ids;
  quote writes notify subscribers so header Undo refreshes the compare section.
  8 new tests (`tests/ui/quote-sidecar-integrity.test.tsx`).
- `769eae4` fix(api): same-origin policy hardening (Origin must match Host, and the
  platform-reported scheme when present; missing-Origin requests judged by the
  unforgable Sec-Fetch-Site - cross-site contexts rejected, non-browser tooling still
  works); rate-limit identity now prefers the platform-injected
  x-vercel-forwarded-for over the client-spoofable x-forwarded-for; the per-IP bucket
  map is bounded (5,000) with sweep + eviction. 7 new guard tests.
- `ef57ed0` fix(ai): model chain corrected against the official provider model list
  (checked 2026-10-31) - removed the non-existent gemini-3.5-flash (plain) that cost
  one doomed round-trip per cache miss; added the documented newest stable
  gemini-3.8-flash; 3.6-flash stays first per the deployment owner directive.

### Results (all real runs, same environment)

- `npm run check`: **665 tests passed** across 57 files, 0 failed; coverage
  **96.18% lines / 94.29% statements / 96.61% functions / 83.67% branches** - every
  threshold met, ratchet unbroken; prettier, eslint, tsc, dependency-cruiser, knip clean.
- `npm run test:e2e`: **77 passed**, 1 by-design skip - unchanged, re-run on the new build.
- Bundle **115.2/250 KB gz** (+0.2 KB = the integrity/security code); repo **1.58/10 MB**;
  secret scan clean; `npm audit --omit=dev` **0 vulnerabilities**; full audit = the one
  previously disclosed dev-only advisory (minimatch in the eslint toolchain), no safe
  upgrade, no dependency added or removed.
- `docs/METRICS.md` regenerated by `node scripts/gen-metrics.mjs`; README's
  recorded-verification numbers synced to this run (accuracy only).

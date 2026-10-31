# Utsav — Phase 3 final audit

Independent, evidence-first record of the competition-readiness phase. Every claim below
points at something that runs or exists in the repository. Written 2026-10-31.

## A. Repository baseline

- **Inspected commit:** `d117c0f` (Phase 2 complete, pushed) — working tree clean apart
  from filesystem mode bits (handled with `core.fileMode=false`; no content changes).
- **Phase 1 status at baseline:** complete; 22/22 acceptance criteria PASS with
  evidence in `docs/SPEC.md` (re-verified on a clean clone at `f6920bc`).
- **Phase 2 status at baseline:** complete and pushed — vendor payments UI, expense
  linking, quotation lifecycle, dietary editing, personalization sidecar, budget locks
  and trade-offs, run sheet with print, scenarios with custom assumptions, multi-event
  workspace v3 (duplicate/archive/restore). 626 unit/integration tests + 54 browser
  journeys green.
- **Initial quality:** `npm run check` green; bundle 113.6 KB gz; coverage 94.1%
  statements; two open E2E-side gaps (no accessibility spec, no tablet profile) and a
  broken CI trigger (below).
- **Critical blockers found:** one — CI never ran on pushes to `main`
  (`branches: ain]` typo). Fixed first (defect P3-1 in `PHASE3_TEST_REPORT.md` §5).

## B. Problem alignment

- Requirements source: the three phase briefs' enumerations + the repo's R1–R10
  classification. The original challenge statement was **not independently available**;
  this is disclosed in `PHASE3_PROBLEM_ALIGNMENT.md` rather than papered over.
- Full traceability matrix: R1–R10 all **Verified**, each with implementation location
  and a reproducible test or journey.
- The organiser's eleven questions (§4.2 of the brief) each map to a shipped feature.
- End-to-end demonstration: `docs/DEMO.md` — fourteen steps, realistic sample family,
  every step also automated in the browser journeys.
- Missing/unsupported: quotation file upload (deliberate, disclosed); nothing else.

## C. Accessibility

- Target: WCAG 2.2 AA (engineering standard, no conformance claim).
- Methodology: automated axe scans of every view in light **and** dark themes (tags
  wcag2a/2aa/21a/21aa/22aa), keyboard-only journeys, 320 px reflow, reduced motion,
  token-level contrast math; then fixes; then re-scan.
- Automated results: **0 serious/critical violations** across 8 populated views × 2
  themes + 2 first-run states × 2 themes, desktop and mobile profiles
  (`e2e/evidence/accessibility/*.json`).
- Manual keyboard findings: skip link works (moves real focus), full form completion by
  keyboard, arrow-key tabs (APG), no keyboard trap in a 20-press walk, visible focus
  ring, destructive reset confirmed before acting.
- Contrast: header label defect (1.3:1) found and fixed; tokens asserted by tests.
- Screen reader: **not tested** — none available in this environment; stated honestly
  (structure/roles/live-regions verified by axe instead).
- Remaining limitations: listed in `ACCESSIBILITY_REPORT.md` §6 (SR interaction, exotic
  zoom levels, recovery-card SR walk).

## D. AI usefulness

- Capabilities: intake parsing, personalised ideas, plan review, ask-the-planner,
  quotation extraction, change proposals — all behind same-origin guarded routes.
- Context construction: `planFacts()` from engine output only; Phase 3 added aggregate
  dietary/RSVP lines (the assistant can now answer the caterer question); PII never
  included (asserted by `context-no-pii-leak`).
- Data validation: single zod source for server + client; major-unit decimal strings
  converted exactly once; unknown fields stripped; malformed refused.
- Safety: proposals dry-run through the engine, require explicit approval, apply as one
  undoable step; AI cannot delete, touch paid records, or change currency (schema +
  engine scope).
- Evaluation dataset: 24 scenarios / 74 checks across the eight required categories —
  **all passing**; machine results in `docs/evidence/ai/ai-eval-results.json`; 5/5 on
  the eight scorecard dimensions (safety, groundedness, correctness, context awareness,
  actionability, personalization, relevance, clarity). This measures Utsav's
  validation/grounding layer, not a live model's fluency.
- Mocked vs live: kept strictly separate. Live smoke exists (`npm run smoke:ai`) and
  **was not run** — no key in this environment; nothing here describes mocked runs as
  live.
- Failure handling: typed notices, built-in fallbacks that answer from the plan's own
  numbers, model-chain fallbacks (tested), rate-limit/timeout paths (tested).

## E. Functional completeness

- Workflow-by-workflow: `PHASE3_FUNCTIONAL_COMPLETENESS.md` — every workflow Pass on
  CRUD, validation, persistence, integration and E2E (with the two N/A cases explained).
- Cross-module integration: all ten §7.3 checks verified with named tests.
- Persistence and migration: storage v3 with safe v0→v3 migration; per-event deep
  validation drops an invalid event alone; recovery card for corrupt storage.
- Mobile verification: full suite on the Pixel 7 profile + 320 px reflow + tablet walk.
- Remaining defects: none open. Disclosed non-defects: no file upload; print verified by
  emulation.

## F. Testing

- Commands and exact counts: `PHASE3_TEST_REPORT.md` §2 — 650 unit/integration
  (0 fail), 77 browser E2E (0 fail, 1 by-design skip), coverage 94.1/83.63/96.47/95.99%
  (every threshold met),
  bundle 115.0/250 KB gz, repo 1.58/10 MB, runtime-dependency audit 0 vulnerabilities
  (one moderate dev-only advisory disclosed in the test report §7), secret scan clean.
  _(Phase 3 snapshot, 2026-10-31 — current generated values: [METRICS.md](METRICS.md)
  and the README.)_
- Machine evidence: `e2e/evidence/e2e-results.json` (Playwright JSON, 77 expected).
- New in Phase 3: 12 accessibility tests, 5 negative/adversarial tests, 1 tablet walk,
  24-scenario AI evaluation, machine-readable evidence files.
- CI: trigger fixed; steps unchanged and unbypassed; traces uploaded on failure.
- CI status in this environment: all steps re-run locally with the recorded results
  (no GitHub run to cite from this sandbox — the push triggers CI for real).

## G. Competition evaluation (independent-judge scorecard)

Internal targets, not claimed official weights. Evidence-first: every score cites runs
or files.

| Dimension               | Before Phase 3 | After Phase 3 | Supporting evidence                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------: | ------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem alignment       |              3 |             4 | Phase 2 had all features but no traceability matrix, no repeatable demo, scattered evidence → now `PHASE3_PROBLEM_ALIGNMENT.md`, `DEMO.md`, R1–R10 verified; capped at 4 because the original challenge statement could not be independently consulted and production AI stays unverified |
| Accessibility           |              3 |             4 | Phase 2: component-level axe + token contrast only, one shipped contrast defect, no keyboard spec → now view×theme axe clean, keyboard journeys, reflow, reduced motion, 6 defects fixed; capped at 4 because no screen-reader testing was possible                                       |
| AI usefulness           |              3 |             4 | Phase 2: guarded routes + fallbacks, no evaluation dataset, context lacked dietary aggregates → now 24-scenario dataset with grounding/safety checks, dietary context, honest mocked/live separation; capped at 4 because live-model fluency could not be measured                        |
| Functional completeness |              4 |             4 | Both states complete with integration evidence; Phase 3 added the summary export and closed the UX audit items; no open defects — stays 4 only for the disclosed file-upload gap and emulation-only print verification                                                                    |
| Testing                 |              4 |             5 | Phase 2: 626 tests + 54 journeys but broken CI trigger, no negative/a11y/tablet E2E → now 650 + 77 with negative, accessibility, tablet layers, machine evidence files, CI fixed and every gate green (coverage-gate drift P3-9 caught and fixed by independent re-verification)          |

**Three strongest aspects**

1. Financial integrity end to end — one money engine behind manual and AI paths, with
   property tests, reconciliation journeys and honest UI states (budget columns match
   the cashflow calendar match the export).
2. Safe AI assistance — proposals are schema-checked, dry-run through the real engine,
   approved by the user, applied as one undoable step, with fallbacks that keep working
   without a key.
3. Reproducible evidence discipline — machine-readable results (axe per view, Playwright
   JSON, AI eval JSON) committed next to the reports that cite them.

**Three remaining weaknesses**

1. Live provider behaviour unverified (no API key in any working environment so far).
2. No screen-reader interaction testing (environmental limitation).
3. Original challenge statement not independently consultable; alignment rests on the
   briefs' own requirement lists.

## H. Production readiness

- Latest production build: verified locally (build + preview + 77 E2E + bundle budget).
- Required API configuration: `GEMINI_API_KEY` server-side only (documented in
  `.env.example`; the app degrades honestly without it — nothing else to configure).
- Live AI requests: **not verified** in the recorded audit (no key) — mocked paths and schemas
  verified. The owner later reported a manual live check on 2026-10-31; no log of it is
  committed, so it is owner-reported and not independently verified. See
  `FINAL_DOCUMENTATION_AUDIT.md`.
- Deployment ready: `vercel.json` reviewed (build, headers incl. strict CSP/HSTS,
  function config); the six serverless routes are guarded and their compiled-ESM import
  bug was already fixed in Phase 1 (verified via local Vercel build then).
- Operational migration: none required; storage migrations are automatic and tested
  (v0/v1/v2 → v3).
- Production deployment **not** re-tested from here (no deploy without authorization);
  the last live check on record is 2026-10-30 (`docs/SPEC.md` R9).

## I. Final limitations

1. Live AI behaviour in production: unverified (no key in this environment). The opt-in
   smoke exists and documents exactly what to run.
2. Screen-reader interaction: untested (no SR available); structure verified by axe only.
3. Original challenge statement: not independently available; alignment derived from the
   project's own requirement records (disclosed at the top of the alignment document).
4. Quotation file upload: intentionally not implemented (pasted text only).
5. Physical-paper print: verified via print-media emulation only.
6. Production deployment: not re-verified from this sandbox (no deploy authorization);
   CI on GitHub will run for the first time on this push for `main` (trigger was broken
   until this phase).
7. Archived events count toward the 12-event storage cap (deliberate; documented).

## J. Final recommendation

**Ready with disclosed limitations.** All critical criteria pass with reproducible
evidence; the limitations above are environmental or deliberate, none hides a broken
workflow. The strongest next steps, in order: run `npm run smoke:ai` with a key on the
deployed app, one NVDA/VoiceOver keyboard pass, and a production URL check after the
next deploy.

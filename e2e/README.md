# Browser E2E — working folder

This folder is the working home for everything browser-level in Utsav: the journey
specifications, the machine-generated output of a run, and the curated evidence that
backs the reports in `docs/`.

```
e2e/
├── specs/       Playwright journey specifications (run against the production build)
├── artifacts/   Machine output of a run: results, traces, HTML report (gitignored)
├── evidence/    Curated, committed evidence produced by real runs (JSON results,
│                screenshots) referenced from docs/PHASE3_TEST_REPORT.md and
│                docs/ACCESSIBILITY_REPORT.md
└── README.md    This file
```

## Running

```bash
npm run test:e2e            # all journeys, desktop + mobile (+ tablet) profiles
npx playwright test --project=desktop          # one profile
npx playwright show-report e2e/artifacts/report # open the HTML report of the last run
```

Ordinary runs never write into the tracked `evidence/` directory — the Git tree stays
clean. Refreshing the committed accessibility evidence is an explicit step:

```bash
npm run evidence:a11y       # re-runs accessibility.spec.ts with UTSAV_WRITE_EVIDENCE=1
```

The suite builds the app first (`vite build`) and serves the real production bundle via
`vite preview` on port 4173 — journeys never run against the dev server. AI endpoints are
mocked per test so runs are deterministic and free; a separate opt-in live-AI smoke
(`npm run smoke:ai`, requires a key in the environment) covers the real provider path and
is never part of CI.

## Artifact policy

- `artifacts/` is a disposable working area: results, traces (`retain-on-failure`) and the
  HTML report land here and are gitignored. Nothing in it is committed.
- `evidence/` holds only what a report cites: small machine-readable results (for example
  axe-core JSON per view and theme) and screenshots captured from real runs. Every file
  here must be regenerable by a documented command in `docs/` — nothing is hand-drawn.
- The axe JSONs are written only by the explicit evidence mode (`npm run evidence:a11y`);
  CI regenerates them and retains the result as a workflow artifact.

## Conventions

- One spec file per concern: `journeys.spec.ts` (product journeys), `accessibility.spec.ts`
  (axe scans + keyboard journeys), and later additions follow the same pattern.
- Journeys reload and re-read storage constantly: persistence bugs cannot hide behind
  in-memory state.
- The two-worker cap and the single shared build keep the suite stable in constrained CI
  environments; do not raise `workers` without a documented reason.

# Metrics — generated from real runs

Every number below comes from a command executed on 2026-10-30 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | FAILED |
| Tests | 360 passed across 23 files |
| Coverage | 95.19% lines, 94.61% statements, 94.25% functions, 83.83% branches |
| Bundle | 89.3 KB gzipped JavaScript |
| Repo size | 0.11 MB (limit 10 MB) |
| npm audit (runtime deps) | clean at high severity |

Reproduce locally:

```bash
npm ci
node scripts/gen-metrics.mjs
```

AI features are not exercised by these checks: they need a `GEMINI_API_KEY` and are
therefore marked **Not run here**. The route tests cover the AI paths with a mocked model.

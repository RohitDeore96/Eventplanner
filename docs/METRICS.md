# Metrics — generated from real runs

Every number below comes from a command executed on 2026-10-31 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | 0 findings |
| Tests | 635 passed across 55 files |
| Coverage | 95.55% lines, 93.69% statements, 95.82% functions, 82.88% branches |
| Bundle | 115.0 KB gzipped JavaScript |
| Repo size | 1.58 MB (limit 10 MB) |
| npm audit (runtime deps) | clean at high severity |

Reproduce locally:

```bash
npm ci
node scripts/gen-metrics.mjs
```

AI features are not exercised by these checks: they need the AI provider key (see
`.env.example`) and are
therefore marked **Not run here**. The route tests cover the AI paths with a mocked model.

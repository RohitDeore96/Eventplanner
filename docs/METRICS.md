# Metrics — generated from real runs

Every number below comes from a command executed on 2026-10-30 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | 0 findings |
| Tests | 517 passed across 42 files |
| Coverage | 95.7% lines, 94.48% statements, 96.07% functions, 84.55% branches |
| Bundle | 102.5 KB gzipped JavaScript |
| Repo size | 0.11 MB (limit 10 MB) |
| npm audit (runtime deps) | clean at high severity |

Reproduce locally:

```bash
npm ci
node scripts/gen-metrics.mjs
```

AI features are not exercised by these checks: they need the AI provider key (see
`.env.example`) and are
therefore marked **Not run here**. The route tests cover the AI paths with a mocked model.

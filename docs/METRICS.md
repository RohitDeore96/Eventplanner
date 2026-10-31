# Metrics — generated from real runs

Every number below comes from a command executed on 2026-10-31 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | 0 findings |
| Tests | 683 passed across 59 files |
| Coverage | 96.32% lines, 94.43% statements, 96.62% functions, 83.67% branches |
| Bundle | 115.5 KB gzipped JavaScript |
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

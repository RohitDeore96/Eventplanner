# Metrics — generated from real runs

Every number below comes from a command executed on 2026-10-31 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | 0 findings |
| Tests | 665 passed across 57 files |
| Coverage | 96.18% lines, 94.29% statements, 96.61% functions, 83.67% branches |
| Bundle | 115.2 KB gzipped JavaScript |
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

# Metrics — generated from real runs

Every number below comes from a command executed on 2026-10-31 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | 0 findings |
| Tests | 517 passed across 42 files |
| Coverage | 95.81% lines, 94.56% statements, 96.37% functions, 84.67% branches |
| Bundle | 102.5 KB gzipped JavaScript |
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

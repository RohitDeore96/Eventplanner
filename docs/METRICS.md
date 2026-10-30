# Metrics — generated from real runs

Every number below comes from a command executed on 2026-10-30 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | 0 findings |
| Tests | 438 passed across 33 files |
| Coverage | 95.44% lines, 94.06% statements, 95.18% functions, 83.24% branches |
| Bundle | 96.6 KB gzipped JavaScript |
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

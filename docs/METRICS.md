# Metrics — generated from real runs

Every number below comes from a command executed on 2026-11-01 by `node scripts/gen-metrics.mjs`.
Nothing here is typed by hand. CI regenerates and re-checks this file.

| Check | Result |
| --- | --- |
| Typecheck | 0 errors |
| Lint (typescript-eslint strictTypeChecked) | 0 findings |
| Tests | 803 passed across 73 files |
| Coverage | 96.65% lines, 94.96% statements, 96.59% functions, 84.69% branches |
| Bundle | 116.2 KB gzipped JavaScript |
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

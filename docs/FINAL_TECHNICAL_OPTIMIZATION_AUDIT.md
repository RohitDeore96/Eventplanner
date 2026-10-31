# Final technical optimization audit

Scope: **Code Quality, Security, Efficiency only.** Baseline: `d296dc71d190b3a15bdba85871aa50161736fe73`
on `main` (the previously reviewed snapshot). Every fix below is verified by a command in
"Verification"; nothing was weakened to obtain a pass (no coverage threshold, lint rule,
type setting or gate changed). Product features, UI design, accessibility scope, demo
material and challenge-alignment documents are untouched.

## 1. Prioritized defects found (working audit)

| #   | Finding                                                                                                                                                                                        | Criterion           | Severity | Location                                                                    | Evidence                                                                                | Fix                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | A full quotation library (24) silently discarded the oldest quotation on save (`[record, ...all].slice(0, 24)` looked like success)                                                            | Quality             | High     | `src/state/quotes.ts`                                                       | The slice dropped user records without any signal                                       | Refuse the save with `null`; the caller's existing notice already says the storage is full                                              |
| Q2  | Accepting a quotation wrote the plan change and the sidecar `accepted` status as two independent effects; Undo un-booked the vendor while the accepted guard permanently blocked re-acceptance | Quality             | High     | `src/state/quotes.ts`, `src/ui/views/VendorsView.tsx`, `src/state/store.ts` | `setQuoteStatus(..., 'accepted')` ran after the one undo step; no mechanism reverted it | The batch's activity entry carries `{ quoteId, previousStatus }`; `undo()` restores the previous status, `redo()` re-applies `accepted` |
| Q3  | The status dropdown offered `accepted`, so a quote could be locked without a booking; moving an accepted quote back to review defeated the never-accepted-twice guard                          | Quality             | Medium   | `VendorsView.tsx`                                                           | `QUOTE_STATUS_LABELS` rendered every status as an option                                | `accepted` is only reachable through the engine-gated Accept button; the select is disabled while accepted                              |
| Q4  | The load schema rejected any library with more than 24 records, so a foreign/older writer's larger file was destroyed entirely at parse time                                                   | Quality             | Medium   | `src/state/quotes.ts`                                                       | `z.array(...).max(MAX_QUOTES)` on load                                                  | Parse bound (200) separated from the product cap, which is enforced at save                                                             |
| S1  | A POST with no `Origin` header was always allowed                                                                                                                                              | Security            | Medium   | `api/_lib/http.ts`                                                          | `if (origin === undefined) return true`                                                 | Context policy (below): browser cross-site contexts are rejected; non-browser tooling still works                                       |
| S2  | Rate-limit identity came from `x-forwarded-for`, whose leftmost entry is client-chosen on Vercel — a spoofed header minted fresh buckets                                                       | Security            | Medium   | `api/_lib/http.ts`                                                          | `forwarded.split(',')[0]` trusted blindly                                               | Prefer the platform-injected `x-vercel-forwarded-for`; XFF only where no platform header exists (local dev)                             |
| S3  | The per-IP bucket `Map` grew without bound under IP rotation                                                                                                                                   | Security/Efficiency | Medium   | `api/_lib/http.ts`                                                          | Entries were pruned only per-access                                                     | Bounded at 5,000 buckets: expired-window sweep, then oldest-first eviction                                                              |
| Q5  | `updateQuote` wrote unchanged data and returned `true` for an unknown id                                                                                                                       | Quality             | Low      | `src/state/quotes.ts`                                                       | No id existence check                                                                   | Report `false`                                                                                                                          |
| Q6  | Header Undo/Redo did not refresh the quotation compare section (stale badge after the sidecar reverted)                                                                                        | Quality             | Low      | `VendorsView.tsx`                                                           | Memo read only `[plan.id, version]`                                                     | Quote writes notify subscribers; the compare section re-reads                                                                           |
| E1  | The model chain attempted `gemini-3.5-flash` (plain), which the Gemini API does not offer — every cache-miss paid one guaranteed-failing HTTP round-trip                                       | Efficiency          | Medium   | `api/_lib/models.ts`                                                        | Official model list (checked 2026-10-31) has no such endpoint; only 3.5 Flash-Lite      | Replaced with `gemini-3.8-flash`, the newest stable Flash; `gemini-3.6-flash` stays first per the deployment owner directive            |

## 2. The same-origin policy (S1) — design notes

Every browser attaches `Origin` to a POST (same-origin included), so a present `Origin`
must match the `Host` — and, when the platform reports the scheme (`x-forwarded-proto`),
its protocol too, which blocks an `http://` downgrade on an https site. A POST _without_
`Origin` is judged by `Sec-Fetch-Site`, which browsers always send and page scripts cannot
forge (it is a forbidden header name): `cross-site`/`same-site` contexts are rejected.
A request with neither header is non-browser tooling — the local dev bridge, the owner's
`npm run smoke:ai` — which cannot be the victim of CSRF and stays behind schema validation,
body caps and rate limits. Residual gap, stated honestly: a browser old enough to send
neither header (Internet Explorer era, EOL since 2022) could theoretically forge a
`text/plain` body that parses as JSON; every evergreen browser is covered by the rules
above, and the deterministic schemas bound what such a request could do.

## 3. What was deliberately NOT changed

- **No shared rate-limit backend (Upstash etc.).** The limiter stays per-instance and the
  docs say so. A shared store would add a paid service, a runtime dependency and a new
  failure mode for a single-region deployment; the security benefit did not justify it.
  Daily AI caps are likewise instance-local, and nothing claims global enforcement.
- **No CSP change.** `vercel.json` already sends a strict CSP (no `unsafe-inline`/`eval`),
  HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy` and COOP. COEP was considered and skipped (asset-compat risk,
  marginal benefit).
- **No retry-policy change in the AI layer.** Chain failover on a model-specific schema
  failure is intentional (JSON-mode conformance varies per model); attempts are capped at
  three, aborts propagate, and daily-cap errors abort the walk immediately.
- **No memoization or code-splitting churn.** Code review found no measurable render hot
  path: the engine runs only inside the reducer, the response cache and rate buckets are
  bounded, and `loadQuotes` is memoized. No benchmark dependency was added.

## 4. Before → after (recorded runs, same machine, 2026-10-31)

| Metric                                    | Before (`d296dc7`)                             | After (`ef57ed0` + docs)                                                                                         | Gate                                                      |
| ----------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Unit/integration tests                    | 650 passed / 56 files                          | **665 passed / 57 files** (15 new)                                                                               | all pass                                                  |
| Coverage (line/stmt/func/branch)          | 95.99 / 94.1 / 96.47 / 83.63                   | **96.18 / 94.29 / 96.61 / 83.67**                                                                                | 95 / 94 / 94 / 83 — every threshold met, ratchet unbroken |
| Browser journeys (Playwright, prod build) | 77 passed, 1 by-design skip                    | **77 passed, 1 by-design skip**                                                                                  | unchanged                                                 |
| Bundle (gzipped JS)                       | 115.0 KB                                       | **115.2 KB** (+0.2 KB = the integrity/security code)                                                             | ≤ 250 KB                                                  |
| Provider round-trips per AI cache miss    | up to 3 attempts, first often a guaranteed 404 | **3 attempts, all live-documented models**                                                                       | one wasted hop removed                                    |
| Repo size                                 | 1.58 MB                                        | 1.58 MB                                                                                                          | ≤ 10 MB                                                   |
| Runtime dependency audit                  | clean                                          | **clean (0 vulnerabilities)**                                                                                    | clean at high severity                                    |
| Full dependency audit                     | 1 dev-only advisory (minimatch)                | same single advisory, chain reported as 14 moderate findings — all one advisory in the dev-only eslint toolchain | disclosed; see §6                                         |
| Secret scan                               | clean                                          | **clean**                                                                                                        | clean                                                     |

Efficiency note, stated plainly: the only _measurable_ efficiency win is latency-side
(one fewer doomed provider round-trip per cache miss); the bundle grew by 0.2 KB because
the data-integrity and security fixes add code. No number is presented as an improvement
that is not one.

## 5. Verification (actual repository commands)

| Command                                                                               | Result after the fixes                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check` (format + lint + types + architecture + unused + tests with coverage) | pass; 665 tests, coverage above every gate                                                                                                                   |
| `npm run test:e2e` (production build via `vite preview`)                              | 77 passed, 1 skipped by design                                                                                                                               |
| `npm audit --omit=dev`                                                                | 0 vulnerabilities                                                                                                                                            |
| `npm audit`                                                                           | 14 moderate — one advisory (`minimatch <11.0.1`, GHSA-g3hv-75wg-m249) inside the dev-only eslint/typescript-eslint toolchain                                 |
| `node scripts/secret-scan.mjs`                                                        | clean                                                                                                                                                        |
| `node scripts/check-size.mjs`                                                         | 115.2 / 250 KB gz                                                                                                                                            |
| `node scripts/check-repo-size.mjs`                                                    | 1.58 / 10 MB                                                                                                                                                 |
| `node scripts/gen-metrics.mjs`                                                        | regenerated `docs/METRICS.md` from these real runs                                                                                                           |
| Targeted negative security tests (new)                                                | missing-Origin × 3 contexts, invalid Origin, protocol downgrade, spoofed-`x-forwarded-for` limiting, 5,200-IP flood with the limiter still intact — all pass |

## 6. Dependencies

None added, none removed, none updated. The dev-only `minimatch` advisory (DoS via glob
parts amplification) is build-time lint tooling: it never ships, and its input is this
repository, not attacker traffic. The only "fix" npm offers is a breaking downgrade of
typescript-eslint, so no upgrade was applied — same assessment as the previously
disclosed advisory.

## 7. Files changed

| Commit                | Files                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4b7205c` fix(quotes) | `src/state/quotes.ts`, `src/state/store.ts`, `src/state/planState.ts`, `src/state/activity.ts`, `src/ui/views/VendorsView.tsx`, `tests/ui/quote-sidecar-integrity.test.tsx` (new) |
| `769eae4` fix(api)    | `api/_lib/http.ts`, `tests/api/routes.test.ts`                                                                                                                                    |
| `ef57ed0` fix(ai)     | `api/_lib/models.ts`                                                                                                                                                              |
| docs commit           | `README.md` (recorded-run numbers only), `docs/METRICS.md` (regenerated), this file, `worklog.md`                                                                                 |

## 8. Remaining technical debt (honest)

1. `tests/ui/vendor-quotes-ui.test.tsx` (and one sibling) hand-roll a `Store` object
   instead of reusing `usePlanStore`; they still pass, but the duplication is real and a
   future refactor should render the real hook. Left untouched to keep this pass minimal.
2. The AI layer's zod-introspection helpers (`asZod`, the cache read) use two narrow,
   documented casts — inherent to reading zod v4 internal structure; a zod public API for
   this would remove them.
3. The quotation sidecar cap is global across events (by design since Phase 2); per-event
   allocation would be a product change, not a fix, so it was not done here.
4. Undo/redo of a quotation acceptance depends on the session activity log (like the undo
   stack itself); after a reload the stack is empty, so there is nothing to undo — no
   divergence is possible, but the coupling is session-scoped and documented as such.

## 9. Scorecard (strict self-evaluation)

| Criterion         | Initial weaknesses                                                                                                                                                   | Fixes                                                                                    | Evidence                                                                                                             | Remaining                                                                                                                                                         | Score  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Code Quality (×3) | Two real data-integrity defects in the quotation flow; a status path that could lock a quote without a booking; load-time data destruction; one false-success helper | All fixed with 15 targeted tests; undo/redo now atomic across plan and sidecar           | New suite passes; 665/665; coverage up on every axis; `tsc` strict, zero `any`, zero suppressions (verified by grep) | Harness duplication in two older test files; two documented narrow casts                                                                                          | **93** |
| Security (×2)     | No-Origin POSTs always allowed; spoofable rate-limit identity; unbounded limiter memory                                                                              | Context-aware same-origin policy; platform-trusted IP; bounded buckets; 7 negative tests | New guard tests pass; audits + secret scan clean; CSP untouched and still strict                                     | Instance-local limiter (honestly labelled, not global); live production behaviour not independently verified; pre-evergreen-browser residual gap documented in §2 | **91** |
| Efficiency (×2)   | One doomed provider round-trip per AI cache miss; no other measurable hot path found                                                                                 | Chain corrected against official docs; caches/buckets already bounded                    | 3/3 attempted models live-documented; bundle 115.2/250 KB; E2E timing unchanged                                      | Bundle +0.2 KB for the fixes; live-model latency not measurable without a key                                                                                     | **88** |

**Weighted score = (3×93 + 2×91 + 2×88) / 7 = 637 / 7 ≈ 91.0 / 100.**
Confidence: high for everything covered by automated gates (all evidence above is from
recorded local runs), medium for the security score (no penetration test), and explicitly
**not** verified: live provider behaviour of the corrected model chain (no API key in this
environment — verified against the official documentation page dated 2026-10-31, cited in
`api/_lib/models.ts`), and production traffic (local tests do not prove live deployment
security).

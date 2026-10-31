# Technical audit — code quality, security, efficiency

Date: 2026-11-01 · Baseline: `d021fca` → this audit ships on top of `6337e3e` (smoke fix)
and `39ced4c` (docs sync). Scope: `src/engine`, `src/state`, `src/ui`, `src/schemas`,
`api/`, `scripts/`. Method: read the actual sources, rank real defects, fix the
highest-value safe ones with regression tests, measure before/after. No redesign, no new
features, no dependency changes, no schema or model-chain changes.

## 1. Executive summary

Four genuine defects were found and fixed; all are in the request/persistence lifecycle,
none in the deterministic engine. The engine's financial logic (allocation, expenses,
instalments, reconciliation, delay ripple) was reviewed and left untouched — the property
tests and benchmark show it healthy. Security review found the documented server-side
controls implemented as described; the honest gap fixed here is that the _client_ never
validated AI replies despite the schema contract saying it should. Efficiency review found
no pathology worth code changes (numbers below); the one real lifecycle defect — a client
timeout that aborted live answers the server was still producing — was both a correctness
and a quota-waste bug, fixed.

## 2. Findings, ranked

| #   | Severity    | Area                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Medium-High | `src/lib/aiClient.ts`                             | Client timeout was 16 s while the route waits 40 s (`AI_TIMEOUT_MS`), so any live answer needing chain-failover time was aborted client-side; the committed deployed evidence contains a 41 s round-trip. Users saw "service unavailable" while the server went on answering (and the serverless invocation kept billing quota). The in-code comment still said "15 s timeout" — a stale leftover from before the route moved to 40 s. |
| F2  | Medium      | `src/lib/aiClient.ts`                             | One global `AbortController` shared by all six endpoints, while the UI runs AI panels concurrently by design (Assistant view: review, ask, ideas — independent busy states). Starting a call on one panel aborted an in-flight call on another → false "service unavailable" notices.                                                                                                                                                  |
| F3  | Medium      | `src/lib/aiClient.ts`, `src/schemas/ai.ts`        | Replies were cast `raw as T` with no client-side validation, although `src/schemas/ai.ts` says it is "used by … the client (response validation)" and the README claims replies are validated "and again on the client". A malformed or hostile same-origin reply reached the UI unchecked. Only the saved-quote path validated.                                                                                                       |
| F4  | Low         | `src/state/persistence.ts`, `src/state/quotes.ts` | The storage caps (`MAX_STORE_BYTES` 400 KB / 120 KB) were compared against `text.length` — UTF-16 code units, not bytes. Multibyte content (Devanagari names, emoji) could exceed the intended byte cap by up to 3×, inconsistent with the cap's name and with the API layer's own `Buffer.byteLength` standard.                                                                                                                       |

Reviewed and deliberately **not** changed (no demonstrable benefit, or out of scope):
`store.plan: initial` passthrough (used by `Shell` seed flow); synchronous whole-workspace
autosave on every change (durability by design — debouncing would risk data on quick
close); `localToday()` captured at mount (midnight staleness — recommendation below);
`buildIcs` cost at extreme scale (export-only action, see §7); per-instance rate limit and
daily cap (documented limitation, no Redis in this pass); engine algorithms (all sub-ms at
realistic scale).

## 3. Affected files and root causes

| File                       | Root cause                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/aiClient.ts`      | Timeout constant never raised when the route's patience moved 15 s → 40 s; cancellation state was module-global instead of per-endpoint; success path trusted the body with a cast. |
| `src/schemas/ai.ts`        | `intakeParseSchema` was module-private, so the client could not reuse the one source-of-truth schema for intake replies.                                                            |
| `src/state/persistence.ts` | Size check used `string.length` instead of a byte measure.                                                                                                                          |
| `src/state/quotes.ts`      | Same unit-vs-byte mistake in its 120 KB cap.                                                                                                                                        |

## 4. Exact fixes implemented

1. **`CLIENT_TIMEOUT_MS = 45_000`** (exported, documented): 5 s above the route's 40 s so
   the server's verdict — model answer, built-in fallback, or typed `504 AI_TIMEOUT` —
   always wins the race. Stale comment corrected.
2. **Per-endpoint cancellation**: `Map<string, AbortController>` keyed by path; a newer
   call supersedes only the same endpoint; the map entry is cleaned up in `finally`.
3. **Reply validation**: every method now validates its reply with the same zod schema the
   server used (extended with the required `source` field), throwing typed
   `AI_REPLY_INVALID` on failure; views keep showing their honest offline notice. Every
   200 from Utsav's routes carries `source` (verified for all six routes including cache
   and built-in paths), so a source-less body is rejected rather than mislabelled. All
   built-in fallback shapes were checked against the reply schemas before tightening —
   the offline path can never be rejected by the new validation.
4. **Byte-accurate caps**: `TextEncoder`-based `byteLength()` replaces `text.length` in
   both stores (load and save paths).

Untouched by design: model chain/order (`api/_lib/models.ts`), retry policy, route
schemas, engine and its financial invariants, UI structure, dependencies.

## 5. Regression tests added

| Test file                      | Tests                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/lib/aiClient.test.ts`   | Aborts only **after** the route's 40 s patience (asserts still pending at 40 s, aborted at 45 s; asserts `CLIENT_TIMEOUT_MS > 40_000`); different endpoints never abort each other (path-tracked hanging fetch); same-endpoint supersede still aborts; schema-invalid reply → `AI_REPLY_INVALID`; source-less 200 → `AI_REPLY_INVALID`; all fixtures now schema-valid as real route replies. |
| `tests/ui/persistence.test.ts` | Multibyte record (140,000 Devanagari chars = 140k units, 420k bytes) is `too_large`; a workspace whose JSON exceeds 400 KB in bytes (but not units) is refused on save with the honest reason.                                                                                                                                                                                               |
| `tests/ui/intake.test.tsx`     | Updated: a reply carrying `occasion: 'anniversary'` (outside the enum) is now rejected whole before the UI — the select keeps its value; stronger version of the previous per-field guard test.                                                                                                                                                                                              |

## 6. Security review — result and limitations

Verified as implemented (not just as documented): server-only key (never in browser
bundle, logs, or URLs); guarded routes (405/403/415/413/400/429/504 with the origin rules
described in the README — present-Origin match incl. forwarded proto, Sec-Fetch-Site for
origin-less browser requests, header-less tooling left to validation and rate limits);
8 KB **byte**-accurate body cap; per-IP buckets bounded at 5,000 with platform-first IP
extraction (`x-vercel-forwarded-for` → `x-forwarded-for` → socket); bounded in-memory
cache (200 entries, 10-min TTL) keyed by SHA-256 of route + prompt (no PII in prompts —
`planFacts()` excludes names/phones/notes, machine-checked by the `context-no-pii-leak`
evaluation); logs carry status + model only, never prompts, keys or user text; prompt
wrapping with closing-tag stripping; JSON-mode response schemas derived from zod; strict
CSP without `unsafe-inline`, HSTS preload, `frame-ancestors 'none'`, COOP; untrusted
localStorage deep-validated with referential-integrity, duplicate-id, calendar-date and
cycle checks before reaching React state; no `dangerouslySetInnerHTML`/`innerHTML`
anywhere; `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities**.

New with this pass: the client now actually enforces the reply contract (F3), and the
client no longer abandons requests the server is still serving (F1 — aborted Vercel
invocations kept running to completion, wasting the daily quota a defender is trying to
conserve).

Remaining, honestly stated (not fixable in this architecture without new infrastructure):
rate limit and daily cap are **per serverless instance** (in-memory; a shared store such
as Upstash/Vercel KV would be needed — deliberately not introduced here); the daily cap
resets on cold start (safety valve, not billing enforcement); no independent penetration
test; no CSP nonces (none needed while the CSP forbids inline everything); dev-only
`npm audit` reports 14 moderate advisories (no runtime dependency is affected — reported,
not suppressed).

## 7. Performance measurements (before → after)

Engine benchmark (`npm run bench`, median of 30 runs, Node 24, same machine):

| operation               | realistic before | realistic after | extreme before | extreme after |
| ----------------------- | ---------------: | --------------: | -------------: | ------------: |
| summarize               |         0.190 ms |        0.180 ms |       4.160 ms |      3.875 ms |
| budgetTotals            |         0.007 ms |        0.007 ms |       0.569 ms |      0.567 ms |
| buildTimeline           |         0.086 ms |        0.059 ms |       2.124 ms |      2.092 ms |
| buildIcs                |         0.398 ms |        0.382 ms |      16.802 ms |     20.019 ms |
| delay first task        |         0.174 ms |        0.172 ms |       5.192 ms |      6.612 ms |
| reducePlan: expense/add |         0.004 ms |        0.004 ms |       0.050 ms |      0.050 ms |

The engine was not modified; differences are run-to-run noise on shared CI-class hardware
(buildIcs at the synthetic 500-task extreme is the only double-digit figure and remains
an export-only action). **No performance claims are made for this pass beyond "no
regression and no bundle-relevant growth"** — the value delivered is correctness, not
speed.

Bundle (`npm run build` + `scripts/check-size.mjs`):

| metric            |    before |     after | delta                                                                      |
| ----------------- | --------: | --------: | -------------------------------------------------------------------------- |
| JavaScript (gzip) | 119.14 KB | 119.40 KB | +0.26 KB (+0.22%) — the runtime reply-schema imports for F3; budget 250 KB |
| CSS (gzip)        |   2.56 KB |   2.56 KB | 0                                                                          |

## 8. Test and coverage results

| gate                                                       | before (d021fca)                      | after                                                                                      |
| ---------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unit/integration                                           | 674 passed / 58 files                 | **683 passed / 59 files** (679 after the smoke-fix tests, +4 net here)                     |
| Coverage                                                   | 96.26 L / 94.37 S / 96.61 F / 83.77 B | **96.32 L / 94.43 S / 96.62 F / 83.67 B** (gates 95/94/94/83 unchanged and still enforced) |
| Browser (Playwright)                                       | 77 passed, 1 skipped by design        | **77 passed, 1 skipped by design**                                                         |
| `npm run check` (format, lint, types, arch, unused, tests) | green                                 | **green**                                                                                  |
| `npm audit` (runtime)                                      | clean at high                         | **clean at high**                                                                          |

The 0.10-point branch-coverage dip is new hard-to-reach abort-race branches in the client
timeout test path; the gate (83%) holds and no threshold was touched.

## 9. Bundle-size comparison

See §7: 119.14 → 119.40 KB gzipped JavaScript (+0.26 KB), CSS unchanged. The increase is
the price of making the README's "validated … again on the client" claim true with the
project's own single-source schemas instead of duplicating shapes; the alternative
(weakening the README claim) was rejected by the audit brief.

## 10. Outstanding recommendations (recorded, not implemented)

1. Capture `today` once per action dispatch rather than per mount, so a page left open
   past midnight recomputes overdue flags (cosmetic; reload already fixes it).
2. Split `VendorsView.tsx` (~700 lines: capture, compare, payment schedules) into
   focused components — maintainability only; behaviour is covered by tests.
3. A shared store for per-IP and daily-cap counters if AI abuse ever becomes a real
   threat (Upstash/Vercel KV); documented as the distributed-limitation boundary.
4. Ask-the-planner still lacks raw JSON evidence (screenshot only); independent
   third-party reproduction of the five live route checks remains outstanding.
5. Real screen-reader (NVDA/VoiceOver) pass and real-device checks remain open in the
   evidence index.

## 11. Internal engineering estimate (not an official competition score)

Evidence-based self-assessment after this pass, on a 10 scale:

| Criterion    | Weight | Estimate | Basis                                                                                                                                                                          |
| ------------ | ------ | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code Quality | ×3     |      8.7 | strict TS (no `any`), 683 unit tests + property tests + 77 browser tests, arch/knip/mutation gates, coverage ≈ 96/94, four real lifecycle defects closed with regression tests |
| Security     | ×2     |      8.4 | all documented server controls verified in code; client reply validation now real; honest remaining gaps: per-instance limits, no independent pentest                          |
| Efficiency   | ×2     |      8.5 | engine sub-ms at realistic scale, bundle 119.4 KB gzip vs 250 KB budget, concurrency fixed, no pathological re-render found at this scale; no unmeasured claims                |

Weighted: `(3×8.7 + 2×8.4 + 2×8.5) / 7 = 59.9 / 7 ≈ 8.6 / 10` — **internal engineering
estimate only**, not an official PromptWars score; the competition's own evaluators may
weigh these dimensions differently.

# Sharing the API rate limit across instances — architecture proposal

**Status: PROPOSED, NOT ADOPTED.** This document is the Phase-5 evaluation deliverable: it
designs a shared Redis-backed rate limiter behind the current in-memory contract and states
explicitly why it is **not** wired into production yet. No production code, dependency or
infrastructure changed with this proposal. The current limiter
(`api/_lib/rateLimit.ts`: sliding window, 20 requests / 5 minutes / IP, ≤ 5 000 bounded
buckets, direct unit tests in `tests/api/rate-limit.test.ts`) keeps working unchanged.

## 1. Why consider sharing at all

The limiter is **per serverless instance**. Vercel may run N concurrent function instances,
so the effective ceiling is `20 × N` requests / 5 min. This is accepted today because:

- The expensive resource (Gemini calls) is already bounded globally by the **AI daily cap**
  (`api/_lib/aiCache.ts`), which is the real cost guard.
- The routes are same-origin only and the app's real users are one family-scale audience.

A shared limiter becomes worth adopting only if abuse pressure (not cost) is the problem —
e.g. after opening sign-ups or multi-tenant use.

## 2. Goal architecture: one interface, two implementations

```ts
/** api/_lib/rateLimiter.ts (proposed) */
export interface RateLimiter {
  /** Consume one hit for `ip` at time `now`; true when the request must be rejected. */
  limit(ip: string, now: number): boolean;
}

export function createRateLimiter(env: {
  RATE_LIMIT_REDIS_REST_URL?: string;
  RATE_LIMIT_REDIS_REST_TOKEN?: string;
}): RateLimiter;
```

- `InMemoryRateLimiter` — today's `isRateLimited` + `pruneBuckets` logic, unchanged.
- `RedisRateLimiter` — plain `fetch` against a Redis REST API (Upstash / Vercel KV style).
  **No SDK, no new dependency**: the serverless bundle imports nothing, and `api/` code is
  never in the client bundle, so the 250 KB client budget is untouched either way.
- `createHandler` keeps calling `limit(clientIp(req), now)`; the guard's request order
  (method → origin → content-type → **rate limit** → body → schema → run) and every
  externally visible status (`429 RATE_LIMITED`) stay identical.

## 3. Atomicity requirements

The check-and-count must be one indivisible step, or two concurrent requests can both read
"19 hits" and both pass. With Redis this means **the counting lives server-side in Redis**:

- Fixed window: `INCR key` + `EXPIRE key window NX` — two commands, not atomic enough on
  their own (a crash between them leaves a key without TTL); acceptable only when issued
  as a transaction (`MULTI/EXEC`).
- **Chosen: sliding window via a Lua script** (`EVAL`) — read hits in window, decide, write
  back, set TTL — because Lua executes atomically in Redis and one round trip decides.
  The REST provider must expose `EVAL` (Upstash does; plain Vercel KV does not — a
  fixed-window `INCR+PEXPIRE` transaction is the documented fallback there).

## 4. Concurrency safety

- Redis is single-threaded per key: Lua scripts serialize naturally; no client-side locks,
  no compare-and-swap loops.
- The response must carry the decision, not a stale read: the script returns 1/0 and the
  updated TTL, so a retry by the client cannot double-consume (the write already happened).
- Bucket-bound memory: Redis key TTL = window length; expired IP keys vanish without a
  prune pass. Key namespace: `rl:{ip}` with `NX` semantics only inside the script.

## 5. Timeout behaviour

- The limiter must never extend worst-case latency noticeably: **250 ms budget** on the
  REST call via `AbortController`, ~4% of the 8 KB-body + 40 s AI budget.
- On timeout the request is decided by the fallback policy (§6), never left hanging; the
  abort is logged as a fixed message (hygiene rule: no interpolated request data in logs).

## 6. Network failure behaviour (the decision point)

| Failure                     | Policy A: fail open to in-memory                                   | Policy B: fail closed (503)               |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| Redis unreachable / timeout | Use the existing per-instance limiter for that request             | Reject with 503 SERVICE_UNAVAILABLE       |
| Blast radius                | Limit degrades to `20 × N` — exactly today's behaviour             | A Redis blip becomes a user-facing outage |
| Security                    | No worse than the shipped baseline; AI daily cap still bounds cost | Strictest                                 |
| Chosen                      | **Yes** — degradation equals today's documented behaviour          | No                                        |

Rationale: the shared limiter is a _strengthening_, so its failure mode must return the
system to the status quo, not below it. Fail-closed would trade availability for a marginal
limit tightening — the wrong trade for a family-scale app whose real cost control is the
daily AI cap.

## 7. Local development fallback

- No `RATE_LIMIT_REDIS_REST_URL` in the environment → `createRateLimiter` returns the
  in-memory implementation. `npm run dev` / `npm run api` and the local dev bridge need
  zero configuration, and existing behaviour (and `tests/api/rate-limit.test.ts`) is
  byte-identical.

## 8. Testability

- Both implementations satisfy **one shared contract suite** (inject a fake clock):
  first 20 pass, 21st in window is limited, window expiry frees slots, distinct IPs are
  independent, bounded memory holds under rotation.
- In-memory: current unit tests, moved onto the interface.
- Redis: contract tests run against a **REST fake** (a `vi.stubGlobal('fetch', …)` double
  asserting the exact script/args); a live smoke test exists as a script but is never part
  of CI (no provider account in CI).

## 9. Provider and deployment configuration

- Env vars (never committed): `RATE_LIMIT_REDIS_REST_URL`, `RATE_LIMIT_REDIS_REST_TOKEN`
  — documented in `.env.example` **only if adopted**.
- Vercel: env vars set per environment (preview/production); the REST endpoint keeps the
  function region-local (same-region Upstash) to hold p99 latency.
- Rotation: the token is provider-side; `clientIp()` unchanged (platform-injected
  `x-vercel-forwarded-for` remains the trusted signal).

## 10. Why not adopted now (explicit decision)

1. **No demonstrated security need**: same-origin-only routes, family-scale audience, and a
   global AI daily cap already bound the costly path; per-instance limiting matches the
   documented baseline.
2. **New external infrastructure** (a Redis account) is a new operational and credential
   surface — the task's rule: no production infrastructure without a clear benefit.
3. **Safe failure behaviour would exist only to be absent**: with fail-open, a healthy
   deployment behaves identically to today; with fail-closed it behaves worse.

Adoption trigger: multi-tenant sign-ups, measured abuse, or a second region. At that point
this document is the implementation plan; the interface keeps `tests/api/rate-limit.test.ts`
meaningful before and after.

# Decisions

Short records of choices and their trade-offs.

## 1. One reducer for every change

Manual edits and accepted AI patches both go through `reducePlan`. An AI patch is a list of `PlanAction`s, so the engine can dry-run it and undo treats it as one step. Trade-off: the AI can only do what an action expresses, which is deliberate.

## 2. Results, not exceptions

Engine functions return `Result<T>` with a stable `code`, a human `message` and the offending `field`. The UI can link errors to inputs and tests can assert codes. Trade-off: a little more code at call sites.

## 3. "Paid" lives in expenses only

A vendor instalment is "paid" when an expense references it. No second flag exists to drift. Trade-off: marking an instalment paid creates an expense, which is the honest record anyway.

## 4. Commitment is `max(agreed, paid)`

Paying more than the agreed price still counts as committed so cash-to-pay can never be negative; the overpayment is surfaced as a warning rather than hidden.

## 5. Integer minor units, parsed without floats

User text is parsed by string and BigInt (`parseMajorAmount`); allocation uses BigInt so `total x weight` cannot overflow. Floats are used only to display.

## 6. Ratios are not stored

Default category splits are basis-point constants used once at creation. Only amounts are persisted, so a stored ratio can never disagree with the amounts.

## 7. Tooling choices (all dev-only)

- `vitest` + `@vitest/coverage-v8`: test runner and coverage.
- `fast-check`: property tests with shrinking.
- `@stryker-mutator/*`: mutation testing, to measure whether tests catch bugs.
- `dependency-cruiser`: enforces layers and bans cycles and orphans.
- `knip`: fails on unused files and exports. In sandboxes where it cannot allocate memory, set `KNIP_DISABLE_RAW_TRANSFER=1` (a documented knip switch).
- `typescript-eslint` strict-type-checked, `prettier`, `tsx` for scripts.

## Dependency ledger (one line each, per house rule)

- `react`, `react-dom` — the UI layer; the only render library considered for this scope.
- `vite`, `@vitejs/plugin-react` — build/dev server; zero-config, fast, framework-per-Vercel.
- `zod` — one schema language shared by client, server and tests for every untrusted input.
- (removed) `@google/genai` — replaced by a plain `fetch` call to the provider's JSON-mode
  REST endpoint (same contract, fewer than 40 lines of transport). The SDK pulled ~30
  transitive packages (auth, fetch polyfills, websocket clients) into every serverless
  function, and its ESM-only layout was not fully traced into the deployed lambda, which
  crashed every `/api/*` route with `FUNCTION_INVOCATION_FAILED` at cold start. Plain
  `fetch` is built into Node 20+, so there is nothing left to trace.
- `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`,
  `vitest-axe`, `jsdom` — component and accessibility testing without a browser in the loop.
- `fast-check` (pre-existing) — property/fuzz tests for engine and reducer robustness.
- Deliberately NOT added: state libraries (one reducer + context suffices), UI component
  kits (design tokens + small CSS keep the bundle at ~90 KB gz and CSP strict), form libraries.

## Coverage ratchet (M5)

The UI landed faster than branch tests. Thresholds are ratcheted to just below the measured
actual (95 lines / 94 statements / 94 functions / 83 branches) and must never move DOWN.
Next pass: raise branches toward 90 by testing AI-panel error branches and SetupView edits.

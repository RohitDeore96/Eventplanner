# Architecture

```
config  <-  engine  <-  schemas  <-  api (Vercel functions)
                    <-  components (React)
```

- `src/config/limits.ts`: every limit and default, imported by everything, imports nothing.
- `src/engine`: pure functions. No UI, no network, no clock (`today` is passed in), no runtime dependencies. Enforced by `.dependency-cruiser.cjs`.
- `src/schemas` (zod contracts, including the patch-union schema), `src/lib` (typed API
  client), `src/state` (store, persistence), `src/ui` (views): all shipped.

## Data flow

```
user edit ---------------------> PlanAction -+
                                              +--> reducePlan --> new Plan --> summarize --> UI
AI text --> patch (validated) --> dry run ----+        ^
                  user accepts --------------> history (one undo step)
```

## AI patch flow (engine side, implemented)

1. A patch is `{ summary, actions[] }` with at most 10 actions, each one of five allowed types.
2. `dryRunPatch` applies the actions to a copy, then `comparePlans` computes exact deltas and new or resolved warnings.
3. If the patch adds an error-level warning, `blockedBy` is non-empty and `applyPatch` refuses.
4. `acceptPatch` pushes the result as a single history entry so one undo reverts it.

The AI call that produces the patch is shipped: `api/propose-patch.ts` builds a
response schema from the same zod union, validates the reply server-side, walks a model
chain with failover, and degrades to a deterministic 503 `AI_UNAVAILABLE` when no key is
configured — the engine, not the model, remains the gate.

## The AI patch flow (added M3)

1. The family types what they want changed in the Assistant tab.
2. The client sends a compact facts summary (built from `summarize`) plus the instruction to
   `POST /api/propose-patch`, guarded like every route.
3. The AI returns a small JSON patch (at most 10 ops of `task/add`, `task/update`,
   `task/delay`, `budget/move`, `category/add`), schema-validated server-side and client-side.
4. The ENGINE dry-runs the patch in the browser (`dryRunPatch`): any change that would
   enlarge an error condition (over-allocation, over-commitment) or introduce a new error is
   blocked with the exact reason.
5. The UI shows the before/after per category plus added/rescheduled tasks. **Apply** goes
   through `acceptPatch` — one undo step. **Reject** touches nothing.

The same shape powers every AI touchpoint: intake, ideas, review, ask-the-planner and quote
extraction all return zod-validated JSON, all degrade to deterministic fallbacks, and none
of them can change the plan without the family's explicit approval.

## The money boundary (Phase 1)

Models are never trusted with exponent arithmetic. Every model-facing amount is a DECIMAL
STRING in MAJOR units (`budgetMajor`, `totalPriceMajor`, `amountMajor`, `plannedMajor`),
exactly as a human writes it. Each serverless route converts it EXACTLY ONCE with the
request currency via `parseMajorAmount()` (BigInt, exponent-aware: JPY 0, INR 2, KWD 3) and
answers with true minor-unit fields; `*Major` values never reach the client. The same
canonical parser serves the typed setup form, which additionally accepts Indian comma
grouping ("8,00,000"). A model amount whose decimals exceed the currency's exponent is
rejected (`502 AI_RESPONSE_INVALID`), never guessed.

## Correctness foundations (Phase 1)

- **Autosave** follows the active plan's lifecycle — every change, undo and redo of the
  current plan is saved; the original seed prop is never used as a proxy for state; a
  refused write surfaces a recoverable message.
- **Currency lock**: `currencyChangeError()` (shared by the reducer and the setup form)
  locks the currency once vendor agreements or payments exist; otherwise a currency change
  requires re-entering the budget fresh in the new currency. Amounts are never converted —
  no exchange rate is ever invented.
- **Deep persistence validation** (`src/state/persistence.ts`): storage is untrusted. Load
  path = size cap → JSON parse → `schemaVersion` migration → deep zod schema for every
  nested record → duplicate-id, supported-currency, real-calendar-date, and
  instalment-belongs-to-its-own-vendor checks → dependency-cycle check. Unusable data never
  reaches React state and is never deleted silently: `loadSavedState()` returns the reason
  plus the untouched raw text, and the app offers an exportable copy plus a fresh start.
- **Legacy cleanup**: the storage model is one active plan under `utsav.plans.v1`; the
  unused `utsav.activeId.v1` key from an abandoned design is scrubbed on save and clear.

# Architecture

```
config  <-  engine  <-  schemas  <-  api (Vercel functions)
                    <-  components (React)
```

- `src/config/limits.ts`: every limit and default, imported by everything, imports nothing.
- `src/engine`: pure functions. No UI, no network, no clock (`today` is passed in), no runtime dependencies. Enforced by `.dependency-cruiser.cjs`.
- `src/schemas`, `src/api`, `src/components`: not built yet.

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

Not built yet: the Gemini call that produces the patch, its schema validation, and the deterministic fallback.

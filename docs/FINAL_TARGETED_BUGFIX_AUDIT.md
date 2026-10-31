# Final targeted bug-fix audit

Date: 2026-10-31 · Baseline commit: `6d2bcb8` (latest `main` at the start of work)

Scope: exactly the three verified defects named in the task. No refactor, no unrelated
improvements, no UI redesign, no documentation changes beyond this report. Existing API
contracts and saved-data formats are unchanged.

## Defect 1 (critical): Redo could re-accept a quotation without its vendor booking

**Reproduction.** In `src/state/store.ts`: (1) accept a quotation — the plan books the
vendor and the sidecar library marks the quote `accepted`; (2) Undo — both sides revert;
(3) make any different event change — this clears the redo step (`push()` resets
`future`); (4) press Redo. The redo is a plan-level no-op, but the quote flipped back to
`accepted` while no vendor was booked.

**Root cause.** The store ran `reapplyEntryQuote(state.log)` _before_ dispatching redo and
never checked that the transition would happen; `reapplyEntryQuote` fished the most recent
reverted entry out of the activity log and set its quote to `accepted` unconditionally.
The same assumption lived in the reducer: `planReducer` flipped the log strike-through
(`markReverted`/`markRedone`) even when `undo()`/`redo()` returned the history unchanged
(both return the same object on a no-op).

**Fix.** Both sides now act only when the history transition actually succeeds:

- `src/state/planState.ts` — the `undo`/`redo` cases compare the history returned by the
  engine with the one they received; on a no-op they return the state untouched (no log
  flip, no side effect).
- `src/state/store.ts` — `undo`/`redo` run the same pure reducer first and call
  `revertEntryQuote`/`reapplyEntryQuote` only when `next.history !== state.history`.

The mirror case (Undo with an empty stack) is closed by the same gate; the no-op-undo
path cannot mis-strike today because log entries map 1:1 to history steps, and a test
now pins that.

**Regression tests** (`tests/ui/quote-sidecar-integrity.test.tsx`, new describe block
"no-op Undo/Redo cannot move the sidecar"): fails against the old code —

- "does not mark an old quotation accepted when Redo has nothing to redo" (the exact
  sequence above; asserts the quote stays `shortlisted`, the plan keeps the second
  change, and the accept entry stays struck);
- "leaves the log untouched when Redo has nothing to redo (pure reducer)";
  plus the guard "leaves the log untouched when Undo has nothing to undo (pure reducer)",
  which passed on the old code as well and pins the symmetric gate.

## Defect 2 (critical): a failed quotation-status write still booked the vendor

**Reproduction.** In `src/ui/views/VendorsView.tsx` `accept()`: the vendor booking
(`store.applyAll`) ran first; `setQuoteStatus(quote.id, 'accepted')` ran after and its
`false` return was ignored. When the sidecar library cannot be written (storage quota
exceeded, 120 KB byte cap, record missing), the vendor stayed booked, the UI announced
"the vendor is booked", and the `accepted` badge — which is the guard that blocks a
second booking — never persisted, so the quotation could be "accepted" again.

**Root cause.** Order of operations: the booking preceded the status write, and the
status write's failure signal was discarded.

**Fix.** `accept()` now writes the status FIRST and aborts on `false` with an honest
notice ("The quotation status could not be saved, so the vendor was not booked. …"), so
a failed write can never leave the vendor booked while the quote keeps its previous
status. If the engine refuses the booking after the status write succeeded, the status
is written back to `previousStatus` (compensation) and the engine's message is shown;
the success notice is unchanged.

**Regression tests** (`tests/ui/quote-accept-failure.test.tsx`, new file): fails against
the old code —

- "does not book the vendor when the accepted status cannot be saved, and says so"
  (stubbed `Storage.prototype.setItem` throws for the quotes key; asserts `applyAll` is
  never attempted, the status is unchanged, and the notice reports the failure);
  plus the guard "restores the previous status when the engine refuses the booking
  afterwards", which passed on the old code as well (the old flow never wrote the status
  when the engine refused first) and pins the new compensating path.

## Defect 3 (security): the 8 KB API body limit measured characters, not bytes

**Reproduction.** In `api/_lib/http.ts` the final body validation compared
`raw.length > BODY_LIMIT_BYTES`. `raw.length` counts UTF-16 code units, so a body of
multibyte characters slips under the check: `'🎉'.repeat(2200)` is 2,200 units but 8,800
UTF-8 bytes (limit 8,192) and was accepted by the size gate.

**Root cause.** The check measured the JavaScript string length instead of the encoded
byte length.

**Fix.** The gate now uses `Buffer.byteLength(raw, 'utf8')`. Both body paths — a raw
string body and a pre-parsed body serialized with `JSON.stringify` — flow through this
single check, so the limit is applied consistently in bytes to both. The streaming
reader already counted chunk bytes and is unchanged.

**Regression tests** (`tests/api/routes.test.ts`, new describe block "body-size is
measured in UTF-8 bytes"): fail against the old code —

- "rejects a multibyte string body whose UTF-8 bytes exceed the 8 KB limit with 413";
- "rejects a serialized object body whose UTF-8 bytes exceed the limit with 413";
  plus guards that passed on the old code as well: a multibyte request inside the limit
  still answers end to end (200), and the ASCII boundary is pinned (8,192 bytes → 400 via
  JSON parsing, 8,193 → 413).

## Files changed

| File                                        | Change                                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `src/state/planState.ts`                    | undo/redo flip the log only when the history moved                |
| `src/state/store.ts`                        | sidecar revert/re-apply gated on the actual transition            |
| `src/ui/views/VendorsView.tsx`              | accept(): status write first, compensation, honest failure notice |
| `api/_lib/http.ts`                          | body limit measured in UTF-8 bytes (`Buffer.byteLength`)          |
| `tests/ui/quote-sidecar-integrity.test.tsx` | +3 tests (2 fail on old code)                                     |
| `tests/ui/quote-accept-failure.test.tsx`    | new file, +2 tests (1 fails on old code)                          |
| `tests/api/routes.test.ts`                  | +4 tests (2 fail on old code)                                     |

## Verification results

All numbers below come from real runs on 2026-10-31 after the fixes:

| Command                                                                      | Result                                                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run check` (prettier, eslint, tsc, arch rules, knip, vitest + coverage) | pass — 674 tests / 58 files, coverage 96.26% lines / 94.37% statements / 96.61% functions / 83.77% branches |
| Regression tests against the unfixed code                                    | 5 of the 9 new tests failed (48 total in the three touched files: 5 failed, 43 passed)                      |
| Regression tests after the fixes                                             | same three files: 48 passed, 0 failed                                                                       |
| `npm run build`                                                              | pass                                                                                                        |
| `node scripts/check-size.mjs`                                                | 115.3 KB gz / 250 KB budget (baseline 115.2 KB)                                                             |
| `node scripts/check-repo-size.mjs`                                           | 1.58 MB / 10 MB                                                                                             |
| `node scripts/secret-scan.mjs`                                               | clean                                                                                                       |

## Remaining limitations

- The status-write failure is handled at the acceptance workflow; the unrelated
  shortlist/reject buttons in the same card (`onStatus`) still ignore `setQuoteStatus`'s
  return value. Out of scope here by the fix-only mandate.
- If the engine refuses a booking AND the compensating status write also fails, the
  quote can remain marked `accepted` without a booking; the notice still reports the
  refused booking. Fully transactional sidecar writes would need a storage redesign and
  were not attempted.
- The undo/redo gate compares history object identity, which relies on
  `undo()`/`redo()` in `src/engine/history.ts` returning the same object on a no-op —
  that behaviour is pinned by the new reducer tests.

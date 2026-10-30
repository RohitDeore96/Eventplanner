# utsav AI

A planner for weddings, birthdays and community events. This repository currently contains the **tested planning engine** only. The UI, API, Gemini integration, persistence and deployment are not built yet; `docs/SPEC.md` has the honest status table.

## What works today

- Integer-only money with largest-remainder allocation, parsed without floats.
- Planned vs committed vs paid per category, an expense log, and vendor payment schedules.
- Task create/edit/delete/reorder with cycle prevention, delay propagation with reasons, and short-notice schedule compression.
- Guests with RSVP, plus-ones and dietary needs feeding a catering requirement.
- Warnings, each with a plain-language fix. Nothing is auto-applied.
- One reducer for every change, a patch dry-run that blocks plan-breaking suggestions, and undo.
- `.ics` export with escaping and line folding.

## Run it

```
npm install
npm run check      # format, lint, types, architecture, dead code, tests with coverage
npm run bench      # engine timings
npm run mutation   # slow: about 3 s per mutant
```

If `knip` fails with an ArrayBuffer error on a small machine, run `KNIP_DISABLE_RAW_TRANSFER=1 npm run unused`.

## Evidence

Numbers live in `docs/METRICS.md` (hand-recorded and dated; no generator yet). Design notes: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.

## Honest limits

- No user interface, server, AI calls, storage, accessibility testing, CI or live deployment yet.
- Mutation testing covers 5 of the engine files so far.
- Default budget splits are assumptions, not quotes or market data.

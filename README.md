<p align="center"><img src="docs/screenshots/utsav-logo.png" alt="Utsav — every utsav, one connected plan" width="360" /></p>

# Utsav

**Every utsav, one connected plan.** A GenAI-powered planner for weddings, birthdays and
community events — budget, timeline, guests and vendors in one place, where every change
updates the rest. Built for Indian families: ₹ with lakh/crore formatting, en-IN locale
defaults, Hinglish-friendly answers, and a festive-but-calm design.

**[🌐 Live app](https://utsav-event-planner.vercel.app)** · status: **Unverified** (deployed from this repo; open the URL to confirm) · MIT license

> **Design rule:** the AI never touches money or dates. A deterministic engine owns all
> arithmetic; Gemini only does what needs language understanding, proposes small patches,
> and the engine dry-runs every patch before you can accept it.

---

## Try it in two minutes

1. Open the app and press **Load demo event** — a full wedding plan with vendors, payments,
   guests and a delayed task appears, so every screen has real data instantly.
2. **Budget**: see planned vs committed vs paid per category, move money between categories,
   log an expense. Totals reconcile everywhere because one engine computes them.
3. **Timeline**: mark a task done, delay another and watch dependants move with reasons.
   Download the whole timeline as a calendar file (.ics).
4. **Guests**: add guests, flip RSVPs, watch the catering headcount and dietary counts update.
5. **Vendors**: add vendors with booking status, paste a quote and let AI read it —
   unstated fields stay empty and the gaps are flagged ("no cancellation policy").
6. **Assistant**: get a plan review and next steps, ask questions in English or Hinglish
   ("Kitna kharcha bacha hai?"), get occasion-tuned ideas, and — the differentiator —
   **ask AI to propose changes**: it returns a patch, the engine dry-runs it, you see the
   exact before/after, and **Apply** makes it one undo step. Reject does nothing at all.
7. **Export JSON / CSV** from the header, or press Reset to start fresh.

Without a `GEMINI_API_KEY` the app keeps working: every AI panel answers from a built-in
planner and says so. Nothing is ever invented.

## What problem this solves

Event planning is a set of **connected** problems: guests drive catering, the budget drives
every category, the venue date drives the whole timeline. Spreadsheets and WhatsApp threads
do not move together. Utsav keeps **one plan** in one reducer; any change — guests, budget,
date, quote, payment, delay — re-runs the engine and every view, warning and readiness
figure updates from the same numbers.

## How the work is split

|                                                       | Deterministic engine (`src/engine`) | Gemini (server only) |
| ----------------------------------------------------- | :---------------------------------: | :------------------: |
| Money: allocation, expenses, payments, reconciliation |                 ✅                  |                      |
| Scheduling, dependencies, delay ripple, .ics          |                 ✅                  |                      |
| Warnings with plain-language fixes                    |                 ✅                  |                      |
| Vetting AI patches (dry-run gate)                     |                 ✅                  |                      |
| Read a free-text event description                    |                                     |          ✅          |
| Read a pasted vendor quote                            |                                     |          ✅          |
| Ideas, plan review, answers grounded in plan facts    |                                     |          ✅          |
| Propose small patches (engine still gates them)       |                                     |          ✅          |

**AI patch flow (X1):** propose → schema-validate → engine dry-run (plan-breaking patches
are blocked) → before/after diff → user accepts (one undo step) or rejects.

## GenAI usage

- **Model chain** (see `api/_lib/models.ts`): `gemini-3.6-flash` first (this deployment's
  provisioned model), then documented fallbacks — `gemini-3.5-flash` → `2.5-flash` →
  Flash-Lite line — from Google's live model documentation. Override with `GEMINI_MODEL`.
- **JSON mode with a schema** generated from the same zod schemas the app uses; output is
  validated on the server (`502 AI_RESPONSE_INVALID` on failure) and again on the client.
- **Prompt-injection guard**: user text is wrapped in data tags with delimiter stripping;
  the model is told never to invent prices, vendors or availability; unknown fields stay null.
- **Guarded routes**: POST-only, same-origin only (403 otherwise), 8 KB body cap, zod
  validation, per-IP rate limit (20/5 min), 15 s timeout, daily AI cap, safe error codes only.
- **Cache**: identical validated requests answer from a 10-minute cache.
- **Fallbacks first**: with no key or AI down, every panel degrades to the built-in planner;
  every reply labels who answered ("answered by gemini-3.6-flash" / "built-in").

## Security

- `GEMINI_API_KEY` is read only inside serverless functions; never in the browser, repo or logs.
- Strict CSP **without `unsafe-inline`**, HSTS, `frame-ancestors 'none'`, nosniff, COOP,
  Referrer-Policy, Permissions-Policy (`vercel.json`).
- Imported JSON and saved plans are untrusted: size cap → schema → migration → engine
  re-validation. The reducer never throws on arbitrary input (fuzz-tested with fast-check).
- Secret scan and `npm audit` in CI; `SECURITY.md` documents the threat model and residual
  risks (the rate limiter and daily cap are per-instance without a shared store — stated plainly).

## Testing

- **341+ tests**: engine unit + property tests (fast-check fuzz: arbitrary JSON as an action
  never throws), API route tests with a mocked model (405/403/415/413/429/503/502 paths),
  component tests for every view, axe accessibility scans on the setup view and all four
  main views in jsdom, token-level WCAG contrast tests in **both themes**.
- `npm run check` = format + lint (typescript-eslint strictTypeChecked) + types +
  architecture rules + unused-code + tests with enforced coverage thresholds.
- Mutation testing is configured (`npm run mutation`); it is a scheduled job, not a per-push gate.

## Accessibility

Skip link, landmarks, labelled inputs, error alerts wired to fields, visible focus rings,
44 px touch targets, `aria-live` for statuses, status always text + icon (never colour
alone), tables with `th scope`, progress bars labelled, light/dark token contrast enforced
by test, `prefers-reduced-motion` / `prefers-contrast` / forced-colours support.
**Not yet tested with real screen readers** — stated honestly.

## Evidence table

Every requirement maps to a file and a command you can run. `npm run check` runs the gates;
`node scripts/gen-metrics.mjs` regenerates `docs/METRICS.md` from real runs.

| ID    | Requirement                                            | Where                                                            | Proof command                             |
| ----- | ------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------- |
| R1    | Create/edit wedding, birthday, community events        | `src/ui/views/SetupView.tsx`, `src/engine/create.ts`             | `npm test -- create`                      |
| R2    | Budget: allocate, expenses, remaining, over-allocation | `src/engine/budget.ts`, `src/ui/views/BudgetView.tsx`            | `npm test -- reducer`                     |
| R3    | Timeline: milestones, overdue, task CRUD, delay        | `src/engine/tasks.ts`, `src/ui/views/TimelineView.tsx`           | `npm test -- timeline`                    |
| R4    | Vendor checklist per occasion with statuses            | `src/ui/views/VendorsView.tsx`, `src/engine/reducers/vendors.ts` | `npm test -- reducer`                     |
| R5    | Personalised ideas (no prices)                         | `api/suggest-ideas.ts`, `src/ui/views/AssistantView.tsx`         | `npm test -- routes`                      |
| R6    | GenAI: intake, review, ask, quote, patches             | `api/*.ts`, `src/schemas/ai.ts`                                  | `npm test -- routes`                      |
| R7    | Guests + RSVP feeding catering                         | `src/engine/guests.ts`, `src/ui/views/GuestsView.tsx`            | `npm test -- guests`                      |
| R8    | Persistence + export with real data                    | `src/state/persistence.ts`, `src/lib/export.ts`                  | `npm test -- persistence`                 |
| R9    | Live on Vercel                                         | `vercel.json`, this repo → Vercel                                | open the live URL                         |
| R10   | Repo under 10 MB                                       | `scripts/check-repo-size.mjs`                                    | `node scripts/check-repo-size.mjs`        |
| Q1    | Enforced layers, strict TS, no dead code               | `.dependency-cruiser.cjs`, `eslint.config.js`, `knip.json`       | `npm run arch && npm run unused`          |
| Q2    | Docs numbers generated from real runs                  | `scripts/gen-metrics.mjs` → `docs/METRICS.md`                    | `node scripts/gen-metrics.mjs`            |
| S1    | Route guards                                           | `api/_lib/http.ts`                                               | `npm test -- routes`                      |
| S2    | Injection + untrusted model output                     | `api/_lib/prompts.ts`, `src/schemas/ai.ts`                       | `npm test -- routes`                      |
| S3    | Strict CSP, zero console errors                        | `vercel.json`                                                    | e2e under production headers (see limits) |
| S4    | Daily AI cap with fallback                             | `api/_lib/gemini.ts`                                             | `npm test -- routes`                      |
| S5    | No secrets, audit, SECURITY.md                         | `scripts/secret-scan.mjs`, `SECURITY.md`                         | `node scripts/secret-scan.mjs`            |
| E1    | Engine does the maths; AI cached/aborted               | `src/engine/*`, `src/lib/aiClient.ts`                            | `npm test -- engine`                      |
| E2    | Bundle budget                                          | `scripts/check-size.mjs`                                         | `node scripts/check-size.mjs`             |
| T1    | Unit, property, API, component, a11y                   | `tests/`                                                         | `npm run test:cov`                        |
| T2    | AI eval vs mock                                        | `tests/api/routes.test.ts`                                       | `npm test -- routes`                      |
| A1    | WCAG 2.1 AA target + token contrast                    | `src/ui/tokens.css`, `tests/ui/tokens.test.ts`                   | `npm test -- tokens`                      |
| A2    | Keyboard-operable journey                              | `src/ui/*` (tabs, forms, focus)                                  | axe scans in component tests              |
| X1    | AI patch → dry-run → approve → undo                    | `src/engine/patch.ts`, `src/ui/views/AiPatchPanel.tsx`           | `npm test -- patch`                       |
| X2/X6 | Scenario comparison / what-if                          | `src/engine/scenario.ts` (engine ready; UI in progress)          | `npm test -- patch`                       |
| X3    | Demo event                                             | `src/state/demo.ts`                                              | `npm test -- demo`                        |
| X4    | Expense log, payment schedule, cash-to-pay             | `src/engine/budget.ts`                                           | `npm test -- reducer`                     |
| X5    | This evidence table                                    | `README.md`                                                      | —                                         |

## Assumptions (all editable in the app)

- Occasion splits (wedding: venue 30%, catering 30%, photography 10%, decor 8%, music 6%,
  attire 6%, contingency 10%) are documented starting points, not market data.
- A scheduled payment (instalment) settles only when summed payments reach its amount;
  partial and multiple payments are supported; overpaying warns.
- The AI's intake and quote readings are suggestions to verify, labelled with their source.

## Honest limits

- The live link is marked **Unverified** until the owner opens it after deploying.
- Rate limiting and the daily AI cap are per serverless instance without Upstash/KV.
- Accessibility is tested with axe in jsdom and token math, not with real screen readers.
- The AI quote reader depends on what the pasted text says; unstated fields stay empty.
- Playwright e2e specs are configured in `tests/ui`; real-browser runs happen in CI (not in
  this repo's local gates) and are on the roadmap below.

## Run it locally

```bash
git clone https://github.com/RohitDeore96/Eventplanner.git
cd Eventplanner
npm install
cp .env.example .env    # optional: add GEMINI_API_KEY for AI features
npm run api             # terminal 1: same handlers Vercel runs, on :8787
npm run dev             # terminal 2: the app on :5173 (proxies /api)
```

| Command                        | What it does                                                     |
| ------------------------------ | ---------------------------------------------------------------- |
| `npm run check`                | format, lint, types, architecture, unused code, tests + coverage |
| `npm test`                     | the whole suite                                                  |
| `npm run build`                | production build                                                 |
| `node scripts/gen-metrics.mjs` | regenerate `docs/METRICS.md` from real runs                      |
| `npm run mutation`             | Stryker mutation testing (slow; scheduled job)                   |

Environment: `GEMINI_API_KEY` (optional — the app is fully usable without it),
`GEMINI_MODEL` (optional; default chain starts at `gemini-3.6-flash`), `AI_DAILY_CAP` (optional).

## Deploy (Vercel)

Import the repo into Vercel (framework: **Vite**), add `GEMINI_API_KEY` (and optionally
`GEMINI_MODEL`, `AI_DAILY_CAP`) under Settings → Environment Variables, deploy. Every push
to `main` redeploys. Security headers come from `vercel.json`; the serverless functions in
`api/` are picked up automatically.

## Docs

[Audit](docs/AUDIT.md) · [Specification](docs/SPEC.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Decisions](docs/DECISIONS.md) · [Metrics](docs/METRICS.md) (generated) · [Security](SECURITY.md)

## License

MIT © Rohit Deore

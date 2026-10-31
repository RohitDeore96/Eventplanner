# Live AI verification

- Date: 2026-10-31
- Deployment: https://eventplanner-mocha.vercel.app/
- Deployed commit: `b55f024` (latest Production deployment on the Vercel Deployments page, see [04-vercel-deployment.png](evidence/04-vercel-deployment.png))
- Local checkout recorded in `deployed-run-summary.txt`: `08441fd`. That checkout was behind the deployed commit when the check ran, so the deployed commit above is the one under test. The PowerShell session was typed from that checkout, but every call targeted the deployed URL — `08441fd` is where the tests were prepared, not the commit that served them. The same Vercel Deployments page shows the earlier `08441fd` deployment (Ready) lower in the list.
- Main run: 2026-10-31 23:13 IST, against the deployed site (not localhost).
- Plan-review follow-up run: 2026-11-01 00:59 IST (2026-10-31 19:29 UTC), also against the deployed site.

## Results per feature

| Feature         | Endpoint                  | Result on the deployed site                                                                                                                                           | Evidence                                                                                                                               |
| --------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Parse intake    | `POST /api/parse-intake`  | `source=gemini-3.5-flash-lite`, 6 s. "5 lakh" returned `budgetMinor=50000000` (correct).                                                                              | [deployed-parse-intake.json](evidence/deployed-parse-intake.json), [deployed-run-summary.txt](evidence/deployed-run-summary.txt)       |
| Suggest ideas   | `POST /api/suggest-ideas` | `source=gemini-3.5-flash-lite`, 2 s (after correcting my test input, see below).                                                                                      | [deployed-suggest-ideas.json](evidence/deployed-suggest-ideas.json), [deployed-run-summary.txt](evidence/deployed-run-summary.txt)     |
| Extract quote   | `POST /api/extract-quote` | Attempt 1: `source=built-in` after 41 s. Attempt 2: `source=gemini-3.5-flash-lite`, `totalPriceMinor=9000000` (correct for Rs 90,000).                                | [deployed-extract-quote.json](evidence/deployed-extract-quote.json), [deployed-run-summary.txt](evidence/deployed-run-summary.txt)     |
| Propose patch   | `POST /api/propose-patch` | `source=gemini-3.5-flash-lite`, 1 s.                                                                                                                                  | [deployed-propose-patch.json](evidence/deployed-propose-patch.json), [deployed-run-summary.txt](evidence/deployed-run-summary.txt)     |
| Ask the planner | `POST /api/ask-planner`   | Answered in the app UI, labelled `gemini-3.5-flash-lite`. Screenshot only; no raw response file saved.                                                                | [05-app-live.png](evidence/05-app-live.png)                                                                                            |
| Plan review     | `POST /api/review-plan`   | `source=gemini-3.6-flash`, HTTP 200 (2026-11-01, one call). Every figure in the summary matches the facts sent; `nextSteps` has 3 items, within the schema's maximum. | [deployed-review-plan.json](evidence/deployed-review-plan.json), [deployed-review-plan-run.txt](evidence/deployed-review-plan-run.txt) |

## Provider behavior observed

`gemini-3.6-flash` (first in the model chain) returned HTTP 429 or 503 on most recent calls, and `gemini-3.8-flash` returned 503 or 429. The fallback chain then reached `gemini-3.5-flash-lite`, which answered. The Vercel Runtime Logs show these `[ai] ... -> HTTP 429/503` lines ([02-vercel-runtime-logs.png](evidence/02-vercel-runtime-logs.png)).

Consequence: the live evidence above was produced by `gemini-3.5-flash-lite`, not by the first-choice model, for the four routes run on 2026-10-31. The 2026-11-01 plan-review call, however, was answered directly by `gemini-3.6-flash` — the chain's first, owner-selected entry — so the first-choice model has now also been observed answering live. Earlier console runs the same evening were observed by hand but not machine-captured or retained; they appeared to show `gemini-3.6-flash` answering parse-intake, suggest-ideas and extract-quote on the deployed site. The machine-captured local run of `npm run smoke:ai` — which passed all four endpoints on a live model — is committed verbatim at [evidence/ai/live-smoke-2026-10-31.txt](evidence/ai/live-smoke-2026-10-31.txt).

## Failures and test errors, recorded as they happened

- `extract-quote` attempt 1 returned `built-in` after 41 s because the live models returned errors. This is the fallback behaving as designed; it is not live-model evidence. Attempt 2 reached the live model.
- `propose-patch` returned `504 AI_TIMEOUT` twice earlier in the evening (visible as 504 rows in [03-vercel-request-logs.png](evidence/03-vercel-request-logs.png)), before it passed.
- `suggest-ideas` attempts 1 and 2 returned `INVALID_INPUT` because the test used `occasion="anniversary"`, which the API rejects. This was a test input error, not an app fault. Attempt 3 used `occasion="birthday"` and passed ([01b-powershell-suggest-ideas.png](evidence/01b-powershell-suggest-ideas.png)).
- An HTTP 200 alone does not prove a live answer, because the routes return 200 with a built-in result when the model fails. The `source` field in each response is the proof.

## Plan review follow-up (2026-11-01)

`/api/review-plan` — the one route without a live check after the 2026-10-31 session — was exercised against the deployed site on 2026-11-01 00:59 IST: one POST with a valid `facts` payload (a small milestone plan), no `Origin` header (plain curl — non-browser tooling, which the route's documented origin policy handles by deterministic validation and rate limits), and no client-side key: the deployed function used its own server-side key.

The response was HTTP 200 with `source=gemini-3.6-flash` — a real model, not `built-in` and not `cache` — and every figure in the summary (₹500,000 budget, ₹180,000 committed, ₹50,000 paid, ₹320,000 remaining, ₹90,000 Lotus Florals, 3/12 tasks, 49 days, 2026-12-20) matches the facts exactly; nothing was invented. Raw response: [deployed-review-plan.json](evidence/deployed-review-plan.json); the exact request, timing and runner: [deployed-review-plan-run.txt](evidence/deployed-review-plan-run.txt).

Honest scope: this call was executed by the project's AI assistant from its own development sandbox — the maintainer side, not the owner's machine and not an independent third party. It closes the plan-review live gap for the deployed site, but it does not provide independent reproduction. Ask-the-planner remains screenshot-only UI evidence.

## How to reproduce

Without a key (the deployed site holds the key server-side), PowerShell:

```powershell
$base = "https://eventplanner-mocha.vercel.app"
$h = @{ origin = $base }
$body = @{ occasion="birthday"; vibe="garden brunch"; guests=30 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/suggest-ideas" -Headers $h -ContentType "application/json" -Body $body
```

Change the inputs on each run, otherwise the answer is served from cache and `source` says `cache`. The response includes a `source` field naming the model that answered.

With your own key, locally:

```powershell
git clone https://github.com/RohitDeore96/Eventplanner.git
cd Eventplanner
npm install
$env:GEMINI_API_KEY = "<your own key>"
npm run smoke:ai
```

## Evidence files

| File                                                                          | What it shows                                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-powershell-run.png](evidence/01-powershell-run.png)                       | The full PowerShell session: the four test calls to the deployed URL, the retry loop, and the printed per-attempt results                                       |
| [01b-powershell-suggest-ideas.png](evidence/01b-powershell-suggest-ideas.png) | The corrected `suggest-ideas` attempt (`occasion="birthday"`) answering `source=gemini-3.5-flash-lite`, and the evidence folder listing                         |
| [02-vercel-runtime-logs.png](evidence/02-vercel-runtime-logs.png)             | Vercel Runtime Logs: the route-side `[ai]` failover lines (`gemini-3.6-flash`/`gemini-3.8-flash` → HTTP 429/503)                                                |
| [03-vercel-request-logs.png](evidence/03-vercel-request-logs.png)             | Vercel Request Logs: 200 rows for the four routes and ask-planner, the two `INVALID_INPUT` 400s on `suggest-ideas`, and the two earlier 504s on `propose-patch` |
| [04-vercel-deployment.png](evidence/04-vercel-deployment.png)                 | Vercel Deployments page: `b55f024` **Ready** in **Production**, with the earlier `08441fd` deployment visible lower in the same list                            |
| [05-app-live.png](evidence/05-app-live.png)                                   | The deployed app UI: Ask-the-planner answered in Hinglish, labelled "Answered by gemini-3.5-flash-lite"                                                         |
| [06-summary-file.png](evidence/06-summary-file.png)                           | `type docs\evidence\deployed-run-summary.txt` — the on-disk summary matching the transcript                                                                     |
| [deployed-parse-intake.json](evidence/deployed-parse-intake.json)             | Raw response, `source=gemini-3.5-flash-lite`, `budgetMinor=50000000` ("5 lakh")                                                                                 |
| [deployed-suggest-ideas.json](evidence/deployed-suggest-ideas.json)           | Raw response, `source=gemini-3.5-flash-lite`                                                                                                                    |
| [deployed-extract-quote.json](evidence/deployed-extract-quote.json)           | Raw response, `source=gemini-3.5-flash-lite`, `totalPriceMinor=9000000` (Rs 90,000)                                                                             |
| [deployed-propose-patch.json](evidence/deployed-propose-patch.json)           | Raw response, `source=gemini-3.5-flash-lite`, one task add plus one 8000 budget move                                                                            |
| [deployed-run-summary.txt](evidence/deployed-run-summary.txt)                 | The per-attempt transcript including the failed attempts, verbatim from the PowerShell session                                                                  |
| [deployed-review-plan.json](evidence/deployed-review-plan.json)               | Raw plan-review response from 2026-11-01, `source=gemini-3.6-flash`, summary grounded in the facts sent                                                         |
| [deployed-review-plan-run.txt](evidence/deployed-review-plan-run.txt)         | The plan-review run record: exact request, HTTP status, timestamp, runner and the honesty scope                                                                 |

## Status

Verified by the repository author on 2026-10-31 for parse-intake, suggest-ideas, extract-quote and propose-patch (deployed), with ask-planner shown by screenshot. Plan review was verified on the deployed site on 2026-11-01 by the project's AI assistant from the maintainer side — the same party that maintains the repository, so this is not independent reproduction. All five POST routes now have deployed live-model evidence; ask-the-planner has screenshot evidence only. Independent reproduction by a third party has not been performed.

# Security policy — Utsav

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main`  | yes       |

## Reporting a vulnerability

Open a private security advisory via GitHub ("Security" → "Report a vulnerability") or email the owner. Please do not open a public issue for anything exploitable. You will get a response within a week.

## Threat model (honest, current)

Utsav is a local-first single-page app plus small serverless functions that call the
hosted AI provider.

| Asset                 | Threat                                                      | Mitigation                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`      | Theft                                                       | Read only from `process.env` inside `api/` functions; never shipped to the browser, never logged, never committed; `.env` gitignored; secret scan in CI                                                                                                                                                                                                         |
| AI provider quota     | Abuse by third parties                                      | Same-origin check (403 for cross-site), POST-only routes, per-IP rate limit, 8 KB body cap, daily AI cap with graceful fallback                                                                                                                                                                                                                                 |
| AI output             | Prompt injection through pasted quotes, intake text or chat | User text is wrapped as DATA with delimiter stripping; the model is told to treat it as data and never invent prices/vendors; all output is validated against zod schemas before it reaches the client                                                                                                                                                          |
| AI output             | Unvalidated content                                         | JSON-mode + schema, server-side zod parse (`502 AI_RESPONSE_INVALID` on failure), client validates again; nothing is rendered as HTML (React escapes; no `dangerouslySetInnerHTML`)                                                                                                                                                                             |
| Imported/shared plans | Malicious JSON                                              | Size cap, deep nested-record schema, duplicate-id/currency/calendar-date/cross-vendor checks, then full engine re-validation; migrations run before validation; unusable stored data is quarantined behind a recovery notice with an exportable copy — never loaded, never silently deleted; the engine's reducer never throws on arbitrary input (fuzz-tested) |
| Browser               | XSS, clickjacking, sniffing                                 | Strict CSP without `unsafe-inline`, `frame-ancestors 'none'`, HSTS, `nosniff`, COOP, Referrer-Policy, Permissions-Policy (set in `vercel.json`)                                                                                                                                                                                                                 |
| User data             | Loss/leak                                                   | Plans live in the browser's localStorage and never leave the device; there are no accounts and no server-side plan storage                                                                                                                                                                                                                                      |

## Known residual risks (stated plainly)

- The rate limiter and daily AI cap are **per serverless instance** (in-memory). Without a shared store (Upstash/Vercel KV), a determined attacker multiplies their budget by the instance count. The code isolates this in one module so a shared store can be added without touching handlers.
- CSP allows `connect-src 'self'` only; if the provider were called from the client one day, this must be revisited. It is not
  today.
- Accessibility is tested with axe in jsdom, not with real screen readers; claims are limited accordingly.
- The daily AI cap counter resets when an instance cold-starts; it is a safety valve, not billing enforcement.

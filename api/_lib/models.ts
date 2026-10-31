/**
 * Model chain — ONE place for model names, sourced from Google's live documentation
 * (ai.google.dev/gemini-api/docs/models, checked 2026-10-31): newest stable Flash first,
 * then older Flash lines, skipping previews. Verified against that page on 2026-10-31:
 * - `gemini-3.5-flash` (plain) is NOT offered on the Gemini API (only 3.5 Flash-Lite) and
 *   was removed — it made every cache-miss pay one guaranteed-failing round-trip.
 * - `gemini-3.8-flash` is the newest stable Flash and is now the second attempt.
 * - The 2.5 models are served "until further notice" but access-limited to pre-existing
 *   users; `gemini-2.5-flash-lite` stays as the last-resort entry for keys that have it.
 * `GEMINI_MODEL` overrides the chain (one name or a comma-separated list).
 * Never hard-code a model name anywhere else.
 */

const DOCUMENTED_CHAIN = [
  // Deployment choice: this deployment's key is provisioned for gemini-3.6-flash first
  // (owner directive, 2026-10-30); the rest are live-documented fallbacks, newest first.
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
] as const;

export function modelChain(): readonly string[] {
  const override = process.env.GEMINI_MODEL?.trim();
  if (override !== undefined && override.length > 0) {
    const custom = override
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (custom.length > 0) {
      return [...new Set([...custom, ...DOCUMENTED_CHAIN])];
    }
  }
  return DOCUMENTED_CHAIN;
}

/** How many models may fail before the endpoint gives up and the fallback answers. */
export const MAX_MODEL_ATTEMPTS = 3;

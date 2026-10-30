/**
 * Model chain — ONE place for model names, sourced from Google's live documentation
 * (ai.google.dev/gemini-api/docs/models and the model lifecycle page), checked 2026-10-30:
 * newest stable Flash first, then older Flash, then the Flash-Lite line, skipping previews.
 * `GEMINI_MODEL` overrides the chain (one name or a comma-separated list).
 * Never hard-code a model name anywhere else.
 */

const DOCUMENTED_CHAIN = [
  // Deployment choice: this deployment's key is provisioned for gemini-3.6-flash first
  // (owner directive, 2026-10-30); the rest are live-documented fallbacks, newest first.
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
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

import { z } from 'zod';
import { modelChain, MAX_MODEL_ATTEMPTS } from './models.js';
import { systemPrompt } from './prompts.js';
import { cacheGet, cacheKey, cacheSet, checkDailyCap } from './aiCache.js';
import {
  asZod,
  extractJson,
  extractText,
  fillNullables,
  toResponseSchema,
  type GenerateContentReply,
} from './geminiSchema.js';

const API_ORIGIN = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The single AI entry point: one `fetch` call to the provider's JSON-mode REST endpoint with
 * a response schema derived from zod (geminiSchema.ts), a model chain with failover, a
 * 10-minute cache (aiCache.ts) and a daily global cap. Uses plain `fetch` (no provider SDK)
 * so serverless bundling stays tiny and deterministic. Fails closed: the caller's
 * deterministic fallback answers when anything here throws.
 *
 * Server logs here are fixed messages only — no prompts, no keys, no user text, no
 * interpolated request data. The thrown typed errors carry the machine-readable detail.
 */

export interface GenerateOptions<T> {
  /** Route name; also the first part of the cache key. */
  readonly name: string;
  /** What the model is being asked to do (goes into the system prompt). */
  readonly role: string;
  readonly userPrompt: string;
  readonly schema: z.ZodType<T>;
  readonly signal: AbortSignal;
}

/**
 * One validated AI response. Walks the model chain; validates with zod; throws typed
 * errors the route maps to safe status codes. Cached for 10 minutes on success.
 */
export async function generateJson<T>(
  options: GenerateOptions<T>,
): Promise<{ body: T; model: string }> {
  const key = cacheKey(options.name, options.userPrompt);
  const cached = cacheGet(key);
  if (cached !== undefined) {
    // The cache only ever stores values already validated against this schema.
    const body = cached as T;
    return { body, model: 'cache' };
  }
  checkDailyCap();

  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (apiKey.length === 0) throw new Error('AI_UNAVAILABLE');

  const responseSchema = toResponseSchema(asZod(options.schema));
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt(options.role) }] },
    contents: [{ role: 'user', parts: [{ text: options.userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  };
  let lastError: Error = new Error('AI_UNAVAILABLE');

  for (const model of modelChain().slice(0, MAX_MODEL_ATTEMPTS)) {
    try {
      const response = await fetch(`${API_ORIGIN}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: options.signal,
      });
      const rawText = await response.text();
      let reply: GenerateContentReply;
      try {
        reply = JSON.parse(rawText) as GenerateContentReply;
      } catch {
        // Upstream error pages are not always JSON (HTML/plain). Still a failed attempt.
        lastError = new Error(`AI_HTTP_${response.status}`, { cause: 'non-JSON reply' });
        console.error('[ai] the provider returned a non-JSON reply');
        continue;
      }
      if (!response.ok) {
        lastError = new Error(`AI_HTTP_${response.status}`, { cause: reply.error?.message });
        console.error('[ai] the provider replied with an HTTP error status');
        continue;
      }
      const candidate = fillNullables(extractJson(extractText(reply)), asZod(options.schema));
      const parsed = options.schema.safeParse(candidate);
      if (!parsed.success) {
        lastError = new Error('AI_RESPONSE_INVALID', { cause: parsed.error });
        console.error('[ai] the provider reply failed schema validation');
        continue;
      }
      cacheSet(key, parsed.data);
      return { body: parsed.data, model };
    } catch (error) {
      // Preserve the original abort signal error so runGuarded can map it to 504.
      if (options.signal.aborted) throw error;
      if (error instanceof Error && error.message === 'AI_DAILY_CAP') throw error;
      if (error instanceof Error && error.message === 'AI_RESPONSE_INVALID') lastError = error;
    }
  }
  throw lastError;
}

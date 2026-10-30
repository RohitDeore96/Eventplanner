import { createHash } from 'node:crypto';
import { z } from 'zod';
import { modelChain, MAX_MODEL_ATTEMPTS } from './models';
import { systemPrompt } from './prompts';

/**
 * The single AI entry point: one `fetch` call to the provider's JSON-mode REST endpoint with
 * a response schema derived from zod, a model chain with failover, a 10-minute cache, and a
 * daily global cap. Uses plain `fetch` (no provider SDK) so serverless bundling stays tiny
 * and deterministic. Fails closed: the caller's deterministic fallback answers when anything
 * here throws.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { readonly at: number; readonly body: unknown }>();
const MAX_CACHE_ENTRIES = 200;

let dailyCount = { day: '', hits: 0 };

function dailyCap(): number {
  const parsed = Number(process.env.AI_DAILY_CAP);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2000;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkDailyCap(): void {
  const day = todayStamp();
  if (dailyCount.day !== day) dailyCount = { day, hits: 0 };
  dailyCount.hits += 1;
  if (dailyCount.hits > dailyCap()) throw new Error('AI_DAILY_CAP');
}

function cacheKey(name: string, payload: unknown): string {
  const normalized = JSON.stringify(payload);
  return createHash('sha256').update(`${name}:${normalized}`).digest('hex');
}

function cacheGet(key: string): unknown {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.body;
}

function cacheSet(key: string, body: unknown): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), body });
}

const API_ORIGIN = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Runtime view of a zod v4 schema node; every node exposes `def.type`. */
interface ZodNode {
  readonly def: {
    readonly type: string;
    readonly shape?: Record<string, ZodNode>;
    readonly element?: ZodNode;
    readonly innerType?: ZodNode;
    readonly options?: readonly ZodNode[];
  };
}

/** Builds a JSON-mode response schema from a zod schema (object/string/number/array/boolean/enum/null). */
function toResponseSchema(node: z.ZodType): Record<string, unknown> {
  const def = (node as unknown as ZodNode).def;
  switch (def.type) {
    case 'object': {
      const shape = def.shape ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [name, child] of Object.entries(shape)) {
        properties[name] = toResponseSchema(child as unknown as z.ZodType);
        if (child.def.type !== 'optional') required.push(name);
      }
      return { type: 'object', properties, required, propertyOrdering: Object.keys(properties) };
    }
    case 'array':
      return { type: 'array', items: toResponseSchema(def.element as unknown as z.ZodType) };
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
      return {
        type: 'string',
        enum: (def.options ?? []).map((option) => {
          const literal = option.def as unknown as { value?: unknown };
          return literal.value;
        }),
      };
    case 'optional':
    case 'nullable': {
      const inner = toResponseSchema(def.innerType as unknown as z.ZodType);
      return def.type === 'nullable' ? { ...inner, nullable: true } : inner;
    }
    default:
      return { type: 'string' };
  }
}

/** Shape of the provider's JSON reply; only the fields we read are modelled. */
interface GenerateContentReply {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly error?: { readonly message?: string };
}

function extractText(reply: GenerateContentReply): string {
  const parts = reply.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (text.length === 0 && reply.promptFeedback?.blockReason !== undefined) {
    throw new Error('AI_RESPONSE_INVALID');
  }
  return text;
}

function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('AI_RESPONSE_INVALID');
  }
}

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

  const responseSchema = toResponseSchema(options.schema);
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
      const reply = (await response.json()) as GenerateContentReply;
      if (!response.ok) {
        lastError = new Error(`AI_HTTP_${response.status}`, { cause: reply.error?.message });
        continue;
      }
      const parsed = options.schema.safeParse(extractJson(extractText(reply)));
      if (!parsed.success) {
        lastError = new Error('AI_RESPONSE_INVALID', { cause: parsed.error });
        continue;
      }
      cacheSet(key, parsed.data);
      return { body: parsed.data, model };
    } catch (error) {
      if (options.signal.aborted) throw new Error('AbortError', { cause: error });
      if (error instanceof Error && error.message === 'AI_DAILY_CAP') throw error;
      if (error instanceof Error && error.message === 'AI_RESPONSE_INVALID') lastError = error;
    }
  }
  throw lastError;
}

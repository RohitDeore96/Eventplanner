import { createHash } from 'node:crypto';
import { z } from 'zod';
import { modelChain, MAX_MODEL_ATTEMPTS } from './models.js';
import { systemPrompt } from './prompts.js';

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

/**
 * Runtime view of a zod v4 schema node. Only the def fields this module reads are typed;
 * zod v4 keeps literals in `def.values` and enums in `def.entries`.
 */
interface ZodSchema {
  readonly def: ZodDef;
}
interface ZodDef {
  readonly type: string;
  readonly shape?: Record<string, ZodSchema>;
  readonly element?: ZodSchema;
  readonly innerType?: ZodSchema;
  readonly options?: readonly ZodSchema[];
  readonly entries?: Record<string, unknown>;
  readonly values?: readonly unknown[];
}

function asZod(value: unknown): ZodSchema {
  return value as ZodSchema;
}

function isOptionalish(node: ZodSchema): boolean {
  return node.def.type === 'optional' || node.def.type === 'nullable';
}

function enumValues(def: ZodDef): unknown[] {
  // zod v4 enums carry `entries` (a record of string -> value); literals carry `values`.
  const raw = def.entries ?? [];
  return Array.isArray(raw) ? [...raw] : Object.values(raw);
}

function unwrapInner(def: ZodDef): Record<string, unknown> {
  return def.innerType === undefined ? { type: 'string' } : toResponseSchema(def.innerType);
}

/** Builds a JSON-mode response schema from a zod schema (object/string/number/array/boolean/enum/literal/union/null). */
function toResponseSchema(node: ZodSchema): Record<string, unknown> {
  const def = node.def;
  switch (def.type) {
    case 'object':
      return objectToResponseSchema(def.shape ?? {});
    case 'array': {
      if (def.element === undefined) return { type: 'string' };
      return { type: 'array', items: toResponseSchema(def.element) };
    }
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
    case 'literal':
      return { type: 'string', enum: enumValues(def) };
    case 'union':
      return { anyOf: (def.options ?? []).map(toResponseSchema) };
    case 'nullable':
      return { ...unwrapInner(def), nullable: true };
    case 'optional':
      return unwrapInner(def);
    default:
      return { type: 'string' };
  }
}

function objectToResponseSchema(shape: Record<string, ZodSchema>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, child] of Object.entries(shape)) {
    properties[name] = toResponseSchema(child);
    // The provider rejects schemas where a nullable field is also required, so nullable
    // fields stay optional; fillNullables() re-adds explicit nulls before zod validation.
    if (!isOptionalish(child)) required.push(name);
  }
  return { type: 'object', properties, required, propertyOrdering: Object.keys(properties) };
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

/**
 * The provider may omit a nullable field entirely; the zod contract wants an explicit null.
 * Walks the value against the schema and injects null for missing nullable keys, so one
 * flexible wire format still validates strictly. Unions are matched by their `type` literal.
 */
function fillNullables(value: unknown, node: ZodSchema): unknown {
  const def = node.def;
  switch (def.type) {
    case 'object':
      return fillObject(value, def.shape ?? {});
    case 'array': {
      const element = def.element;
      if (element === undefined || !Array.isArray(value)) return value;
      return value.map((item) => fillNullables(item, element));
    }
    case 'nullable': {
      const inner = def.innerType;
      if (value === undefined || value === null || inner === undefined) return value;
      return fillNullables(value, inner);
    }
    case 'union':
      return fillUnion(value, def.options ?? []);
    default:
      return value;
  }
}

function fillObject(value: unknown, shape: Record<string, ZodSchema>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [name, child] of Object.entries(shape)) {
    if (out[name] === undefined) {
      if (child.def.type === 'nullable') out[name] = null;
      continue;
    }
    out[name] = fillNullables(out[name], child);
  }
  return out;
}

/** A union member is chosen by its `type` literal tag, matching the patch action shapes. */
function fillUnion(value: unknown, options: readonly ZodSchema[]): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const tag = (value as Record<string, unknown>).type;
  for (const option of options) {
    const tagValues = option.def.shape?.type?.def.values;
    if (tagValues !== undefined && tagValues[0] === tag) {
      return fillNullables(value, option);
    }
  }
  return value;
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
        console.error(`[ai] ${options.name}: ${model} -> HTTP ${response.status} (non-JSON reply)`);
        continue;
      }
      if (!response.ok) {
        lastError = new Error(`AI_HTTP_${response.status}`, { cause: reply.error?.message });
        // Server log only: status and the provider's own reason. No prompts, no key, no user text.
        console.error(`[ai] ${options.name}: ${model} -> HTTP ${response.status}`);
        continue;
      }
      const candidate = fillNullables(extractJson(extractText(reply)), asZod(options.schema));
      const parsed = options.schema.safeParse(candidate);
      if (!parsed.success) {
        lastError = new Error('AI_RESPONSE_INVALID', { cause: parsed.error });
        console.error(`[ai] ${options.name}: ${model} -> reply failed schema validation`);
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

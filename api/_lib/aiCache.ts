import { createHash } from 'node:crypto';

/**
 * The AI response cache and the daily global cap. Successful provider replies are cached
 * for 10 minutes (bounded map, oldest entry evicted first) so identical prompts within a
 * session never cost another provider call; the daily cap bounds the total number of
 * outbound calls per serverless day. Cache entries are only ever stored AFTER zod
 * validation, so a cache hit is as trustworthy as a fresh reply.
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

/** Counts one outbound attempt against the daily cap; throws the typed cap error when exceeded. */
export function checkDailyCap(): void {
  const day = todayStamp();
  if (dailyCount.day !== day) dailyCount = { day, hits: 0 };
  dailyCount.hits += 1;
  if (dailyCount.hits > dailyCap()) throw new Error('AI_DAILY_CAP');
}

/** Cache key: the route name plus a digest of the exact prompt — never the API key. */
export function cacheKey(name: string, payload: unknown): string {
  const normalized = JSON.stringify(payload);
  return createHash('sha256').update(`${name}:${normalized}`).digest('hex');
}

export function cacheGet(key: string): unknown {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.body;
}

export function cacheSet(key: string, body: unknown): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), body });
}
